import { requireAuth } from '@shared/auth.js';
import { renderNavbar } from '@shared/navbar.js';
import { supabase } from '@shared/supabase.js';
import { showToast } from '@shared/toast.js';
import { getManagedTeams, getAllTeams } from '@shared/teams.js';
import {
  createLeaveRequest,
  getMyLeaveRequests,
  getTeamLeaveRequests,
  cancelLeaveRequest,
  rejectLeaveRequest,
  approveLeaveRequest,
  getConflictingShifts,
  getReassignmentCandidates,
  cancelApprovedLeave,
} from '@shared/leave.js';

// ── State ─────────────────────────────────────────────────────────────────────

let currentUser = null;
let isManager = false;
let submitModalInstance = null;
let reviewModalInstance = null;
let cancelApprovedModalInstance = null;

// Cache requests for the review modal to look up without re-fetching
let cachedTeamRequests = [];

// ── Entry point ───────────────────────────────────────────────────────────────

async function init() {
  currentUser = await requireAuth();

  renderNavbar({ activePage: 'leave' });

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('full_name, role, avatar_url')
    .eq('id', currentUser.id)
    .single();

  if (profileError) {
    console.error('Profile fetch error:', profileError);
    showToast('Could not load your profile.', 'danger');
    return;
  }

  const isAdmin = profile.role === 'admin';

  let managedTeams = [];
  if (isAdmin) {
    managedTeams = (await getAllTeams()).map((t) => ({ team: t }));
  } else {
    managedTeams = await getManagedTeams(currentUser.id);
  }

  const isTeamManager = managedTeams.length > 0;
  isManager = isAdmin || isTeamManager;

  renderNavbar({
    activePage: 'leave',
    role: profile.role,
    isTeamManager,
    userName: profile.full_name,
    avatarUrl: profile.avatar_url,
  });

  if (isManager) {
    document.getElementById('manager-queue-tab-item').classList.remove('d-none');
  }

  submitModalInstance       = new bootstrap.Modal(document.getElementById('submit-modal'));
  reviewModalInstance       = new bootstrap.Modal(document.getElementById('review-modal'));
  cancelApprovedModalInstance = new bootstrap.Modal(document.getElementById('cancel-approved-modal'));

  document.getElementById('request-leave-btn').addEventListener('click', openSubmitModal);
  document.getElementById('submit-confirm-btn').addEventListener('click', handleSubmit);
  document.getElementById('review-approve-btn').addEventListener('click', handleApprove);
  document.getElementById('review-reject-btn').addEventListener('click', handleReject);
  document.getElementById('cancel-approved-confirm-btn').addEventListener('click', handleCancelApproved);

  // Clear review state when modal closes
  document.getElementById('review-modal').addEventListener('hidden.bs.modal', () => {
    document.getElementById('review-request-id').value = '';
    document.getElementById('review-note').value = '';
    setReviewButtons(false);
  });

  await loadAllData();
}

// ── Data loading ──────────────────────────────────────────────────────────────

async function loadAllData() {
  const myRequests = await getMyLeaveRequests(currentUser.id);
  renderRequestList('my-requests-list', myRequests, 'employee');
  const pendingMine = myRequests.filter((r) => r.status === 'pending').length;
  updateBadge('my-requests-badge', pendingMine);

  if (isManager) {
    const teamRequests = await getTeamLeaveRequests();
    // Exclude the manager's own requests from the queue view
    cachedTeamRequests = teamRequests.filter((r) => r.employee_id !== currentUser.id);
    renderRequestList('manager-queue-list', cachedTeamRequests, 'manager');
    const pendingTeam = cachedTeamRequests.filter((r) => r.status === 'pending').length;
    updateBadge('manager-queue-badge', pendingTeam);
  }
}

// ── Rendering ─────────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  pending:   { label: 'Pending',   badge: 'bg-warning text-dark' },
  approved:  { label: 'Approved',  badge: 'bg-success' },
  rejected:  { label: 'Rejected',  badge: 'bg-danger' },
  cancelled: { label: 'Cancelled', badge: 'bg-secondary' },
};

const LEAVE_TYPE_LABELS = {
  sick:     'Sick Leave',
  vacation: 'Vacation',
  personal: 'Personal',
  other:    'Other',
};

function renderRequestList(containerId, requests, context) {
  const container = document.getElementById(containerId);

  if (!requests.length) {
    const messages = {
      employee: 'You haven\'t submitted any leave requests yet.',
      manager:  'No leave requests from your team.',
    };
    container.innerHTML = `
      <div class="leave-empty text-muted py-5">
        <i class="bi bi-calendar-x display-6 d-block mb-2 opacity-50"></i>
        <p class="mb-0">${messages[context]}</p>
      </div>
    `;
    return;
  }

  container.innerHTML = requests.map((r) => buildRequestCard(r, context)).join('');

  container.querySelectorAll('[data-action="cancel"]').forEach((btn) => {
    btn.addEventListener('click', () => handleCancel(btn.dataset.requestId));
  });

  container.querySelectorAll('[data-action="review"]').forEach((btn) => {
    btn.addEventListener('click', () => openReviewModal(btn.dataset.requestId));
  });

  container.querySelectorAll('[data-action="cancel-approved"]').forEach((btn) => {
    btn.addEventListener('click', () => openCancelApprovedModal(btn.dataset.requestId));
  });
}

function buildRequestCard(request, context) {
  const employee = request.employee || {};
  const reviewer = request.reviewer || {};
  const statusCfg = STATUS_CONFIG[request.status] || STATUS_CONFIG.cancelled;
  const typeLabel = LEAVE_TYPE_LABELS[request.leave_type] || request.leave_type;

  const dateRange = `${formatDate(request.start_date)} – ${formatDate(request.end_date)}`;

  let notes = '';
  if (request.employee_note) {
    notes += `<div class="text-muted small mt-2"><i class="bi bi-chat-left-text me-1"></i>${escapeHtml(request.employee_note)}</div>`;
  }
  if (request.manager_note) {
    notes += `<div class="text-muted small mt-1"><i class="bi bi-chat-left-text me-1"></i><em>Manager:</em> ${escapeHtml(request.manager_note)}</div>`;
  }

  let reviewerInfo = '';
  if (request.reviewed_at && reviewer.full_name) {
    const reviewedDate = new Date(request.reviewed_at).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
    reviewerInfo = `
      <div class="text-muted small mt-1">
        <i class="bi bi-person-check me-1"></i>Reviewed by ${escapeHtml(reviewer.full_name)} on ${reviewedDate}
      </div>
    `;
  }

  let actions = '';

  if (context === 'employee' && request.status === 'pending') {
    actions = `
      <button class="btn btn-sm btn-outline-secondary" data-request-id="${request.id}" data-action="cancel">
        <i class="bi bi-x-lg me-1"></i>Cancel
      </button>
    `;
  } else if (context === 'manager' && request.status === 'pending') {
    actions = `
      <button class="btn btn-sm btn-primary" data-request-id="${request.id}" data-action="review">
        <i class="bi bi-clipboard-check me-1"></i>Review
      </button>
    `;
  } else if (context === 'manager' && request.status === 'approved') {
    actions = `
      <button class="btn btn-sm btn-outline-warning" data-request-id="${request.id}" data-action="cancel-approved">
        <i class="bi bi-x-circle me-1"></i>Cancel Leave
      </button>
    `;
  }

  const createdDate = new Date(request.created_at).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });

  // Manager view: show employee name/avatar
  let employeeInfo = '';
  if (context === 'manager') {
    const initials = getInitials(employee.full_name || '?');
    employeeInfo = `
      <div class="d-flex align-items-center gap-2 mb-2">
        <span class="avatar-badge">${initials}</span>
        <strong>${escapeHtml(employee.full_name || 'Unknown')}</strong>
      </div>
    `;
  }

  return `
    <div class="card border-0 shadow-sm mb-3 leave-card-${request.status}">
      <div class="card-body">
        <div class="d-flex align-items-start justify-content-between flex-wrap gap-2">
          <div>
            ${employeeInfo}
            <div>
              <i class="bi bi-calendar3 me-1 text-muted"></i>
              <strong>${dateRange}</strong>
              <span class="badge bg-light text-dark border ms-2 fw-normal">${escapeHtml(typeLabel)}</span>
            </div>
            ${notes}
            ${reviewerInfo}
            <div class="text-muted small mt-2">
              <i class="bi bi-clock-history me-1"></i>Submitted ${createdDate}
            </div>
          </div>
          <div class="d-flex flex-column align-items-end gap-2">
            <span class="badge ${statusCfg.badge} rounded-pill">${statusCfg.label}</span>
            ${actions ? `<div>${actions}</div>` : ''}
          </div>
        </div>
      </div>
    </div>
  `;
}

function updateBadge(badgeId, count) {
  const badge = document.getElementById(badgeId);
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count;
    badge.classList.remove('d-none');
  } else {
    badge.classList.add('d-none');
  }
}

// ── Submit Modal ──────────────────────────────────────────────────────────────

function openSubmitModal() {
  const form = document.getElementById('leave-form');
  form.classList.remove('was-validated');
  form.reset();

  // Set minimum date to today
  const today = toDateString(new Date());
  document.getElementById('leave-start-date').min = today;
  document.getElementById('leave-end-date').min = today;

  submitModalInstance.show();
}

async function handleSubmit() {
  const form = document.getElementById('leave-form');
  form.classList.add('was-validated');

  const startDate = document.getElementById('leave-start-date').value;
  const endDate   = document.getElementById('leave-end-date').value;
  const leaveType = document.getElementById('leave-type').value;
  const note      = document.getElementById('leave-note').value.trim();

  // Custom validation: end date must be >= start date
  const endInput = document.getElementById('leave-end-date');
  if (startDate && endDate && endDate < startDate) {
    endInput.setCustomValidity('End date must be on or after start date.');
  } else {
    endInput.setCustomValidity('');
  }

  if (!form.checkValidity()) return;

  const btn     = document.getElementById('submit-confirm-btn');
  const spinner = document.getElementById('submit-spinner');
  btn.disabled = true;
  spinner.classList.remove('d-none');

  const { error } = await createLeaveRequest({
    employeeId:   currentUser.id,
    startDate,
    endDate,
    leaveType,
    employeeNote: note,
  });

  btn.disabled = false;
  spinner.classList.add('d-none');

  if (error) {
    showToast(error.message || 'Could not submit leave request.', 'danger');
    return;
  }

  submitModalInstance.hide();
  showToast('Leave request submitted.', 'success');
  await loadAllData();
}

// ── Review Modal ──────────────────────────────────────────────────────────────

async function openReviewModal(requestId) {
  document.getElementById('review-request-id').value = requestId;
  document.getElementById('review-note').value = '';
  setReviewButtons(false);

  // Populate summary from cached request
  const request = cachedTeamRequests.find((r) => r.id === requestId);
  if (request) {
    const employee = request.employee || {};
    const typeLabel = LEAVE_TYPE_LABELS[request.leave_type] || request.leave_type;
    const dateRange = `${formatDate(request.start_date)} – ${formatDate(request.end_date)}`;
    const noteHtml  = request.employee_note
      ? `<div class="mt-1 text-muted small"><i class="bi bi-chat-left-text me-1"></i>${escapeHtml(request.employee_note)}</div>`
      : '';

    document.getElementById('review-request-summary').innerHTML = `
      <div class="d-flex align-items-center gap-2 mb-1">
        <span class="avatar-badge">${getInitials(employee.full_name || '?')}</span>
        <strong>${escapeHtml(employee.full_name || 'Unknown')}</strong>
      </div>
      <div>
        <i class="bi bi-calendar3 me-1 text-muted"></i>${dateRange}
        <span class="badge bg-light text-dark border ms-2 fw-normal">${escapeHtml(typeLabel)}</span>
      </div>
      ${noteHtml}
    `;
  }

  // Reset conflicts area
  document.getElementById('review-transfer-warning').classList.add('d-none');
  document.getElementById('review-conflicts-list').innerHTML = `
    <div class="text-center py-3 text-muted" id="conflicts-loading">
      <span class="spinner-border spinner-border-sm me-2"></span>Loading affected shifts...
    </div>
  `;

  reviewModalInstance.show();

  // Load conflicts asynchronously
  const { data: conflicts, error } = await getConflictingShifts(requestId);

  if (error) {
    document.getElementById('review-conflicts-list').innerHTML =
      '<div class="text-danger small py-2">Could not load affected shifts.</div>';
    setReviewButtons(true);
    return;
  }

  await renderConflicts(conflicts, request?.employee_id);
  setReviewButtons(true);
}

async function renderConflicts(conflicts, employeeId) {
  const listEl    = document.getElementById('review-conflicts-list');
  const warningEl = document.getElementById('review-transfer-warning');

  if (!conflicts.length) {
    listEl.innerHTML = `
      <div class="alert alert-info py-2 mb-0">
        <i class="bi bi-check-circle me-1"></i>No scheduled shifts overlap this leave period.
      </div>
    `;
    return;
  }

  // Show transfer warning if any conflict has a pending transfer
  if (conflicts.some((c) => c.has_pending_transfer)) {
    warningEl.classList.remove('d-none');
  }

  // Pre-fetch reassignment candidates per unique team
  const teamIds = [...new Set(conflicts.filter((c) => c.team_id).map((c) => c.team_id))];
  const candidatesByTeam = {};
  await Promise.all(
    teamIds.map(async (teamId) => {
      candidatesByTeam[teamId] = await getReassignmentCandidates(teamId, employeeId);
    })
  );

  const rows = conflicts.map((c) => {
    const candidates = (candidatesByTeam[c.team_id] || []);
    const candidateOptions = candidates.map(
      (p) => `<option value="${p.id}">${escapeHtml(p.full_name)}</option>`
    ).join('');

    const transferBadge = c.has_pending_transfer
      ? '<span class="badge bg-warning text-dark ms-1" title="Has pending transfer request"><i class="bi bi-arrow-left-right"></i></span>'
      : '';

    return `
      <div class="conflict-row" data-shift-id="${c.shift_id}">
        <div class="conflict-shift-info">
          <strong>${escapeHtml(c.title || 'Shift')}</strong>${transferBadge}
          ${c.team_name ? `<span class="text-muted small ms-1">(${escapeHtml(c.team_name)})</span>` : ''}
        </div>
        <div class="text-muted small conflict-date">
          <i class="bi bi-calendar3 me-1"></i>${formatDate(c.shift_date)}
        </div>
        <div class="text-muted small conflict-time">
          <i class="bi bi-clock me-1"></i>${formatTime(c.start_time)} – ${formatTime(c.end_time)}
        </div>
        <div class="conflict-action">
          <select class="form-select form-select-sm reassign-select">
            <option value="">Cancel shift</option>
            ${candidateOptions}
          </select>
        </div>
      </div>
    `;
  }).join('');

  listEl.innerHTML = `
    <div class="conflict-header d-none d-md-grid mb-1 text-muted small fw-medium">
      <div>Shift</div>
      <div>Date</div>
      <div>Time</div>
      <div>Action</div>
    </div>
    ${rows}
  `;
}

function setReviewButtons(enabled) {
  document.getElementById('review-approve-btn').disabled = !enabled;
  document.getElementById('review-reject-btn').disabled  = !enabled;
}

// ── Approve / Reject ──────────────────────────────────────────────────────────

async function handleApprove() {
  const requestId = document.getElementById('review-request-id').value;
  if (!requestId) return;

  // Collect reassignments from dropdowns
  const reassignments = [];
  document.querySelectorAll('#review-conflicts-list .conflict-row').forEach((row) => {
    const shiftId   = row.dataset.shiftId;
    const select    = row.querySelector('.reassign-select');
    const newEmpId  = select?.value || '';
    if (newEmpId) {
      reassignments.push({ shift_id: shiftId, new_employee_id: newEmpId });
    }
  });

  const approveBtn = document.getElementById('review-approve-btn');
  const rejectBtn  = document.getElementById('review-reject-btn');
  const spinner    = document.getElementById('approve-spinner');

  approveBtn.disabled = true;
  rejectBtn.disabled  = true;
  spinner.classList.remove('d-none');

  const { data: summary, error } = await approveLeaveRequest(requestId, reassignments);

  approveBtn.disabled = false;
  rejectBtn.disabled  = false;
  spinner.classList.add('d-none');

  if (error) {
    showToast(error.message || 'Could not approve leave request.', 'danger');
    return;
  }

  let msg = 'Leave request approved.';
  if (summary) {
    const parts = [];
    if (summary.cancelled_shifts  > 0) parts.push(`${summary.cancelled_shifts} shift${summary.cancelled_shifts > 1 ? 's' : ''} cancelled`);
    if (summary.reassigned_shifts > 0) parts.push(`${summary.reassigned_shifts} reassigned`);
    if (summary.cancelled_transfers > 0) parts.push(`${summary.cancelled_transfers} transfer request${summary.cancelled_transfers > 1 ? 's' : ''} cancelled`);
    if (parts.length) msg += ` (${parts.join(', ')})`;
  }

  reviewModalInstance.hide();
  showToast(msg, 'success');
  await loadAllData();
}

async function handleReject() {
  const requestId = document.getElementById('review-request-id').value;
  if (!requestId) return;

  const note       = document.getElementById('review-note').value.trim();
  const approveBtn = document.getElementById('review-approve-btn');
  const rejectBtn  = document.getElementById('review-reject-btn');
  const spinner    = document.getElementById('reject-spinner');

  approveBtn.disabled = true;
  rejectBtn.disabled  = true;
  spinner.classList.remove('d-none');

  const { error } = await rejectLeaveRequest(requestId, note);

  approveBtn.disabled = false;
  rejectBtn.disabled  = false;
  spinner.classList.add('d-none');

  if (error) {
    showToast(error.message || 'Could not reject leave request.', 'danger');
    return;
  }

  reviewModalInstance.hide();
  showToast('Leave request rejected.', 'info');
  await loadAllData();
}

function openCancelApprovedModal(requestId) {
  const request = cachedTeamRequests.find((r) => r.id === requestId);
  if (!request) return;

  const typeLabel = LEAVE_TYPE_LABELS[request.leave_type] || request.leave_type;
  const employeeName = request.employee?.full_name || 'this employee';
  const dateRange = `${formatDate(request.start_date)} – ${formatDate(request.end_date)}`;

  document.getElementById('cancel-approved-id').value = requestId;
  document.getElementById('cancel-approved-note').value = '';
  document.getElementById('cancel-approved-summary').textContent =
    `Cancel ${typeLabel} for ${employeeName} (${dateRange})?`;

  cancelApprovedModalInstance.show();
}

async function handleCancelApproved() {
  const btn     = document.getElementById('cancel-approved-confirm-btn');
  const spinner = document.getElementById('cancel-approved-spinner');
  btn.disabled  = true;
  spinner.classList.remove('d-none');

  const requestId = document.getElementById('cancel-approved-id').value;
  const note      = document.getElementById('cancel-approved-note').value.trim();

  const { error } = await cancelApprovedLeave(requestId, note);

  btn.disabled = false;
  spinner.classList.add('d-none');

  if (error) {
    showToast(error.message || 'Could not cancel leave.', 'danger');
    return;
  }

  cancelApprovedModalInstance.hide();
  showToast('Leave request cancelled.', 'success');
  await loadAllData();
}

async function handleCancel(requestId) {
  const { error } = await cancelLeaveRequest(requestId);

  if (error) {
    showToast(error.message || 'Could not cancel leave request.', 'danger');
    return;
  }

  showToast('Leave request cancelled.', 'success');
  await loadAllData();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-');
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(timeStr) {
  if (!timeStr) return '—';
  const [h, m] = timeStr.split(':');
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}

function toDateString(date) {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d  = String(date.getDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

function getInitials(name) {
  return (name || '?')
    .split(' ')
    .map((w) => w[0] || '')
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

// ── Start ─────────────────────────────────────────────────────────────────────

init();
