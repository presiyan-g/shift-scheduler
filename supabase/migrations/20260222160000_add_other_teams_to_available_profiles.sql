-- Drop and recreate get_available_profiles_for_team with added other_teams column
DROP FUNCTION IF EXISTS public.get_available_profiles_for_team(uuid);

CREATE FUNCTION public.get_available_profiles_for_team(target_team_id uuid)
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
    ORDER BY p.full_name;
END;
$$;
