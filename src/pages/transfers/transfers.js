import { requireAuth } from '@shared/auth.js';
import { renderNavbar } from '@shared/navbar.js';
import { supabase } from '@shared/supabase.js';
import { showToast } from '@shared/toast.js';
import { getManagedTeams, getAllTeams } from '@shared/teams.js';
import {
  getMyTransferRequests,
  getPendingManagerRequests,
  acceptTransferRequest,
  rejectTransferRequest,
  approveTransferRequest,
  declineTransferRequest,
  cancelTransferRequest,
  expireStaleRequests,
} from '@shared/transfers.js';

// ── State ────────────────────────────────────────────────────────────────────

let currentUser = null;
let isManager = false;
let managedTeams = [];
let actionModalInstance = null;

// ── Entry point ──────────────────────────────────────────────────────────────

async function init() {
  currentUser = await requireAuth();

  renderNavbar({ activePage: 'transfers' });

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

  if (isAdmin) {
    managedTeams = (await getAllTeams()).map((t) => ({ team: t }));
  } else {
    managedTeams = await getManagedTeams(currentUser.id);
  }

  const isTeamManager = managedTeams.length > 0;
  isManager = isAdmin || isTeamManager;

  renderNavbar({
    activePage: 'transfers',
    role: profile.role,
    isTeamManager,
    userName: profile.full_name,
    avatarUrl: profile.avatar_url,
  });

  if (isManager) {
    document.getElementById('manager-queue-tab-item').classList.remove('d-none');
  }

  actionModalInstance = new bootstrap.Modal(document.getElementById('action-modal'));

  // Expire stale requests before loading data
  await expireStaleRequests();
  await loadAllData();
}

// ── Data loading ─────────────────────────────────────────────────────────────

async function loadAllData() {
  const allRequests = await getMyTransferRequests(currentUser.id);

  const outgoing = allRequests.filter((r) => r.requester_id === currentUser.id);
  const incoming = allRequests.filter((r) => r.target_id === currentUser.id);

  renderRequestList('my-requests-list', outgoing, 'outgoing');
  renderRequestList('incoming-list', incoming, 'incoming');

  const outgoingActive = outgoing.filter((r) => r.status === 'pending_target' || r.status === 'pending_manager');
  updateBadge('my-requests-badge', outgoingActive.length);

  const incomingPending = incoming.filter((r) => r.status === 'pending_target');
  updateBadge('incoming-badge', incomingPending.length);

  if (isManager) {
    const teamIds = managedTeams.map((mt) => mt.team.id);
    const managerQueue = await getPendingManagerRequests(teamIds);
    renderRequestList('manager-queue-list', managerQueue, 'manager');
    updateBadge('manager-queue-badge', managerQueue.length);
  }
}

// ── Rendering ────────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  pending_target:  { label: 'Awaiting Response',  badge: 'bg-warning text-dark' },
  pending_manager: { label: 'Awaiting Manager',   badge: 'bg-info' },
  approved:        { label: 'Approved',            badge: 'bg-success' },
  rejected:        { label: 'Declined by Teammate', badge: 'bg-danger' },
  declined:        { label: 'Declined by Manager', badge: 'bg-danger' },
  cancelled:       { label: 'Cancelled',           badge: 'bg-secondary' },
  expired:         { label: 'Expired',             badge: 'bg-secondary' },
};

function renderRequestList(containerId, requests, context) {
  const container = document.getElementById(containerId);

  if (!requests.length) {
    const messages = {
      outgoing: 'You haven\'t made any transfer requests yet.',
      incoming: 'No one has sent you a transfer request.',
      manager: 'No transfer requests awaiting your approval.',
    };
    container.innerHTML = `
      <div class="transfers-empty text-muted py-5">
        <i class="bi bi-inbox display-6 d-block mb-2 opacity-50"></i>
        <p class="mb-0">${messages[context]}</p>
      </div>
    `;
    return;
  }

  container.innerHTML = requests.map((r) => buildRequestCard(r, context)).join('');

  // Attach click handlers for action buttons
  container.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      openActionModal(btn.dataset.requestId, btn.dataset.action, btn.closest('.card'));
    });
  });
}

function buildRequestCard(request, context) {
  const shift = request.shift || {};
  const requester = request.requester || {};
  const target = request.target || {};
  const statusCfg = STATUS_CONFIG[request.status] || STATUS_CONFIG.cancelled;

  const shiftInfo = `
    <strong>${escapeHtml(shift.title || 'Shift')}</strong>
    <span class="text-muted ms-2">
      <i class="bi bi-calendar3 me-1"></i>${shift.shift_date || '—'}
      <i class="bi bi-clock ms-2 me-1"></i>${formatTime(shift.start_time)} – ${formatTime(shift.end_time)}
    </span>
  `;

  const fromTo = `
    <div class="d-flex align-items-center gap-2 mt-2">
      <span class="badge bg-light text-dark border">
        <i class="bi bi-person me-1"></i>${escapeHtml(requester.full_name || 'Unknown')}
      </span>
      <i class="bi bi-arrow-right text-muted"></i>
      <span class="badge bg-light text-dark border">
        <i class="bi bi-person me-1"></i>${escapeHtml(target.full_name || 'Unknown')}
      </span>
    </div>
  `;

  let notes = '';
  if (request.requester_note) {
    notes += `<div class="text-muted small mt-2"><i class="bi bi-chat-left-text me-1"></i>${escapeHtml(request.requester_note)}</div>`;
  }
  if (request.target_note) {
    notes += `<div class="text-muted small mt-1"><i class="bi bi-chat-left-text me-1"></i><em>Response:</em> ${escapeHtml(request.target_note)}</div>`;
  }
  if (request.manager_note) {
    notes += `<div class="text-muted small mt-1"><i class="bi bi-chat-left-text me-1"></i><em>Manager:</em> ${escapeHtml(request.manager_note)}</div>`;
  }

  let actions = '';

  if (context === 'outgoing' && request.status === 'pending_target') {
    actions = `
      <button class="btn btn-sm btn-outline-secondary" data-request-id="${request.id}" data-action="cancel">
        <i class="bi bi-x-lg me-1"></i>Cancel
      </button>
    `;
  } else if (context === 'incoming' && request.status === 'pending_target') {
    actions = `
      <button class="btn btn-sm btn-success" data-request-id="${request.id}" data-action="accept">
        <i class="bi bi-check-circle me-1"></i>Accept
      </button>
      <button class="btn btn-sm btn-outline-danger" data-request-id="${request.id}" data-action="reject">
        <i class="bi bi-x-circle me-1"></i>Decline
      </button>
    `;
  } else if (context === 'manager' && request.status === 'pending_manager') {
    actions = `
      <button class="btn btn-sm btn-success" data-request-id="${request.id}" data-action="approve">
        <i class="bi bi-check-circle me-1"></i>Approve
      </button>
      <button class="btn btn-sm btn-outline-danger" data-request-id="${request.id}" data-action="decline">
        <i class="bi bi-x-circle me-1"></i>Decline
      </button>
    `;
  }

  const createdDate = new Date(request.created_at).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });

  return `
    <div class="card border-0 shadow-sm mb-3 transfer-card-${request.status}">
      <div class="card-body">
        <div class="d-flex align-items-start justify-content-between flex-wrap gap-2">
          <div>
            ${shiftInfo}
            ${fromTo}
            ${notes}
            <div class="text-muted small mt-2">
              <i class="bi bi-clock-history me-1"></i>Requested ${createdDate}
            </div>
          </div>
          <div class="d-flex flex-column align-items-end gap-2">
            <span class="badge ${statusCfg.badge} rounded-pill">${statusCfg.label}</span>
            ${actions ? `<div class="d-flex gap-2">${actions}</div>` : ''}
          </div>
        </div>
      </div>
    </div>
  `;
}

function updateBadge(badgeId, count) {
  const badge = document.getElementById(badgeId);
  if (count > 0) {
    badge.textContent = count;
    badge.classList.remove('d-none');
  } else {
    badge.classList.add('d-none');
  }
}

// ── Action Modal ─────────────────────────────────────────────────────────────

function openActionModal(requestId, actionType, cardEl) {
  document.getElementById('action-request-id').value = requestId;
  document.getElementById('action-type').value = actionType;
  document.getElementById('action-note').value = '';

  // Show/hide note field (not needed for cancel)
  const noteField = document.getElementById('action-note-field');
  noteField.classList.toggle('d-none', actionType === 'cancel');

  // Extract shift summary from the card
  const shiftInfo = cardEl?.querySelector('.card-body > div > div:first-child');
  const summary = document.getElementById('action-shift-summary');
  if (shiftInfo) {
    const strong = cardEl.querySelector('strong');
    const timeSpan = cardEl.querySelector('.text-muted.ms-2') || cardEl.querySelector('span.text-muted');
    summary.innerHTML = `${strong?.outerHTML || ''} ${timeSpan?.outerHTML || ''}`;
  } else {
    summary.innerHTML = '<em>Shift details</em>';
  }

  const titles = {
    accept: 'Accept Transfer Request',
    reject: 'Decline Transfer Request',
    approve: 'Approve Transfer Request',
    decline: 'Decline Transfer Request',
    cancel: 'Cancel Transfer Request',
  };
  document.getElementById('action-modal-label').textContent = titles[actionType] || 'Transfer Request';

  const footer = document.getElementById('action-modal-footer');
  const buttonConfig = {
    accept:  { cls: 'btn-success', icon: 'bi-check-circle', label: 'Accept Transfer' },
    reject:  { cls: 'btn-danger',  icon: 'bi-x-circle',     label: 'Decline Transfer' },
    approve: { cls: 'btn-success', icon: 'bi-check-circle', label: 'Approve Transfer' },
    decline: { cls: 'btn-danger',  icon: 'bi-x-circle',     label: 'Decline Transfer' },
    cancel:  { cls: 'btn-secondary', icon: 'bi-x-lg',       label: 'Cancel Request' },
  };
  const cfg = buttonConfig[actionType];

  footer.innerHTML = `
    <button class="btn btn-light" data-bs-dismiss="modal">Back</button>
    <button class="btn ${cfg.cls}" id="modal-confirm-btn">
      <i class="bi ${cfg.icon} me-1"></i>${cfg.label}
      <span class="spinner-border spinner-border-sm ms-2 d-none" id="modal-spinner"></span>
    </button>
  `;

  document.getElementById('modal-confirm-btn').addEventListener('click', handleModalConfirm, { once: true });
  actionModalInstance.show();
}

async function handleModalConfirm() {
  const requestId = document.getElementById('action-request-id').value;
  const actionType = document.getElementById('action-type').value;
  const note = document.getElementById('action-note').value.trim();

  const btn = document.getElementById('modal-confirm-btn');
  const spinner = document.getElementById('modal-spinner');
  btn.disabled = true;
  spinner.classList.remove('d-none');

  let result = { error: null };

  switch (actionType) {
    case 'accept':
      result = await acceptTransferRequest(requestId, note);
      break;
    case 'reject':
      result = await rejectTransferRequest(requestId, note);
      break;
    case 'approve':
      result = await approveTransferRequest(requestId);
      break;
    case 'decline':
      result = await declineTransferRequest(requestId, note);
      break;
    case 'cancel':
      result = await cancelTransferRequest(requestId);
      break;
  }

  btn.disabled = false;
  spinner.classList.add('d-none');

  if (result.error) {
    showToast(result.error.message || 'Action failed.', 'danger');
    return;
  }

  const messages = {
    accept: 'Request accepted. Waiting for manager approval.',
    reject: 'Request declined.',
    approve: 'Transfer approved. The shift has been reassigned.',
    decline: 'Transfer request declined.',
    cancel: 'Request cancelled.',
  };

  actionModalInstance.hide();
  showToast(messages[actionType] || 'Done.', 'success');
  await loadAllData();
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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
