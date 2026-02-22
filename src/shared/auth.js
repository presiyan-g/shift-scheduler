import { supabase } from '@shared/supabase.js';

const PROFILE_CACHE_KEY = 'ss_profile';
const MT_CACHE_PREFIX = 'ss_mt_';

/**
 * Returns the authenticated user object or null.
 * Uses getUser() which validates the JWT server-side (not just local storage).
 */
export async function getUser() {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) {
    console.error('getUser error:', error.message);
    return null;
  }
  return user;
}

/**
 * Redirects to the login page if no authenticated user exists.
 * Call at the top of every protected page's init function.
 * Returns the user so callers don't need to call getUser() again.
 *
 * @param {string} [loginPath='/login']
 * @returns {Promise<import('@supabase/supabase-js').User>}
 */
export async function requireAuth(loginPath = '/login') {
  const user = await getUser();
  if (!user) {
    window.location.replace(loginPath);
    // Freeze execution so no page code runs while redirect is pending
    return new Promise(() => {});
  }
  return user;
}

/**
 * Returns the current user's profile, using sessionStorage as a cache.
 * Falls back to a Supabase query on cache miss.
 *
 * @param {string} userId
 * @returns {Promise<{full_name: string, role: string, avatar_url: string|null}|null>}
 */
export async function getProfile(userId) {
  const cached = sessionStorage.getItem(PROFILE_CACHE_KEY);
  if (cached) {
    try { return JSON.parse(cached); } catch {}
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('full_name, role, avatar_url')
    .eq('id', userId)
    .single();

  if (error) {
    console.error('getProfile error:', error.message);
    return null;
  }

  sessionStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(data));
  return data;
}

/**
 * Clears the session cache for profile and managed teams.
 * Call on logout or after the user updates their profile.
 */
export function clearSessionCache() {
  sessionStorage.removeItem(PROFILE_CACHE_KEY);
  const keysToRemove = [];
  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    if (key?.startsWith(MT_CACHE_PREFIX)) keysToRemove.push(key);
  }
  keysToRemove.forEach((k) => sessionStorage.removeItem(k));
}

/**
 * Redirects already-authenticated users away from public pages (login, register).
 * Call at the top of login.js and register.js init functions.
 *
 * @param {string} [dashboardPath='/dashboard']
 * @returns {Promise<void>}
 */
export async function redirectIfAuthed(
  dashboardPath = '/dashboard'
) {
  const user = await getUser();
  if (user) {
    window.location.replace(dashboardPath);
    return new Promise(() => {});
  }
}
