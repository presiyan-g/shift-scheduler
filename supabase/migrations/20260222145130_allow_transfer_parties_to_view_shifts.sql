-- Allow users who are a party to a transfer request (requester or target)
-- to view the shift being transferred, even if it doesn't belong to them yet.
CREATE POLICY "Transfer request parties can view associated shifts"
  ON public.shifts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.shift_transfer_requests
      WHERE shift_id = shifts.id
        AND (requester_id = auth.uid() OR target_id = auth.uid())
    )
  );
