import { deleteShift } from '@shared/services/shifts.js';
import { showToast } from '@shared/components/toast/toast.js';

// ── Private state ────────────────────────────────────────────────────────────
let deleteModalInstance = null;
let pendingDeleteId = null;
let _getCurrentShifts = null;
let _onSuccess = null;

/**
 * Initialise the delete-confirm modal. Call once during page init.
 *
 * @param {Object} ctx
 * @param {Function} ctx.getCurrentShifts - () => currentShifts[]
 * @param {Function} ctx.onSuccess        - async () => void (reload view)
 */
export function initDeleteModal(ctx) {
  _getCurrentShifts = ctx.getCurrentShifts;
  _onSuccess = ctx.onSuccess;

  deleteModalInstance = new bootstrap.Modal(document.getElementById('delete-modal'));

  document.getElementById('confirm-delete-btn').addEventListener('click', () => {
    handleDeleteConfirm();
  });
}

/**
 * Show the delete confirmation modal for the given shift.
 */
export function openDeleteModal(shiftId) {
  pendingDeleteId = shiftId;
  const shift = _getCurrentShifts().find((s) => s.id === shiftId);
  document.getElementById('delete-shift-name').textContent = shift?.title || 'this shift';
  deleteModalInstance.show();
}

// ── Internal ─────────────────────────────────────────────────────────────────

async function handleDeleteConfirm() {
  const confirmBtn = document.getElementById('confirm-delete-btn');
  const spinner = document.getElementById('delete-spinner');
  confirmBtn.disabled = true;
  spinner.classList.remove('d-none');

  const { error } = await deleteShift(pendingDeleteId);

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
  await _onSuccess();
}
