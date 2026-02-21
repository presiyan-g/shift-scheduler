import { requireAuth } from '@shared/auth.js';
import { renderNavbar } from '@shared/navbar.js';
import { supabase } from '@shared/supabase.js';
import { showToast } from '@shared/toast.js';
import { getAllTeams, getManagedTeams, getTeamEmployees } from '@shared/teams.js';

// ── Module-level state ──────────────────────────────────────────────────────

let currentWeekStart = null; // Date object — Monday of the displayed week
let currentUser = null;
let userRole = 'employee';
let isManager = false;
let isAdmin = false;
let managedTeams = [];       // teams the current manager manages
let selectedTeamId = null;   // currently selected team filter (null = all)
let employees = [];          // [{ id, full_name }] — loaded for the selected team
let currentShifts = [];      // cached after each loadWeek() for edit/delete lookup
let pendingDeleteId = null;  // shift UUID awaiting deletion confirm
let shiftModalInstance = null;
let deleteModalInstance = null;

// ── Entry point ─────────────────────────────────────────────────────────────

async function init() {
  currentUser = await requireAuth();

  renderNavbar({ activePage: 'schedule' });

  // Fetch profile to determine role
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('full_name, role')
    .eq('id', currentUser.id)
    .single();

  if (profileError) {
    console.error('Profile fetch error:', profileError);
    showToast('Could not load your profile.', 'danger');
    return;
  }

  userRole = profile.role;
  isAdmin = userRole === 'admin';

  // Fetch managed teams early to determine manager status
  if (isAdmin) {
    managedTeams = (await getAllTeams()).map((t) => ({ team: t }));
  } else {
    managedTeams = await getManagedTeams(currentUser.id);
  }

  const isTeamManager = managedTeams.length > 0;
  isManager = isAdmin || isTeamManager;

  renderNavbar({ activePage: 'schedule', role: userRole, isTeamManager });

  // Subtitle text
  document.getElementById('schedule-subtitle').textContent = isManager
    ? 'Viewing team shifts for the week'
    : 'Viewing your shifts for the week';

  if (isManager) {
    document.getElementById('add-shift-btn').classList.remove('d-none');

    const teamFilter = document.getElementById('team-filter');
    const teamField = document.getElementById('team-field');
    const shiftTeamSelect = document.getElementById('shift-team');

    if (managedTeams.length > 0) {
      // Populate team filter dropdown
      teamFilter.innerHTML = managedTeams.length > 1
        ? '<option value="">All My Teams</option>'
        : '';
      managedTeams.forEach((mt) => {
        const opt = document.createElement('option');
        opt.value = mt.team.id;
        opt.textContent = mt.team.name;
        teamFilter.appendChild(opt);
      });
      teamFilter.classList.remove('d-none');

      // Populate team dropdown in shift modal
      shiftTeamSelect.innerHTML = '<option value="">— Select team —</option>';
      managedTeams.forEach((mt) => {
        const opt = document.createElement('option');
        opt.value = mt.team.id;
        opt.textContent = mt.team.name;
        shiftTeamSelect.appendChild(opt);
      });
      teamField.classList.remove('d-none');

      // Auto-select if only one team
      if (managedTeams.length === 1) {
        selectedTeamId = managedTeams[0].team.id;
        teamFilter.value = selectedTeamId;
        shiftTeamSelect.value = selectedTeamId;
        teamFilter.classList.add('d-none'); // hide single-option filter
      }

      // Load employees for the selected team (or first team)
      await fetchEmployeesForTeam(selectedTeamId || managedTeams[0].team.id);
    } else {
      // Manager with no teams
      document.getElementById('schedule-subtitle').textContent =
        'You haven\'t been assigned to any teams yet. Contact your administrator.';
      document.getElementById('add-shift-btn').classList.add('d-none');
    }
  } else {
    // Hide team & employee fields in modal for non-managers
    document.getElementById('team-field').classList.add('d-none');
    document.getElementById('shift-team').removeAttribute('required');
    document.getElementById('employee-field').classList.add('d-none');
    document.getElementById('shift-employee').removeAttribute('required');
  }

  currentWeekStart = getWeekStart(new Date());

  // Bootstrap modal instances
  shiftModalInstance = new bootstrap.Modal(document.getElementById('shift-modal'));
  deleteModalInstance = new bootstrap.Modal(document.getElementById('delete-modal'));

  // Reset form validation state when modal closes
  document.getElementById('shift-modal').addEventListener('hidden.bs.modal', () => {
    const form = document.getElementById('shift-form');
    form.classList.remove('was-validated');
  });

  attachEventListeners();
  await loadWeek();
}

// ── Event listeners ──────────────────────────────────────────────────────────

function attachEventListeners() {
  document.getElementById('prev-week-btn').addEventListener('click', () => {
    currentWeekStart.setDate(currentWeekStart.getDate() - 7);
    loadWeek();
  });

  document.getElementById('next-week-btn').addEventListener('click', () => {
    currentWeekStart.setDate(currentWeekStart.getDate() + 7);
    loadWeek();
  });

  document.getElementById('add-shift-btn').addEventListener('click', () => {
    openShiftModal(null);
  });

  // Delegated click on the week grid for edit/delete buttons
  document.getElementById('week-grid').addEventListener('click', (e) => {
    const editBtn = e.target.closest('.edit-shift-btn');
    const deleteBtn = e.target.closest('.delete-shift-btn');
    if (editBtn) openShiftModal(editBtn.dataset.shiftId);
    if (deleteBtn) openDeleteModal(deleteBtn.dataset.shiftId);
  });

  document.getElementById('shift-save-btn').addEventListener('click', () => {
    handleShiftSave();
  });

  document.getElementById('confirm-delete-btn').addEventListener('click', () => {
    handleDeleteConfirm();
  });

  // Team filter change — reload shifts and employees for selected team
  document.getElementById('team-filter').addEventListener('change', async (e) => {
    selectedTeamId = e.target.value || null;
    if (selectedTeamId) {
      await fetchEmployeesForTeam(selectedTeamId);
    }
    await loadWeek();
  });

  // Team dropdown in shift modal — reload employees when team changes
  document.getElementById('shift-team').addEventListener('change', async (e) => {
    const teamId = e.target.value;
    if (teamId) {
      await fetchEmployeesForTeam(teamId);
    } else {
      // Clear employee dropdown
      const select = document.getElementById('shift-employee');
      select.innerHTML = '<option value="">— Select employee —</option>';
      employees = [];
    }
  });
}

// ── Data fetching ────────────────────────────────────────────────────────────

async function loadWeek() {
  const loading = document.getElementById('schedule-loading');
  const grid = document.getElementById('week-grid');

  loading.classList.remove('d-none');
  grid.classList.add('d-none');

  const weekEnd = new Date(currentWeekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  document.getElementById('week-label').textContent = formatWeekLabel(currentWeekStart);

  const weekStartStr = toDateString(currentWeekStart);
  const weekEndStr = toDateString(weekEnd);

  let query = supabase
    .from('shifts')
    .select('*, employee:profiles!employee_id(full_name)')
    .gte('shift_date', weekStartStr)
    .lte('shift_date', weekEndStr)
    .order('start_time', { ascending: true });

  // Filter by selected team (managers/admins)
  if (selectedTeamId) {
    query = query.eq('team_id', selectedTeamId);
  }

  const { data: shifts, error } = await query;

  if (error) {
    console.error('Shifts fetch error:', error);
    showToast('Could not load shifts.', 'danger');
    loading.classList.add('d-none');
    grid.classList.remove('d-none');
    return;
  }

  currentShifts = shifts || [];
  renderWeekGrid(currentShifts);

  loading.classList.add('d-none');
  grid.classList.remove('d-none');
}

async function fetchEmployeesForTeam(teamId) {
  const data = await getTeamEmployees(teamId);

  employees = data || [];
  const select = document.getElementById('shift-employee');
  select.innerHTML = '<option value="">— Select employee —</option>';
  employees.forEach((emp) => {
    const opt = document.createElement('option');
    opt.value = emp.id;
    opt.textContent = emp.full_name;
    select.appendChild(opt);
  });
}

// ── Rendering ────────────────────────────────────────────────────────────────

function renderWeekGrid(shifts) {
  const grid = document.getElementById('week-grid');
  grid.innerHTML = '';

  const today = toDateString(new Date());
  const days = getWeekDays(currentWeekStart);

  days.forEach((dayDate) => {
    const dateStr = toDateString(dayDate);
    const isToday = dateStr === today;
    const dayShifts = shifts.filter((s) => s.shift_date === dateStr);

    const col = document.createElement('div');
    col.className = 'col-12 col-sm-6 col-md-4 col-lg schedule-day-col';
    col.innerHTML = buildDayColumnHtml(dayDate, dateStr, isToday, dayShifts);
    grid.appendChild(col);
  });
}

function buildDayColumnHtml(dayDate, dateStr, isToday, dayShifts) {
  const weekday = dayDate.toLocaleDateString('en-US', { weekday: 'short' });
  const monthDay = dayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  const todayCardClass = isToday ? ' today-card' : '';
  const headerClass = isToday ? ' today-header' : ' bg-white';
  const labelClass = isToday ? ' today-day-label fw-bold' : ' text-muted';
  const todayBadge = isToday
    ? `<span class="badge bg-primary ms-auto">Today</span>`
    : '';

  const shiftsHtml =
    dayShifts.length === 0
      ? `<p class="text-muted text-center small my-auto py-3 mb-0">No shifts</p>`
      : dayShifts.map((s) => buildShiftCardHtml(s)).join('');

  return `
    <div class="card border-0 shadow-sm h-100 schedule-day-card${todayCardClass}">
      <div class="card-header d-flex align-items-center gap-2 py-2${headerClass}">
        <div>
          <div class="fw-semibold small${labelClass}">${escapeHtml(weekday)}</div>
          <div class="small text-muted">${escapeHtml(monthDay)}</div>
        </div>
        ${todayBadge}
      </div>
      <div class="card-body p-2 d-flex flex-column gap-2">
        ${shiftsHtml}
      </div>
    </div>
  `;
}

function buildShiftCardHtml(shift) {
  const statusClass = `shift-status-${shift.status}`;
  const badgeClass = {
    scheduled: 'bg-primary-subtle text-primary',
    completed: 'bg-success-subtle text-success',
    cancelled: 'bg-danger-subtle text-danger',
  }[shift.status] || 'bg-secondary-subtle text-secondary';

  const employeeRow = isManager
    ? `<div class="text-muted mt-1">
         <i class="bi bi-person me-1"></i>${escapeHtml(shift.employee?.full_name || '—')}
       </div>`
    : '';

  const actionBtns = isManager
    ? `<div class="d-flex gap-1 mt-2 justify-content-end">
         <button
           class="btn btn-sm btn-outline-secondary py-0 px-1 edit-shift-btn"
           data-shift-id="${shift.id}"
           title="Edit shift"
           type="button"
         ><i class="bi bi-pencil"></i></button>
         <button
           class="btn btn-sm btn-outline-danger py-0 px-1 delete-shift-btn"
           data-shift-id="${shift.id}"
           title="Delete shift"
           type="button"
         ><i class="bi bi-trash"></i></button>
       </div>`
    : '';

  return `
    <div class="shift-card p-2 rounded border ${statusClass}">
      <div class="d-flex align-items-start justify-content-between gap-1">
        <span class="fw-semibold text-truncate">${escapeHtml(shift.title || 'Shift')}</span>
        <span class="badge ${badgeClass} rounded-pill text-nowrap">${shift.status}</span>
      </div>
      <div class="text-muted mt-1">
        <i class="bi bi-clock me-1"></i>${formatTime(shift.start_time)} – ${formatTime(shift.end_time)}
      </div>
      ${employeeRow}
      ${actionBtns}
    </div>
  `;
}

// ── Modal: Shift create / edit ───────────────────────────────────────────────

function openShiftModal(shiftId) {
  const form = document.getElementById('shift-form');
  form.reset();
  form.classList.remove('was-validated');

  const titleEl = document.getElementById('shift-modal-label');
  const shiftIdEl = document.getElementById('shift-id');
  const statusField = document.getElementById('status-field');
  const saveLabelEl = document.getElementById('shift-save-label');

  if (!shiftId) {
    // Create mode
    titleEl.textContent = 'Add Shift';
    shiftIdEl.value = '';
    statusField.classList.add('d-none');
    saveLabelEl.textContent = 'Save Shift';
    // Pre-fill date with the current week's Monday as a convenience
    document.getElementById('shift-date').value = toDateString(currentWeekStart);
  } else {
    // Edit mode
    const shift = currentShifts.find((s) => s.id === shiftId);
    if (!shift) return;

    titleEl.textContent = 'Edit Shift';
    shiftIdEl.value = shift.id;
    statusField.classList.remove('d-none');
    saveLabelEl.textContent = 'Update Shift';

    if (isManager) {
      if (shift.team_id) {
        document.getElementById('shift-team').value = shift.team_id;
      }
      document.getElementById('shift-employee').value = shift.employee_id;
    }
    document.getElementById('shift-title').value = shift.title || '';
    document.getElementById('shift-date').value = shift.shift_date;
    document.getElementById('shift-start').value = shift.start_time?.slice(0, 5) || '';
    document.getElementById('shift-end').value = shift.end_time?.slice(0, 5) || '';
    document.getElementById('shift-status').value = shift.status;
    document.getElementById('shift-notes').value = shift.notes || '';
  }

  shiftModalInstance.show();
}

async function handleShiftSave() {
  const form = document.getElementById('shift-form');
  form.classList.add('was-validated');
  if (!form.checkValidity()) return;

  const saveBtn = document.getElementById('shift-save-btn');
  const spinner = document.getElementById('shift-save-spinner');
  saveBtn.disabled = true;
  spinner.classList.remove('d-none');

  const shiftId = document.getElementById('shift-id').value;
  const isEdit = Boolean(shiftId);

  const payload = {
    employee_id: isManager
      ? document.getElementById('shift-employee').value
      : currentUser.id,
    title: document.getElementById('shift-title').value.trim(),
    shift_date: document.getElementById('shift-date').value,
    start_time: document.getElementById('shift-start').value,
    end_time: document.getElementById('shift-end').value,
    notes: document.getElementById('shift-notes').value.trim() || null,
    team_id: isManager
      ? document.getElementById('shift-team').value || null
      : null,
  };

  if (isEdit) {
    payload.status = document.getElementById('shift-status').value;
  } else {
    payload.created_by = currentUser.id;
  }

  const { error } = isEdit
    ? await supabase.from('shifts').update(payload).eq('id', shiftId)
    : await supabase.from('shifts').insert(payload);

  saveBtn.disabled = false;
  spinner.classList.add('d-none');

  if (error) {
    console.error('Shift save error:', error);
    showToast(error.message || 'Could not save shift.', 'danger');
    return;
  }

  shiftModalInstance.hide();
  showToast(isEdit ? 'Shift updated.' : 'Shift created.', 'success');
  await loadWeek();
}

// ── Modal: Delete confirm ────────────────────────────────────────────────────

function openDeleteModal(shiftId) {
  pendingDeleteId = shiftId;
  const shift = currentShifts.find((s) => s.id === shiftId);
  document.getElementById('delete-shift-name').textContent = shift?.title || 'this shift';
  deleteModalInstance.show();
}

async function handleDeleteConfirm() {
  const confirmBtn = document.getElementById('confirm-delete-btn');
  const spinner = document.getElementById('delete-spinner');
  confirmBtn.disabled = true;
  spinner.classList.remove('d-none');

  const { error } = await supabase.from('shifts').delete().eq('id', pendingDeleteId);

  confirmBtn.disabled = false;
  spinner.classList.add('d-none');

  if (error) {
    console.error('Shift delete error:', error);
    showToast(error.message || 'Could not delete shift.', 'danger');
    return;
  }

  deleteModalInstance.hide();
  pendingDeleteId = null;
  showToast('Shift deleted.', 'success');
  await loadWeek();
}

// ── Date / time helpers ──────────────────────────────────────────────────────

function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const diff = day === 0 ? -6 : 1 - day; // days back to Monday
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getWeekDays(weekStart) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });
}

function toDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatWeekLabel(weekStart) {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const opts = { weekday: 'short', month: 'short', day: 'numeric' };
  const start = weekStart.toLocaleDateString('en-US', opts);
  const end = weekEnd.toLocaleDateString('en-US', { ...opts, year: 'numeric' });
  return `${start} – ${end}`;
}

function formatTime(timeStr) {
  if (!timeStr) return '—';
  const [h, m] = timeStr.split(':');
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

// ── Start ────────────────────────────────────────────────────────────────────

init();
