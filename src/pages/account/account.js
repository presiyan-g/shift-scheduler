import { requireAuth } from '@shared/auth.js';
import { renderNavbar } from '@shared/navbar.js';
import { supabase } from '@shared/supabase.js';
import { showToast } from '@shared/toast.js';
import { getManagedTeams } from '@shared/teams.js';

async function init() {
  const user = await requireAuth();

  renderNavbar({ activePage: 'account' });

  // Fetch profile for navbar
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role, avatar_url')
    .eq('id', user.id)
    .single();

  const managedTeams = await getManagedTeams(user.id);
  const isTeamManager = managedTeams.length > 0;

  renderNavbar({
    activePage: 'account',
    role: profile?.role ?? 'employee',
    isTeamManager,
    userName: profile?.full_name ?? '',
    avatarUrl: profile?.avatar_url ?? null,
  });

  // Show current email
  document.getElementById('current-email').textContent = user.email;

  // Attach form handlers
  document.getElementById('email-form').addEventListener('submit', (e) => {
    e.preventDefault();
    handleEmailChange();
  });

  document.getElementById('password-form').addEventListener('submit', (e) => {
    e.preventDefault();
    handlePasswordChange();
  });

  // Live confirm-password match check
  document.getElementById('confirm-password').addEventListener('input', validatePasswordMatch);
  document.getElementById('new-password').addEventListener('input', validatePasswordMatch);
}

// ── Email change ────────────────────────────────────────────────────────────

async function handleEmailChange() {
  const form = document.getElementById('email-form');
  form.classList.add('was-validated');
  if (!form.checkValidity()) return;

  const btn = document.getElementById('save-email-btn');
  const spinner = document.getElementById('save-email-spinner');
  btn.disabled = true;
  spinner.classList.remove('d-none');

  const newEmail = document.getElementById('new-email').value.trim();

  const { error } = await supabase.auth.updateUser({ email: newEmail });

  btn.disabled = false;
  spinner.classList.add('d-none');

  if (error) {
    console.error('Email update error:', error);
    showToast(error.message || 'Could not update email.', 'danger');
    return;
  }

  form.reset();
  form.classList.remove('was-validated');
  document.getElementById('email-confirm-alert').classList.remove('d-none');
  showToast('Confirmation email sent. Check your inbox.', 'success');
}

// ── Password change ─────────────────────────────────────────────────────────

function validatePasswordMatch() {
  const newPwd = document.getElementById('new-password').value;
  const confirmPwd = document.getElementById('confirm-password');

  if (confirmPwd.value && confirmPwd.value !== newPwd) {
    confirmPwd.setCustomValidity('Passwords do not match');
  } else {
    confirmPwd.setCustomValidity('');
  }
}

async function handlePasswordChange() {
  validatePasswordMatch();

  const form = document.getElementById('password-form');
  form.classList.add('was-validated');
  if (!form.checkValidity()) return;

  const btn = document.getElementById('save-password-btn');
  const spinner = document.getElementById('save-password-spinner');
  btn.disabled = true;
  spinner.classList.remove('d-none');

  const newPassword = document.getElementById('new-password').value;

  const { error } = await supabase.auth.updateUser({ password: newPassword });

  btn.disabled = false;
  spinner.classList.add('d-none');

  if (error) {
    console.error('Password update error:', error);
    showToast(error.message || 'Could not change password.', 'danger');
    return;
  }

  form.reset();
  form.classList.remove('was-validated');
  showToast('Password changed successfully.', 'success');
}

init();
