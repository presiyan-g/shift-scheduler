-- Helper function: is the current user a member of the given team?
-- Mirrors is_team_manager_of() but without the role filter.
CREATE OR REPLACE FUNCTION public.is_team_member_of(check_team_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members
    WHERE team_id = check_team_id
      AND profile_id = auth.uid()
  );
$$;

-- team_members: employees see all members of their own teams
CREATE POLICY "Members can view members of own teams"
  ON public.team_members FOR SELECT
  USING (public.is_team_member_of(team_id));

-- profiles: employees see profiles of same-team members
CREATE POLICY "Members can view team member profiles"
  ON public.profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.team_members
      WHERE team_members.profile_id = profiles.id
        AND public.is_team_member_of(team_members.team_id)
    )
  );
