import { createTransferRequest, getTransferTargets } from '@shared/services/transfers.js';
import { getPendingTransferShiftIds } from '@shared/services/shifts.js';
import { showToast } from '@shared/components/toast/toast.js';
import { escapeHtml, formatTime } from '@shared/utils/formatting.js';

// ── Private state ────────────────────────────────────────────────────────────
let transferModalInstance = null;
let _currentUser = null;
let _getCurrentShifts = null;
let _getPendingIds = null;
let _addPendingId = null;
let _onSuccess = null;

/**
 * Initialise the transfer request modal. Call once during page init.
 *
 * @param {Object} ctx
 * @param {Object} ctx.currentUser
 * @param {Function} ctx.getCurrentShifts  - () => currentShifts[]
 * @param {Function} ctx.getPendingIds     - () => Set<string>
 * @param {Function} ctx.addPendingId      - (shiftId) => void
 * @param {Function} ctx.onSuccess         - async () => void (reload view)
 */
export function initTransferModal(ctx) {
  _currentUser = ctx.currentUser;
  _getCurrentShifts = ctx.getCurrentShifts;
  _getPendingIds = ctx.getPendingIds;
  _addPendingId = ctx.addPendingId;
  _onSuccess = ctx.onSuccess;

  transferModalInstance = new bootstrap.Modal(document.getElementById('transfer-modal'));

  document.getElementById('transfer-submit-btn').addEventListener('click', () => {
    handleTransferSubmit();
  });
}

/**
 * Load pending transfer IDs for the current user and update the shared set.
 */
export async function loadPendingTransferIds() {
  const ids = await getPendingTransferShiftIds(_currentUser.id);
  // Replace the contents of the shared set
  const pendingIds = _getPendingIds();
  pendingIds.clear();
  ids.forEach((id) => pendingIds.add(id));
}

/**
 * Show the transfer modal for a specific shift.
 */
export async function openTransferModal(shiftId, teamId) {
  const shift = _getCurrentShifts().find((s) => s.id === shiftId);
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

  const targets = await getTransferTargets(teamId, _currentUser.id);
  targetSelect.innerHTML = '<option value="">— Select teammate —</option>';
  targets.forEach((t) => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.full_name;
    targetSelect.appendChild(opt);
  });
  targetSelect.disabled = false;
}

// ── Internal ─────────────────────────────────────────────────────────────────

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

  const shift = _getCurrentShifts().find((s) => s.id === shiftId);

  const { error } = await createTransferRequest({
    shiftId,
    teamId,
    requesterId: _currentUser.id,
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

  _addPendingId(shiftId);
  await _onSuccess();
}
