CREATE TABLE public.shift_templates (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT        NOT NULL,
  start_time  TIME        NOT NULL,
  end_time    TIME        NOT NULL,
  notes       TEXT        NOT NULL DEFAULT '',
  color       TEXT        DEFAULT NULL,
  created_by  UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER update_shift_templates_updated_at
  BEFORE UPDATE ON public.shift_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.shift_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view shift templates"
  ON public.shift_templates FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins and managers can create shift templates"
  ON public.shift_templates FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    OR EXISTS (SELECT 1 FROM public.team_members WHERE profile_id = auth.uid() AND role = 'manager')
  );

CREATE POLICY "Admins and managers can update shift templates"
  ON public.shift_templates FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    OR EXISTS (SELECT 1 FROM public.team_members WHERE profile_id = auth.uid() AND role = 'manager')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    OR EXISTS (SELECT 1 FROM public.team_members WHERE profile_id = auth.uid() AND role = 'manager')
  );

CREATE POLICY "Admins and managers can delete shift templates"
  ON public.shift_templates FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    OR EXISTS (SELECT 1 FROM public.team_members WHERE profile_id = auth.uid() AND role = 'manager')
  );
