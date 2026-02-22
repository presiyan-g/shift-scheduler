import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Maps clean URLs to their source HTML files for the dev server.
const pageRewrites = {
  '/':          '/src/pages/index/index.html',
  '/index':     '/src/pages/index/index.html',
  '/login':     '/src/pages/login/login.html',
  '/register':  '/src/pages/register/register.html',
  '/dashboard': '/src/pages/dashboard/dashboard.html',
  '/schedule':  '/src/pages/schedule/schedule.html',
  '/teams':     '/src/pages/teams/teams.html',
  '/profile':   '/src/pages/profile/profile.html',
  '/account':   '/src/pages/account/account.html',
  '/transfers': '/src/pages/transfers/transfers.html',
  '/leave':     '/src/pages/leave/leave.html',
};

// Redirect legacy .html routes to clean paths so URLs stay extensionless.
const legacyPathRedirects = {
  '/index.html':     '/',
  '/login.html':     '/login',
  '/register.html':  '/register',
  '/dashboard.html': '/dashboard',
  '/schedule.html':  '/schedule',
  '/teams.html':     '/teams',
  '/profile.html':   '/profile',
  '/account.html':   '/account',
  '/transfers.html': '/transfers',
  '/leave.html':     '/leave',
};

const rewritePlugin = {
  name: 'page-rewrites',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const originalUrl = req.url ?? '/';
      const [pathname, query = ''] = originalUrl.split('?');
      const redirectPath = legacyPathRedirects[pathname];

      if (redirectPath) {
        const target = query ? `${redirectPath}?${query}` : redirectPath;
        res.statusCode = 301;
        res.setHeader('Location', target);
        res.end();
        return;
      }

      const rewrittenPath = pageRewrites[pathname];
      if (rewrittenPath) {
        req.url = query ? `${rewrittenPath}?${query}` : rewrittenPath;
      }

      next();
    });
  },
};

export default defineConfig({
  root: '.',
  publicDir: 'public',
  plugins: [rewritePlugin],
  server: {
    open: '/',
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main:      resolve(__dirname, 'src/pages/index/index.html'),
        login:     resolve(__dirname, 'src/pages/login/login.html'),
        register:  resolve(__dirname, 'src/pages/register/register.html'),
        dashboard: resolve(__dirname, 'src/pages/dashboard/dashboard.html'),
        schedule:  resolve(__dirname, 'src/pages/schedule/schedule.html'),
        teams:     resolve(__dirname, 'src/pages/teams/teams.html'),
        profile:   resolve(__dirname, 'src/pages/profile/profile.html'),
        account:   resolve(__dirname, 'src/pages/account/account.html'),
        transfers: resolve(__dirname, 'src/pages/transfers/transfers.html'),
        leave:     resolve(__dirname, 'src/pages/leave/leave.html'),
      },
    },
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
});
