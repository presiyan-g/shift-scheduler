import { requireAuth } from '@shared/auth.js';
import { renderNavbar } from '@shared/navbar.js';
import { supabase } from '@shared/supabase.js';
import { showToast } from '@shared/toast.js';

async function init() {
  const user = await requireAuth();
  renderNavbar({ activePage: 'dashboard' });

  // 1. Fetch profile to get full_name and role
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('full_name, role')
    .eq('id', user.id)
    .single();

  if (profileError) {
    console.error('Profile fetch error:', profileError);
    showToast('Could not load profile.', 'danger');
    return;
  }

  // 2. Set welcome message
  const firstName = profile.full_name?.split(' ')[0] || 'there';
  document.getElementById('welcome-heading').textContent = `Welcome back, ${firstName}!`;

  const isManager = profile.role === 'manager' || profile.role === 'admin';

  if (isManager) {
    document.getElementById('welcome-sub').textContent = "Here's your team's schedule overview.";
  }

  // 3. Date helpers
  const today = toDateString(new Date());
  const nextWeek = getDateOffset(7);
  const lastWeek = getDateOffset(-7);
  const startOfWeek = getStartOfWeek();
  const endOfWeek = getEndOfWeek();
  const startOfMonth = getStartOfMonth();

  // 4. Fetch upcoming shifts (next 7 days, scheduled)
  let upcomingQuery = supabase
    .from('shifts')
    .select('*, employee:profiles!employee_id(full_name)')
    .gte('shift_date', today)
    .lte('shift_date', nextWeek)
    .eq('status', 'scheduled')
    .order('shift_date', { ascending: true })
    .order('start_time', { ascending: true });

  if (!isManager) {
    upcomingQuery = upcomingQuery.eq('employee_id', user.id);
  }

  const { data: upcomingShifts, error: upcomingError } = await upcomingQuery;

  if (upcomingError) {
    console.error('Shifts fetch error:', upcomingError);
    showToast('Could not load shifts.', 'danger');
    return;
  }

  // 5. Fetch recent/past shifts (last 7 days, max 5)
  let recentQuery = supabase
    .from('shifts')
    .select('*, employee:profiles!employee_id(full_name)')
    .lt('shift_date', today)
    .gte('shift_date', lastWeek)
    .order('shift_date', { ascending: false })
    .order('start_time', { ascending: false })
    .limit(5);

  if (!isManager) {
    recentQuery = recentQuery.eq('employee_id', user.id);
  }

  const { data: recentShifts, error: recentError } = await recentQuery;

  if (recentError) {
    console.error('Recent shifts fetch error:', recentError);
  }

  // 6. Compute stats

  // Upcoming count
  document.getElementById('stat-upcoming').textContent = upcomingShifts?.length ?? 0;

  // Hours this week
  let weekQuery = supabase
    .from('shifts')
    .select('start_time, end_time')
    .gte('shift_date', startOfWeek)
    .lte('shift_date', endOfWeek)
    .in('status', ['scheduled', 'completed']);

  if (!isManager) {
    weekQuery = weekQuery.eq('employee_id', user.id);
  }

  const { data: weekShifts } = await weekQuery;
  const totalHours = calcTotalHours(weekShifts || []);
  document.getElementById('stat-hours-week').textContent = totalHours.toFixed(1);

  // Completed this month
  let monthQuery = supabase
    .from('shifts')
    .select('id', { count: 'exact', head: true })
    .gte('shift_date', startOfMonth)
    .eq('status', 'completed');

  if (!isManager) {
    monthQuery = monthQuery.eq('employee_id', user.id);
  }

  const { count: completedCount } = await monthQuery;
  document.getElementById('stat-completed').textContent = completedCount ?? 0;

  // Today's shifts
  let todayQuery = supabase
    .from('shifts')
    .select('id', { count: 'exact', head: true })
    .eq('shift_date', today)
    .eq('status', 'scheduled');

  if (!isManager) {
    todayQuery = todayQuery.eq('employee_id', user.id);
  }

  const { count: todayCount } = await todayQuery;
  document.getElementById('stat-today').textContent = todayCount ?? 0;

  // 7. Render shift lists
  renderUpcomingShifts(upcomingShifts || [], isManager);
  renderRecentShifts(recentShifts || [], isManager);

  // 8. Manager banner
  if (isManager) {
    document.getElementById('manager-banner').classList.remove('d-none');
    document.getElementById('manager-team-summary').textContent =
      `${todayCount ?? 0} shift(s) scheduled for today across the team.`;
  }
}

// ── Date helpers ──

function toDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getDateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toDateString(d);
}

function getStartOfWeek() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  d.setDate(diff);
  return toDateString(d);
}

function getEndOfWeek() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? 0 : 7); // Sunday
  d.setDate(diff);
  return toDateString(d);
}

function getStartOfMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

// ── Formatting helpers ──

function calcTotalHours(shifts) {
  return shifts.reduce((sum, s) => {
    const [sh, sm] = s.start_time.split(':').map(Number);
    const [eh, em] = s.end_time.split(':').map(Number);
    let hours = (eh * 60 + em - sh * 60 - sm) / 60;
    if (hours < 0) hours += 24; // overnight shift
    return sum + hours;
  }, 0);
}

function formatTime(timeStr) {
  const [h, m] = timeStr.split(':');
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Render functions ──

function renderUpcomingShifts(shifts, isManager) {
  const container = document.getElementById('upcoming-shifts-list');
  const emptyEl = document.getElementById('upcoming-empty');
  const countBadge = document.getElementById('upcoming-count');

  countBadge.textContent = shifts.length;

  if (shifts.length === 0) {
    return;
  }

  emptyEl.classList.add('d-none');

  container.innerHTML = shifts.map(shift => `
    <div class="d-flex align-items-center px-3 py-3 border-bottom shift-row">
      <div class="me-3 text-center" style="min-width: 50px;">
        <div class="fw-bold text-primary" style="font-size: 0.85rem;">
          ${formatDate(shift.shift_date).split(', ')[0] || ''}
        </div>
        <small class="text-muted">${formatDate(shift.shift_date).split(', ')[1] || formatDate(shift.shift_date)}</small>
      </div>
      <div class="flex-grow-1">
        <div class="fw-semibold">${escapeHtml(shift.title || 'Shift')}</div>
        <small class="text-muted">
          <i class="bi bi-clock me-1"></i>${formatTime(shift.start_time)} – ${formatTime(shift.end_time)}
          ${isManager ? `<span class="ms-2"><i class="bi bi-person me-1"></i>${escapeHtml(shift.employee?.full_name || 'Unknown')}</span>` : ''}
        </small>
      </div>
      <span class="badge bg-primary-subtle text-primary rounded-pill">${shift.status}</span>
    </div>
  `).join('');
}

function renderRecentShifts(shifts, isManager) {
  const container = document.getElementById('recent-shifts-list');
  const emptyEl = document.getElementById('recent-empty');

  if (shifts.length === 0) {
    return;
  }

  emptyEl.classList.add('d-none');

  container.innerHTML = shifts.map(shift => {
    const statusColor = shift.status === 'completed' ? 'success'
      : shift.status === 'cancelled' ? 'danger'
      : 'secondary';

    return `
      <div class="px-3 py-2 border-bottom shift-row">
        <div class="d-flex justify-content-between align-items-center">
          <small class="fw-semibold">${escapeHtml(shift.title || 'Shift')}</small>
          <span class="badge bg-${statusColor}-subtle text-${statusColor} rounded-pill" style="font-size: 0.7rem;">${shift.status}</span>
        </div>
        <small class="text-muted">
          ${formatDate(shift.shift_date)} &middot; ${formatTime(shift.start_time)} – ${formatTime(shift.end_time)}
        </small>
        ${isManager ? `<br><small class="text-muted"><i class="bi bi-person"></i> ${escapeHtml(shift.employee?.full_name || '')}</small>` : ''}
      </div>
    `;
  }).join('');
}

init();
