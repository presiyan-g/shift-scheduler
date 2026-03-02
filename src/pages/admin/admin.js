import { requireAuth, getProfile } from '@shared/auth/auth.js';
import { renderNavbar } from '@shared/components/navbar/navbar.js';
import { supabase } from '@shared/supabase.js';
import { showToast } from '@shared/components/toast/toast.js';
import { getManagedTeams } from '@shared/services/teams.js';
import { escapeHtml } from '@shared/utils/formatting.js';
import { buildAvatarHtml } from '@shared/components/avatar/avatar.js';

// ── Module-level state ──────────────────────────────────────────────────────

let currentUser = null;
let currentUserRole = 'employee';
let allUsers = [];
let filteredUsers = [];
let pendingToggleUserId = null;
let pendingToggleStatus = null;
let pendingToggleUserName = '';
let toggleModalInstance = null;
let pendingRoleUserId   = null;
let pendingRoleNewRole  = null;
let pendingRoleUserName = '';
let roleModalInstance   = null;

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
  roleModalInstance   = new bootstrap.Modal(document.getElementById('role-modal'));

  attachEventListeners();
  await loadUsers();
}

// ── Event listeners ─────────────────────────────────────────────────────────

function attachEventListeners() {
  document.getElementById('search-input').addEventListener('input', applyFilters);
  document.getElementById('role-filter').addEventListener('change', applyFilters);
  document.getElementById('status-filter').addEventListener('change', applyFilters);
  document.getElementById('confirm-toggle-btn').addEventListener('click', handleToggleConfirm);
  document.getElementById('confirm-role-btn').addEventListener('click', handleRoleConfirm);

  // Delegated click on the users table body
  document.getElementById('users-tbody').addEventListener('click', (e) => {
    const toggleBtn = e.target.closest('.toggle-active-btn');
    if (toggleBtn) {
      const userId = toggleBtn.dataset.userId;
      const user = allUsers.find((u) => u.id === userId);
      if (user) openToggleModal(user);
    }

    const roleBtn = e.target.closest('.change-role-btn');
    if (roleBtn) {
      const userId = roleBtn.dataset.userId;
      const user = allUsers.find((u) => u.id === userId);
      if (user) openRoleModal(user);
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

    const canToggle   = canToggleUser(user);
    const canRole     = canChangeRole(user);
    const isPromoting = user.role === 'employee';

    const toggleBtnHtml = canToggle
      ? `<button class="btn btn-sm ${user.is_active ? 'btn-outline-danger' : 'btn-outline-success'} toggle-active-btn"
                 data-user-id="${user.id}" type="button">
           <i class="bi ${user.is_active ? 'bi-person-x' : 'bi-person-check'} me-1"></i>${user.is_active ? 'Deactivate' : 'Activate'}
         </button>`
      : '';

    const roleBtnHtml = canRole
      ? `<button class="btn btn-sm ${isPromoting ? 'btn-outline-primary' : 'btn-outline-warning'} change-role-btn ms-1"
                 data-user-id="${user.id}" type="button">
           <i class="bi ${isPromoting ? 'bi-shield-plus' : 'bi-shield-minus'} me-1"></i>${isPromoting ? 'Make Admin' : 'Demote'}
         </button>`
      : '';

    const selfLabel = (!canToggle && !canRole && user.id === currentUser.id)
      ? '<span class="text-muted small fst-italic">You</span>'
      : '';

    const actionHtml = toggleBtnHtml + roleBtnHtml + selfLabel;

    return `
      <tr class="${!user.is_active ? 'table-light' : ''}">
        <td class="ps-3">
          <div class="d-flex align-items-center gap-2">
            <div class="avatar avatar-sm">
              ${buildAvatarHtml(user.full_name, user.avatar_url)}
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

// ── Role change authorization (client-side mirror of DB rules) ──────────────

function canChangeRole(user) {
  // Only super_admins can change roles
  if (currentUserRole !== 'super_admin') return false;

  // Cannot change your own role
  if (user.id === currentUser.id) return false;

  // Cannot change another super_admin's role
  if (user.role === 'super_admin') return false;

  // Only admin and employee are valid targets
  if (user.role !== 'admin' && user.role !== 'employee') return false;

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

// ── Role change modal ────────────────────────────────────────────────────────

function openRoleModal(user) {
  pendingRoleUserId   = user.id;
  pendingRoleNewRole  = user.role === 'employee' ? 'admin' : 'employee';
  pendingRoleUserName = user.full_name || 'this user';

  const isPromoting = pendingRoleNewRole === 'admin';

  document.getElementById('role-title').textContent   = isPromoting ? 'Make Admin' : 'Demote to Employee';
  document.getElementById('role-message').textContent = isPromoting
    ? `Promote ${pendingRoleUserName} to Admin? They will gain admin privileges.`
    : `Demote ${pendingRoleUserName} to Employee? They will lose admin privileges.`;

  const btn = document.getElementById('confirm-role-btn');
  btn.className = `btn btn-sm ${isPromoting ? 'btn-primary' : 'btn-warning'}`;
  document.getElementById('role-btn-label').textContent = isPromoting ? 'Make Admin' : 'Demote';

  roleModalInstance.show();
}

async function handleRoleConfirm() {
  const btn     = document.getElementById('confirm-role-btn');
  const spinner = document.getElementById('role-spinner');
  btn.disabled  = true;
  spinner.classList.remove('d-none');

  const { error } = await supabase.rpc('change_user_role', {
    target_user_id: pendingRoleUserId,
    new_role:       pendingRoleNewRole,
  });

  btn.disabled = false;
  spinner.classList.add('d-none');

  if (error) {
    console.error('Change role error:', error);
    showToast(error.message || 'Could not change user role.', 'danger');
    return;
  }

  roleModalInstance.hide();

  const actionPast = pendingRoleNewRole === 'admin' ? 'promoted to Admin' : 'demoted to Employee';
  showToast(`${pendingRoleUserName} has been ${actionPast}.`, 'success');

  await loadUsers();

  pendingRoleUserId   = null;
  pendingRoleNewRole  = null;
  pendingRoleUserName = '';
}

// ── Start ───────────────────────────────────────────────────────────────────

init();
