CREATE OR REPLACE FUNCTION public.complete_past_shifts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  completed_count integer;
BEGIN
  UPDATE public.shifts
  SET status     = 'completed',
      updated_at = now()
  WHERE status = 'scheduled'
    AND (shift_date + end_time) <= now();

  GET DIAGNOSTICS completed_count = ROW_COUNT;
  RETURN completed_count;
END;
$$;
