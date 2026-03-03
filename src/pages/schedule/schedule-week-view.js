import { toDateString, getWeekDays, escapeHtml, formatTime } from '@shared/utils/formatting.js';

/**
 * Render the 7-column week grid into #week-grid.
 *
 * @param {Object} ctx
 * @param {string} ctx.currentUserId
 * @param {boolean} ctx.isManager
 * @param {Set<string>} ctx.pendingTransferShiftIds
 * @param {Date} ctx.weekStart
 * @param {Array} shifts
 * @param {Array} leaves
 */
export function renderWeekGrid(ctx, shifts, leaves = []) {
  const grid = document.getElementById('week-grid');
  grid.innerHTML = '';

  const today = toDateString(new Date());
  const days = getWeekDays(ctx.weekStart);

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
    col.innerHTML = buildDayColumnHtml(ctx, dayDate, dateStr, isToday, dayShifts, leaveMap[dateStr] || []);
    grid.appendChild(col);
  });
}

// ── Internal helpers (not exported) ──────────────────────────────────────────

function buildDayColumnHtml(ctx, dayDate, dateStr, isToday, dayShifts, dayLeaves = []) {
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
    const isOwn = lr.employee_id === ctx.currentUserId;
    const name = isOwn ? 'You' : escapeHtml(lr.employee?.full_name || '—');
    const typeLabel = typeLabels[lr.leave_type] || 'Leave';
    return `<div class="leave-day-banner leave-banner-approved">
      <i class="bi bi-airplane me-1"></i>${name} — ${typeLabel}
    </div>`;
  }).join('');

  const shiftsHtml =
    dayShifts.length === 0
      ? `<p class="text-muted text-center small my-auto py-3 mb-0">No shifts</p>`
      : dayShifts.map((s) => buildShiftCardHtml(ctx, s)).join('');

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

function buildShiftCardHtml(ctx, shift) {
  const statusClass = `shift-status-${shift.status}`;
  const badgeClass = {
    scheduled: 'bg-primary-subtle text-primary',
    completed: 'bg-success-subtle text-success',
    cancelled: 'bg-danger-subtle text-danger',
  }[shift.status] || 'bg-secondary-subtle text-secondary';

  // Show employee name when viewing someone else's shift
  const isOwnShift = shift.employee_id === ctx.currentUserId;
  const employeeRow = !isOwnShift
    ? `<div class="shift-employee-name mt-1">
         <i class="bi bi-person-fill me-1"></i>${escapeHtml(shift.employee?.full_name || '—')}
       </div>`
    : '';

  let actionBtns = '';
  if (ctx.isManager) {
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
    if (ctx.pendingTransferShiftIds.has(shift.id)) {
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

  const colorStyle = shift.color
    ? `style="border-left: 3px solid ${escapeHtml(shift.color)} !important;"`
    : '';

  return `
    <div class="shift-card p-2 rounded border ${statusClass}" ${colorStyle}>
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
