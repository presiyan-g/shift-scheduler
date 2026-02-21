-- 1. Create the enum type
CREATE TYPE public.team_role AS ENUM ('manager', 'member');

-- 2. Drop the dependent policy on profiles that references team_members.role
DROP POLICY IF EXISTS "Managers can view team member profiles" ON public.profiles;

-- 3. Drop the existing CHECK constraint on role
ALTER TABLE public.team_members
  DROP CONSTRAINT IF EXISTS team_members_role_check;

-- 4. Convert the column from text to enum
ALTER TABLE public.team_members
  ALTER COLUMN role DROP DEFAULT,
  ALTER COLUMN role TYPE public.team_role USING role::public.team_role,
  ALTER COLUMN role SET DEFAULT 'member'::public.team_role;

-- 5. Recreate the dependent policy on profiles
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
