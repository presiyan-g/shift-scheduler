-- Fix infinite recursion: replace direct profiles queries with SECURITY DEFINER helper

-- 1. team_members: replace admin policy
DROP POLICY IF EXISTS "Admins can manage all team members" ON public.team_members;
CREATE POLICY "Admins can manage all team members"
  ON public.team_members FOR ALL
  USING (public.is_admin());

-- 2. teams: replace admin policy
DROP POLICY IF EXISTS "Admins can manage all teams" ON public.teams;
CREATE POLICY "Admins can manage all teams"
  ON public.teams FOR ALL
  USING (public.is_admin());
