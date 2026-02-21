import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Maps clean URLs to their source HTML files so the dev server
// can serve /login.html → src/pages/login/login.html, etc.
const pageRewrites = {
  '/':               '/src/pages/index/index.html',
  '/index.html':     '/src/pages/index/index.html',
  '/login.html':     '/src/pages/login/login.html',
  '/register.html':  '/src/pages/register/register.html',
  '/dashboard.html': '/src/pages/dashboard/dashboard.html',
  '/schedule.html':  '/src/pages/schedule/schedule.html',
};

const rewritePlugin = {
  name: 'page-rewrites',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url in pageRewrites) {
        req.url = pageRewrites[req.url];
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
      },
    },
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
});
