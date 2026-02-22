-- ============================================================
-- Leave Requests Feature Migration
-- ============================================================

-- 1. Enums
CREATE TYPE public.leave_type AS ENUM ('sick', 'vacation', 'personal', 'other');
CREATE TYPE public.leave_request_status AS ENUM ('pending', 'approved', 'rejected', 'cancelled');

-- 2. Table
CREATE TABLE public.leave_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  start_date    DATE NOT NULL,
  end_date      DATE NOT NULL,
  leave_type    public.leave_type NOT NULL,
  status        public.leave_request_status NOT NULL DEFAULT 'pending',
  employee_note TEXT NOT NULL DEFAULT '',
  manager_note  TEXT NOT NULL DEFAULT '',
  reviewed_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT valid_date_range CHECK (end_date >= start_date)
);

-- 3. Indexes
CREATE INDEX idx_leave_requests_employee    ON public.leave_requests (employee_id);
CREATE INDEX idx_leave_requests_status      ON public.leave_requests (status);
CREATE INDEX idx_leave_requests_dates       ON public.leave_requests (start_date, end_date);
CREATE INDEX idx_leave_requests_reviewed_by ON public.leave_requests (reviewed_by);

-- 4. updated_at trigger
CREATE TRIGGER leave_requests_updated_at
  BEFORE UPDATE ON public.leave_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- 5. Enable RLS
ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;

-- SELECT: employees see own
CREATE POLICY "Employees can view own leave requests"
  ON public.leave_requests FOR SELECT
  USING (auth.uid() = employee_id);

-- SELECT: managers see requests from employees in their teams
CREATE POLICY "Managers can view leave requests from their teams"
  ON public.leave_requests FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.profile_id = leave_requests.employee_id
        AND public.is_team_manager_of(tm.team_id)
    )
  );

-- SELECT: admins see all
CREATE POLICY "Admins can view all leave requests"
  ON public.leave_requests FOR SELECT
  USING (public.is_admin());

-- INSERT: employees submit for themselves only
CREATE POLICY "Employees can submit leave requests for themselves"
  ON public.leave_requests FOR INSERT
  WITH CHECK (auth.uid() = employee_id);

-- UPDATE: employees can cancel own pending requests
CREATE POLICY "Employees can cancel own pending leave requests"
  ON public.leave_requests FOR UPDATE
  USING (
    auth.uid() = employee_id
    AND status = 'pending'
  )
  WITH CHECK (
    auth.uid() = employee_id
    AND status = 'cancelled'
  );

-- UPDATE: managers can approve/reject pending requests from their team
CREATE POLICY "Managers can review team leave requests"
  ON public.leave_requests FOR UPDATE
  USING (
    status = 'pending'
    AND EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.profile_id = leave_requests.employee_id
        AND public.is_team_manager_of(tm.team_id)
    )
  )
  WITH CHECK (
    status IN ('approved', 'rejected')
  );

-- UPDATE: admins can update any leave request
CREATE POLICY "Admins can update any leave request"
  ON public.leave_requests FOR UPDATE
  USING (public.is_admin());

-- ============================================================
-- 6. Function: get_conflicting_shifts
--    Returns the employee's scheduled shifts that overlap the
--    leave period. Includes a flag if a pending transfer exists.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_conflicting_shifts(p_request_id UUID)
RETURNS TABLE (
  shift_id             UUID,
  title                TEXT,
  shift_date           DATE,
  start_time           TIME,
  end_time             TIME,
  team_id              UUID,
  team_name            TEXT,
  has_pending_transfer BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.leave_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_request
  FROM public.leave_requests
  WHERE id = p_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Leave request not found';
  END IF;

  -- Only managers of the employee's teams (or admins) can call this
  IF NOT (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.profile_id = v_request.employee_id
        AND public.is_team_manager_of(tm.team_id)
    )
  ) THEN
    RAISE EXCEPTION 'Not authorized to view conflicts for this leave request';
  END IF;

  RETURN QUERY
    SELECT
      s.id,
      s.title,
      s.shift_date,
      s.start_time,
      s.end_time,
      s.team_id,
      t.name AS team_name,
      EXISTS (
        SELECT 1 FROM public.shift_transfer_requests str
        WHERE str.shift_id = s.id
          AND str.status IN ('pending_target', 'pending_manager')
      ) AS has_pending_transfer
    FROM public.shifts s
    LEFT JOIN public.teams t ON t.id = s.team_id
    WHERE s.employee_id = v_request.employee_id
      AND s.status = 'scheduled'
      AND s.shift_date >= v_request.start_date
      AND s.shift_date <= v_request.end_date
    ORDER BY s.shift_date, s.start_time;
END;
$$;

-- ============================================================
-- 7. Function: approve_leave_request
--    Atomically:
--      - Validates caller is authorized
--      - For each conflicting shift: reassigns or cancels
--      - Cancels any pending transfers for those shifts
--      - Marks the leave request approved
--    p_reassignments: [{"shift_id": "<uuid>", "new_employee_id": "<uuid>"}, ...]
--    Returns summary JSONB: {cancelled_shifts, reassigned_shifts, cancelled_transfers}
-- ============================================================
CREATE OR REPLACE FUNCTION public.approve_leave_request(
  p_request_id    UUID,
  p_reassignments JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request           public.leave_requests%ROWTYPE;
  v_shift             public.shifts%ROWTYPE;
  v_reassignment      JSONB;
  v_new_employee_id   UUID;
  v_cancelled_shifts  INT := 0;
  v_reassigned_shifts INT := 0;
  v_cancelled_xfers   INT := 0;
  v_xfer_count        INT;
  v_found_reassign    BOOLEAN;
BEGIN
  -- Lock and fetch the leave request
  SELECT * INTO v_request
  FROM public.leave_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Leave request not found';
  END IF;

  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'Leave request is not pending (current status: %)', v_request.status;
  END IF;

  -- Authorization check
  IF NOT (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.profile_id = v_request.employee_id
        AND public.is_team_manager_of(tm.team_id)
    )
  ) THEN
    RAISE EXCEPTION 'Not authorized to approve this leave request';
  END IF;

  -- Process each conflicting shift
  FOR v_shift IN
    SELECT s.*
    FROM public.shifts s
    WHERE s.employee_id = v_request.employee_id
      AND s.status = 'scheduled'
      AND s.shift_date >= v_request.start_date
      AND s.shift_date <= v_request.end_date
    FOR UPDATE
  LOOP
    -- Check if a reassignment was provided for this shift
    v_new_employee_id := NULL;
    v_found_reassign := FALSE;
    FOR v_reassignment IN SELECT * FROM jsonb_array_elements(p_reassignments)
    LOOP
      IF (v_reassignment->>'shift_id')::UUID = v_shift.id THEN
        v_new_employee_id := (v_reassignment->>'new_employee_id')::UUID;
        v_found_reassign := TRUE;
        EXIT;
      END IF;
    END LOOP;

    IF v_found_reassign AND v_new_employee_id IS NOT NULL THEN
      -- Reassign shift to new employee
      UPDATE public.shifts
      SET employee_id = v_new_employee_id,
          updated_at  = now()
      WHERE id = v_shift.id;
      v_reassigned_shifts := v_reassigned_shifts + 1;
    ELSE
      -- Cancel the shift
      UPDATE public.shifts
      SET status     = 'cancelled',
          updated_at = now()
      WHERE id = v_shift.id;
      v_cancelled_shifts := v_cancelled_shifts + 1;
    END IF;

    -- Cancel any pending transfer requests for this shift
    UPDATE public.shift_transfer_requests
    SET status     = 'cancelled',
        updated_at = now()
    WHERE shift_id = v_shift.id
      AND status IN ('pending_target', 'pending_manager');

    GET DIAGNOSTICS v_xfer_count = ROW_COUNT;
    v_cancelled_xfers := v_cancelled_xfers + v_xfer_count;
  END LOOP;

  -- Approve the leave request
  UPDATE public.leave_requests
  SET status      = 'approved',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      updated_at  = now()
  WHERE id = p_request_id;

  RETURN jsonb_build_object(
    'cancelled_shifts',    v_cancelled_shifts,
    'reassigned_shifts',   v_reassigned_shifts,
    'cancelled_transfers', v_cancelled_xfers
  );
END;
$$;
