/**
 * Shared formatting & string utility functions.
 *
 * Centralises helpers that were previously duplicated across page modules.
 */

/** Escape a string for safe insertion into HTML. */
export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

/** Convert a 24-hour "HH:MM" or "HH:MM:SS" time string to 12-hour format (e.g. "2:30 PM"). */
export function formatTime(timeStr) {
  if (!timeStr) return '—';
  const [h, m] = timeStr.split(':');
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}

/** Compact time format — hour + a/p (e.g. "2p", "11a"). */
export function formatTimeShort(timeStr) {
  if (!timeStr) return '';
  const [h] = timeStr.split(':');
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? 'p' : 'a';
  const h12 = hour % 12 || 12;
  return `${h12}${ampm}`;
}

/** Extract up to two uppercase initials from a full name. */
export function getInitials(name) {
  return (name ?? '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

/** Format a Date object as "YYYY-MM-DD". */
export function toDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Human-readable full date — e.g. "Jan 5, 2026". */
export function formatDateFull(dateStr) {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-');
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Short date with weekday — e.g. "Mon, Jan 5". */
export function formatDateShort(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
