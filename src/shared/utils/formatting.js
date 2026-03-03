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

// ── Week helpers ──────────────────────────────────────────────────────────────

/** Return the Monday (start of ISO week) for the given date, at midnight. */
export function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Return the Sunday (end of ISO week) for the given date, at midnight. */
export function getWeekEnd(date) {
  const d = getWeekStart(date);
  d.setDate(d.getDate() + 6);
  return d;
}

/** Return an array of 7 Date objects starting from weekStart. */
export function getWeekDays(weekStart) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });
}

/** Format a week range label — e.g. "Mon, Jan 5 – Sun, Jan 11, 2026". */
export function formatWeekLabel(weekStart) {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const opts = { weekday: 'short', month: 'short', day: 'numeric' };
  const start = weekStart.toLocaleDateString('en-US', opts);
  const end = weekEnd.toLocaleDateString('en-US', { ...opts, year: 'numeric' });
  return `${start} – ${end}`;
}

// ── Month helpers ─────────────────────────────────────────────────────────────

/** Return the 1st of the month for the given date. */
export function getMonthStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/** Return the last day of the month for the given date. */
export function getMonthEnd(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

/** Return the number of days in the month of the given date. */
export function getDaysInMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

/** Format a month label — e.g. "January 2026". */
export function formatMonthLabel(date) {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/**
 * Return a "YYYY-MM-DD" string offset by `days` from `refDate` (defaults to today).
 */
export function toDateOffset(days, refDate = new Date()) {
  const d = new Date(refDate);
  d.setDate(d.getDate() + days);
  return toDateString(d);
}

// ── Generic utilities ─────────────────────────────────────────────────────────

/** Return a debounced version of fn that delays execution by `delay` ms. */
export function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
