# copilot-instructions.md — Shift Scheduler

## Project Overview

**Shift Scheduler** is a web application for small companies (10–50 employees) to manage work shifts, time-off requests, and shift swaps. Managers create and assign shifts; employees view their schedules and submit requests. An admin oversees the entire organization.

**Target users:** Small restaurants, retail shops, clinics, warehouses — any team that runs on shifts.

## Tech Stack

| Layer        | Technology                                      |
| ------------ | ----------------------------------------------- |
| Frontend     | HTML, CSS, JavaScript (vanilla), Bootstrap 5    |
| Backend      | Supabase (Database, Auth, Storage, REST API)    |
| Build tools  | Node.js, npm, Vite                              |
| Deployment   | Netlify (or Vercel)                             |
| Version control | Git + GitHub                                 |

**No TypeScript. No frontend frameworks (React, Vue, Angular, etc.).**

## Architecture

```
Client (Browser)  ──REST API──▶  Supabase (Postgres + Auth + Storage)
```

- **Client-server architecture**: vanilla JS frontend communicates with Supabase via its REST API / JS client library (`@supabase/supabase-js`).
- **Multi-page application (MPA)**: each screen is a separate HTML file, NOT a single-page app with hash routing.
- **Vite** is used as the dev server and build tool — it handles module bundling, hot reload, and multi-page entry points.
- **Supabase Auth** for authentication (email/password).
- **Supabase Storage** for file uploads (avatars, documents, any other files).

## Project Structure

### Key conventions

- **Use modular design**
- **One page = one HTML file + one co-located or imported JS module.** No monolith scripts.
- For each page/feature, create a dedicated folder that contains all related files
- **CSS**: Bootstrap 5 via CDN or npm, plus a single `styles.css` for custom overrides.
- **Environment variables**: prefixed with `VITE_` so Vite exposes them to client code.


## Key Pages (planned — may evolve)

- Landing page (index.html) - includes login and register
- Dashboard (my shifts, my pending requests)
- Team schedule (calendar/list view)
- Swap requests, Leave requests
- Profile

## Pages and Navigation
- Split the app into multiple HTML pages.
- Implement pages as reusable components.
- Use routing to navigate between pages.
- Use full URL paths (e.g. `/dashboard.html`) instead of hash-based routing.

## UI Guidelines

- **Bootstrap 5** for layout, grid, forms, buttons, modals, and cards.
- **Bootstrap Icons** (or Font Awesome) for visual cues.
- **Responsive design**: mobile-first. The schedule view should work on phones.
- **Toasts** for success/error feedback (not `alert()`).
- **Consistent navbar** across all authenticated pages with role-aware links.
- Use modern and beautiful design with semantic HTML.
- Use consistent color scheme and typography.

## Coding Standards

- **Vanilla JavaScript** with ES modules (`import`/`export`).
- **No TypeScript, no JSX, no frontend frameworks.**
- Use `async/await` for all Supabase calls.
- Handle errors gracefully — show user-friendly messages, log details to console.
- Use `const`/`let` (never `var`).
- Use modular code structure.



## AI Agent Instructions

When working on this project, the AI assistant should:

1. **Follow the project structure** defined above. Don't create files outside the convention.
2. **Use vanilla JS only** — no TypeScript, no React/Vue/Angular.
3. **Use ES modules** (`import`/`export`) — Vite handles bundling.
4. **Always use Supabase client library** for DB/Auth/Storage operations — never raw SQL from the frontend.
5. **Apply RLS thinking** — never trust the client. All access control is enforced at the DB level.
6. **Create migrations** for any schema change — never modify the DB manually without a migration file.
7. **Keep pages modular** — each page imports only the modules it needs.
8. **Use Bootstrap 5 classes** for styling — minimize custom CSS.
9. **Handle all errors** — every Supabase call should have error handling with user-facing feedback.
10. **Write commit-friendly code** — each change should be small, testable, and meaningful.