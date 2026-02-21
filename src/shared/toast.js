/**
 * Toast notification helper using Bootstrap 5 Toast component.
 * Injects a fixed toast container into the page on first use.
 *
 * Usage:
 *   import { showToast } from '@shared/toast.js';
 *   showToast('Saved successfully', 'success');
 *   showToast('Something went wrong', 'danger');
 *
 * @param {string} message   The message to display.
 * @param {'success'|'danger'|'warning'|'info'} [type='info']
 * @param {number} [duration=4000]  Auto-hide delay in milliseconds.
 */

let toastContainer = null;

function getOrCreateContainer() {
  if (toastContainer) return toastContainer;

  toastContainer = document.createElement('div');
  toastContainer.setAttribute('aria-live', 'polite');
  toastContainer.setAttribute('aria-atomic', 'true');
  toastContainer.style.cssText =
    'position: fixed; top: 1rem; right: 1rem; z-index: 1100;' +
    'display: flex; flex-direction: column; gap: 0.5rem;';
  document.body.appendChild(toastContainer);
  return toastContainer;
}

const icons = {
  success: 'bi-check-circle-fill',
  danger:  'bi-exclamation-triangle-fill',
  warning: 'bi-exclamation-circle-fill',
  info:    'bi-info-circle-fill',
};

export function showToast(message, type = 'info', duration = 4000) {
  const container = getOrCreateContainer();
  const icon = icons[type] ?? icons.info;

  const toastEl = document.createElement('div');
  toastEl.className = `toast align-items-center text-white bg-${type} border-0`;
  toastEl.setAttribute('role', 'alert');
  toastEl.setAttribute('aria-live', 'assertive');
  toastEl.setAttribute('aria-atomic', 'true');

  toastEl.innerHTML = `
    <div class="d-flex">
      <div class="toast-body d-flex align-items-center gap-2">
        <i class="bi ${icon}"></i>
        <span>${message}</span>
      </div>
      <button
        type="button"
        class="btn-close btn-close-white me-2 m-auto"
        data-bs-dismiss="toast"
        aria-label="Close"
      ></button>
    </div>
  `;

  container.appendChild(toastEl);

  const bsToast = new bootstrap.Toast(toastEl, {
    autohide: true,
    delay: duration,
  });
  bsToast.show();

  toastEl.addEventListener('hidden.bs.toast', () => {
    toastEl.remove();
  });
}
