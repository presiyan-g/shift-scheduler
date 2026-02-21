-- ============================================================
-- SECURITY DEFINER function: get available profiles for a team
-- Returns profiles not yet in the given team.
-- Only callable by admins or managers of that team.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_available_profiles_for_team(target_team_id uuid)
RETURNS TABLE (id uuid, full_name text, role public.app_role)
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
    SELECT p.id, p.full_name, p.role
    FROM public.profiles p
    WHERE p.id NOT IN (
      SELECT tm.profile_id
      FROM public.team_members tm
      WHERE tm.team_id = target_team_id
    )
    ORDER BY p.full_name;
END;
$$;
