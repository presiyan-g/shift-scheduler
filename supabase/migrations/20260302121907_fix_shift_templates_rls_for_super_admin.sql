-- Drop existing policies that hardcode role = 'admin' (excludes super_admin)
DROP POLICY "Admins and managers can create shift templates" ON public.shift_templates;
DROP POLICY "Admins and managers can update shift templates" ON public.shift_templates;
DROP POLICY "Admins and managers can delete shift templates" ON public.shift_templates;

-- Recreate with is_admin() which includes both admin and super_admin
CREATE POLICY "Admins and managers can create shift templates"
  ON public.shift_templates FOR INSERT TO authenticated
  WITH CHECK (
    is_admin()
    OR EXISTS (SELECT 1 FROM public.team_members WHERE profile_id = auth.uid() AND role = 'manager')
  );

CREATE POLICY "Admins and managers can update shift templates"
  ON public.shift_templates FOR UPDATE TO authenticated
  USING (
    is_admin()
    OR EXISTS (SELECT 1 FROM public.team_members WHERE profile_id = auth.uid() AND role = 'manager')
  )
  WITH CHECK (
    is_admin()
    OR EXISTS (SELECT 1 FROM public.team_members WHERE profile_id = auth.uid() AND role = 'manager')
  );

CREATE POLICY "Admins and managers can delete shift templates"
  ON public.shift_templates FOR DELETE TO authenticated
  USING (
    is_admin()
    OR EXISTS (SELECT 1 FROM public.team_members WHERE profile_id = auth.uid() AND role = 'manager')
  );
