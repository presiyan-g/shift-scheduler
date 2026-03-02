-- Allows a super_admin to promote an employee to admin or demote an admin to employee.
-- All authorization rules are enforced at the DB level (SECURITY DEFINER).
CREATE OR REPLACE FUNCTION public.change_user_role(
  target_user_id UUID,
  new_role       public.app_role
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_role public.app_role;
  target_role public.app_role;
BEGIN
  SELECT role INTO caller_role
  FROM public.profiles
  WHERE id = auth.uid();

  IF caller_role IS NULL THEN
    RAISE EXCEPTION 'Caller profile not found';
  END IF;

  IF caller_role <> 'super_admin' THEN
    RAISE EXCEPTION 'Not authorized: only super_admins can change user roles';
  END IF;

  IF auth.uid() = target_user_id THEN
    RAISE EXCEPTION 'Cannot change your own role';
  END IF;

  IF new_role NOT IN ('admin', 'employee') THEN
    RAISE EXCEPTION 'Invalid target role: only admin or employee are permitted';
  END IF;

  SELECT role INTO target_role
  FROM public.profiles
  WHERE id = target_user_id;

  IF target_role IS NULL THEN
    RAISE EXCEPTION 'Target user not found';
  END IF;

  IF target_role = 'super_admin' THEN
    RAISE EXCEPTION 'Cannot change the role of a super_admin';
  END IF;

  IF target_role = new_role THEN
    RETURN; -- no-op: role already set (handles double-submit race)
  END IF;

  UPDATE public.profiles
  SET role = new_role
  WHERE id = target_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.change_user_role(UUID, public.app_role)
  TO authenticated;
