import { supabase } from '@shared/supabase.js';

const MT_CACHE_PREFIX = 'ss_mt_';

/**
 * Fetch teams where the given user is a manager.
 * Result is cached in sessionStorage for the duration of the session.
 * @param {string} userId
 * @returns {Promise<Array<{team_id: string, role: string, team: {id: string, name: string, description: string}}>>}
 */
export async function getManagedTeams(userId) {
  const cacheKey = `${MT_CACHE_PREFIX}${userId}`;
  const cached = sessionStorage.getItem(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch {}
  }

  const { data, error } = await supabase
    .from('team_members')
    .select('team_id, role, team:teams(id, name, description)')
    .eq('profile_id', userId)
    .eq('role', 'manager');

  if (error) {
    console.error('getManagedTeams error:', error);
    return [];
  }

  const result = data || [];
  sessionStorage.setItem(cacheKey, JSON.stringify(result));
  return result;
}

/**
 * Fetch all teams (admin use).
 * @returns {Promise<Array<{id: string, name: string, description: string}>>}
 */
export async function getAllTeams() {
  const { data, error } = await supabase
    .from('teams')
    .select('*')
    .order('name');

  if (error) {
    console.error('getAllTeams error:', error);
    return [];
  }
  return data || [];
}

/**
 * Fetch all members of a specific team with their profile info.
 * @param {string} teamId
 * @returns {Promise<Array>}
 */
export async function getTeamMembers(teamId) {
  const { data, error } = await supabase
    .from('team_members')
    .select('id, role, profile:profiles(id, full_name, role, avatar_url)')
    .eq('team_id', teamId)
    .order('role');

  if (error) {
    console.error('getTeamMembers error:', error);
    return [];
  }
  return data || [];
}

/**
 * Fetch employees (members) of a specific team — for shift assignment dropdowns.
 * @param {string} teamId
 * @returns {Promise<Array<{id: string, full_name: string}>>}
 */
export async function getTeamEmployees(teamId) {
  const { data, error } = await supabase
    .from('team_members')
    .select('profile:profiles(id, full_name)')
    .eq('team_id', teamId);

  if (error) {
    console.error('getTeamEmployees error:', error);
    return [];
  }
  return (data || []).map((row) => row.profile);
}
