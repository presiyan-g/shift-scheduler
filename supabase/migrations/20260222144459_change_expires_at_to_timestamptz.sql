-- ============================================================
-- 1. Change expires_at from DATE to TIMESTAMPTZ
-- ============================================================
ALTER TABLE public.shift_transfer_requests
  ALTER COLUMN expires_at SET DATA TYPE TIMESTAMPTZ
  USING (expires_at::TIMESTAMPTZ);

-- ============================================================
-- 2. Update expire_transfer_requests() to compare against now()
-- ============================================================
CREATE OR REPLACE FUNCTION public.expire_transfer_requests()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  expired_count integer;
BEGIN
  UPDATE public.shift_transfer_requests
  SET status     = 'expired',
      updated_at = now()
  WHERE status IN ('pending_target', 'pending_manager')
    AND expires_at <= now();

  GET DIAGNOSTICS expired_count = ROW_COUNT;
  RETURN expired_count;
END;
$$;

-- ============================================================
-- 3. Update approve_shift_transfer() to use timestamp comparison
-- ============================================================
CREATE OR REPLACE FUNCTION public.approve_shift_transfer(request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request  public.shift_transfer_requests%ROWTYPE;
  v_shift    public.shifts%ROWTYPE;
BEGIN
  -- Lock and fetch the request
  SELECT * INTO v_request
  FROM public.shift_transfer_requests
  WHERE id = request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer request not found';
  END IF;

  IF v_request.status <> 'pending_manager' THEN
    RAISE EXCEPTION 'Request is not in pending_manager status (current: %)', v_request.status;
  END IF;

  IF NOT (public.is_admin() OR public.is_team_manager_of(v_request.team_id)) THEN
    RAISE EXCEPTION 'Not authorized to approve this request';
  END IF;

  -- Fetch and lock the shift
  SELECT * INTO v_shift
  FROM public.shifts
  WHERE id = v_request.shift_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shift not found';
  END IF;

  IF v_shift.employee_id <> v_request.requester_id THEN
    RAISE EXCEPTION 'Shift no longer belongs to the requester';
  END IF;

  IF v_shift.status <> 'scheduled' THEN
    RAISE EXCEPTION 'Shift is no longer in scheduled status';
  END IF;

  -- Block transfer if the shift has already started
  IF (v_shift.shift_date + v_shift.start_time) <= now() THEN
    RAISE EXCEPTION 'Cannot transfer a shift that has already started';
  END IF;

  -- Transfer ownership
  UPDATE public.shifts
  SET employee_id = v_request.target_id,
      updated_at  = now()
  WHERE id = v_shift.id;

  -- Mark request as approved
  UPDATE public.shift_transfer_requests
  SET status     = 'approved',
      updated_at = now()
  WHERE id = request_id;

  -- Cancel any other pending requests for this shift (defensive)
  UPDATE public.shift_transfer_requests
  SET status     = 'cancelled',
      updated_at = now()
  WHERE shift_id = v_shift.id
    AND id <> request_id
    AND status IN ('pending_target', 'pending_manager');
END;
$$;
