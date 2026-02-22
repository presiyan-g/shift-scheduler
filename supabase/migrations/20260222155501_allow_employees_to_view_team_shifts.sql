-- Allow any team member to see shifts of teammates in a shared team.
-- The shift must have a team_id and the viewing user must be a member of that team.
-- The existing "Employees can view own shifts" policy still covers unteamed shifts.
CREATE POLICY "Employees can view teammate shifts in shared teams"
  ON public.shifts FOR SELECT
  USING (
    team_id IS NOT NULL
    AND public.is_team_member_of(team_id)
  );
