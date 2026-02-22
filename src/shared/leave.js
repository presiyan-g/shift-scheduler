import { supabase } from '@shared/supabase.js';
import { getTeamMembers } from '@shared/teams.js';

// ── Shared select string for leave requests ──────────────────────────────────
const LEAVE_REQUEST_SELECT = `
  id, employee_id, start_date, end_date, leave_type,
  status, employee_note, manager_note,
  reviewed_by, reviewed_at, created_at, updated_at,
  employee:profiles!employee_id(id, full_name, avatar_url),
  reviewer:profiles!reviewed_by(id, full_name)
`;

/**
 * Submit a new leave request.
 */
export async function createLeaveRequest({ employeeId, startDate, endDate, leaveType, employeeNote = '' }) {
  const { data, error } = await supabase
    .from('leave_requests')
    .insert({
      employee_id:   employeeId,
      start_date:    startDate,
      end_date:      endDate,
      leave_type:    leaveType,
      employee_note: employeeNote,
    })
    .select()
    .single();

  return { data, error };
}

/**
 * Fetch all leave requests for the current employee (own history).
 * @param {string} userId
 * @returns {Promise<Array>}
 */
export async function getMyLeaveRequests(userId) {
  const { data, error } = await supabase
    .from('leave_requests')
    .select(LEAVE_REQUEST_SELECT)
    .eq('employee_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('getMyLeaveRequests error:', error);
    return [];
  }
  return data || [];
}

/**
 * Fetch all leave requests visible to the manager (all statuses).
 * RLS auto-scopes results to the caller's managed teams.
 * @returns {Promise<Array>}
 */
export async function getTeamLeaveRequests() {
  const { data, error } = await supabase
    .from('leave_requests')
    .select(LEAVE_REQUEST_SELECT)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('getTeamLeaveRequests error:', error);
    return [];
  }
  return data || [];
}

/**
 * Fetch only pending leave requests visible to the manager.
 * RLS auto-scopes results to the caller's managed teams.
 * @returns {Promise<Array>}
 */
export async function getPendingTeamLeaveRequests() {
  const { data, error } = await supabase
    .from('leave_requests')
    .select(LEAVE_REQUEST_SELECT)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('getPendingTeamLeaveRequests error:', error);
    return [];
  }
  return data || [];
}

/**
 * Employee cancels their own pending request.
 * @param {string} requestId
 * @returns {Promise<{data, error}>}
 */
export async function cancelLeaveRequest(requestId) {
  const { data, error } = await supabase
    .from('leave_requests')
    .update({ status: 'cancelled' })
    .eq('id', requestId)
    .select()
    .single();

  return { data, error };
}

/**
 * Manager rejects a leave request.
 * @param {string} requestId
 * @param {string} managerNote
 * @returns {Promise<{data, error}>}
 */
export async function rejectLeaveRequest(requestId, managerNote = '') {
  const { data, error } = await supabase
    .from('leave_requests')
    .update({ status: 'rejected', manager_note: managerNote })
    .eq('id', requestId)
    .select()
    .single();

  return { data, error };
}

/**
 * Manager approves a leave request.
 * Calls the SECURITY DEFINER function which handles all side effects.
 * @param {string} requestId
 * @param {Array<{shift_id: string, new_employee_id: string}>} reassignments
 * @returns {Promise<{data: {cancelled_shifts, reassigned_shifts, cancelled_transfers}, error}>}
 */
export async function approveLeaveRequest(requestId, reassignments = []) {
  const { data, error } = await supabase.rpc('approve_leave_request', {
    p_request_id:    requestId,
    p_reassignments: reassignments,
  });

  return { data, error };
}

/**
 * Fetch conflicting shifts for a leave request (for the review modal preview).
 * @param {string} requestId
 * @returns {Promise<{data: Array, error}>}
 */
export async function getConflictingShifts(requestId) {
  const { data, error } = await supabase.rpc('get_conflicting_shifts', {
    p_request_id: requestId,
  });

  return { data: data || [], error };
}

/**
 * Get team members eligible for reassignment (excludes the leave-requesting employee).
 * @param {string} teamId
 * @param {string} excludeUserId
 * @returns {Promise<Array<{id, full_name, avatar_url}>>}
 */
export async function getReassignmentCandidates(teamId, excludeUserId) {
  const members = await getTeamMembers(teamId);
  return members
    .map((m) => m.profile)
    .filter((p) => p && p.id !== excludeUserId);
}

/**
 * Fetch approved and pending leave requests overlapping [startDate, endDate].
 * RLS auto-scopes: employees see own, managers see team, admins see all.
 * @param {string} startDate  YYYY-MM-DD
 * @param {string} endDate    YYYY-MM-DD
 * @returns {Promise<Array>}
 */
export async function getLeaveRequestsForPeriod(startDate, endDate) {
  const { data, error } = await supabase
    .from('leave_requests')
    .select('id, employee_id, start_date, end_date, leave_type, status, employee:profiles!employee_id(id, full_name)')
    .in('status', ['approved', 'pending'])
    .lte('start_date', endDate)   // leave starts on or before period end
    .gte('end_date', startDate)   // leave ends on or after period start
    .order('start_date', { ascending: true });

  if (error) {
    console.error('getLeaveRequestsForPeriod error:', error);
    return [];
  }
  return data || [];
}

/**
 * Manager or admin cancels an already-approved leave request.
 * @param {string} requestId
 * @param {string} managerNote
 * @returns {Promise<{data, error}>}
 */
export async function cancelApprovedLeave(requestId, managerNote = '') {
  const { data, error } = await supabase
    .from('leave_requests')
    .update({ status: 'cancelled', manager_note: managerNote })
    .eq('id', requestId)
    .select()
    .single();

  return { data, error };
}
