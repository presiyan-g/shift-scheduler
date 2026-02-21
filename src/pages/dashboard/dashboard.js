import { requireAuth } from '@shared/auth.js';
import { renderNavbar } from '@shared/navbar.js';

async function init() {
  await requireAuth();
  renderNavbar({ activePage: 'dashboard' });
}

init();
