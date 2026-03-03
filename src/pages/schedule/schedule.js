import { requireAuth, getProfile } from '@shared/auth/auth.js';
import { renderNavbar } from '@shared/components/navbar/navbar.js';
import { supabase } from '@shared/supabase.js';
import { showToast } from '@shared/components/toast/toast.js';
import { getAllTeams, getManagedTeams, getTeamEmployees } from '@shared/services/teams.js';
import {
  completeExpiredShifts, getShiftsForPeriod, getApprovedLeavesForPeriod,
} from '@shared/services/shifts.js';
import {
  toDateString,
  getWeekStart, formatWeekLabel,
  getMonthStart, getMonthEnd, formatMonthLabel,
} from '@shared/utils/formatting.js';
import { renderWeekGrid } from './schedule-week-view.js';
import { renderMonthMatrix, renderMyMonthCalendar } from './schedule-month-view.js';
import { initDeleteModal, openDeleteModal } from './schedule-delete-modal.js';
import { initTransferModal, openTransferModal, loadPendingTransferIds } from './schedule-transfer-modal.js';
import { initShiftModal, openShiftModal, openShiftModalPrefilled } from './schedule-shift-modal.js';

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
  isAdmin = userRole === 'admin' || userRole === 'super_admin';

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

  const reloadView = async () => {
    if (currentView === 'week') await loadWeek();
    else await loadMonth();
  };

  initDeleteModal({
    getCurrentShifts: () => currentShifts,
    onSuccess: reloadView,
  });

  initTransferModal({
    currentUser,
    getCurrentShifts: () => currentShifts,
    getPendingIds: () => pendingTransferShiftIds,
    addPendingId: (id) => pendingTransferShiftIds.add(id),
    onSuccess: reloadView,
  });

  initShiftModal({
    currentUser,
    isManager,
    getEmployees: () => employees,
    getCurrentShifts: () => currentShifts,
    onSaveSuccess: reloadView,
    fetchEmployeesForTeam,
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

  // confirm-delete-btn listener is wired inside initDeleteModal()
  // transfer-submit-btn listener is wired inside initTransferModal()
  // shift-save-btn + all shift-modal listeners wired inside initShiftModal()

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
      if (isManager) {
        openShiftModal(shiftPill.dataset.shiftId);
      } else {
        openTransferModal(shiftPill.dataset.shiftId, shiftPill.dataset.teamId);
      }
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
  document.getElementById('month-calendar-grid').classList.toggle('d-none', view !== 'month' || !myShiftsOnly);
  document.getElementById('month-matrix-container').classList.toggle('d-none', view !== 'month' || myShiftsOnly);

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
  const showCalendar = myShiftsOnly;
  const activeGrid = showCalendar ? calGrid : matrixContainer;
  const inactiveGrid = showCalendar ? matrixContainer : calGrid;

  loading.classList.remove('d-none');
  activeGrid.classList.add('d-none');
  inactiveGrid.classList.add('d-none');

  document.getElementById('month-label').textContent = formatMonthLabel(currentMonthDate);

  const monthStart = getMonthStart(currentMonthDate);
  const monthEnd = getMonthEnd(currentMonthDate);
  const startStr = toDateString(monthStart);
  const endStr = toDateString(monthEnd);
  const monthEmployees = await getMonthViewEmployees();

  const { data: shifts, error } = await getShiftsForPeriod({
    startDate: startStr,
    endDate: endStr,
    teamId: selectedTeamId,
    employeeId: myShiftsOnly ? currentUser.id : null,
  });

  if (error) {
    console.error('Month shifts fetch error:', error);
    showToast('Could not load shifts.', 'danger');
    loading.classList.add('d-none');
    activeGrid.classList.remove('d-none');
    return;
  }

  currentShifts = shifts || [];

  const monthLeaves = await getApprovedLeavesForPeriod({
    startDate: startStr,
    endDate: endStr,
    employeeId: myShiftsOnly ? currentUser.id : null,
  });

  const monthCtx = {
    currentUserId: currentUser.id,
    isManager,
    pendingTransferShiftIds,
    monthDate: currentMonthDate,
  };

  if (showCalendar) {
    renderMyMonthCalendar(monthCtx, currentShifts, monthLeaves || []);
  } else {
    renderMonthMatrix(monthCtx, currentShifts, monthEmployees, monthLeaves || []);
  }

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

  const { data: shifts, error } = await getShiftsForPeriod({
    startDate: weekStartStr,
    endDate: weekEndStr,
    teamId: selectedTeamId,
    employeeId: myShiftsOnly ? currentUser.id : null,
  });

  if (error) {
    console.error('Shifts fetch error:', error);
    showToast('Could not load shifts.', 'danger');
    loading.classList.add('d-none');
    grid.classList.remove('d-none');
    return;
  }

  currentShifts = shifts || [];

  const weekLeaves = await getApprovedLeavesForPeriod({
    startDate: weekStartStr,
    endDate: weekEndStr,
    employeeId: myShiftsOnly ? currentUser.id : null,
  });

  renderWeekGrid({
    currentUserId: currentUser.id,
    isManager,
    pendingTransferShiftIds,
    weekStart: currentWeekStart,
  }, currentShifts, weekLeaves || []);

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

// ── Start ────────────────────────────────────────────────────────────────────

init();
