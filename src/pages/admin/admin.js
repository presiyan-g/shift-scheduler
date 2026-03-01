import { requireAuth, getProfile } from '@shared/auth.js';
import { renderNavbar } from '@shared/navbar.js';
import { supabase } from '@shared/supabase.js';
import { showToast } from '@shared/toast.js';
import { getManagedTeams } from '@shared/teams.js';

// ── Module-level state ──────────────────────────────────────────────────────

let currentUser = null;
let currentUserRole = 'employee';
let allUsers = [];
let filteredUsers = [];
let pendingToggleUserId = null;
let pendingToggleStatus = null;
let pendingToggleUserName = '';
let toggleModalInstance = null;

// ── Entry point ─────────────────────────────────────────────────────────────

async function init() {
  currentUser = await requireAuth();

  // Quick navbar while profile loads
  renderNavbar({ activePage: 'admin' });

  const profile = await getProfile(currentUser.id);
  if (!profile) {
    showToast('Could not load profile.', 'danger');
    return;
  }

  currentUserRole = profile.role;

  // Only admins and super_admins can access this page
  if (currentUserRole !== 'admin' && currentUserRole !== 'super_admin') {
    window.location.replace('/dashboard');
    return new Promise(() => {});
  }

  // Determine team manager status for navbar rendering
  const managedTeams = await getManagedTeams(currentUser.id);
  const isTeamManager = managedTeams.length > 0;

  renderNavbar({
    activePage: 'admin',
    role: currentUserRole,
    isTeamManager,
    userName: profile.full_name,
    avatarUrl: profile.avatar_url,
  });

  toggleModalInstance = new bootstrap.Modal(document.getElementById('toggle-modal'));

  attachEventListeners();
  await loadUsers();
}

// ── Event listeners ─────────────────────────────────────────────────────────

function attachEventListeners() {
  document.getElementById('search-input').addEventListener('input', applyFilters);
  document.getElementById('role-filter').addEventListener('change', applyFilters);
  document.getElementById('status-filter').addEventListener('change', applyFilters);
  document.getElementById('confirm-toggle-btn').addEventListener('click', handleToggleConfirm);

  // Delegated click on the users table body
  document.getElementById('users-tbody').addEventListener('click', (e) => {
    const toggleBtn = e.target.closest('.toggle-active-btn');
    if (toggleBtn) {
      const userId = toggleBtn.dataset.userId;
      const user = allUsers.find((u) => u.id === userId);
      if (user) openToggleModal(user);
    }
  });
}

// ── Data loading ────────────────────────────────────────────────────────────

async function loadUsers() {
  const loadingEl = document.getElementById('users-loading');
  loadingEl.classList.remove('d-none');

  const { data, error } = await supabase.rpc('get_all_users_admin');

  loadingEl.classList.add('d-none');

  if (error) {
    console.error('Load users error:', error);
    showToast('Could not load users.', 'danger');
    return;
  }

  allUsers = data || [];
  applyFilters();
}

// ── Filtering ───────────────────────────────────────────────────────────────

function applyFilters() {
  const searchTerm = document.getElementById('search-input').value.toLowerCase().trim();
  const roleFilter = document.getElementById('role-filter').value;
  const statusFilter = document.getElementById('status-filter').value;

  filteredUsers = allUsers.filter((user) => {
    // Search filter
    if (searchTerm) {
      const matchesName = user.full_name?.toLowerCase().includes(searchTerm);
      const matchesEmail = user.email?.toLowerCase().includes(searchTerm);
      if (!matchesName && !matchesEmail) return false;
    }

    // Role filter
    if (roleFilter !== 'all' && user.role !== roleFilter) return false;

    // Status filter
    if (statusFilter === 'active' && !user.is_active) return false;
    if (statusFilter === 'inactive' && user.is_active) return false;

    return true;
  });

  renderUsersTable();
}

// ── Rendering ───────────────────────────────────────────────────────────────

const ROLE_CONFIG = {
  super_admin: { color: 'warning', label: 'Super Admin' },
  admin:       { color: 'danger',  label: 'Admin' },
  employee:    { color: 'primary', label: 'Employee' },
};

function renderUsersTable() {
  const tbody = document.getElementById('users-tbody');
  const emptyEl = document.getElementById('users-empty');
  const countEl = document.getElementById('user-count');

  countEl.textContent = `Showing ${filteredUsers.length} of ${allUsers.length} user${allUsers.length !== 1 ? 's' : ''}`;

  if (filteredUsers.length === 0) {
    tbody.innerHTML = '';
    emptyEl.classList.remove('d-none');
    return;
  }

  emptyEl.classList.add('d-none');

  tbody.innerHTML = filteredUsers.map((user) => {
    const rc = ROLE_CONFIG[user.role] || { color: 'secondary', label: user.role };

    const teamsHtml = (user.teams || []).length > 0
      ? user.teams.map((t) =>
          `<span class="badge bg-secondary-subtle text-secondary me-1 mb-1"${
            t.team_role === 'manager' ? ' title="Team Manager"' : ''
          }>${escapeHtml(t.team_name)}${
            t.team_role === 'manager'
              ? ' <i class="bi bi-star-fill text-warning" style="font-size:0.6rem" title="Team Manager"></i>'
              : ''
          }</span>`
        ).join('')
      : '<span class="text-muted small fst-italic">No teams</span>';

    const statusBadge = user.is_active
      ? '<span class="badge bg-success-subtle text-success">Active</span>'
      : '<span class="badge bg-danger-subtle text-danger">Inactive</span>';

    // Determine if toggle button should be shown
    const canToggle = canToggleUser(user);

    const actionHtml = canToggle
      ? `<button class="btn btn-sm ${user.is_active ? 'btn-outline-danger' : 'btn-outline-success'} toggle-active-btn"
                 data-user-id="${user.id}" type="button">
           <i class="bi ${user.is_active ? 'bi-person-x' : 'bi-person-check'} me-1"></i>${user.is_active ? 'Deactivate' : 'Activate'}
         </button>`
      : (user.id === currentUser.id
          ? '<span class="text-muted small fst-italic">You</span>'
          : '');

    return `
      <tr class="${!user.is_active ? 'table-light' : ''}">
        <td class="ps-3">
          <div class="d-flex align-items-center gap-2">
            <div class="admin-avatar-sm">
              ${buildAvatarSmall(user.avatar_url, user.full_name)}
            </div>
            <span class="fw-medium ${!user.is_active ? 'text-muted' : ''}">${escapeHtml(user.full_name || 'Unnamed')}</span>
          </div>
        </td>
        <td class="${!user.is_active ? 'text-muted' : ''}"><small>${escapeHtml(user.email)}</small></td>
        <td>
          <span class="badge bg-${rc.color}-subtle text-${rc.color} rounded-pill">${rc.label}</span>
        </td>
        <td>${teamsHtml}</td>
        <td>${statusBadge}</td>
        <td class="text-end pe-3">${actionHtml}</td>
      </tr>
    `;
  }).join('');
}

// ── Authorization logic (client-side mirror of DB rules) ────────────────────

function canToggleUser(user) {
  // Cannot toggle yourself
  if (user.id === currentUser.id) return false;

  // Super admin cannot be deactivated by anyone
  if (user.role === 'super_admin') return false;

  // Regular admin can only toggle employees (not other admins)
  if (currentUserRole === 'admin' && user.role === 'admin') return false;

  // Super admin can toggle anyone (except themselves and super_admins — handled above)
  // Admin can toggle employees
  return true;
}

// ── Toggle modal ────────────────────────────────────────────────────────────

function openToggleModal(user) {
  pendingToggleUserId = user.id;
  pendingToggleStatus = !user.is_active;
  pendingToggleUserName = user.full_name || 'this user';

  const isDeactivating = user.is_active;
  const action = isDeactivating ? 'Deactivate' : 'Reactivate';

  document.getElementById('toggle-title').textContent = `${action} User`;
  document.getElementById('toggle-message').textContent = isDeactivating
    ? `Are you sure you want to deactivate ${pendingToggleUserName}? They will be unable to log in.`
    : `Reactivate ${pendingToggleUserName}? They will be able to log in again.`;

  const btn = document.getElementById('confirm-toggle-btn');
  btn.className = `btn btn-sm ${isDeactivating ? 'btn-danger' : 'btn-success'}`;
  document.getElementById('toggle-btn-label').textContent = action;

  toggleModalInstance.show();
}

async function handleToggleConfirm() {
  const btn = document.getElementById('confirm-toggle-btn');
  const spinner = document.getElementById('toggle-spinner');
  btn.disabled = true;
  spinner.classList.remove('d-none');

  const { error } = await supabase.rpc('toggle_user_active', {
    target_user_id: pendingToggleUserId,
    new_status: pendingToggleStatus,
  });

  btn.disabled = false;
  spinner.classList.add('d-none');

  if (error) {
    console.error('Toggle user error:', error);
    showToast(error.message || 'Could not change user status.', 'danger');
    return;
  }

  toggleModalInstance.hide();

  const actionPast = pendingToggleStatus ? 'reactivated' : 'deactivated';
  showToast(`${pendingToggleUserName} has been ${actionPast}.`, 'success');

  // Refresh the user list
  await loadUsers();

  pendingToggleUserId = null;
  pendingToggleStatus = null;
  pendingToggleUserName = '';
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function buildAvatarSmall(avatarUrl, name) {
  if (avatarUrl) {
    return `<img src="${escapeHtml(avatarUrl)}" alt="" class="admin-avatar-img"
              onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />
            <span class="admin-avatar-initials" style="display:none">${getInitials(name)}</span>`;
  }
  if (name) {
    return `<span class="admin-avatar-initials">${getInitials(name)}</span>`;
  }
  return `<i class="bi bi-person-fill text-muted"></i>`;
}

function getInitials(name) {
  return (name ?? '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

// ── Start ───────────────────────────────────────────────────────────────────

init();
