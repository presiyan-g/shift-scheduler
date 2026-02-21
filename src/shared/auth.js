import { supabase } from '@shared/supabase.js';

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
