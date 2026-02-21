-- ============================================================
-- 1. Add team_id to shifts
-- ============================================================
ALTER TABLE public.shifts
  ADD COLUMN team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL;

CREATE INDEX idx_shifts_team ON public.shifts (team_id);

-- ============================================================
-- 2. Helper function: is the current user an admin?
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- ============================================================
-- 3. Drop old global manager policies on shifts
-- ============================================================
DROP POLICY IF EXISTS "Managers and admins can view all shifts" ON public.shifts;
DROP POLICY IF EXISTS "Managers and admins can insert shifts"   ON public.shifts;
DROP POLICY IF EXISTS "Managers and admins can update shifts"   ON public.shifts;
DROP POLICY IF EXISTS "Managers and admins can delete shifts"   ON public.shifts;
-- KEEP: "Employees can view own shifts" — unchanged

-- ============================================================
-- 4. New admin policies on shifts (global access)
-- ============================================================
CREATE POLICY "Admins can view all shifts"
  ON public.shifts FOR SELECT
  USING (public.is_admin());

CREATE POLICY "Admins can insert any shift"
  ON public.shifts FOR INSERT
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update any shift"
  ON public.shifts FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can delete any shift"
  ON public.shifts FOR DELETE
  USING (public.is_admin());

-- ============================================================
-- 5. New manager policies on shifts (team-scoped)
-- ============================================================
CREATE POLICY "Managers can view team shifts"
  ON public.shifts FOR SELECT
  USING (public.is_team_manager_of(team_id));

CREATE POLICY "Managers can insert team shifts"
  ON public.shifts FOR INSERT
  WITH CHECK (public.is_team_manager_of(team_id));

CREATE POLICY "Managers can update team shifts"
  ON public.shifts FOR UPDATE
  USING (public.is_team_manager_of(team_id))
  WITH CHECK (public.is_team_manager_of(team_id));

CREATE POLICY "Managers can delete team shifts"
  ON public.shifts FOR DELETE
  USING (public.is_team_manager_of(team_id));

-- ============================================================
-- 6. Update profiles policies: scope manager visibility to teams
-- ============================================================
DROP POLICY IF EXISTS "Admins and managers can view all profiles" ON public.profiles;

CREATE POLICY "Admins can view all profiles"
  ON public.profiles FOR SELECT
  USING (public.is_admin());

CREATE POLICY "Managers can view team member profiles"
  ON public.profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.team_members my_membership
      JOIN public.team_members their_membership
        ON my_membership.team_id = their_membership.team_id
      WHERE my_membership.profile_id = auth.uid()
        AND my_membership.role = 'manager'
        AND their_membership.profile_id = profiles.id
    )
  );
