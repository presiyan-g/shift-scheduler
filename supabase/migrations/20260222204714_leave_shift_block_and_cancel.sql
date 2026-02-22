-- ============================================================
-- 1. Trigger function: block scheduling shifts during approved leave
-- ============================================================
CREATE OR REPLACE FUNCTION public.prevent_shift_during_leave()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_leave RECORD;
BEGIN
  -- Only block creating/updating a shift to 'scheduled' status
  IF NEW.status <> 'scheduled' THEN
    RETURN NEW;
  END IF;

  SELECT id, start_date, end_date, leave_type INTO v_leave
  FROM public.leave_requests
  WHERE employee_id = NEW.employee_id
    AND status = 'approved'
    AND start_date <= NEW.shift_date
    AND end_date   >= NEW.shift_date
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'LEAVE_CONFLICT: % from % to %',
      v_leave.leave_type, v_leave.start_date, v_leave.end_date;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER prevent_shift_during_approved_leave
  BEFORE INSERT OR UPDATE ON public.shifts
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_shift_during_leave();

-- ============================================================
-- 2. RLS policy: managers can cancel approved leave requests
-- ============================================================
CREATE POLICY "Managers can cancel approved leave requests"
  ON public.leave_requests
  FOR UPDATE
  USING (
    status = 'approved'
    AND EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.profile_id = leave_requests.employee_id
        AND public.is_team_manager_of(tm.team_id)
    )
  )
  WITH CHECK (status = 'cancelled');
