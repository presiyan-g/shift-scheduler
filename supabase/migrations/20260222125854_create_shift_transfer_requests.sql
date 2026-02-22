-- ============================================================
-- 1. Enum for transfer request status
-- ============================================================
CREATE TYPE public.transfer_request_status AS ENUM (
  'pending_target',
  'pending_manager',
  'approved',
  'rejected',
  'declined',
  'cancelled',
  'expired'
);

-- ============================================================
-- 2. shift_transfer_requests table
-- ============================================================
CREATE TABLE public.shift_transfer_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id        UUID NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  team_id         UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  requester_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  target_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status          public.transfer_request_status NOT NULL DEFAULT 'pending_target',
  expires_at      DATE NOT NULL,
  requester_note  TEXT NOT NULL DEFAULT '',
  target_note     TEXT NOT NULL DEFAULT '',
  manager_note    TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 3. Constraints
-- ============================================================
ALTER TABLE public.shift_transfer_requests
  ADD CONSTRAINT no_self_transfer CHECK (requester_id <> target_id);

-- One active (non-terminal) request per shift at a time
CREATE UNIQUE INDEX idx_one_active_request_per_shift
  ON public.shift_transfer_requests (shift_id)
  WHERE status IN ('pending_target', 'pending_manager');

-- ============================================================
-- 4. Indexes
-- ============================================================
CREATE INDEX idx_transfer_requests_shift       ON public.shift_transfer_requests (shift_id);
CREATE INDEX idx_transfer_requests_team        ON public.shift_transfer_requests (team_id);
CREATE INDEX idx_transfer_requests_requester   ON public.shift_transfer_requests (requester_id);
CREATE INDEX idx_transfer_requests_target      ON public.shift_transfer_requests (target_id);
CREATE INDEX idx_transfer_requests_status      ON public.shift_transfer_requests (status);

-- ============================================================
-- 5. updated_at trigger
-- ============================================================
CREATE TRIGGER shift_transfer_requests_updated_at
  BEFORE UPDATE ON public.shift_transfer_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- 6. Enable RLS
-- ============================================================
ALTER TABLE public.shift_transfer_requests ENABLE ROW LEVEL SECURITY;

-- ── SELECT ────────────────────────────────────────────────────
CREATE POLICY "Parties can view their own transfer requests"
  ON public.shift_transfer_requests FOR SELECT
  USING (
    auth.uid() = requester_id
    OR auth.uid() = target_id
  );

CREATE POLICY "Managers can view transfer requests for their teams"
  ON public.shift_transfer_requests FOR SELECT
  USING (public.is_team_manager_of(team_id));

CREATE POLICY "Admins can view all transfer requests"
  ON public.shift_transfer_requests FOR SELECT
  USING (public.is_admin());

-- ── INSERT ────────────────────────────────────────────────────
CREATE POLICY "Employees can create transfer requests for own shifts"
  ON public.shift_transfer_requests FOR INSERT
  WITH CHECK (
    auth.uid() = requester_id
    AND EXISTS (
      SELECT 1 FROM public.team_members
      WHERE team_id = shift_transfer_requests.team_id
        AND profile_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.team_members
      WHERE team_id = shift_transfer_requests.team_id
        AND profile_id = shift_transfer_requests.target_id
    )
  );

-- ── UPDATE ────────────────────────────────────────────────────
CREATE POLICY "Requester can cancel own pending request"
  ON public.shift_transfer_requests FOR UPDATE
  USING (
    auth.uid() = requester_id
    AND status = 'pending_target'
  )
  WITH CHECK (
    auth.uid() = requester_id
    AND status = 'cancelled'
  );

CREATE POLICY "Target can accept or reject pending request"
  ON public.shift_transfer_requests FOR UPDATE
  USING (
    auth.uid() = target_id
    AND status = 'pending_target'
  )
  WITH CHECK (
    auth.uid() = target_id
    AND status IN ('pending_manager', 'rejected')
  );

CREATE POLICY "Managers can approve or decline pending manager requests"
  ON public.shift_transfer_requests FOR UPDATE
  USING (
    public.is_team_manager_of(team_id)
    AND status = 'pending_manager'
  )
  WITH CHECK (
    public.is_team_manager_of(team_id)
    AND status IN ('approved', 'declined')
  );

CREATE POLICY "Admins can update any transfer request"
  ON public.shift_transfer_requests FOR UPDATE
  USING (public.is_admin());

-- ============================================================
-- 7. Function: approve_shift_transfer
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

  IF v_shift.shift_date <= CURRENT_DATE THEN
    RAISE EXCEPTION 'Cannot transfer a past or current-day shift';
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

-- ============================================================
-- 8. Function: expire_transfer_requests
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
    AND expires_at <= CURRENT_DATE;

  GET DIAGNOSTICS expired_count = ROW_COUNT;
  RETURN expired_count;
END;
$$;
