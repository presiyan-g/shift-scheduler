import { supabase } from '@shared/supabase.js';
import { clearSessionCache } from '@shared/auth.js';

/**
 * Renders the shared navbar into a container element.
 * Call this on every authenticated page after requireAuth().
 *
 * @param {object} options
 * @param {string} [options.activePage] - Current page key to highlight in nav (e.g. 'dashboard', 'schedule')
 * @param {string} [options.role] - User role ('admin' | 'employee') — controls which links are shown
 * @param {boolean} [options.isTeamManager] - Whether the user manages at least one team
 * @param {string} [options.userName] - Display name for the avatar menu
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
    { key: 'leave', label: 'Leave', href: '/leave', icon: 'bi-airplane' },
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
  const mobileUserMenuHtml = `
    <li class="nav-item d-lg-none user-inline-item">
      <button
        class="nav-link w-100 text-start border-0 bg-transparent d-flex align-items-center gap-2"
        type="button"
        id="mobile-user-menu-btn"
        data-bs-toggle="collapse"
        data-bs-target="#mobile-user-menu"
        aria-expanded="false"
        aria-controls="mobile-user-menu"
      >
        <span class="navbar-avatar-bubble">${avatarHtml}</span>
        <span class="fw-medium">${displayName}</span>
        <i class="bi bi-chevron-down small ms-auto"></i>
      </button>
      <div class="collapse" id="mobile-user-menu">
        <ul class="navbar-nav mobile-user-submenu ps-2 pb-2">
          <li class="nav-item">
            <a class="nav-link" href="/profile">
              <i class="bi bi-person-circle me-2"></i>Profile
            </a>
          </li>
          <li class="nav-item">
            <a class="nav-link" href="/account">
              <i class="bi bi-gear me-2"></i>Account
            </a>
          </li>
          <li class="nav-item">
            <button class="nav-link text-danger border-0 bg-transparent text-start w-100" type="button" id="logout-btn-mobile">
              <i class="bi bi-box-arrow-right me-2"></i>Log Out
            </button>
          </li>
        </ul>
      </div>
    </li>
  `;

  const nav = document.createElement('nav');
  nav.id = 'main-navbar';
  nav.className = 'navbar navbar-expand-lg navbar-dark bg-primary';
  nav.innerHTML = `
    <div class="container-fluid px-4 px-xl-5">
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
          ${mobileUserMenuHtml}
        </ul>
        <div class="dropdown user-menu-dropdown d-none d-lg-block">
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
          <ul class="dropdown-menu dropdown-menu-lg-end shadow-sm border-0" aria-labelledby="user-menu-btn">
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
              <button class="dropdown-item text-danger" type="button" id="logout-btn-desktop">
                <i class="bi bi-box-arrow-right me-2"></i>Log Out
              </button>
            </li>
          </ul>
        </div>
      </div>
    </div>
  `;

  document.body.prepend(nav);

  const handleLogout = async () => {
    clearSessionCache();
    await supabase.auth.signOut();
    window.location.replace('/login');
  };

  document.getElementById('logout-btn-desktop')?.addEventListener('click', handleLogout);
  document.getElementById('logout-btn-mobile')?.addEventListener('click', handleLogout);
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
