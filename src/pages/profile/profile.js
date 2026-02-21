import { requireAuth } from '@shared/auth.js';
import { renderNavbar } from '@shared/navbar.js';
import { supabase } from '@shared/supabase.js';
import { showToast } from '@shared/toast.js';
import { getManagedTeams } from '@shared/teams.js';

const MAX_FILE_SIZE_MB = 2;

async function init() {
  const user = await requireAuth();

  renderNavbar({ activePage: 'profile' });

  // Fetch profile
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('full_name, role, avatar_url, created_at')
    .eq('id', user.id)
    .single();

  if (profileError) {
    console.error('Profile fetch error:', profileError);
    showToast('Could not load profile.', 'danger');
    return;
  }

  // Determine team manager status for navbar
  const managedTeams = await getManagedTeams(user.id);
  const isTeamManager = managedTeams.length > 0;

  renderNavbar({
    activePage: 'profile',
    role: profile.role,
    isTeamManager,
    userName: profile.full_name,
    avatarUrl: profile.avatar_url,
  });

  // Populate static fields
  document.getElementById('profile-email').textContent = user.email;
  document.getElementById('profile-since').textContent =
    new Date(profile.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // Render avatar and header info
  renderProfileHeader(profile);
  document.getElementById('full-name-input').value = profile.full_name;

  // Attach name save handler
  document.getElementById('name-form').addEventListener('submit', (e) => {
    e.preventDefault();
    handleNameSave(user.id);
  });

  // Attach avatar upload handler
  const fileInput = document.getElementById('avatar-file-input');
  document.getElementById('avatar-container').addEventListener('click', () => fileInput.click());
  document.getElementById('avatar-container').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener('change', () => handleAvatarUpload(user, fileInput));

  // Load team memberships
  await loadTeamMemberships(user.id);
}

// ── Render helpers ──────────────────────────────────────────────────────────

function renderProfileHeader(profile) {
  renderAvatarLarge(profile.avatar_url, profile.full_name);

  document.getElementById('profile-name-display').textContent =
    profile.full_name || 'Unnamed User';

  const roleColors = { admin: 'danger', employee: 'primary' };
  const roleLabels = { admin: 'Admin', employee: 'Employee' };
  const badgeColor = roleColors[profile.role] ?? 'secondary';
  const badgeLabel = roleLabels[profile.role] ?? profile.role;

  document.getElementById('profile-role-badge').innerHTML =
    `<span class="badge bg-${badgeColor}-subtle text-${badgeColor} rounded-pill px-3">${escapeHtml(badgeLabel)}</span>`;
}

function renderAvatarLarge(avatarUrl, name) {
  const container = document.getElementById('avatar-container');
  if (avatarUrl) {
    container.innerHTML = `
      <img src="${escapeHtml(avatarUrl)}" alt="Avatar" class="profile-avatar-img"
        onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />
      <span class="profile-avatar-initials" style="display:none">${getInitials(name)}</span>
    `;
  } else if (name) {
    container.innerHTML = `<span class="profile-avatar-initials">${getInitials(name)}</span>`;
  } else {
    container.innerHTML = `<i class="bi bi-person-fill fs-1 text-white"></i>`;
  }
}

function getInitials(name) {
  return (name ?? '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str ?? '';
  return d.innerHTML;
}

// ── Name save ───────────────────────────────────────────────────────────────

async function handleNameSave(userId) {
  const form = document.getElementById('name-form');
  form.classList.add('was-validated');
  if (!form.checkValidity()) return;

  const btn = document.getElementById('save-name-btn');
  const spinner = document.getElementById('save-name-spinner');
  btn.disabled = true;
  spinner.classList.remove('d-none');

  const newName = document.getElementById('full-name-input').value.trim();

  const { error } = await supabase
    .from('profiles')
    .update({ full_name: newName })
    .eq('id', userId);

  btn.disabled = false;
  spinner.classList.add('d-none');

  if (error) {
    console.error('Name update error:', error);
    showToast('Could not save name.', 'danger');
    return;
  }

  document.getElementById('profile-name-display').textContent = newName;
  form.classList.remove('was-validated');
  showToast('Name updated successfully.', 'success');
}

// ── Avatar upload ───────────────────────────────────────────────────────────

async function handleAvatarUpload(user, fileInput) {
  const file = fileInput.files[0];
  if (!file) return;

  // Validate file type
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowed.includes(file.type)) {
    showToast('Please upload a JPEG, PNG, WebP, or GIF image.', 'warning');
    fileInput.value = '';
    return;
  }

  // Validate file size
  if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    showToast(`Image must be smaller than ${MAX_FILE_SIZE_MB} MB.`, 'warning');
    fileInput.value = '';
    return;
  }

  const spinner = document.getElementById('avatar-spinner');
  spinner.classList.remove('d-none');

  // Path: avatars/<user_id>/avatar (upsert replaces old file)
  const uploadPath = `${user.id}/avatar`;

  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(uploadPath, file, { upsert: true, contentType: file.type });

  if (uploadError) {
    spinner.classList.add('d-none');
    console.error('Avatar upload error:', uploadError);
    showToast('Could not upload image.', 'danger');
    fileInput.value = '';
    return;
  }

  // Get public URL with cache-bust param
  const { data: { publicUrl } } = supabase.storage
    .from('avatars')
    .getPublicUrl(uploadPath);

  const avatarUrl = `${publicUrl}?t=${Date.now()}`;

  // Update profiles.avatar_url
  const { error: updateError } = await supabase
    .from('profiles')
    .update({ avatar_url: avatarUrl })
    .eq('id', user.id);

  spinner.classList.add('d-none');

  if (updateError) {
    console.error('Avatar URL update error:', updateError);
    showToast('Uploaded image but could not save URL.', 'danger');
    return;
  }

  // Re-render avatar with new URL
  const currentName = document.getElementById('full-name-input').value;
  renderAvatarLarge(avatarUrl, currentName);
  showToast('Profile photo updated.', 'success');
  fileInput.value = '';
}

// ── Team memberships ────────────────────────────────────────────────────────

async function loadTeamMemberships(userId) {
  const { data, error } = await supabase
    .from('team_members')
    .select('role, team:teams(id, name, description)')
    .eq('profile_id', userId);

  if (error) {
    console.error('Team memberships error:', error);
    return;
  }

  const container = document.getElementById('teams-list');
  const emptyEl = document.getElementById('teams-empty');

  if (!data || data.length === 0) {
    return; // empty state already visible
  }

  emptyEl.classList.add('d-none');

  container.innerHTML = data
    .map(
      (row) => `
    <a
      href="/teams?team=${encodeURIComponent(row.team?.id ?? '')}"
      class="d-flex align-items-center px-4 py-3 border-bottom profile-team-link"
      ${row.team?.id ? '' : 'aria-disabled="true" tabindex="-1"'}
    >
      <div class="me-3">
        <i class="bi bi-people-fill text-primary fs-5"></i>
      </div>
      <div class="flex-grow-1">
        <div class="fw-semibold">${escapeHtml(row.team?.name ?? '—')}</div>
        <small class="text-muted">${escapeHtml(row.team?.description ?? '')}</small>
      </div>
      <span class="badge ${row.role === 'manager' ? 'bg-primary' : 'bg-secondary'} rounded-pill">
        ${row.role === 'manager' ? 'Manager' : 'Member'}
      </span>
    </a>
  `
    )
    .join('');
}

init();
