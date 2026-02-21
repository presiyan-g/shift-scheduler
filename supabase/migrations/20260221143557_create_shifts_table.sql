-- Create shift_status enum
CREATE TYPE public.shift_status AS ENUM ('scheduled', 'completed', 'cancelled');

-- Create shifts table
CREATE TABLE public.shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT '',
  shift_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  status public.shift_status NOT NULL DEFAULT 'scheduled',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reusable helper function: check if current user is manager or admin
CREATE OR REPLACE FUNCTION public.is_manager_or_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('admin', 'manager')
  );
$$;

-- Indexes
CREATE INDEX idx_shifts_employee_date ON public.shifts (employee_id, shift_date);
CREATE INDEX idx_shifts_date ON public.shifts (shift_date);

-- Refactor existing profiles policy to use the new helper function
DROP POLICY IF EXISTS "Admins and managers can view all profiles" ON public.profiles;
CREATE POLICY "Admins and managers can view all profiles"
  ON public.profiles FOR SELECT
  USING (public.is_manager_or_admin());

-- Enable RLS
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;

-- Employees see own shifts
CREATE POLICY "Employees can view own shifts"
  ON public.shifts FOR SELECT
  USING (auth.uid() = employee_id);

-- Managers/admins see all shifts
CREATE POLICY "Managers and admins can view all shifts"
  ON public.shifts FOR SELECT
  USING (public.is_manager_or_admin());

-- Managers/admins can insert shifts
CREATE POLICY "Managers and admins can insert shifts"
  ON public.shifts FOR INSERT
  WITH CHECK (public.is_manager_or_admin());

-- Managers/admins can update shifts
CREATE POLICY "Managers and admins can update shifts"
  ON public.shifts FOR UPDATE
  USING (public.is_manager_or_admin())
  WITH CHECK (public.is_manager_or_admin());

-- Managers/admins can delete shifts
CREATE POLICY "Managers and admins can delete shifts"
  ON public.shifts FOR DELETE
  USING (public.is_manager_or_admin());

-- Reuse existing updated_at trigger
CREATE TRIGGER shifts_updated_at
  BEFORE UPDATE ON public.shifts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();
