import { redirectIfAuthed } from '@shared/auth.js';
import { supabase } from '@shared/supabase.js';
import { showToast } from '@shared/toast.js';

async function init() {
  // Bounce already-authenticated users straight to dashboard
  await redirectIfAuthed();

  const form            = document.getElementById('register-form');
  const nameInput       = document.getElementById('fullname');
  const emailInput      = document.getElementById('email');
  const passInput       = document.getElementById('password');
  const confirmInput    = document.getElementById('confirm-password');
  const confirmFeedback = document.getElementById('confirm-feedback');
  const registerBtn     = document.getElementById('register-btn');
  const registerLabel   = document.getElementById('register-label');
  const spinner         = document.getElementById('register-spinner');
  const toggleBtn       = document.getElementById('toggle-password');
  const toggleIcon      = document.getElementById('toggle-icon');

  // ── Password visibility toggle ──
  toggleBtn.addEventListener('click', () => {
    const isPassword = passInput.type === 'password';
    passInput.type = isPassword ? 'text' : 'password';
    toggleIcon.className = isPassword ? 'bi bi-eye-slash' : 'bi bi-eye';
  });

  // ── Real-time confirm password validation ──
  confirmInput.addEventListener('input', () => {
    if (confirmInput.value && confirmInput.value !== passInput.value) {
      confirmInput.setCustomValidity('Passwords do not match');
      confirmFeedback.textContent = 'Passwords do not match.';
    } else {
      confirmInput.setCustomValidity('');
      confirmFeedback.textContent = 'Please confirm your password.';
    }
  });

  // ── Form submission ──
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Cross-field password check before HTML5 validation runs
    if (passInput.value !== confirmInput.value) {
      confirmInput.setCustomValidity('Passwords do not match');
      confirmFeedback.textContent = 'Passwords do not match.';
    } else {
      confirmInput.setCustomValidity('');
    }

    if (!form.checkValidity()) {
      form.classList.add('was-validated');
      return;
    }

    const fullName = nameInput.value.trim();
    const email    = emailInput.value.trim();
    const password = passInput.value;

    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName },
        },
      });

      if (error) {
        showToast(mapSignUpError(error.message), 'danger');
        console.error('Registration error:', error);
        return;
      }

      if (data.session) {
        // Email confirmation disabled — user is logged in immediately
        showToast('Account created! Redirecting…', 'success', 2000);
        setTimeout(() => {
          window.location.href = '/dashboard.html';
        }, 500);
      } else {
        // Email confirmation required
        showToast(
          'Account created! Please check your email to confirm your address.',
          'info',
          8000
        );
        setTimeout(() => {
          window.location.href = '/login.html';
        }, 3000);
      }

    } catch (err) {
      showToast('An unexpected error occurred. Please try again.', 'danger');
      console.error('Unexpected registration error:', err);
    } finally {
      setLoading(false);
    }
  });

  function setLoading(loading) {
    registerBtn.disabled = loading;
    registerLabel.textContent = loading ? 'Creating account…' : 'Create Account';
    spinner.classList.toggle('d-none', !loading);
  }
}

/**
 * Maps Supabase signUp error messages to user-friendly strings.
 * @param {string} message
 * @returns {string}
 */
function mapSignUpError(message) {
  if (message.includes('User already registered')) {
    return 'An account with this email already exists. Try logging in instead.';
  }
  if (message.includes('Password should be at least')) {
    return 'Password must be at least 8 characters.';
  }
  if (message.includes('Unable to validate email address')) {
    return 'Please enter a valid email address.';
  }
  return message;
}

init();
