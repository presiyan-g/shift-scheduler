import { requireAuth, getProfile } from '@shared/auth.js';
import { renderNavbar } from '@shared/navbar.js';
import { supabase } from '@shared/supabase.js';
import { showToast } from '@shared/toast.js';
import { getAllTeams, getManagedTeams, getTeamEmployees } from '@shared/teams.js';
import { createTransferRequest, getTransferTargets } from '@shared/transfers.js';
import { completeExpiredShifts } from '@shared/shifts.js';

// ── Module-level state ──────────────────────────────────────────────────────

let currentWeekStart = null; // Date object — Monday of the displayed week
let currentUser = null;
let currentUserFullName = 'You';
let userRole = 'employee';
let isManager = false;
let isAdmin = false;
let managedTeams = [];       // teams the current manager manages
let selectedTeamId = null;   // currently selected team filter (null = all)
let employees = [];          // [{ id, full_name }] — loaded for the selected team
let currentShifts = [];      // cached after each loadWeek()/loadMonth() for edit/delete lookup
let pendingDeleteId = null;  // shift UUID awaiting deletion confirm
let shiftModalInstance = null;
let deleteModalInstance = null;
let transferModalInstance = null;
let pendingTransferShiftIds = new Set(); // shift IDs with active transfer requests
let myShiftsOnly = false;  // toggle: true = current user's shifts only

// Monthly view state
let currentView = 'week';       // 'week' | 'month'
let currentMonthDate = null;    // Date object — 1st of the displayed month

// ── Entry point ─────────────────────────────────────────────────────────────

async function init() {
  currentUser = await requireAuth();

  renderNavbar({ activePage: 'schedule' });
  await completeExpiredShifts();

  // Fetch profile to determine role
  const profile = await getProfile(currentUser.id);
  if (!profile) {
    showToast('Could not load your profile.', 'danger');
    return;
  }

  userRole = profile.role;
  currentUserFullName = profile.full_name || 'You';
  isAdmin = userRole === 'admin';

  // Fetch managed teams early to determine manager status
  if (isAdmin) {
    managedTeams = (await getAllTeams()).map((t) => ({ team: t }));
  } else {
    managedTeams = await getManagedTeams(currentUser.id);
  }

  const isTeamManager = managedTeams.length > 0;
  isManager = isAdmin || isTeamManager;

  renderNavbar({ activePage: 'schedule', role: userRole, isTeamManager, userName: profile.full_name, avatarUrl: profile.avatar_url });

  // Subtitle text
  updateSubtitle();

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
  currentMonthDate = getMonthStart(new Date());

  // Bootstrap modal instances
  shiftModalInstance = new bootstrap.Modal(document.getElementById('shift-modal'));
  deleteModalInstance = new bootstrap.Modal(document.getElementById('delete-modal'));
  transferModalInstance = new bootstrap.Modal(document.getElementById('transfer-modal'));

  // Reset form validation state when modal closes
  document.getElementById('shift-modal').addEventListener('hidden.bs.modal', () => {
    const form = document.getElementById('shift-form');
    form.classList.remove('was-validated');
  });

  // Load pending transfer request IDs for the current employee
  if (!isManager) {
    await loadPendingTransferIds();
  }

  attachEventListeners();
  await loadWeek();
}

// ── Subtitle helper ──────────────────────────────────────────────────────────

function updateSubtitle() {
  const el = document.getElementById('schedule-subtitle');
  const period = currentView === 'week' ? 'week' : 'month';
  el.textContent = myShiftsOnly
    ? `Viewing your shifts for the ${period}`
    : `Viewing team shifts for the ${period}`;
}

// ── Event listeners ──────────────────────────────────────────────────────────

function attachEventListeners() {
  // View toggle
  document.getElementById('view-week-btn').addEventListener('click', () => {
    if (currentView !== 'week') switchView('week');
  });
  document.getElementById('view-month-btn').addEventListener('click', () => {
    if (currentView !== 'month') switchView('month');
  });

  // Week navigation
  document.getElementById('prev-week-btn').addEventListener('click', () => {
    currentWeekStart.setDate(currentWeekStart.getDate() - 7);
    loadWeek();
  });

  document.getElementById('next-week-btn').addEventListener('click', () => {
    currentWeekStart.setDate(currentWeekStart.getDate() + 7);
    loadWeek();
  });

  // Month navigation
  document.getElementById('prev-month-btn').addEventListener('click', () => {
    currentMonthDate.setMonth(currentMonthDate.getMonth() - 1);
    loadMonth();
  });
  document.getElementById('next-month-btn').addEventListener('click', () => {
    currentMonthDate.setMonth(currentMonthDate.getMonth() + 1);
    loadMonth();
  });

  document.getElementById('add-shift-btn').addEventListener('click', () => {
    openShiftModal(null);
  });

  // Delegated click on the week grid for edit/delete/transfer buttons
  document.getElementById('week-grid').addEventListener('click', (e) => {
    const editBtn = e.target.closest('.edit-shift-btn');
    const deleteBtn = e.target.closest('.delete-shift-btn');
    const transferBtn = e.target.closest('.request-transfer-btn');
    if (editBtn) openShiftModal(editBtn.dataset.shiftId);
    if (deleteBtn) openDeleteModal(deleteBtn.dataset.shiftId);
    if (transferBtn) openTransferModal(transferBtn.dataset.shiftId, transferBtn.dataset.teamId);
  });

  document.getElementById('shift-save-btn').addEventListener('click', () => {
    handleShiftSave();
  });

  document.getElementById('confirm-delete-btn').addEventListener('click', () => {
    handleDeleteConfirm();
  });

  document.getElementById('transfer-submit-btn').addEventListener('click', () => {
    handleTransferSubmit();
  });

  // Team filter change — reload shifts and employees for selected team
  document.getElementById('team-filter').addEventListener('change', async (e) => {
    selectedTeamId = e.target.value || null;
    if (selectedTeamId) {
      await fetchEmployeesForTeam(selectedTeamId);
    }
    if (currentView === 'week') {
      await loadWeek();
    } else {
      await loadMonth();
    }
  });

  // "My shifts only" toggle
  document.getElementById('my-shifts-toggle').addEventListener('change', async (e) => {
    myShiftsOnly = e.target.checked;
    updateSubtitle();
    if (currentView === 'week') {
      await loadWeek();
    } else {
      await loadMonth();
    }
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
    await updateLeaveConflictWarning();
  });

  // Leave conflict check: re-run when employee, date, or status changes in the shift modal
  document.getElementById('shift-employee').addEventListener('change', debouncedLeaveConflictWarning);
  document.getElementById('shift-date').addEventListener('change', debouncedLeaveConflictWarning);
  document.getElementById('shift-status').addEventListener('change', debouncedLeaveConflictWarning);

  // Employee calendar: click shift pill for transfer, or click day cell to navigate
  document.getElementById('month-calendar-grid').addEventListener('click', (e) => {
    const transferBtn = e.target.closest('.request-transfer-btn');
    if (transferBtn) {
      e.stopPropagation();
      openTransferModal(transferBtn.dataset.shiftId, transferBtn.dataset.teamId);
      return;
    }
    const shiftPill = e.target.closest('.month-cal-shift-clickable');
    if (shiftPill && shiftPill.dataset.shiftId) {
      e.stopPropagation();
      openTransferModal(shiftPill.dataset.shiftId, shiftPill.dataset.teamId);
      return;
    }
    const cell = e.target.closest('.month-cal-cell');
    if (cell && cell.dataset.date) {
      const clickedDate = new Date(cell.dataset.date + 'T00:00:00');
      currentWeekStart = getWeekStart(clickedDate);
      switchView('week');
    }
  });

  // Matrix: click shift pill — managers edit, employees transfer (own eligible shifts only)
  document.getElementById('month-matrix-container').addEventListener('click', (e) => {
    const pill = e.target.closest('.matrix-shift-pill');
    if (pill) {
      if (isManager) {
        openShiftModal(pill.dataset.shiftId);
      } else {
        const shift = currentShifts.find((s) => s.id === pill.dataset.shiftId);
        const today = toDateString(new Date());
        if (
          shift &&
          shift.employee_id === currentUser.id &&
          shift.status === 'scheduled' &&
          shift.shift_date >= today &&
          shift.team_id &&
          !pendingTransferShiftIds.has(shift.id)
        ) {
          openTransferModal(shift.id, shift.team_id);
        }
      }
      return;
    }

    if (isManager) {
      const cell = e.target.closest('.month-matrix-cell');
      if (cell && cell.dataset.date && cell.dataset.employee) {
        openShiftModalPrefilled(cell.dataset.date, cell.dataset.employee);
      }
    }
  });
}

// ── View toggle ─────────────────────────────────────────────────────────────

function switchView(view) {
  currentView = view;

  const weekBtn = document.getElementById('view-week-btn');
  const monthBtn = document.getElementById('view-month-btn');
  weekBtn.classList.toggle('btn-primary', view === 'week');
  weekBtn.classList.toggle('btn-outline-primary', view !== 'week');
  weekBtn.classList.toggle('active', view === 'week');
  monthBtn.classList.toggle('btn-primary', view === 'month');
  monthBtn.classList.toggle('btn-outline-primary', view !== 'month');
  monthBtn.classList.toggle('active', view === 'month');

  document.getElementById('week-nav').classList.toggle('d-none', view !== 'week');
  document.getElementById('month-nav').classList.toggle('d-none', view !== 'month');

  document.getElementById('week-grid').classList.toggle('d-none', view !== 'week');
  document.getElementById('month-calendar-grid').classList.add('d-none');
  document.getElementById('month-matrix-container').classList.toggle('d-none', view !== 'month');

  updateSubtitle();
  if (view === 'week') {
    loadWeek();
  } else {
    if (!currentMonthDate) {
      currentMonthDate = getMonthStart(currentWeekStart);
    }
    loadMonth();
  }
}

// ── Data fetching ────────────────────────────────────────────────────────────

async function loadMonth() {
  const loading = document.getElementById('schedule-loading');
  const calGrid = document.getElementById('month-calendar-grid');
  const matrixContainer = document.getElementById('month-matrix-container');
  const activeGrid = matrixContainer;
  const inactiveGrid = calGrid;

  loading.classList.remove('d-none');
  activeGrid.classList.add('d-none');
  inactiveGrid.classList.add('d-none');

  document.getElementById('month-label').textContent = formatMonthLabel(currentMonthDate);

  const monthStart = getMonthStart(currentMonthDate);
  const monthEnd = getMonthEnd(currentMonthDate);
  const startStr = toDateString(monthStart);
  const endStr = toDateString(monthEnd);
  const monthEmployees = await getMonthViewEmployees();

  let query = supabase
    .from('shifts')
    .select('*, employee:profiles!employee_id(id, full_name)')
    .gte('shift_date', startStr)
    .lte('shift_date', endStr)
    .order('start_time', { ascending: true });

  if (selectedTeamId) {
    query = query.eq('team_id', selectedTeamId);
  }

  // Honour "My shifts only" toggle for any role
  if (myShiftsOnly) {
    query = query.eq('employee_id', currentUser.id);
  }

  const { data: shifts, error } = await query;

  if (error) {
    console.error('Month shifts fetch error:', error);
    showToast('Could not load shifts.', 'danger');
    loading.classList.add('d-none');
    activeGrid.classList.remove('d-none');
    return;
  }

  currentShifts = shifts || [];

  // Co-fetch leave requests for the month period
  let leaveMonthQuery = supabase
    .from('leave_requests')
    .select('id, employee_id, start_date, end_date, leave_type, status, employee:profiles!employee_id(id, full_name)')
    .in('status', ['approved', 'pending'])
    .lte('start_date', endStr)
    .gte('end_date', startStr);
  if (myShiftsOnly) leaveMonthQuery = leaveMonthQuery.eq('employee_id', currentUser.id);
  const { data: monthLeaves } = await leaveMonthQuery;

  renderMonthMatrix(currentShifts, monthEmployees, monthLeaves || []);

  loading.classList.add('d-none');
  activeGrid.classList.remove('d-none');
}

async function getMonthViewEmployees() {
  if (myShiftsOnly) {
    return [{ id: currentUser.id, full_name: currentUserFullName }];
  }

  if (selectedTeamId) {
    return getTeamEmployees(selectedTeamId);
  }

  if (isManager) {
    const teamIds = managedTeams
      .map((mt) => mt?.team?.id)
      .filter(Boolean);

    if (teamIds.length === 0) {
      return [];
    }

    const teamEmployees = await Promise.all(teamIds.map((teamId) => getTeamEmployees(teamId)));
    return dedupeEmployees(teamEmployees.flat());
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name')
    .order('full_name');

  if (error) {
    console.error('Month employee roster fetch error:', error);
    return [];
  }

  return dedupeEmployees(data || []);
}

function dedupeEmployees(list) {
  const map = new Map();
  (list || []).forEach((employee) => {
    if (!employee?.id) return;
    if (!map.has(employee.id)) {
      map.set(employee.id, {
        id: employee.id,
        full_name: employee.full_name || 'Unknown',
      });
    }
  });
  return Array.from(map.values());
}

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
    .select('*, employee:profiles!employee_id(id, full_name)')
    .gte('shift_date', weekStartStr)
    .lte('shift_date', weekEndStr)
    .order('start_time', { ascending: true });

  // Filter by selected team (managers/admins)
  if (selectedTeamId) {
    query = query.eq('team_id', selectedTeamId);
  }

  // Honour "My shifts only" toggle for any role
  if (myShiftsOnly) {
    query = query.eq('employee_id', currentUser.id);
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

  // Co-fetch leave requests for the week period
  let leaveWeekQuery = supabase
    .from('leave_requests')
    .select('id, employee_id, start_date, end_date, leave_type, status, employee:profiles!employee_id(id, full_name)')
    .in('status', ['approved', 'pending'])
    .lte('start_date', weekEndStr)
    .gte('end_date', weekStartStr);
  if (myShiftsOnly) leaveWeekQuery = leaveWeekQuery.eq('employee_id', currentUser.id);
  const { data: weekLeaves } = await leaveWeekQuery;

  renderWeekGrid(currentShifts, weekLeaves || []);

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

function renderWeekGrid(shifts, leaves = []) {
  const grid = document.getElementById('week-grid');
  grid.innerHTML = '';

  const today = toDateString(new Date());
  const days = getWeekDays(currentWeekStart);

  // Build leaveMap[dateStr] = [leave, ...] for days in this week
  const leaveMap = {};
  days.forEach((d) => { leaveMap[toDateString(d)] = []; });
  leaves.forEach((lr) => {
    let cur = new Date(lr.start_date + 'T00:00:00');
    const end = new Date(lr.end_date + 'T00:00:00');
    while (cur <= end) {
      const ds = toDateString(cur);
      if (leaveMap[ds]) leaveMap[ds].push(lr);
      cur.setDate(cur.getDate() + 1);
    }
  });

  days.forEach((dayDate) => {
    const dateStr = toDateString(dayDate);
    const isToday = dateStr === today;
    const dayShifts = shifts.filter((s) => s.shift_date === dateStr);

    const col = document.createElement('div');
    col.className = 'col-12 col-sm-6 col-md-4 col-lg schedule-day-col';
    col.innerHTML = buildDayColumnHtml(dayDate, dateStr, isToday, dayShifts, leaveMap[dateStr] || []);
    grid.appendChild(col);
  });
}

function buildDayColumnHtml(dayDate, dateStr, isToday, dayShifts, dayLeaves = []) {
  const weekday = dayDate.toLocaleDateString('en-US', { weekday: 'short' });
  const monthDay = dayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  const todayCardClass = isToday ? ' today-card' : '';
  const headerClass = isToday ? ' today-header' : ' bg-white';
  const labelClass = isToday ? ' today-day-label fw-bold' : ' text-muted';
  const todayBadge = isToday
    ? `<span class="badge bg-primary ms-auto">Today</span>`
    : '';

  const typeLabels = { sick: 'Sick', vacation: 'Vacation', personal: 'Personal', other: 'Leave' };
  const leaveBannersHtml = dayLeaves.map((lr) => {
    const isOwn = lr.employee_id === currentUser.id;
    const name = isOwn ? 'You' : escapeHtml(lr.employee?.full_name || '—');
    const typeLabel = typeLabels[lr.leave_type] || 'Leave';
    const isPending = lr.status === 'pending';
    const cls = isPending ? 'leave-banner-pending' : 'leave-banner-approved';
    return `<div class="leave-day-banner ${cls}">
      <i class="bi bi-airplane me-1"></i>${name} — ${typeLabel}${isPending ? ' <em class="text-muted">(pending)</em>' : ''}
    </div>`;
  }).join('');

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
        ${leaveBannersHtml}
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

  // Show employee name when viewing someone else's shift
  const isOwnShift = shift.employee_id === currentUser.id;
  const employeeRow = !isOwnShift
    ? `<div class="shift-employee-name mt-1">
         <i class="bi bi-person-fill me-1"></i>${escapeHtml(shift.employee?.full_name || '—')}
       </div>`
    : '';

  let actionBtns = '';
  if (isManager) {
    // Managers/admins: always show edit and delete
    actionBtns = `<div class="d-flex gap-1 mt-2 justify-content-end">
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
       </div>`;
  } else if (isOwnShift && shift.status === 'scheduled' && shift.shift_date >= toDateString(new Date()) && shift.team_id) {
    // Employee's own eligible shift: show transfer button
    if (pendingTransferShiftIds.has(shift.id)) {
      actionBtns = `<div class="d-flex gap-1 mt-2 justify-content-end">
        <span class="badge bg-warning-subtle text-warning rounded-pill" style="font-size:0.68rem;">
          <i class="bi bi-hourglass-split me-1"></i>Transfer Pending
        </span>
      </div>`;
    } else {
      actionBtns = `<div class="d-flex gap-1 mt-2 justify-content-end">
        <button
          class="btn btn-sm btn-outline-primary py-0 px-2 request-transfer-btn"
          data-shift-id="${shift.id}"
          data-team-id="${shift.team_id}"
          title="Request shift transfer"
          type="button"
          style="font-size:0.72rem;"
        ><i class="bi bi-arrow-right-circle me-1"></i>Transfer</button>
      </div>`;
    }
  }
  // else: teammate's shift → no action buttons (read-only)

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

// ── Monthly renderer ─────────────────────────────────────────────────────────

function renderMonthMatrix(shifts, rosterEmployees = [], leaves = []) {
  const container = document.getElementById('month-matrix-container');
  container.innerHTML = '';

  const today = toDateString(new Date());
  const daysInMonth = getDaysInMonth(currentMonthDate);
  const monthNum = currentMonthDate.getMonth();
  const year = currentMonthDate.getFullYear();

  // Group shifts by employee_id -> date -> [shifts]
  const shiftMap = {};
  const employeeMap = {};

  (rosterEmployees || []).forEach((employee) => {
    if (!employee?.id) return;
    employeeMap[employee.id] = {
      id: employee.id,
      full_name: employee.full_name || 'Unknown',
    };
  });

  shifts.forEach((s) => {
    const empId = s.employee_id;
    if (!shiftMap[empId]) shiftMap[empId] = {};
    if (!shiftMap[empId][s.shift_date]) shiftMap[empId][s.shift_date] = [];
    shiftMap[empId][s.shift_date].push(s);

    if (!employeeMap[empId]) {
      employeeMap[empId] = {
        id: empId,
        full_name: s.employee?.full_name || 'Unknown',
      };
    }
  });

  // Build leaveMap[empId][dateStr] = [leave, ...]
  const leaveMap = {};
  leaves.forEach((lr) => {
    if (!leaveMap[lr.employee_id]) leaveMap[lr.employee_id] = {};
    let cur = new Date(lr.start_date + 'T00:00:00');
    const endD = new Date(lr.end_date + 'T00:00:00');
    while (cur <= endD) {
      const ds = toDateString(cur);
      if (!leaveMap[lr.employee_id][ds]) leaveMap[lr.employee_id][ds] = [];
      leaveMap[lr.employee_id][ds].push(lr);
      cur.setDate(cur.getDate() + 1);
    }
  });

  const sortedEmployees = Object.values(employeeMap).sort((a, b) =>
    a.full_name.localeCompare(b.full_name)
  );

  let html = '<div class="month-matrix-wrapper">';
  html += '<table class="month-matrix-table">';

  // Header row
  html += '<thead><tr><th class="month-matrix-employee-header">Employee</th>';
  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj = new Date(year, monthNum, d);
    const dateStr = toDateString(dateObj);
    const isToday = dateStr === today;
    const dayAbbr = dateObj.toLocaleDateString('en-US', { weekday: 'narrow' });
    const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;

    html += `<th class="month-matrix-day-header${isToday ? ' matrix-today-header' : ''}${isWeekend ? ' matrix-weekend' : ''}">
      <div class="matrix-day-abbr">${dayAbbr}</div>
      <div class="matrix-day-num">${d}</div>
    </th>`;
  }
  html += '</tr></thead>';

  // Body: one row per employee
  html += '<tbody>';
  if (sortedEmployees.length === 0) {
    html += `<tr><td class="month-matrix-employee-name text-muted" colspan="${daysInMonth + 1}">No employees found for this view.</td></tr>`;
  }

  sortedEmployees.forEach((emp) => {
    html += '<tr>';
    html += `<td class="month-matrix-employee-name">${escapeHtml(emp.full_name)}</td>`;

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = toDateString(new Date(year, monthNum, d));
      const isToday = dateStr === today;
      const dateObj = new Date(year, monthNum, d);
      const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;
      const cellShifts = shiftMap[emp.id]?.[dateStr] || [];

      let cellHtml = '';
      cellShifts.forEach((s) => {
        const statusColor = {
          scheduled: 'primary',
          completed: 'success',
          cancelled: 'danger',
        }[s.status] || 'secondary';

        cellHtml += `<div class="matrix-shift-pill badge bg-${statusColor}-subtle text-${statusColor}"
          data-shift-id="${s.id}"
          title="${escapeHtml(s.title)}: ${formatTime(s.start_time)}\u2013${formatTime(s.end_time)}">
          ${formatTimeShort(s.start_time)}-${formatTimeShort(s.end_time)}
        </div>`;
      });

      // Leave pills
      const cellLeaves = leaveMap[emp.id]?.[dateStr] || [];
      const leaveTypeLabels = { sick: 'Sick', vacation: 'Vacation', personal: 'Personal', other: 'Leave' };
      cellLeaves.forEach((lr) => {
        const isPending = lr.status === 'pending';
        const typeLabel = leaveTypeLabels[lr.leave_type] || 'Leave';
        const pendingCls = isPending ? ' matrix-leave-pending' : '';
        cellHtml += `<div class="matrix-leave-pill${pendingCls}" title="${typeLabel}${isPending ? ' (pending)' : ''}">
          <i class="bi bi-airplane"></i>
        </div>`;
      });

      const hasApprovedLeave = cellLeaves.some((lr) => lr.status === 'approved');
      const todayClass = isToday ? ' matrix-today-cell' : '';
      const weekendClass = isWeekend ? ' matrix-weekend' : '';
      const leaveCellClass = hasApprovedLeave ? ' matrix-leave-cell' : '';
      html += `<td class="month-matrix-cell${todayClass}${weekendClass}${leaveCellClass}" data-date="${dateStr}" data-employee="${emp.id}">${cellHtml}</td>`;
    }

    html += '</tr>';
  });
  html += '</tbody></table></div>';

  container.innerHTML = html;
}

// ── Debounce helper ──────────────────────────────────────────────────────────

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

const debouncedLeaveConflictWarning = debounce(updateLeaveConflictWarning, 350);

// ── Leave conflict check (shift modal) ──────────────────────────────────────

async function updateLeaveConflictWarning() {
  const warningEl = document.getElementById('leave-conflict-warning');
  const saveBtn   = document.getElementById('shift-save-btn');
  const employeeId = isManager
    ? document.getElementById('shift-employee').value
    : currentUser.id;
  const shiftDate = document.getElementById('shift-date').value;

  // In edit mode, skip check when setting status to non-scheduled
  const statusField = document.getElementById('status-field');
  if (!statusField.classList.contains('d-none')) {
    const statusVal = document.getElementById('shift-status').value;
    if (statusVal && statusVal !== 'scheduled') {
      warningEl.classList.add('d-none');
      saveBtn.disabled = false;
      return;
    }
  }

  if (!employeeId || !shiftDate) {
    warningEl.classList.add('d-none');
    saveBtn.disabled = false;
    return;
  }

  const { data } = await supabase
    .from('leave_requests')
    .select('id, start_date, end_date, leave_type')
    .eq('employee_id', employeeId)
    .eq('status', 'approved')
    .lte('start_date', shiftDate)
    .gte('end_date', shiftDate)
    .limit(1);

  if (data?.length > 0) {
    const lr = data[0];
    const typeLabel = { sick: 'Sick Leave', vacation: 'Vacation', personal: 'Personal', other: 'Other' }[lr.leave_type] || lr.leave_type;
    warningEl.querySelector('.leave-conflict-text').textContent =
      `This employee has approved ${typeLabel} from ${lr.start_date} to ${lr.end_date}. Shifts cannot be created during this period.`;
    warningEl.classList.remove('d-none');
    saveBtn.disabled = true;
  } else {
    warningEl.classList.add('d-none');
    saveBtn.disabled = false;
  }
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
    // Pre-fill date with today's date
    document.getElementById('shift-date').value = toDateString(new Date());
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

  // Clear any stale leave conflict warning
  document.getElementById('leave-conflict-warning').classList.add('d-none');
  document.getElementById('shift-save-btn').disabled = false;

  shiftModalInstance.show();
}

function openShiftModalPrefilled(dateStr, employeeId) {
  openShiftModal(null);
  document.getElementById('shift-date').value = dateStr;
  if (employeeId) {
    document.getElementById('shift-employee').value = employeeId;
  }
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
    if (error.message?.includes('LEAVE_CONFLICT')) {
      const warningEl = document.getElementById('leave-conflict-warning');
      warningEl.querySelector('.leave-conflict-text').textContent =
        'Cannot create shift: this employee has an approved leave during the selected date.';
      warningEl.classList.remove('d-none');
      saveBtn.disabled = true;
    } else {
      showToast(error.message || 'Could not save shift.', 'danger');
    }
    return;
  }

  shiftModalInstance.hide();
  showToast(isEdit ? 'Shift updated.' : 'Shift created.', 'success');
  if (currentView === 'week') {
    await loadWeek();
  } else {
    await loadMonth();
  }
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
  if (currentView === 'week') {
    await loadWeek();
  } else {
    await loadMonth();
  }
}

// ── Transfer request ─────────────────────────────────────────────────────────

async function loadPendingTransferIds() {
  const { data } = await supabase
    .from('shift_transfer_requests')
    .select('shift_id')
    .eq('requester_id', currentUser.id)
    .in('status', ['pending_target', 'pending_manager']);

  pendingTransferShiftIds = new Set((data || []).map((r) => r.shift_id));
}

async function openTransferModal(shiftId, teamId) {
  const shift = currentShifts.find((s) => s.id === shiftId);
  if (!shift || !teamId) return;

  document.getElementById('transfer-shift-summary').innerHTML = `
    <strong>${escapeHtml(shift.title || 'Shift')}</strong><br>
    <small class="text-muted">
      <i class="bi bi-calendar3 me-1"></i>${shift.shift_date} &middot;
      <i class="bi bi-clock me-1"></i>${formatTime(shift.start_time)} – ${formatTime(shift.end_time)}
    </small>
  `;

  document.getElementById('transfer-shift-id').value = shiftId;
  document.getElementById('transfer-team-id').value = teamId;

  const form = document.getElementById('transfer-form');
  form.reset();
  form.classList.remove('was-validated');

  const targetSelect = document.getElementById('transfer-target');
  targetSelect.innerHTML = '<option value="">Loading teammates...</option>';
  targetSelect.disabled = true;

  transferModalInstance.show();

  const targets = await getTransferTargets(teamId, currentUser.id);
  targetSelect.innerHTML = '<option value="">— Select teammate —</option>';
  targets.forEach((t) => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.full_name;
    targetSelect.appendChild(opt);
  });
  targetSelect.disabled = false;
}

async function handleTransferSubmit() {
  const form = document.getElementById('transfer-form');
  form.classList.add('was-validated');
  if (!form.checkValidity()) return;

  const btn = document.getElementById('transfer-submit-btn');
  const spinner = document.getElementById('transfer-submit-spinner');
  btn.disabled = true;
  spinner.classList.remove('d-none');

  const shiftId = document.getElementById('transfer-shift-id').value;
  const teamId = document.getElementById('transfer-team-id').value;
  const targetId = document.getElementById('transfer-target').value;
  const note = document.getElementById('transfer-note').value.trim();

  const shift = currentShifts.find((s) => s.id === shiftId);

  const { error } = await createTransferRequest({
    shiftId,
    teamId,
    requesterId: currentUser.id,
    targetId,
    requesterNote: note,
    expiresAt: `${shift?.shift_date}T${shift?.start_time}`,
  });

  btn.disabled = false;
  spinner.classList.add('d-none');

  if (error) {
    showToast(error.message || 'Could not send transfer request.', 'danger');
    return;
  }

  transferModalInstance.hide();
  showToast('Transfer request sent. Waiting for your teammate to accept.', 'success');

  pendingTransferShiftIds.add(shiftId);
  if (currentView === 'week') await loadWeek();
  else await loadMonth();
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

function getMonthStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function getMonthEnd(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function getDaysInMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function formatMonthLabel(date) {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function formatTimeShort(timeStr) {
  if (!timeStr) return '';
  const [h] = timeStr.split(':');
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? 'p' : 'a';
  const h12 = hour % 12 || 12;
  return `${h12}${ampm}`;
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
