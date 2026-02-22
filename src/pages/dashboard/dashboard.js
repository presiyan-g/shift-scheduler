import { requireAuth, getProfile } from '@shared/auth.js';
import { renderNavbar } from '@shared/navbar.js';
import { supabase } from '@shared/supabase.js';
import { showToast } from '@shared/toast.js';
import { getManagedTeams } from '@shared/teams.js';
import { expireStaleRequests, createTransferRequest, getTransferTargets } from '@shared/transfers.js';
import { completeExpiredShifts } from '@shared/shifts.js';

let currentUser = null;
let transferModalInstance = null;
let pendingTransferShiftIds = new Set();
let dashboardShifts = []; // cached upcoming shifts for transfer lookup

async function init() {
  const user = await requireAuth();
  currentUser = user;

  renderNavbar({ activePage: 'dashboard' });
  await completeExpiredShifts();

  // 1. Fetch profile to get full_name and role
  const profile = await getProfile(user.id);
  if (!profile) {
    showToast('Could not load profile.', 'danger');
    return;
  }

  // Fetch managed teams early to determine manager status
  const managedTeams = await getManagedTeams(user.id);
  const isTeamManager = managedTeams.length > 0;
  const isManager = profile.role === 'admin' || isTeamManager;

  renderNavbar({ activePage: 'dashboard', role: profile.role, isTeamManager, userName: profile.full_name, avatarUrl: profile.avatar_url });

  // 2. Set welcome message
  const firstName = profile.full_name?.split(' ')[0] || 'there';
  document.getElementById('welcome-heading').textContent = `Welcome back, ${firstName}!`;

  if (isManager) {
    document.getElementById('welcome-sub').textContent = "Here's your teams' schedule overview.";
  }

  // 3. Date helpers
  const today = toDateString(new Date());
  const nextWeek = getDateOffset(7);
  const lastWeek = getDateOffset(-7);
  const startOfWeek = getStartOfWeek();
  const endOfWeek = getEndOfWeek();
  const startOfMonth = getStartOfMonth();

  // 4. Fetch upcoming shifts (next 7 days, scheduled)
  let upcomingQuery = supabase
    .from('shifts')
    .select('*, employee:profiles!employee_id(full_name)')
    .gte('shift_date', today)
    .lte('shift_date', nextWeek)
    .eq('status', 'scheduled')
    .order('shift_date', { ascending: true })
    .order('start_time', { ascending: true });

  if (!isManager) {
    upcomingQuery = upcomingQuery.eq('employee_id', user.id);
  }

  const { data: upcomingShifts, error: upcomingError } = await upcomingQuery;

  if (upcomingError) {
    console.error('Shifts fetch error:', upcomingError);
    showToast('Could not load shifts.', 'danger');
    return;
  }

  // 5. Fetch recent/past shifts (last 7 days, max 5)
  let recentQuery = supabase
    .from('shifts')
    .select('*, employee:profiles!employee_id(full_name)')
    .lt('shift_date', today)
    .gte('shift_date', lastWeek)
    .order('shift_date', { ascending: false })
    .order('start_time', { ascending: false })
    .limit(5);

  if (!isManager) {
    recentQuery = recentQuery.eq('employee_id', user.id);
  }

  const { data: recentShifts, error: recentError } = await recentQuery;

  if (recentError) {
    console.error('Recent shifts fetch error:', recentError);
  }

  // 6. Compute stats

  // Upcoming count
  document.getElementById('stat-upcoming').textContent = upcomingShifts?.length ?? 0;

  // Hours this week
  let weekQuery = supabase
    .from('shifts')
    .select('start_time, end_time')
    .gte('shift_date', startOfWeek)
    .lte('shift_date', endOfWeek)
    .in('status', ['scheduled', 'completed']);

  if (!isManager) {
    weekQuery = weekQuery.eq('employee_id', user.id);
  }

  const { data: weekShifts } = await weekQuery;
  const totalHours = calcTotalHours(weekShifts || []);
  document.getElementById('stat-hours-week').textContent = `${totalHours.toFixed(1)} hrs`;

  // Hours this month
  const endOfMonth = getEndOfMonth();

  let monthHoursQuery = supabase
    .from('shifts')
    .select('start_time, end_time')
    .gte('shift_date', startOfMonth)
    .lte('shift_date', endOfMonth)
    .in('status', ['scheduled', 'completed']);

  if (!isManager) {
    monthHoursQuery = monthHoursQuery.eq('employee_id', user.id);
  }

  const { data: monthShifts } = await monthHoursQuery;
  const totalMonthHours = calcTotalHours(monthShifts || []);
  document.getElementById('stat-hours-month').textContent = totalMonthHours.toFixed(1);

  // Completed this month
  let monthQuery = supabase
    .from('shifts')
    .select('id', { count: 'exact', head: true })
    .gte('shift_date', startOfMonth)
    .eq('status', 'completed');

  if (!isManager) {
    monthQuery = monthQuery.eq('employee_id', user.id);
  }

  const { count: completedCount } = await monthQuery;
  document.getElementById('stat-completed').textContent = completedCount ?? 0;

  // Today's shifts
  let todayQuery = supabase
    .from('shifts')
    .select('id', { count: 'exact', head: true })
    .eq('shift_date', today)
    .eq('status', 'scheduled');

  if (!isManager) {
    todayQuery = todayQuery.eq('employee_id', user.id);
  }

  const { count: todayCount } = await todayQuery;
  document.getElementById('stat-today').textContent = todayCount ?? 0;

  // 7. Load pending transfer IDs for employees and init transfer modal
  dashboardShifts = upcomingShifts || [];
  if (!isManager) {
    await loadPendingTransferIds();
    transferModalInstance = new bootstrap.Modal(document.getElementById('transfer-modal'));

    document.getElementById('upcoming-shifts-list').addEventListener('click', (e) => {
      const btn = e.target.closest('.request-transfer-btn');
      if (btn) openTransferModal(btn.dataset.shiftId, btn.dataset.teamId);
    });

    document.getElementById('transfer-submit-btn').addEventListener('click', handleTransferSubmit);
  }

  // 8. Render shift lists
  renderUpcomingShifts(upcomingShifts || [], isManager);
  renderRecentShifts(recentShifts || [], isManager);

  // 9. Manager banner
  if (isManager) {
    document.getElementById('manager-banner').classList.remove('d-none');
    const teamLabel = profile.role === 'admin'
      ? 'all teams'
      : `${managedTeams.length} team(s)`;
    document.getElementById('manager-team-summary').textContent =
      `${todayCount ?? 0} shift(s) scheduled for today across ${teamLabel}.`;
  }

  // 10. Transfer requests widget
  await expireStaleRequests();
  await loadTransferWidget(user.id, isManager, managedTeams);

  // 11. Leave requests widget
  await loadLeaveWidget(user.id, isManager);
}

// ── Transfer widget ──

async function loadTransferWidget(userId, isManager, managedTeams) {
  const widget = document.getElementById('transfer-widget');
  if (!widget) return;

  const heading = document.getElementById('transfer-widget-heading');
  const body = document.getElementById('transfer-widget-body');
  let count = 0;

  if (isManager) {
    const teamIds = managedTeams.map((mt) => mt.team.id);
    if (teamIds.length > 0) {
      const { count: managerCount } = await supabase
        .from('shift_transfer_requests')
        .select('id', { count: 'exact', head: true })
        .in('team_id', teamIds)
        .eq('status', 'pending_manager');
      count = managerCount ?? 0;
    }

    if (count > 0) {
      widget.className = 'alert alert-warning d-flex align-items-center justify-content-between mb-4';
      heading.textContent = 'Transfers Awaiting Approval';
      body.textContent = `${count} transfer request${count > 1 ? 's' : ''} need${count === 1 ? 's' : ''} your approval.`;
    }
  } else {
    const { count: incomingCount } = await supabase
      .from('shift_transfer_requests')
      .select('id', { count: 'exact', head: true })
      .eq('target_id', userId)
      .eq('status', 'pending_target');
    count = incomingCount ?? 0;

    if (count > 0) {
      widget.className = 'alert alert-info d-flex align-items-center justify-content-between mb-4';
      heading.textContent = 'Incoming Transfer Requests';
      body.textContent = `${count} teammate${count > 1 ? 's' : ''} ${count > 1 ? 'have' : 'has'} asked you to take their shift.`;
    }
  }

  if (count > 0) {
    widget.classList.remove('d-none');
  }
}

// ── Leave widget ──

async function loadLeaveWidget(userId, isManager) {
  const widget = document.getElementById('leave-widget');
  if (!widget) return;

  const heading = document.getElementById('leave-widget-heading');
  const body    = document.getElementById('leave-widget-body');
  let count = 0;

  if (isManager) {
    // Count pending leave requests visible to this manager (RLS auto-scopes to team)
    const { count: pendingCount } = await supabase
      .from('leave_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .neq('employee_id', userId);

    count = pendingCount ?? 0;

    if (count > 0) {
      widget.className = 'alert alert-warning d-flex align-items-center justify-content-between mb-4';
      heading.textContent = 'Leave Requests Awaiting Review';
      body.textContent = `${count} leave request${count > 1 ? 's' : ''} need${count === 1 ? 's' : ''} your review.`;
    }
  } else {
    // Employee: count own pending leave requests
    const { count: pendingCount } = await supabase
      .from('leave_requests')
      .select('id', { count: 'exact', head: true })
      .eq('employee_id', userId)
      .eq('status', 'pending');

    count = pendingCount ?? 0;

    if (count > 0) {
      widget.className = 'alert alert-info d-flex align-items-center justify-content-between mb-4';
      heading.textContent = 'Leave Requests';
      body.textContent = `You have ${count} pending leave request${count > 1 ? 's' : ''}.`;
    }
  }

  if (count > 0) {
    widget.classList.remove('d-none');
  }
}

// ── Date helpers ──

function toDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getDateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toDateString(d);
}

function getStartOfWeek() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  d.setDate(diff);
  return toDateString(d);
}

function getEndOfWeek() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? 0 : 7); // Sunday
  d.setDate(diff);
  return toDateString(d);
}

function getStartOfMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function getEndOfMonth() {
  const d = new Date();
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return toDateString(lastDay);
}

// ── Formatting helpers ──

function calcTotalHours(shifts) {
  return shifts.reduce((sum, s) => {
    const [sh, sm] = s.start_time.split(':').map(Number);
    const [eh, em] = s.end_time.split(':').map(Number);
    let hours = (eh * 60 + em - sh * 60 - sm) / 60;
    if (hours < 0) hours += 24; // overnight shift
    return sum + hours;
  }, 0);
}

function formatTime(timeStr) {
  const [h, m] = timeStr.split(':');
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Transfer helpers ──

async function loadPendingTransferIds() {
  const { data } = await supabase
    .from('shift_transfer_requests')
    .select('shift_id')
    .eq('requester_id', currentUser.id)
    .in('status', ['pending_target', 'pending_manager']);

  pendingTransferShiftIds = new Set((data || []).map((r) => r.shift_id));
}

async function openTransferModal(shiftId, teamId) {
  const shift = dashboardShifts.find((s) => s.id === shiftId);
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

  const shift = dashboardShifts.find((s) => s.id === shiftId);

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

  // Update local state and re-render
  pendingTransferShiftIds.add(shiftId);
  renderUpcomingShifts(dashboardShifts, false);
}

// ── Render functions ──

function renderUpcomingShifts(shifts, isManager) {
  const container = document.getElementById('upcoming-shifts-list');
  const emptyEl = document.getElementById('upcoming-empty');
  const countBadge = document.getElementById('upcoming-count');
  const today = toDateString(new Date());

  countBadge.textContent = shifts.length;

  if (shifts.length === 0) {
    return;
  }

  emptyEl.classList.add('d-none');

  container.innerHTML = shifts.map(shift => {
    // Show transfer action for employee's own scheduled future shifts with a team
    let transferAction = '';
    if (!isManager && shift.employee_id === currentUser.id && shift.status === 'scheduled' && shift.shift_date >= today && shift.team_id) {
      if (pendingTransferShiftIds.has(shift.id)) {
        transferAction = `<span class="badge bg-warning-subtle text-warning rounded-pill ms-2" style="font-size:0.68rem;"><i class="bi bi-hourglass-split me-1"></i>Transfer Pending</span>`;
      } else {
        transferAction = `<button class="btn btn-sm btn-outline-primary py-0 px-2 ms-2 request-transfer-btn" data-shift-id="${shift.id}" data-team-id="${shift.team_id}" title="Request shift transfer" type="button" style="font-size:0.72rem;"><i class="bi bi-arrow-right-circle me-1"></i>Transfer</button>`;
      }
    }

    return `
      <div class="d-flex align-items-center px-3 py-3 border-bottom shift-row">
        <div class="me-3 text-center" style="min-width: 50px;">
          <div class="fw-bold text-primary" style="font-size: 0.85rem;">
            ${formatDate(shift.shift_date).split(', ')[0] || ''}
          </div>
          <small class="text-muted">${formatDate(shift.shift_date).split(', ')[1] || formatDate(shift.shift_date)}</small>
        </div>
        <div class="flex-grow-1">
          <div class="fw-semibold">${escapeHtml(shift.title || 'Shift')}</div>
          <small class="text-muted">
            <i class="bi bi-clock me-1"></i>${formatTime(shift.start_time)} – ${formatTime(shift.end_time)}
            ${isManager ? `<span class="ms-2"><i class="bi bi-person me-1"></i>${escapeHtml(shift.employee?.full_name || 'Unknown')}</span>` : ''}
          </small>
        </div>
        <div class="d-flex align-items-center">
          <span class="badge bg-primary-subtle text-primary rounded-pill">${shift.status}</span>
          ${transferAction}
        </div>
      </div>
    `;
  }).join('');
}

function renderRecentShifts(shifts, isManager) {
  const container = document.getElementById('recent-shifts-list');
  const emptyEl = document.getElementById('recent-empty');

  if (shifts.length === 0) {
    return;
  }

  emptyEl.classList.add('d-none');

  container.innerHTML = shifts.map(shift => {
    const statusColor = shift.status === 'completed' ? 'success'
      : shift.status === 'cancelled' ? 'danger'
      : 'secondary';

    return `
      <div class="px-3 py-2 border-bottom shift-row">
        <div class="d-flex justify-content-between align-items-center">
          <small class="fw-semibold">${escapeHtml(shift.title || 'Shift')}</small>
          <span class="badge bg-${statusColor}-subtle text-${statusColor} rounded-pill" style="font-size: 0.7rem;">${shift.status}</span>
        </div>
        <small class="text-muted">
          ${formatDate(shift.shift_date)} &middot; ${formatTime(shift.start_time)} – ${formatTime(shift.end_time)}
        </small>
        ${isManager ? `<br><small class="text-muted"><i class="bi bi-person"></i> ${escapeHtml(shift.employee?.full_name || '')}</small>` : ''}
      </div>
    `;
  }).join('');
}

init();
