import { redirectIfAuthed } from '@shared/auth.js';
import { supabase } from '@shared/supabase.js';
import { showToast } from '@shared/toast.js';

async function init() {
  // Bounce already-authenticated users straight to dashboard
  await redirectIfAuthed();

  const form       = document.getElementById('login-form');
  const emailInput = document.getElementById('email');
  const passInput  = document.getElementById('password');
  const loginBtn   = document.getElementById('login-btn');
  const loginLabel = document.getElementById('login-label');
  const spinner    = document.getElementById('login-spinner');
  const toggleBtn  = document.getElementById('toggle-password');
  const toggleIcon = document.getElementById('toggle-icon');

  // ── Password visibility toggle ──
  toggleBtn.addEventListener('click', () => {
    const isPassword = passInput.type === 'password';
    passInput.type = isPassword ? 'text' : 'password';
    toggleIcon.className = isPassword ? 'bi bi-eye-slash' : 'bi bi-eye';
  });

  // ── Form submission ──
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!form.checkValidity()) {
      form.classList.add('was-validated');
      return;
    }

    const email    = emailInput.value.trim();
    const password = passInput.value;

    setLoading(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });

      if (error) {
        showToast(mapAuthError(error.message), 'danger');
        console.error('Login error:', error);
        return;
      }

      showToast('Welcome back!', 'success', 1500);
      setTimeout(() => {
        window.location.href = '/dashboard';
      }, 500);

    } catch (err) {
      showToast('An unexpected error occurred. Please try again.', 'danger');
      console.error('Unexpected login error:', err);
    } finally {
      setLoading(false);
    }
  });

  function setLoading(loading) {
    loginBtn.disabled = loading;
    loginLabel.textContent = loading ? 'Logging in…' : 'Log In';
    spinner.classList.toggle('d-none', !loading);
  }
}

/**
 * Maps Supabase auth error messages to user-friendly strings.
 * @param {string} message
 * @returns {string}
 */
function mapAuthError(message) {
  if (message.includes('Invalid login credentials')) {
    return 'Incorrect email or password. Please try again.';
  }
  if (message.includes('Email not confirmed')) {
    return 'Please verify your email address before logging in.';
  }
  if (message.includes('Too many requests')) {
    return 'Too many login attempts. Please wait a moment and try again.';
  }
  return message;
}

init();
