import { supabase } from '@shared/supabase.js';

/**
 * Renders the shared navbar into a container element.
 * Call this on every authenticated page after requireAuth().
 *
 * @param {object} options
 * @param {string} [options.activePage] - Current page key to highlight in nav (e.g. 'dashboard', 'schedule')
 * @param {string} [options.role] - User role ('admin' | 'employee') — controls which links are shown
 * @param {boolean} [options.isTeamManager] - Whether the user manages at least one team
 * @param {string} [options.userName] - Display name for the avatar dropdown
 * @param {string|null} [options.avatarUrl] - URL to the user's avatar image
 */
export function renderNavbar({
  activePage = '',
  role = 'employee',
  isTeamManager = false,
  userName = '',
  avatarUrl = null,
} = {}) {
  const existingNavbar = document.getElementById('main-navbar');
  if (existingNavbar) {
    existingNavbar.remove();
  }

  const navLinks = [
    { key: 'dashboard', label: 'Dashboard', href: '/dashboard', icon: 'bi-speedometer2' },
    { key: 'schedule', label: 'Schedule', href: '/schedule', icon: 'bi-calendar3' },
    { key: 'transfers', label: 'Transfers', href: '/transfers', icon: 'bi-arrow-left-right' },
    // Future pages — uncomment as they are built:
    // { key: 'leave', label: 'Leave', href: '/leave', icon: 'bi-airplane' },
  ];

  // Teams link visible to admins and team managers
  if (role === 'admin' || isTeamManager) {
    navLinks.push({ key: 'teams', label: 'Teams', href: '/teams', icon: 'bi-people' });
  }

  const linksHtml = navLinks
    .map(
      (link) =>
        `<li class="nav-item">
          <a class="nav-link${link.key === activePage ? ' active' : ''}" href="${link.href}">
            <i class="bi ${link.icon} me-1"></i>${link.label}
          </a>
        </li>`
    )
    .join('');

  const avatarHtml = buildAvatarHtml(userName, avatarUrl);
  const displayName = escapeHtml(userName) || 'Account';

  const nav = document.createElement('nav');
  nav.id = 'main-navbar';
  nav.className = 'navbar navbar-expand-lg navbar-dark bg-primary';
  nav.innerHTML = `
    <div class="container">
      <a class="navbar-brand fw-bold" href="/dashboard">
        <i class="bi bi-calendar-check me-2"></i>ShiftScheduler
      </a>
      <button class="navbar-toggler" type="button" data-bs-toggle="collapse"
              data-bs-target="#main-nav" aria-controls="main-nav"
              aria-expanded="false" aria-label="Toggle navigation">
        <span class="navbar-toggler-icon"></span>
      </button>
      <div class="collapse navbar-collapse" id="main-nav">
        <ul class="navbar-nav me-auto mb-2 mb-lg-0">
          ${linksHtml}
        </ul>
        <div class="dropdown">
          <button
            class="btn btn-link p-0 d-flex align-items-center gap-2 text-white text-decoration-none"
            type="button"
            id="user-menu-btn"
            data-bs-toggle="dropdown"
            aria-expanded="false"
          >
            <span class="navbar-avatar-bubble">
              ${avatarHtml}
            </span>
            <span class="d-none d-md-inline fw-medium small">${displayName}</span>
            <i class="bi bi-chevron-down small"></i>
          </button>
          <ul class="dropdown-menu dropdown-menu-end shadow-sm border-0" aria-labelledby="user-menu-btn">
            <li>
              <a class="dropdown-item" href="/profile">
                <i class="bi bi-person-circle me-2"></i>Profile
              </a>
            </li>
            <li>
              <a class="dropdown-item" href="/account">
                <i class="bi bi-gear me-2"></i>Account
              </a>
            </li>
            <li><hr class="dropdown-divider" /></li>
            <li>
              <button class="dropdown-item text-danger" type="button" id="logout-btn">
                <i class="bi bi-box-arrow-right me-2"></i>Log Out
              </button>
            </li>
          </ul>
        </div>
      </div>
    </div>
  `;

  document.body.prepend(nav);

  // Logout handler
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.replace('/login');
  });
}

// ── Internal helpers ────────────────────────────────────────────────────────

function buildAvatarHtml(userName, avatarUrl) {
  if (avatarUrl) {
    return `<img
      src="${escapeHtml(avatarUrl)}"
      alt="Avatar"
      class="navbar-avatar-img"
      onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"
    /><span class="navbar-avatar-initials" style="display:none">${getInitials(userName)}</span>`;
  }
  if (userName) {
    return `<span class="navbar-avatar-initials">${getInitials(userName)}</span>`;
  }
  return `<i class="bi bi-person-fill"></i>`;
}

function getInitials(name) {
  return (name ?? '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str ?? '';
  return d.innerHTML;
}
