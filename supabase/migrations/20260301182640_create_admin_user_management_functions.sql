-- 1. SECURITY DEFINER function to toggle user active status.
--    Enforces all deactivation business rules at DB level.
CREATE OR REPLACE FUNCTION public.toggle_user_active(
  target_user_id UUID,
  new_status BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_role public.app_role;
  target_role public.app_role;
BEGIN
  -- Get caller's role
  SELECT role INTO caller_role
  FROM public.profiles
  WHERE id = auth.uid();

  IF caller_role IS NULL THEN
    RAISE EXCEPTION 'Caller profile not found';
  END IF;

  -- Only admins and super_admins can call this
  IF caller_role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'Not authorized: only admins can change user status';
  END IF;

  -- Cannot toggle yourself
  IF auth.uid() = target_user_id THEN
    RAISE EXCEPTION 'Cannot change your own active status';
  END IF;

  -- Get target's role
  SELECT role INTO target_role
  FROM public.profiles
  WHERE id = target_user_id;

  IF target_role IS NULL THEN
    RAISE EXCEPTION 'Target user not found';
  END IF;

  -- Super admin can never be deactivated
  IF target_role = 'super_admin' THEN
    RAISE EXCEPTION 'Cannot deactivate a super admin';
  END IF;

  -- Regular admin can only deactivate employees (not other admins)
  IF caller_role = 'admin' AND target_role = 'admin' THEN
    RAISE EXCEPTION 'Admins cannot change the status of other admins';
  END IF;

  -- Update profiles.is_active
  UPDATE public.profiles
  SET is_active = new_status
  WHERE id = target_user_id;

  -- Update auth.users.banned_until
  --   Deactivate: banned_until = infinity (user cannot log in)
  --   Reactivate: banned_until = NULL (user can log in again)
  IF new_status = FALSE THEN
    UPDATE auth.users
    SET banned_until = 'infinity'::timestamptz
    WHERE id = target_user_id;
  ELSE
    UPDATE auth.users
    SET banned_until = NULL
    WHERE id = target_user_id;
  END IF;
END;
$$;

-- 2. Function to get all users for the admin page.
--    Returns profiles joined with auth.users email + team memberships as JSONB.
--    Only callable by admins/super_admins.
CREATE OR REPLACE FUNCTION public.get_all_users_admin()
RETURNS TABLE (
  id UUID,
  full_name TEXT,
  email TEXT,
  role public.app_role,
  is_active BOOLEAN,
  avatar_url TEXT,
  created_at TIMESTAMPTZ,
  teams JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Only admins and super_admins can call this
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
    SELECT
      p.id,
      p.full_name,
      u.email::TEXT,
      p.role,
      p.is_active,
      p.avatar_url,
      p.created_at,
      COALESCE(
        (
          SELECT jsonb_agg(jsonb_build_object(
            'team_id', t.id,
            'team_name', t.name,
            'team_role', tm.role
          ) ORDER BY t.name)
          FROM public.team_members tm
          JOIN public.teams t ON t.id = tm.team_id
          WHERE tm.profile_id = p.id
        ),
        '[]'::jsonb
      ) AS teams
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.id
    ORDER BY
      -- Super admins first, then admins, then employees
      CASE p.role
        WHEN 'super_admin' THEN 0
        WHEN 'admin' THEN 1
        ELSE 2
      END,
      p.full_name;
END;
$$;

-- 3. Update get_available_profiles_for_team to exclude inactive users.
CREATE OR REPLACE FUNCTION public.get_available_profiles_for_team(target_team_id uuid)
RETURNS TABLE (id uuid, full_name text, role public.app_role, other_teams text[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verify caller is admin OR manager of this specific team
  IF NOT (
    public.is_admin()
    OR public.is_team_manager_of(target_team_id)
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
    SELECT
      p.id,
      p.full_name,
      p.role,
      ARRAY(
        SELECT t.name
        FROM public.team_members tm2
        JOIN public.teams t ON t.id = tm2.team_id
        WHERE tm2.profile_id = p.id
        AND tm2.team_id != target_team_id
        ORDER BY t.name
      ) AS other_teams
    FROM public.profiles p
    WHERE p.id NOT IN (
      SELECT tm.profile_id
      FROM public.team_members tm
      WHERE tm.team_id = target_team_id
    )
    AND p.is_active = TRUE  -- Exclude inactive users
    ORDER BY p.full_name;
END;
$$;
