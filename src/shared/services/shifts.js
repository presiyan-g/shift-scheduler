import { supabase } from '@shared/supabase.js';

// ── Shared select string for shifts ─────────────────────────────────────────
const SHIFT_SELECT = '*, employee:profiles!employee_id(id, full_name)';

/**
 * Mark past scheduled shifts as completed via DB function.
 */
export async function completeExpiredShifts() {
  const { data, error } = await supabase.rpc('complete_past_shifts');
  if (error) {
    console.error('completeExpiredShifts error:', error);
    return 0;
  }
  return data ?? 0;
}

/**
 * Fetch shifts for a date range, optionally filtered by team and/or employee.
 * Returns { data, error }.
 */
export async function getShiftsForPeriod({ startDate, endDate, teamId = null, employeeId = null }) {
  let query = supabase
    .from('shifts')
    .select(SHIFT_SELECT)
    .gte('shift_date', startDate)
    .lte('shift_date', endDate)
    .order('start_time', { ascending: true });

  if (teamId) query = query.eq('team_id', teamId);
  if (employeeId) query = query.eq('employee_id', employeeId);

  const { data, error } = await query;
  if (error) {
    console.error('getShiftsForPeriod error:', error);
    return { data: [], error };
  }
  return { data: data || [], error: null };
}

/**
 * Fetch shift dates for a specific employee (for date-picker dot markers).
 * Returns a Set of "YYYY-MM-DD" strings.
 */
export async function getEmployeeShiftDates({ employeeId, fromDate, toDate }) {
  const { data, error } = await supabase
    .from('shifts')
    .select('shift_date')
    .eq('employee_id', employeeId)
    .gte('shift_date', fromDate)
    .lte('shift_date', toDate);

  if (error) {
    console.error('getEmployeeShiftDates error:', error);
    return new Set();
  }
  return new Set((data || []).map((s) => s.shift_date));
}

/**
 * Insert a single shift. Returns { data, error }.
 */
export async function createShift(payload) {
  const { data, error } = await supabase
    .from('shifts')
    .insert(payload)
    .select()
    .single();

  return { data, error };
}

/**
 * Update a shift by ID. Returns { data, error }.
 */
export async function updateShift(shiftId, payload) {
  const { data, error } = await supabase
    .from('shifts')
    .update(payload)
    .eq('id', shiftId)
    .select()
    .single();

  return { data, error };
}

/**
 * Delete a shift by ID. Returns { error }.
 */
export async function deleteShift(shiftId) {
  const { error } = await supabase
    .from('shifts')
    .delete()
    .eq('id', shiftId);

  return { error };
}

/**
 * Fetch all shift templates ordered by title. Returns [].
 */
export async function getShiftTemplates() {
  const { data, error } = await supabase
    .from('shift_templates')
    .select('id, title, start_time, end_time, notes, color')
    .order('title', { ascending: true });

  if (error) {
    console.error('getShiftTemplates error:', error);
    return [];
  }
  return data || [];
}

/**
 * Fetch shift IDs with active (pending) transfer requests for the given requester.
 * Returns a Set of shift ID strings.
 */
export async function getPendingTransferShiftIds(requesterId) {
  const { data, error } = await supabase
    .from('shift_transfer_requests')
    .select('shift_id')
    .eq('requester_id', requesterId)
    .in('status', ['pending_target', 'pending_manager']);

  if (error) {
    console.error('getPendingTransferShiftIds error:', error);
    return new Set();
  }
  return new Set((data || []).map((r) => r.shift_id));
}

/**
 * Fetch approved leave requests for a period, optionally filtered by employee.
 * Used by schedule views to show leave banners alongside shifts.
 */
export async function getApprovedLeavesForPeriod({ startDate, endDate, employeeId = null }) {
  let query = supabase
    .from('leave_requests')
    .select('id, employee_id, start_date, end_date, leave_type, status, employee:profiles!employee_id(id, full_name)')
    .eq('status', 'approved')
    .lte('start_date', endDate)
    .gte('end_date', startDate);

  if (employeeId) query = query.eq('employee_id', employeeId);

  const { data, error } = await query;
  if (error) {
    console.error('getApprovedLeavesForPeriod error:', error);
    return [];
  }
  return data || [];
}

/**
 * Check for approved leave conflicts for an employee on specific dates.
 * Returns conflicting leave request records (empty array = no conflicts).
 */
export async function checkLeaveConflicts({ employeeId, minDate, maxDate }) {
  const { data, error } = await supabase
    .from('leave_requests')
    .select('id, start_date, end_date, leave_type')
    .eq('employee_id', employeeId)
    .eq('status', 'approved')
    .lte('start_date', maxDate)
    .gte('end_date', minDate);

  if (error) {
    console.error('checkLeaveConflicts error:', error);
    return [];
  }
  return data || [];
}
