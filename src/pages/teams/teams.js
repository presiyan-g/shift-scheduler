import { requireAuth } from '@shared/auth.js';
import { renderNavbar } from '@shared/navbar.js';
import { supabase } from '@shared/supabase.js';
import { showToast } from '@shared/toast.js';
import { getAllTeams, getManagedTeams, getTeamMembers } from '@shared/teams.js';

// ── Module-level state ──────────────────────────────────────────────────────

let currentUser = null;
let userRole = 'employee';        // 'admin' | 'employee'
let isAdmin = false;
let teams = [];                    // current list of teams
let currentTeamId = null;          // team shown in detail view
let currentMembers = [];           // members of the detail team
let pendingDeleteType = null;      // 'team' | 'member'
let pendingDeleteId = null;        // UUID of team or team_member row
let pendingDeleteLabel = '';       // display name for confirmation

let teamModalInstance = null;
let memberModalInstance = null;
let deleteModalInstance = null;

// ── Entry point ─────────────────────────────────────────────────────────────

async function init() {
  currentUser = await requireAuth();

  renderNavbar({ activePage: 'teams' });

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('full_name, role, avatar_url')
    .eq('id', currentUser.id)
    .single();

  if (profileError) {
    console.error('Profile fetch error:', profileError);
    showToast('Could not load profile.', 'danger');
    return;
  }

  userRole = profile.role;
  isAdmin = userRole === 'admin';

  // Only admins and team managers should be on this page
  let isTeamManager = false;
  if (!isAdmin) {
    const managed = await getManagedTeams(currentUser.id);
    isTeamManager = managed.length > 0;
    if (!isTeamManager) {
      window.location.replace('/dashboard');
      return;
    }
  }

  renderNavbar({ activePage: 'teams', role: userRole, isTeamManager, userName: profile.full_name, avatarUrl: profile.avatar_url });

  // Admin-only controls
  if (isAdmin) {
    document.getElementById('create-team-btn').classList.remove('d-none');
    document.getElementById('teams-empty-hint').textContent =
      'Click "New Team" to create your first team.';
  }

  // Bootstrap modal instances
  teamModalInstance = new bootstrap.Modal(document.getElementById('team-modal'));
  memberModalInstance = new bootstrap.Modal(document.getElementById('member-modal'));
  deleteModalInstance = new bootstrap.Modal(document.getElementById('delete-modal'));

  // Reset form validation on modal close
  document.getElementById('team-modal').addEventListener('hidden.bs.modal', () => {
    document.getElementById('team-form').classList.remove('was-validated');
  });
  document.getElementById('member-modal').addEventListener('hidden.bs.modal', () => {
    document.getElementById('member-form').classList.remove('was-validated');
  });

  attachEventListeners();
  await loadTeams();
  await openDeepLinkedTeam();
}

// ── Event listeners ─────────────────────────────────────────────────────────

function attachEventListeners() {
  document.getElementById('create-team-btn').addEventListener('click', () => openTeamModal(null));
  document.getElementById('back-to-list-btn').addEventListener('click', showListView);
  document.getElementById('add-member-btn').addEventListener('click', openMemberModal);
  document.getElementById('team-save-btn').addEventListener('click', handleTeamSave);
  document.getElementById('member-save-btn').addEventListener('click', handleMemberSave);
  document.getElementById('confirm-delete-btn').addEventListener('click', handleDeleteConfirm);

  // Delegated clicks on the teams grid
  document.getElementById('teams-grid').addEventListener('click', (e) => {
    const card = e.target.closest('.team-card');
    const editBtn = e.target.closest('.edit-team-btn');
    const deleteBtn = e.target.closest('.delete-team-btn');

    if (deleteBtn) {
      e.stopPropagation();
      const teamId = deleteBtn.dataset.teamId;
      const team = teams.find((t) => t.id === teamId);
      openDeleteConfirm('team', teamId, team?.name || 'this team');
      return;
    }
    if (editBtn) {
      e.stopPropagation();
      openTeamModal(editBtn.dataset.teamId);
      return;
    }
    if (card) {
      showDetailView(card.dataset.teamId);
    }
  });

  // Delegated clicks on the members table
  document.getElementById('members-tbody').addEventListener('click', (e) => {
    const removeBtn = e.target.closest('.remove-member-btn');

    if (removeBtn) {
      const member = currentMembers.find((m) => m.id === removeBtn.dataset.memberId);
      openDeleteConfirm('member', removeBtn.dataset.memberId, member?.profile?.full_name || 'this member');
    }
  });
}

// ── Data loading ────────────────────────────────────────────────────────────

async function loadTeams() {
  if (isAdmin) {
    teams = await getAllTeams();
  } else {
    const managed = await getManagedTeams(currentUser.id);
    teams = managed.map((m) => m.team);
  }

  renderTeamList();
}

async function loadTeamDetail(teamId) {
  currentMembers = await getTeamMembers(teamId);
  renderMembersTable();
}

async function openDeepLinkedTeam() {
  const params = new URLSearchParams(window.location.search);
  const deepLinkedTeamId = params.get('team');
  if (!deepLinkedTeamId) return;

  const targetTeam = teams.find((team) => team.id === deepLinkedTeamId);
  if (!targetTeam) {
    showToast('Team not found or access denied.', 'warning');
    return;
  }

  await showDetailView(deepLinkedTeamId);
}

// ── Rendering: Team list ────────────────────────────────────────────────────

function renderTeamList() {
  const grid = document.getElementById('teams-grid');
  const emptyEl = document.getElementById('teams-empty');

  if (teams.length === 0) {
    grid.innerHTML = '';
    emptyEl.classList.remove('d-none');
    return;
  }

  emptyEl.classList.add('d-none');
  grid.innerHTML = teams.map((team) => buildTeamCardHtml(team)).join('');
}

function buildTeamCardHtml(team) {
  const adminActions = isAdmin
    ? `<div class="d-flex gap-1 mt-2">
         <button class="btn btn-sm btn-outline-secondary edit-team-btn" data-team-id="${team.id}" title="Edit team" type="button">
           <i class="bi bi-pencil me-1"></i>Edit
         </button>
         <button class="btn btn-sm btn-outline-danger delete-team-btn" data-team-id="${team.id}" title="Delete team" type="button">
           <i class="bi bi-trash me-1"></i>Delete
         </button>
       </div>`
    : '';

  return `
    <div class="col-12 col-sm-6 col-lg-4">
      <div class="card border-0 shadow-sm team-card h-100" data-team-id="${team.id}">
        <div class="card-body">
          <div class="d-flex align-items-start justify-content-between">
            <h5 class="fw-bold mb-1">${escapeHtml(team.name)}</h5>
            <i class="bi bi-people-fill text-primary fs-4"></i>
          </div>
          <p class="text-muted small mb-2">${escapeHtml(team.description || 'No description')}</p>
          ${adminActions}
        </div>
      </div>
    </div>
  `;
}

// ── Rendering: Team detail (members table) ──────────────────────────────────

function renderMembersTable() {
  const tbody = document.getElementById('members-tbody');
  const emptyEl = document.getElementById('members-empty');

  if (currentMembers.length === 0) {
    tbody.innerHTML = '';
    emptyEl.classList.remove('d-none');
    return;
  }

  emptyEl.classList.add('d-none');

  tbody.innerHTML = currentMembers
    .map((member) => {
      const profile = member.profile;
      const teamRoleBadge =
        member.role === 'manager'
          ? '<span class="badge bg-primary">Manager</span>'
          : '<span class="badge bg-secondary">Member</span>';

      const appRoleBadge = {
        admin: '<span class="badge bg-danger-subtle text-danger">Admin</span>',
        employee: '<span class="badge bg-success-subtle text-success">Employee</span>',
      }[profile?.role] || '';

      return `
        <tr>
          <td class="ps-3 fw-medium">${escapeHtml(profile?.full_name || 'Unknown')}</td>
          <td>${appRoleBadge}</td>
          <td>${teamRoleBadge}</td>
          <td class="text-end pe-3">
            <button class="btn btn-sm btn-outline-danger remove-member-btn" data-member-id="${member.id}" title="Remove from team" type="button">
              <i class="bi bi-x-lg"></i>
            </button>
          </td>
        </tr>
      `;
    })
    .join('');
}

// ── View switching ──────────────────────────────────────────────────────────

function showListView() {
  document.getElementById('team-detail-view').classList.add('d-none');
  document.getElementById('team-list-view').classList.remove('d-none');
  document.getElementById('create-team-btn').classList.toggle('d-none', !isAdmin);
  currentTeamId = null;
  syncTeamQueryParam(null);
}

async function showDetailView(teamId) {
  currentTeamId = teamId;
  const team = teams.find((t) => t.id === teamId);
  if (!team) return;

  syncTeamQueryParam(teamId);

  document.getElementById('detail-team-name').textContent = team.name;
  document.getElementById('detail-team-desc').textContent = team.description || '';

  // Show add-member button for admins and team managers
  document.getElementById('add-member-btn').classList.remove('d-none');

  document.getElementById('team-list-view').classList.add('d-none');
  document.getElementById('create-team-btn').classList.add('d-none');
  document.getElementById('team-detail-view').classList.remove('d-none');

  await loadTeamDetail(teamId);
}

function syncTeamQueryParam(teamId) {
  const url = new URL(window.location.href);
  if (teamId) {
    url.searchParams.set('team', teamId);
  } else {
    url.searchParams.delete('team');
  }
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

// ── Modal: Create / Edit Team ───────────────────────────────────────────────

function openTeamModal(teamId) {
  const form = document.getElementById('team-form');
  form.reset();
  form.classList.remove('was-validated');

  const titleEl = document.getElementById('team-modal-label');
  const saveLabelEl = document.getElementById('team-save-label');

  if (!teamId) {
    titleEl.textContent = 'New Team';
    document.getElementById('team-id').value = '';
    saveLabelEl.textContent = 'Create Team';
  } else {
    const team = teams.find((t) => t.id === teamId);
    if (!team) return;

    titleEl.textContent = 'Edit Team';
    document.getElementById('team-id').value = team.id;
    document.getElementById('team-name').value = team.name;
    document.getElementById('team-description').value = team.description || '';
    saveLabelEl.textContent = 'Update Team';
  }

  teamModalInstance.show();
}

async function handleTeamSave() {
  const form = document.getElementById('team-form');
  form.classList.add('was-validated');
  if (!form.checkValidity()) return;

  const saveBtn = document.getElementById('team-save-btn');
  const spinner = document.getElementById('team-save-spinner');
  saveBtn.disabled = true;
  spinner.classList.remove('d-none');

  const teamId = document.getElementById('team-id').value;
  const isEdit = Boolean(teamId);

  const payload = {
    name: document.getElementById('team-name').value.trim(),
    description: document.getElementById('team-description').value.trim() || '',
  };

  if (!isEdit) {
    payload.created_by = currentUser.id;
  }

  const { error } = isEdit
    ? await supabase.from('teams').update(payload).eq('id', teamId)
    : await supabase.from('teams').insert(payload);

  saveBtn.disabled = false;
  spinner.classList.add('d-none');

  if (error) {
    console.error('Team save error:', error);
    showToast(error.message || 'Could not save team.', 'danger');
    return;
  }

  teamModalInstance.hide();
  showToast(isEdit ? 'Team updated.' : 'Team created.', 'success');
  await loadTeams();
}

// ── Modal: Add Member ───────────────────────────────────────────────────────

async function openMemberModal() {
  const form = document.getElementById('member-form');
  form.reset();
  form.classList.remove('was-validated');

  // Fetch profiles not already in this team (bypasses RLS via SECURITY DEFINER)
  const { data: available, error } = await supabase
    .rpc('get_available_profiles_for_team', { target_team_id: currentTeamId });

  if (error) {
    console.error('Profiles fetch error:', error);
    showToast('Could not load profiles.', 'danger');
    return;
  }

  const select = document.getElementById('member-profile');
  select.innerHTML = '<option value="">— Select a person —</option>';
  available.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.role === 'admin' ? `${p.full_name} (admin)` : p.full_name;
    select.appendChild(opt);
  });

  memberModalInstance.show();
}

async function handleMemberSave() {
  const form = document.getElementById('member-form');
  form.classList.add('was-validated');
  if (!form.checkValidity()) return;

  const saveBtn = document.getElementById('member-save-btn');
  const spinner = document.getElementById('member-save-spinner');
  saveBtn.disabled = true;
  spinner.classList.remove('d-none');

  const payload = {
    team_id: currentTeamId,
    profile_id: document.getElementById('member-profile').value,
    role: document.getElementById('member-role').value,
  };

  const { error } = await supabase.from('team_members').insert(payload);

  saveBtn.disabled = false;
  spinner.classList.add('d-none');

  if (error) {
    console.error('Member add error:', error);
    showToast(error.message || 'Could not add member.', 'danger');
    return;
  }

  memberModalInstance.hide();
  showToast('Member added.', 'success');
  await loadTeamDetail(currentTeamId);
}

// ── Delete confirmation ─────────────────────────────────────────────────────

function openDeleteConfirm(type, id, label) {
  pendingDeleteType = type;
  pendingDeleteId = id;
  pendingDeleteLabel = label;

  document.getElementById('delete-title').textContent =
    type === 'team' ? 'Delete Team' : 'Remove Member';
  document.getElementById('delete-message').textContent =
    type === 'team'
      ? `Are you sure you want to delete "${label}"? All members will be removed. This cannot be undone.`
      : `Remove ${label} from this team?`;

  deleteModalInstance.show();
}

async function handleDeleteConfirm() {
  const confirmBtn = document.getElementById('confirm-delete-btn');
  const spinner = document.getElementById('delete-spinner');
  confirmBtn.disabled = true;
  spinner.classList.remove('d-none');

  let error;

  if (pendingDeleteType === 'team') {
    ({ error } = await supabase.from('teams').delete().eq('id', pendingDeleteId));
  } else {
    ({ error } = await supabase.from('team_members').delete().eq('id', pendingDeleteId));
  }

  confirmBtn.disabled = false;
  spinner.classList.add('d-none');

  if (error) {
    console.error('Delete error:', error);
    showToast(error.message || 'Could not delete.', 'danger');
    return;
  }

  deleteModalInstance.hide();

  if (pendingDeleteType === 'team') {
    showToast('Team deleted.', 'success');
    await loadTeams();
    showListView();
  } else {
    showToast('Member removed.', 'success');
    await loadTeamDetail(currentTeamId);
  }

  pendingDeleteType = null;
  pendingDeleteId = null;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

// ── Start ───────────────────────────────────────────────────────────────────

init();
