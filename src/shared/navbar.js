import { supabase } from '@shared/supabase.js';

/**
 * Renders the shared navbar into a container element.
 * Call this on every authenticated page after requireAuth().
 *
 * @param {object} options
 * @param {string} [options.activePage] - Current page key to highlight in nav (e.g. 'dashboard', 'schedule')
 * @param {string} [options.role] - User role ('admin' | 'employee') — controls which links are shown
 * @param {boolean} [options.isTeamManager] - Whether the user manages at least one team
 */
export function renderNavbar({ activePage = '', role = 'employee', isTeamManager = false } = {}) {
  const existingNavbar = document.getElementById('main-navbar');
  if (existingNavbar) {
    existingNavbar.remove();
  }

  const navLinks = [
    { key: 'dashboard', label: 'Dashboard', href: '/dashboard.html', icon: 'bi-speedometer2' },
    { key: 'schedule', label: 'Schedule', href: '/schedule.html', icon: 'bi-calendar3' },
    // Future pages — uncomment as they are built:
    // { key: 'swaps', label: 'Swaps', href: '/swaps.html', icon: 'bi-arrow-left-right' },
    // { key: 'leave', label: 'Leave', href: '/leave.html', icon: 'bi-airplane' },
    // { key: 'profile', label: 'Profile', href: '/profile.html', icon: 'bi-person-circle' },
  ];

  // Teams link visible to admins and team managers
  if (role === 'admin' || isTeamManager) {
    navLinks.push({ key: 'teams', label: 'Teams', href: '/teams.html', icon: 'bi-people' });
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

  const nav = document.createElement('nav');
  nav.id = 'main-navbar';
  nav.className = 'navbar navbar-expand-lg navbar-dark bg-primary';
  nav.innerHTML = `
    <div class="container">
      <a class="navbar-brand fw-bold" href="/dashboard.html">
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
        <button id="logout-btn" class="btn btn-outline-light btn-sm">
          <i class="bi bi-box-arrow-right me-1"></i>Log Out
        </button>
      </div>
    </div>
  `;

  document.body.prepend(nav);

  // Logout handler
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.replace('/login.html');
  });
}
