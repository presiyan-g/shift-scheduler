-- ============================================================
-- Remove 'manager' from app_role enum
-- ============================================================

-- 1. Convert existing global managers to employees
UPDATE public.profiles SET role = 'employee' WHERE role = 'manager';

-- 2. Drop unused helper function
DROP FUNCTION IF EXISTS public.is_manager_or_admin();

-- 3. Recreate app_role enum without 'manager'
ALTER TYPE public.app_role RENAME TO app_role_old;
CREATE TYPE public.app_role AS ENUM ('admin', 'employee');
ALTER TABLE public.profiles
  ALTER COLUMN role DROP DEFAULT,
  ALTER COLUMN role TYPE public.app_role USING role::text::public.app_role,
  ALTER COLUMN role SET DEFAULT 'employee'::public.app_role;
DROP TYPE public.app_role_old;
