-- ============================================================
-- 1. Teams table
-- ============================================================
CREATE TABLE public.teams (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  description TEXT DEFAULT '',
  created_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reuse existing trigger function for updated_at
CREATE TRIGGER teams_updated_at
  BEFORE UPDATE ON public.teams
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- 2. Team members junction table
-- ============================================================
CREATE TABLE public.team_members (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id    UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('manager', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_id, profile_id)
);

CREATE INDEX idx_team_members_team    ON public.team_members (team_id);
CREATE INDEX idx_team_members_profile ON public.team_members (profile_id);

-- ============================================================
-- 3. Helper function: check if current user is a manager of a given team
--    SECURITY DEFINER bypasses RLS to avoid self-reference recursion
--    on the team_members table.
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_team_manager_of(check_team_id UUID)
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
      AND role = 'manager'
  );
$$;

-- ============================================================
-- 4. RLS — teams
-- ============================================================
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

-- Admins: full CRUD on all teams
CREATE POLICY "Admins can manage all teams"
  ON public.teams FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Managers: read teams they manage
CREATE POLICY "Managers can view own teams"
  ON public.teams FOR SELECT
  USING (public.is_team_manager_of(id));

-- Members: read teams they belong to
CREATE POLICY "Members can view own teams"
  ON public.teams FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.team_members
      WHERE team_members.team_id = teams.id
        AND team_members.profile_id = auth.uid()
    )
  );

-- ============================================================
-- 5. RLS — team_members
-- ============================================================
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

-- Admins: full CRUD
CREATE POLICY "Admins can manage all team members"
  ON public.team_members FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Managers: view members of teams they manage
CREATE POLICY "Managers can view members of own teams"
  ON public.team_members FOR SELECT
  USING (public.is_team_manager_of(team_id));

-- Managers: add members to teams they manage
CREATE POLICY "Managers can insert members to own teams"
  ON public.team_members FOR INSERT
  WITH CHECK (public.is_team_manager_of(team_id));

-- Managers: remove members from teams they manage
CREATE POLICY "Managers can delete members from own teams"
  ON public.team_members FOR DELETE
  USING (public.is_team_manager_of(team_id));

-- Members: view their own membership rows
CREATE POLICY "Members can view own memberships"
  ON public.team_members FOR SELECT
  USING (profile_id = auth.uid());
