import { createShift, updateShift, getShiftTemplates, getEmployeeShiftDates, checkLeaveConflicts } from '@shared/services/shifts.js';
import { showToast } from '@shared/components/toast/toast.js';
import { escapeHtml, toDateString, debounce } from '@shared/utils/formatting.js';

// ── Private state ────────────────────────────────────────────────────────────
let shiftModalInstance = null;
let shiftDatePicker = null;
let shiftDateMode = 'single';
let employeeExistingShiftDates = new Set();
let shiftTemplates = [];
let shiftColorEnabled = false;

// ── Captured context ─────────────────────────────────────────────────────────
let _currentUser = null;
let _isManager = false;
let _getEmployees = null;
let _getCurrentShifts = null;
let _onSaveSuccess = null;

// ── Debounced conflict checkers ──────────────────────────────────────────────
const debouncedLeaveConflictWarning = debounce(updateLeaveConflictWarning, 350);
const debouncedShiftConflictWarning = debounce(updateShiftConflictWarning, 350);

/**
 * Initialise the shift create/edit modal. Call once during page init.
 *
 * @param {Object} ctx
 * @param {Object} ctx.currentUser
 * @param {boolean} ctx.isManager
 * @param {Function} ctx.getEmployees      - () => employees[]
 * @param {Function} ctx.getCurrentShifts  - () => currentShifts[]
 * @param {Function} ctx.onSaveSuccess     - async () => void (reload view)
 */
export function initShiftModal(ctx) {
  _currentUser = ctx.currentUser;
  _isManager = ctx.isManager;
  _getEmployees = ctx.getEmployees;
  _getCurrentShifts = ctx.getCurrentShifts;
  _onSaveSuccess = ctx.onSaveSuccess;

  shiftModalInstance = new bootstrap.Modal(document.getElementById('shift-modal'));

  // Reset form validation state when modal closes
  document.getElementById('shift-modal').addEventListener('hidden.bs.modal', () => {
    document.getElementById('shift-form').classList.remove('was-validated');
  });

  initShiftDatePicker();

  // ── Wire all modal-internal event listeners ──────────────────────────────

  document.getElementById('shift-save-btn').addEventListener('click', () => {
    handleShiftSave();
  });

  // Team dropdown — reload employees when team changes
  document.getElementById('shift-team').addEventListener('change', async (e) => {
    const teamId = e.target.value;
    if (teamId) {
      await ctx.fetchEmployeesForTeam(teamId);
    } else {
      const select = document.getElementById('shift-employee');
      select.innerHTML = '<option value="">— Select employee —</option>';
    }
    await updateLeaveConflictWarning();
  });

  // Leave conflict + existing-shift checks
  document.getElementById('shift-employee').addEventListener('change', async (e) => {
    await loadEmployeeExistingShifts(e.target.value);
    debouncedLeaveConflictWarning();
    debouncedShiftConflictWarning();
  });
  document.getElementById('shift-date').addEventListener('change', () => {
    debouncedLeaveConflictWarning();
    debouncedShiftConflictWarning();
  });
  document.getElementById('shift-status').addEventListener('change', debouncedLeaveConflictWarning);

  // Date mode toggle
  document.querySelectorAll('input[name="shift-date-mode"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      if (e.target.checked) onDateModeChange(e.target.value);
    });
  });

  // Template suggestions — title field
  const titleInput = document.getElementById('shift-title');
  const suggestionsEl = document.getElementById('template-suggestions');

  titleInput.addEventListener('focus', async () => {
    await loadShiftTemplatesIfNeeded();
    renderTemplateSuggestions(titleInput.value);
  });

  titleInput.addEventListener('input', () => {
    renderTemplateSuggestions(titleInput.value);
  });

  // Prevent blur from firing before the chip click registers
  suggestionsEl.addEventListener('mousedown', (e) => {
    e.preventDefault();
  });

  suggestionsEl.addEventListener('click', (e) => {
    const chip = e.target.closest('.template-chip');
    if (chip) applyTemplateChip(chip);
  });

  titleInput.addEventListener('blur', () => {
    hideTemplateSuggestions();
  });

  // Shift color field
  document.getElementById('shift-color').addEventListener('input', () => {
    shiftColorEnabled = true;
    document.getElementById('shift-color-status').textContent = 'Color set';
    document.getElementById('shift-color-clear').classList.remove('d-none');
  });

  document.getElementById('shift-color-clear').addEventListener('click', () => {
    shiftColorEnabled = false;
    document.getElementById('shift-color-status').textContent = 'No color';
    document.getElementById('shift-color-clear').classList.add('d-none');
  });
}

/**
 * Open the shift modal in create (shiftId=null) or edit mode.
 */
export function openShiftModal(shiftId) {
  const form = document.getElementById('shift-form');
  form.reset();
  form.classList.remove('was-validated');

  const titleEl = document.getElementById('shift-modal-label');
  const shiftIdEl = document.getElementById('shift-id');
  const statusField = document.getElementById('status-field');
  const saveLabelEl = document.getElementById('shift-save-label');

  if (!shiftId) {
    // Create mode — reset toggle to Single
    employeeExistingShiftDates = new Set();
    const singleRadio = document.getElementById('mode-single');
    if (singleRadio) singleRadio.checked = true;
    onDateModeChange('single');
    document.getElementById('date-mode-toggle-wrap').classList.remove('d-none');

    titleEl.textContent = 'Add Shift';
    shiftIdEl.value = '';
    statusField.classList.add('d-none');
    saveLabelEl.textContent = 'Save Shift';
    // Pre-fill date with today's date
    setShiftDateValue(toDateString(new Date()));
    // Reset color field
    shiftColorEnabled = false;
    document.getElementById('shift-color-status').textContent = 'No color';
    document.getElementById('shift-color-clear').classList.add('d-none');
    hideTemplateSuggestions();
  } else {
    // Edit mode — hide toggle, force single picker
    document.getElementById('date-mode-toggle-wrap').classList.add('d-none');
    onDateModeChange('single');

    const shift = _getCurrentShifts().find((s) => s.id === shiftId);
    if (!shift) return;

    titleEl.textContent = 'Edit Shift';
    shiftIdEl.value = shift.id;
    statusField.classList.remove('d-none');
    saveLabelEl.textContent = 'Update Shift';

    if (_isManager) {
      if (shift.team_id) {
        document.getElementById('shift-team').value = shift.team_id;
      }
      document.getElementById('shift-employee').value = shift.employee_id;
    }
    document.getElementById('shift-title').value = shift.title || '';
    setShiftDateValue(shift.shift_date);
    document.getElementById('shift-start').value = shift.start_time?.slice(0, 5) || '';
    document.getElementById('shift-end').value = shift.end_time?.slice(0, 5) || '';
    document.getElementById('shift-status').value = shift.status;
    document.getElementById('shift-notes').value = shift.notes || '';
    // Restore color field
    if (shift.color) {
      shiftColorEnabled = true;
      document.getElementById('shift-color').value = shift.color;
      document.getElementById('shift-color-status').textContent = 'Color set';
      document.getElementById('shift-color-clear').classList.remove('d-none');
    } else {
      shiftColorEnabled = false;
      document.getElementById('shift-color-status').textContent = 'No color';
      document.getElementById('shift-color-clear').classList.add('d-none');
    }
    hideTemplateSuggestions();
  }

  // Clear any stale warnings
  document.getElementById('leave-conflict-warning').classList.add('d-none');
  document.getElementById('shift-conflict-warning').classList.add('d-none');
  document.getElementById('shift-save-btn').disabled = false;

  shiftModalInstance.show();
}

/**
 * Open the shift modal in create mode, pre-filled with date and employee.
 */
export function openShiftModalPrefilled(dateStr, employeeId) {
  openShiftModal(null);
  setShiftDateValue(dateStr);
  if (employeeId) {
    document.getElementById('shift-employee').value = employeeId;
    loadEmployeeExistingShifts(employeeId).then(() => updateShiftConflictWarning());
  }
}

// ── Save handler ─────────────────────────────────────────────────────────────

async function handleShiftSave() {
  const form = document.getElementById('shift-form');
  form.classList.add('was-validated');

  const dateInput = document.getElementById('shift-date');
  dateInput.setCustomValidity('');

  const dates = getShiftDateValue();
  if (dates.length === 0) {
    dateInput.setCustomValidity('Please select a date.');
    form.classList.add('was-validated');
    return;
  }

  if (!form.checkValidity()) return;

  const saveBtn = document.getElementById('shift-save-btn');
  const spinner = document.getElementById('shift-save-spinner');
  const saveLabelEl = document.getElementById('shift-save-label');
  saveBtn.disabled = true;
  spinner.classList.remove('d-none');

  const shiftId = document.getElementById('shift-id').value;
  const isEdit = Boolean(shiftId);

  const basePayload = {
    employee_id: _isManager
      ? document.getElementById('shift-employee').value
      : _currentUser.id,
    title: document.getElementById('shift-title').value.trim(),
    start_time: document.getElementById('shift-start').value,
    end_time: document.getElementById('shift-end').value,
    notes: document.getElementById('shift-notes').value.trim() || null,
    team_id: _isManager
      ? document.getElementById('shift-team').value || null
      : null,
    color: shiftColorEnabled ? document.getElementById('shift-color').value : null,
  };

  if (isEdit) {
    const payload = {
      ...basePayload,
      shift_date: dates[0],
      status: document.getElementById('shift-status').value,
    };

    const { error } = await updateShift(shiftId, payload);

    saveBtn.disabled = false;
    spinner.classList.add('d-none');

    if (error) {
      console.error('Shift save error:', error);
      if (error.message?.includes('LEAVE_CONFLICT')) {
        const warningEl = document.getElementById('leave-conflict-warning');
        warningEl.querySelector('.leave-conflict-text').textContent =
          'Cannot create shift: this employee has an approved leave during the selected date.';
        warningEl.classList.remove('d-none');
        saveBtn.disabled = true;
      } else {
        showToast(error.message || 'Could not save shift.', 'danger');
      }
      return;
    }

    shiftModalInstance.hide();
    showToast('Shift updated.', 'success');

  } else {
    // Create mode: one insert per date
    const totalDates = dates.length;
    if (totalDates > 1) {
      saveLabelEl.textContent = `Creating ${totalDates} shifts...`;
    }

    let successCount = 0;
    const errors = [];

    for (const date of dates) {
      const payload = { ...basePayload, shift_date: date, created_by: _currentUser.id };
      const { error } = await createShift(payload);
      if (error) {
        console.error(`Shift insert error for ${date}:`, error);
        errors.push({ date, error });
      } else {
        successCount++;
      }
    }

    saveBtn.disabled = false;
    spinner.classList.add('d-none');
    saveLabelEl.textContent = 'Save Shift';

    if (errors.length === 0) {
      shiftModalInstance.hide();
      const msg = totalDates === 1 ? 'Shift created.' : `${successCount} shifts created.`;
      showToast(msg, 'success');
    } else if (successCount > 0) {
      shiftModalInstance.hide();
      showToast(
        `${successCount} shift${successCount > 1 ? 's' : ''} created. ${errors.length} failed — check console for details.`,
        'warning',
        6000
      );
    } else {
      const firstError = errors[0].error;
      if (firstError.message?.includes('LEAVE_CONFLICT')) {
        const warningEl = document.getElementById('leave-conflict-warning');
        warningEl.querySelector('.leave-conflict-text').textContent =
          'Cannot create shift: this employee has an approved leave during one or more selected dates.';
        warningEl.classList.remove('d-none');
        saveBtn.disabled = true;
      } else {
        showToast(firstError.message || 'Could not create shifts.', 'danger');
      }
      return;
    }
  }

  await _onSaveSuccess();
}

// ── Date picker ──────────────────────────────────────────────────────────────

function initShiftDatePicker(mode = 'single') {
  const dateInput = document.getElementById('shift-date');
  if (!dateInput || typeof window.flatpickr !== 'function') return;

  if (shiftDatePicker) {
    shiftDatePicker.destroy();
    shiftDatePicker = null;
  }

  const commonConfig = {
    dateFormat: 'Y-m-d',
    locale: { firstDayOfWeek: 1 },
    onDayCreate: (_dObj, _dStr, _fp, dayElem) => {
      if (!dayElem.dateObj) return;
      const dateStr = toDateString(dayElem.dateObj);
      if (employeeExistingShiftDates.has(dateStr)) {
        dayElem.classList.add('has-existing-shift');
      }
    },
    onChange: () => {
      dateInput.dispatchEvent(new Event('change', { bubbles: true }));
    },
  };

  if (mode === 'range') {
    shiftDatePicker = window.flatpickr(dateInput, { ...commonConfig, mode: 'range' });
  } else if (mode === 'multiple') {
    shiftDatePicker = window.flatpickr(dateInput, { ...commonConfig, mode: 'multiple', conjunction: ', ' });
  } else {
    shiftDatePicker = window.flatpickr(dateInput, { ...commonConfig, mode: 'single' });
  }
}

function onDateModeChange(newMode) {
  shiftDateMode = newMode;
  initShiftDatePicker(newMode);

  const label = document.getElementById('shift-date-label');
  const hint = document.getElementById('shift-date-hint');
  const feedback = document.getElementById('shift-date-feedback');

  if (newMode === 'single') {
    label.textContent = 'Date';
    hint.classList.add('d-none');
    hint.textContent = '';
    feedback.textContent = 'Please select a date.';
  } else if (newMode === 'range') {
    label.textContent = 'Date Range';
    hint.textContent = 'Select a start and end date. One shift will be created for each day.';
    hint.classList.remove('d-none');
    feedback.textContent = 'Please select a date range.';
  } else {
    label.textContent = 'Dates';
    hint.textContent = 'Click individual dates to select them. One shift will be created per date.';
    hint.classList.remove('d-none');
    feedback.textContent = 'Please select at least one date.';
  }

  document.getElementById('shift-date').value = '';
  document.getElementById('leave-conflict-warning').classList.add('d-none');
  document.getElementById('shift-save-btn').disabled = false;
}

function setShiftDateValue(dateStr) {
  if (shiftDatePicker) {
    shiftDatePicker.setDate(dateStr, false, 'Y-m-d');
    return;
  }
  document.getElementById('shift-date').value = dateStr;
}

function getShiftDateValue() {
  if (!shiftDatePicker) {
    const raw = document.getElementById('shift-date').value.trim();
    return raw ? [raw] : [];
  }

  const selectedDates = shiftDatePicker.selectedDates;

  if (shiftDateMode === 'range') {
    if (selectedDates.length < 2) return [];
    const result = [];
    const cur = new Date(selectedDates[0]);
    const end = new Date(selectedDates[1]);
    cur.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    while (cur <= end) {
      result.push(toDateString(cur));
      cur.setDate(cur.getDate() + 1);
    }
    return result;
  } else if (shiftDateMode === 'multiple') {
    return selectedDates.map((d) => toDateString(d));
  } else {
    return selectedDates.length > 0 ? [toDateString(selectedDates[0])] : [];
  }
}

// ── Conflict checks ──────────────────────────────────────────────────────────

async function updateLeaveConflictWarning() {
  const warningEl = document.getElementById('leave-conflict-warning');
  const saveBtn = document.getElementById('shift-save-btn');
  const employeeId = _isManager
    ? document.getElementById('shift-employee').value
    : _currentUser.id;
  const dates = getShiftDateValue();

  // In edit mode, skip check when setting status to non-scheduled
  const statusField = document.getElementById('status-field');
  if (!statusField.classList.contains('d-none')) {
    const statusVal = document.getElementById('shift-status').value;
    if (statusVal && statusVal !== 'scheduled') {
      warningEl.classList.add('d-none');
      saveBtn.disabled = false;
      return;
    }
  }

  if (!employeeId || dates.length === 0) {
    warningEl.classList.add('d-none');
    saveBtn.disabled = false;
    return;
  }

  const minDate = dates.reduce((a, b) => a < b ? a : b);
  const maxDate = dates.reduce((a, b) => a > b ? a : b);

  const data = await checkLeaveConflicts({ employeeId, minDate, maxDate });

  if (!data || data.length === 0) {
    warningEl.classList.add('d-none');
    saveBtn.disabled = false;
    return;
  }

  const conflictingDates = dates.filter((d) =>
    data.some((lr) => d >= lr.start_date && d <= lr.end_date)
  );

  if (conflictingDates.length > 0) {
    const lr = data[0];
    const typeLabel = { sick: 'Sick Leave', vacation: 'Vacation', personal: 'Personal', other: 'Other' }[lr.leave_type] || lr.leave_type;
    const count = conflictingDates.length;
    const isSingle = shiftDateMode === 'single';
    warningEl.querySelector('.leave-conflict-text').textContent = isSingle
      ? `This employee has approved ${typeLabel} from ${lr.start_date} to ${lr.end_date}. Shifts cannot be created during this period.`
      : `${count} of the selected date${count > 1 ? 's' : ''} conflict with an approved ${typeLabel} (${lr.start_date} to ${lr.end_date}). Shifts cannot be created on those dates.`;
    warningEl.classList.remove('d-none');
    saveBtn.disabled = true;
  } else {
    warningEl.classList.add('d-none');
    saveBtn.disabled = false;
  }
}

async function loadEmployeeExistingShifts(employeeId) {
  employeeExistingShiftDates = new Set();
  if (employeeId) {
    const today = new Date();
    const fromDate = toDateString(new Date(today.getFullYear(), today.getMonth() - 1, 1));
    const toDate = toDateString(new Date(today.getFullYear() + 1, today.getMonth(), today.getDate()));

    employeeExistingShiftDates = await getEmployeeShiftDates({ employeeId, fromDate, toDate });
  }
  // Re-init picker so onDayCreate marks the freshly loaded dates
  initShiftDatePicker(shiftDateMode);
}

function updateShiftConflictWarning() {
  const warningEl = document.getElementById('shift-conflict-warning');
  // Only relevant in create mode
  if (document.getElementById('shift-id').value) {
    warningEl.classList.add('d-none');
    return;
  }

  const dates = getShiftDateValue();
  if (dates.length === 0 || employeeExistingShiftDates.size === 0) {
    warningEl.classList.add('d-none');
    return;
  }

  const conflicting = dates.filter((d) => employeeExistingShiftDates.has(d));
  if (conflicting.length > 0) {
    const count = conflicting.length;
    const dateList = conflicting.slice(0, 3).join(', ') + (conflicting.length > 3 ? '…' : '');
    warningEl.querySelector('.shift-conflict-text').textContent = shiftDateMode === 'single'
      ? `This employee already has a shift on ${conflicting[0]}.`
      : `${count} selected date${count > 1 ? 's' : ''} already have a shift: ${dateList}.`;
    warningEl.classList.remove('d-none');
  } else {
    warningEl.classList.add('d-none');
  }
}

// ── Template suggestions ─────────────────────────────────────────────────────

async function loadShiftTemplatesIfNeeded() {
  if (shiftTemplates.length > 0) return;
  shiftTemplates = await getShiftTemplates();
}

function renderTemplateSuggestions(filterText = '') {
  const container = document.getElementById('template-suggestions');
  if (!container) return;

  const lower = filterText.toLowerCase().trim();
  const filtered = lower
    ? shiftTemplates.filter((t) => t.title.toLowerCase().includes(lower))
    : shiftTemplates;

  if (filtered.length === 0) {
    container.classList.add('d-none');
    return;
  }

  container.innerHTML = filtered
    .map((t) => {
      const dotHtml = t.color
        ? `<span class="template-chip-dot" style="background-color:${escapeHtml(t.color)}"></span>`
        : '';
      return `<button
        type="button"
        class="template-chip"
        data-id="${escapeHtml(t.id)}"
        data-title="${escapeHtml(t.title)}"
        data-start="${escapeHtml(t.start_time?.slice(0, 5) || '')}"
        data-end="${escapeHtml(t.end_time?.slice(0, 5) || '')}"
        data-notes="${escapeHtml(t.notes || '')}"
        data-color="${escapeHtml(t.color || '')}"
      >${dotHtml}${escapeHtml(t.title)}</button>`;
    })
    .join('');

  container.classList.remove('d-none');
}

function applyTemplateChip(chip) {
  document.getElementById('shift-title').value = chip.dataset.title;
  document.getElementById('shift-start').value = chip.dataset.start;
  document.getElementById('shift-end').value = chip.dataset.end;
  document.getElementById('shift-notes').value = chip.dataset.notes;

  const color = chip.dataset.color;
  if (color) {
    shiftColorEnabled = true;
    document.getElementById('shift-color').value = color;
    document.getElementById('shift-color-status').textContent = 'Color set';
    document.getElementById('shift-color-clear').classList.remove('d-none');
  } else {
    shiftColorEnabled = false;
    document.getElementById('shift-color-status').textContent = 'No color';
    document.getElementById('shift-color-clear').classList.add('d-none');
  }

  hideTemplateSuggestions();
}

function hideTemplateSuggestions() {
  const container = document.getElementById('template-suggestions');
  if (container) container.classList.add('d-none');
}
