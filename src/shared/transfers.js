import { supabase } from '@shared/supabase.js';
import { getTeamMembers } from '@shared/teams.js';

// ── Shared select string for transfer requests ──────────────────────────────
const TRANSFER_REQUEST_SELECT = `
  id, shift_id, team_id, requester_id, target_id,
  status, expires_at, requester_note, target_note, manager_note,
  created_at, updated_at,
  shift:shifts!shift_id(id, title, shift_date, start_time, end_time, status),
  requester:profiles!requester_id(id, full_name, avatar_url),
  target:profiles!target_id(id, full_name, avatar_url)
`;

/**
 * Create a new transfer request.
 * The caller must supply the shift's date as expiresAt.
 */
export async function createTransferRequest({ shiftId, teamId, requesterId, targetId, requesterNote = '', expiresAt }) {
  const { data, error } = await supabase
    .from('shift_transfer_requests')
    .insert({
      shift_id: shiftId,
      team_id: teamId,
      requester_id: requesterId,
      target_id: targetId,
      requester_note: requesterNote,
      expires_at: expiresAt,
    })
    .select()
    .single();

  return { data, error };
}

/**
 * Fetch all transfer requests involving the given user (as requester or target).
 * Includes shift details and both party profiles.
 */
export async function getMyTransferRequests(userId) {
  const { data, error } = await supabase
    .from('shift_transfer_requests')
    .select(TRANSFER_REQUEST_SELECT)
    .or(`requester_id.eq.${userId},target_id.eq.${userId}`)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('getMyTransferRequests error:', error);
    return [];
  }
  return data || [];
}

/**
 * Fetch transfer requests in 'pending_manager' status for the given team IDs.
 */
export async function getPendingManagerRequests(managedTeamIds) {
  if (!managedTeamIds.length) return [];

  const { data, error } = await supabase
    .from('shift_transfer_requests')
    .select(TRANSFER_REQUEST_SELECT)
    .in('team_id', managedTeamIds)
    .eq('status', 'pending_manager')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('getPendingManagerRequests error:', error);
    return [];
  }
  return data || [];
}

/**
 * Target accepts the request: pending_target → pending_manager
 */
export async function acceptTransferRequest(requestId, targetNote = '') {
  const { data, error } = await supabase
    .from('shift_transfer_requests')
    .update({ status: 'pending_manager', target_note: targetNote })
    .eq('id', requestId)
    .select()
    .single();

  return { data, error };
}

/**
 * Target rejects the request: pending_target → rejected
 */
export async function rejectTransferRequest(requestId, targetNote = '') {
  const { data, error } = await supabase
    .from('shift_transfer_requests')
    .update({ status: 'rejected', target_note: targetNote })
    .eq('id', requestId)
    .select()
    .single();

  return { data, error };
}

/**
 * Manager approves: calls the atomic DB function that reassigns the shift.
 */
export async function approveTransferRequest(requestId) {
  const { error } = await supabase.rpc('approve_shift_transfer', {
    request_id: requestId,
  });

  return { error };
}

/**
 * Manager declines: pending_manager → declined
 */
export async function declineTransferRequest(requestId, managerNote = '') {
  const { data, error } = await supabase
    .from('shift_transfer_requests')
    .update({ status: 'declined', manager_note: managerNote })
    .eq('id', requestId)
    .select()
    .single();

  return { data, error };
}

/**
 * Requester cancels their own pending_target request.
 */
export async function cancelTransferRequest(requestId) {
  const { data, error } = await supabase
    .from('shift_transfer_requests')
    .update({ status: 'cancelled' })
    .eq('id', requestId)
    .select()
    .single();

  return { data, error };
}

/**
 * Expire all stale requests where the shift date has arrived.
 * Returns the number of expired requests.
 */
export async function expireStaleRequests() {
  const { data, error } = await supabase.rpc('expire_transfer_requests');

  if (error) {
    console.error('expireStaleRequests error:', error);
    return 0;
  }
  return data ?? 0;
}

/**
 * Get team members eligible for a transfer (same team, excluding self).
 * Returns [{id, full_name, avatar_url}, ...]
 */
export async function getTransferTargets(teamId, excludeUserId) {
  const members = await getTeamMembers(teamId);
  return members
    .map((m) => m.profile)
    .filter((p) => p.id !== excludeUserId);
}
