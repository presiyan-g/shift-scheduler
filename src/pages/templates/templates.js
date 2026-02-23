import { requireAuth, getProfile } from '@shared/auth.js';
import { renderNavbar } from '@shared/navbar.js';
import { supabase } from '@shared/supabase.js';
import { showToast } from '@shared/toast.js';
import { getManagedTeams } from '@shared/teams.js';

// ── Module-level state ──────────────────────────────────────────────────────

let currentUser = null;
let userRole = 'employee';
let isAdmin = false;
let templates = [];
let pendingDeleteId = null;
let templateColorEnabled = false; // true = color should be saved; false = null

let templateModalInstance = null;
let deleteModalInstance = null;

// ── Entry point ─────────────────────────────────────────────────────────────

async function init() {
  currentUser = await requireAuth();

  renderNavbar({ activePage: 'templates' });

  const profile = await getProfile(currentUser.id);
  if (!profile) {
    showToast('Could not load profile.', 'danger');
    return;
  }

  userRole = profile.role;
  isAdmin = userRole === 'admin';

  // Only admins and team managers may access this page
  let isTeamManager = false;
  if (!isAdmin) {
    const managed = await getManagedTeams(currentUser.id);
    isTeamManager = managed.length > 0;
    if (!isTeamManager) {
      window.location.replace('/dashboard');
      return;
    }
  }

  renderNavbar({
    activePage: 'templates',
    role: userRole,
    isTeamManager,
    userName: profile.full_name,
    avatarUrl: profile.avatar_url,
  });

  templateModalInstance = new bootstrap.Modal(document.getElementById('template-modal'));
  deleteModalInstance   = new bootstrap.Modal(document.getElementById('delete-modal'));

  document.getElementById('template-modal').addEventListener('hidden.bs.modal', () => {
    document.getElementById('template-form').classList.remove('was-validated');
  });

  attachEventListeners();
  await loadTemplates();
}

// ── Event listeners ─────────────────────────────────────────────────────────

function attachEventListeners() {
  document.getElementById('create-template-btn').addEventListener('click', () => openTemplateModal(null));
  document.getElementById('template-save-btn').addEventListener('click', handleTemplateSave);
  document.getElementById('confirm-delete-btn').addEventListener('click', handleDeleteConfirm);

  // Color enable/disable
  document.getElementById('template-color').addEventListener('input', () => {
    templateColorEnabled = true;
    document.getElementById('template-color-status').textContent = 'Color set';
    document.getElementById('template-color-clear').classList.add('d-none');
  });

  document.getElementById('template-color-clear').addEventListener('click', () => {
    templateColorEnabled = false;
    document.getElementById('template-color-status').textContent = 'No color';
    document.getElementById('template-color-clear').classList.add('d-none');
  });

  // Delegated clicks on grid (edit / delete buttons)
  document.getElementById('templates-grid').addEventListener('click', (e) => {
    const editBtn   = e.target.closest('.edit-template-btn');
    const deleteBtn = e.target.closest('.delete-template-btn');
    if (editBtn)   openTemplateModal(editBtn.dataset.templateId);
    if (deleteBtn) openDeleteModal(deleteBtn.dataset.templateId);
  });
}

// ── Data loading ─────────────────────────────────────────────────────────────

async function loadTemplates() {
  const { data, error } = await supabase
    .from('shift_templates')
    .select('*')
    .order('title', { ascending: true });

  if (error) {
    console.error('Templates fetch error:', error);
    showToast('Could not load templates.', 'danger');
    return;
  }

  templates = data || [];
  renderTemplateGrid();
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderTemplateGrid() {
  const grid    = document.getElementById('templates-grid');
  const emptyEl = document.getElementById('templates-empty');

  if (templates.length === 0) {
    grid.innerHTML = '';
    emptyEl.classList.remove('d-none');
    return;
  }

  emptyEl.classList.add('d-none');
  grid.innerHTML = templates.map((t) => buildTemplateCardHtml(t)).join('');
}

function buildTemplateCardHtml(template) {
  const colorDot = template.color
    ? `<span class="template-color-dot me-2 flex-shrink-0" style="background-color:${escapeHtml(template.color)}"></span>`
    : '';

  const timeLabel = `${formatTime(template.start_time)} – ${formatTime(template.end_time)}`;
  const notesHtml = template.notes
    ? `<p class="text-muted small mb-2 text-truncate" title="${escapeHtml(template.notes)}">${escapeHtml(template.notes)}</p>`
    : '';

  return `
    <div class="col-12 col-sm-6 col-lg-4">
      <div class="card border-0 shadow-sm template-card h-100">
        <div class="card-body">
          <div class="d-flex align-items-start justify-content-between gap-2 mb-1">
            <div class="d-flex align-items-center min-w-0">
              ${colorDot}
              <h5 class="fw-bold mb-0 text-truncate">${escapeHtml(template.title)}</h5>
            </div>
            <i class="bi bi-layout-text-sidebar-reverse text-primary fs-5 flex-shrink-0"></i>
          </div>
          <p class="text-muted small mb-1">
            <i class="bi bi-clock me-1"></i>${timeLabel}
          </p>
          ${notesHtml}
          <div class="d-flex gap-1 mt-2">
            <button class="btn btn-sm btn-outline-secondary edit-template-btn"
                    data-template-id="${template.id}" type="button">
              <i class="bi bi-pencil me-1"></i>Edit
            </button>
            <button class="btn btn-sm btn-outline-danger delete-template-btn"
                    data-template-id="${template.id}" type="button">
              <i class="bi bi-trash me-1"></i>Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ── Modal: Create / Edit ─────────────────────────────────────────────────────

function openTemplateModal(templateId) {
  const form = document.getElementById('template-form');
  form.reset();
  form.classList.remove('was-validated');

  if (!templateId) {
    // Create mode
    document.getElementById('template-modal-label').textContent = 'New Template';
    document.getElementById('template-id').value = '';
    document.getElementById('template-save-label').textContent = 'Create Template';
    // Default: no color
    templateColorEnabled = false;
    document.getElementById('template-color-status').textContent = 'No color';
    document.getElementById('template-color-clear').classList.add('d-none');
  } else {
    // Edit mode
    const template = templates.find((t) => t.id === templateId);
    if (!template) return;

    document.getElementById('template-modal-label').textContent = 'Edit Template';
    document.getElementById('template-id').value    = template.id;
    document.getElementById('template-title').value = template.title;
    document.getElementById('template-start').value = template.start_time?.slice(0, 5) || '';
    document.getElementById('template-end').value   = template.end_time?.slice(0, 5) || '';
    document.getElementById('template-notes').value = template.notes || '';
    document.getElementById('template-save-label').textContent = 'Update Template';

    if (template.color) {
      templateColorEnabled = true;
      document.getElementById('template-color').value = template.color;
      document.getElementById('template-color-status').textContent = 'Color set';
      document.getElementById('template-color-clear').classList.remove('d-none');
    } else {
      templateColorEnabled = false;
      document.getElementById('template-color-status').textContent = 'No color';
      document.getElementById('template-color-clear').classList.add('d-none');
    }
  }

  templateModalInstance.show();
}

async function handleTemplateSave() {
  const form = document.getElementById('template-form');
  form.classList.add('was-validated');
  if (!form.checkValidity()) return;

  const saveBtn = document.getElementById('template-save-btn');
  const spinner = document.getElementById('template-save-spinner');
  saveBtn.disabled = true;
  spinner.classList.remove('d-none');

  const templateId = document.getElementById('template-id').value;
  const isEdit     = Boolean(templateId);

  const payload = {
    title:      document.getElementById('template-title').value.trim(),
    start_time: document.getElementById('template-start').value,
    end_time:   document.getElementById('template-end').value,
    notes:      document.getElementById('template-notes').value.trim() || '',
    color:      templateColorEnabled ? document.getElementById('template-color').value : null,
  };

  if (!isEdit) {
    payload.created_by = currentUser.id;
  }

  const { error } = isEdit
    ? await supabase.from('shift_templates').update(payload).eq('id', templateId)
    : await supabase.from('shift_templates').insert(payload);

  saveBtn.disabled = false;
  spinner.classList.add('d-none');

  if (error) {
    console.error('Template save error:', error);
    showToast(error.message || 'Could not save template.', 'danger');
    return;
  }

  templateModalInstance.hide();
  showToast(isEdit ? 'Template updated.' : 'Template created.', 'success');
  await loadTemplates();
}

// ── Modal: Delete ────────────────────────────────────────────────────────────

function openDeleteModal(templateId) {
  pendingDeleteId = templateId;
  const template  = templates.find((t) => t.id === templateId);
  document.getElementById('delete-template-name').textContent = template?.title || 'this template';
  deleteModalInstance.show();
}

async function handleDeleteConfirm() {
  const confirmBtn = document.getElementById('confirm-delete-btn');
  const spinner    = document.getElementById('delete-spinner');
  confirmBtn.disabled = true;
  spinner.classList.remove('d-none');

  const { error } = await supabase
    .from('shift_templates')
    .delete()
    .eq('id', pendingDeleteId);

  confirmBtn.disabled = false;
  spinner.classList.add('d-none');

  if (error) {
    console.error('Template delete error:', error);
    showToast(error.message || 'Could not delete template.', 'danger');
    return;
  }

  deleteModalInstance.hide();
  pendingDeleteId = null;
  showToast('Template deleted.', 'success');
  await loadTemplates();
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(timeStr) {
  if (!timeStr) return '—';
  const [h, m] = timeStr.split(':');
  const hour   = parseInt(h, 10);
  const ampm   = hour >= 12 ? 'PM' : 'AM';
  const h12    = hour % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

// ── Start ────────────────────────────────────────────────────────────────────

init();
