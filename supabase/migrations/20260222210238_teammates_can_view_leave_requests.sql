-- Allow employees to see leave requests from teammates (people sharing at least one team).
CREATE POLICY "Teammates can view each other's leave requests"
ON leave_requests
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM team_members tm1
    JOIN team_members tm2 ON tm1.team_id = tm2.team_id
    WHERE tm1.profile_id = leave_requests.employee_id
      AND tm2.profile_id = auth.uid()
  )
);