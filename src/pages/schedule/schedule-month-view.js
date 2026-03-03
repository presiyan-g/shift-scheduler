import {
  toDateString, escapeHtml, formatTime, formatTimeShort,
  getMonthStart, getDaysInMonth,
} from '@shared/utils/formatting.js';

/**
 * Render the manager-facing employee×day matrix into #month-matrix-container.
 *
 * @param {Object} ctx
 * @param {string} ctx.currentUserId
 * @param {boolean} ctx.isManager
 * @param {Set<string>} ctx.pendingTransferShiftIds
 * @param {Date} ctx.monthDate
 * @param {Array} shifts
 * @param {Array} rosterEmployees
 * @param {Array} leaves
 */
export function renderMonthMatrix(ctx, shifts, rosterEmployees = [], leaves = []) {
  const container = document.getElementById('month-matrix-container');
  container.innerHTML = '';

  const today = toDateString(new Date());
  const daysInMonth = getDaysInMonth(ctx.monthDate);
  const monthNum = ctx.monthDate.getMonth();
  const year = ctx.monthDate.getFullYear();

  // Group shifts by employee_id -> date -> [shifts]
  const shiftMap = {};
  const employeeMap = {};

  (rosterEmployees || []).forEach((employee) => {
    if (!employee?.id) return;
    employeeMap[employee.id] = {
      id: employee.id,
      full_name: employee.full_name || 'Unknown',
    };
  });

  shifts.forEach((s) => {
    const empId = s.employee_id;
    if (!shiftMap[empId]) shiftMap[empId] = {};
    if (!shiftMap[empId][s.shift_date]) shiftMap[empId][s.shift_date] = [];
    shiftMap[empId][s.shift_date].push(s);

    if (!employeeMap[empId]) {
      employeeMap[empId] = {
        id: empId,
        full_name: s.employee?.full_name || 'Unknown',
      };
    }
  });

  // Build leaveMap[empId][dateStr] = [leave, ...]
  const leaveMap = {};
  leaves.forEach((lr) => {
    if (!leaveMap[lr.employee_id]) leaveMap[lr.employee_id] = {};
    let cur = new Date(lr.start_date + 'T00:00:00');
    const endD = new Date(lr.end_date + 'T00:00:00');
    while (cur <= endD) {
      const ds = toDateString(cur);
      if (!leaveMap[lr.employee_id][ds]) leaveMap[lr.employee_id][ds] = [];
      leaveMap[lr.employee_id][ds].push(lr);
      cur.setDate(cur.getDate() + 1);
    }
  });

  const sortedEmployees = Object.values(employeeMap).sort((a, b) =>
    a.full_name.localeCompare(b.full_name)
  );

  let html = '<div class="month-matrix-wrapper">';
  html += '<table class="month-matrix-table">';

  // Header row
  html += '<thead><tr><th class="month-matrix-employee-header">Employee</th>';
  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj = new Date(year, monthNum, d);
    const dateStr = toDateString(dateObj);
    const isToday = dateStr === today;
    const dayAbbr = dateObj.toLocaleDateString('en-US', { weekday: 'narrow' });
    const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;

    html += `<th class="month-matrix-day-header${isToday ? ' matrix-today-header' : ''}${isWeekend ? ' matrix-weekend' : ''}">
      <div class="matrix-day-abbr">${dayAbbr}</div>
      <div class="matrix-day-num">${d}</div>
    </th>`;
  }
  html += '</tr></thead>';

  // Body: one row per employee
  html += '<tbody>';
  if (sortedEmployees.length === 0) {
    html += `<tr><td class="month-matrix-employee-name text-muted" colspan="${daysInMonth + 1}">No employees found for this view.</td></tr>`;
  }

  sortedEmployees.forEach((emp) => {
    html += '<tr>';
    html += `<td class="month-matrix-employee-name">${escapeHtml(emp.full_name)}</td>`;

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = toDateString(new Date(year, monthNum, d));
      const isToday = dateStr === today;
      const dateObj = new Date(year, monthNum, d);
      const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;
      const cellShifts = shiftMap[emp.id]?.[dateStr] || [];

      let cellHtml = '';
      cellShifts.forEach((s) => {
        const statusColor = {
          scheduled: 'primary',
          completed: 'success',
          cancelled: 'danger',
        }[s.status] || 'secondary';

        const pillColorStyle = s.color
          ? `style="border-left: 3px solid ${escapeHtml(s.color)}; background-color: ${escapeHtml(s.color)}22 !important;"`
          : '';
        cellHtml += `<div class="matrix-shift-pill badge bg-${statusColor}-subtle text-${statusColor}"
          data-shift-id="${s.id}"
          ${pillColorStyle}
          title="${escapeHtml(s.title)}: ${formatTime(s.start_time)}\u2013${formatTime(s.end_time)}">
          ${formatTimeShort(s.start_time)}-${formatTimeShort(s.end_time)}
        </div>`;
      });

      // Leave pills
      const cellLeaves = leaveMap[emp.id]?.[dateStr] || [];
      const leaveTypeLabels = { sick: 'Sick', vacation: 'Vacation', personal: 'Personal', other: 'Leave' };
      cellLeaves.forEach((lr) => {
        const typeLabel = leaveTypeLabels[lr.leave_type] || 'Leave';
        cellHtml += `<div class="matrix-leave-pill" title="${typeLabel}">
          <i class="bi bi-airplane"></i>
        </div>`;
      });

      const hasApprovedLeave = cellLeaves.length > 0;
      const todayClass = isToday ? ' matrix-today-cell' : '';
      const weekendClass = isWeekend ? ' matrix-weekend' : '';
      const leaveCellClass = hasApprovedLeave ? ' matrix-leave-cell' : '';
      html += `<td class="month-matrix-cell${todayClass}${weekendClass}${leaveCellClass}" data-date="${dateStr}" data-employee="${emp.id}">${cellHtml}</td>`;
    }

    html += '</tr>';
  });
  html += '</tbody></table></div>';

  container.innerHTML = html;
}

/**
 * Render the personal month calendar grid into #month-calendar-grid.
 *
 * @param {Object} ctx
 * @param {string} ctx.currentUserId
 * @param {boolean} ctx.isManager
 * @param {Set<string>} ctx.pendingTransferShiftIds
 * @param {Date} ctx.monthDate
 * @param {Array} shifts
 * @param {Array} leaves
 */
export function renderMyMonthCalendar(ctx, shifts, leaves = []) {
  const container = document.getElementById('month-calendar-grid');
  container.innerHTML = '';

  const todayStr = toDateString(new Date());
  const monthStart = getMonthStart(ctx.monthDate);
  const monthYear = monthStart.getFullYear();
  const monthNum = monthStart.getMonth();
  const firstDayOffset = (monthStart.getDay() + 6) % 7; // 0=Mon

  const gridStart = new Date(monthYear, monthNum, 1 - firstDayOffset);
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return date;
  });

  const shiftMap = {};
  (shifts || []).forEach((shift) => {
    if (!shift?.shift_date) return;
    if (!shiftMap[shift.shift_date]) shiftMap[shift.shift_date] = [];
    shiftMap[shift.shift_date].push(shift);
  });

  const leaveMap = {};
  (leaves || []).forEach((leave) => {
    let cur = new Date(`${leave.start_date}T00:00:00`);
    const end = new Date(`${leave.end_date}T00:00:00`);
    while (cur <= end) {
      const key = toDateString(cur);
      if (!leaveMap[key]) leaveMap[key] = [];
      leaveMap[key].push(leave);
      cur.setDate(cur.getDate() + 1);
    }
  });

  const weekDayHeaders = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  let html = '<div class="month-calendar">';
  html += '<div class="month-cal-header">';
  weekDayHeaders.forEach((label) => {
    html += `<div class="month-cal-header-cell">${label}</div>`;
  });
  html += '</div>';

  html += '<div class="month-cal-body">';
  days.forEach((dateObj) => {
    const dateStr = toDateString(dateObj);
    const inCurrentMonth = dateObj.getMonth() === monthNum;
    const isToday = dateStr === todayStr;
    const dayShifts = shiftMap[dateStr] || [];
    const dayLeaves = leaveMap[dateStr] || [];

    const cellClasses = [
      'month-cal-cell',
      inCurrentMonth ? '' : 'month-cal-outside',
      isToday ? 'month-cal-today' : '',
    ].filter(Boolean).join(' ');

    let entriesHtml = '';
    dayShifts.slice(0, 3).forEach((shift) => {
      const isEligibleForTransfer =
        !ctx.isManager &&
        shift.employee_id === ctx.currentUserId &&
        shift.status === 'scheduled' &&
        shift.shift_date >= todayStr &&
        shift.team_id &&
        !ctx.pendingTransferShiftIds.has(shift.id);

      const isClickable = ctx.isManager || isEligibleForTransfer;
      const statusTone = {
        scheduled: 'primary',
        completed: 'success',
        cancelled: 'danger',
      }[shift.status] || 'secondary';

      const transferHint = !ctx.isManager && ctx.pendingTransferShiftIds.has(shift.id)
        ? '<i class="bi bi-hourglass-split"></i>'
        : '';

      const calPillColorStyle = shift.color
        ? `style="border-left: 3px solid ${escapeHtml(shift.color)}; background-color: ${escapeHtml(shift.color)}22 !important;"`
        : '';

      entriesHtml += `
        <div
          class="month-cal-shift bg-${statusTone}-subtle text-${statusTone}${isClickable ? ' month-cal-shift-clickable' : ''}"
          data-shift-id="${shift.id}"
          data-team-id="${shift.team_id || ''}"
          title="${escapeHtml(shift.title || 'Shift')}: ${formatTime(shift.start_time)}–${formatTime(shift.end_time)}"
          ${calPillColorStyle}
        >
          <span class="month-cal-shift-time">${formatTimeShort(shift.start_time)}-${formatTimeShort(shift.end_time)}</span>
          <span class="month-cal-shift-title">${escapeHtml(shift.title || 'Shift')}</span>
          ${transferHint}
        </div>
      `;
    });

    if (dayShifts.length > 3) {
      entriesHtml += `<div class="month-cal-more text-muted">+${dayShifts.length - 3} more</div>`;
    }

    if (dayLeaves.length > 0) {
      const hasApproved = dayLeaves.some((leave) => leave.status === 'approved');
      const leaveLabel = hasApproved ? 'Leave' : 'Leave pending';
      entriesHtml += `<div class="month-cal-more ${hasApproved ? 'text-warning-emphasis' : 'text-muted'}"><i class="bi bi-airplane"></i> ${leaveLabel}</div>`;
    }

    html += `
      <div class="${cellClasses}" data-date="${dateStr}">
        <div class="month-cal-day-number ${isToday ? 'fw-bold text-primary' : ''}">${dateObj.getDate()}</div>
        ${entriesHtml}
      </div>
    `;
  });
  html += '</div></div>';

  container.innerHTML = html;
}
