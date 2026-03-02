# copilot-instructions.md — Shift Scheduler

## Project Overview

Shift Scheduler is a web app for small companies (10–50 employees) to manage work shifts, time-off requests, and shift transfers. Managers create and assign shifts; employees view schedules and submit requests. An admin oversees the organization.

## Tech Stack

| Layer           | Technology                                   |
| --------------- | -------------------------------------------- |
| Frontend        | HTML, CSS, vanilla JavaScript, Bootstrap 5   |
| Backend         | Supabase (Postgres, Auth, Storage, REST API) |
| Build           | Node.js, npm, Vite                           |
| Deployment      | Netlify (or Vercel)                          |
| Version control | Git + GitHub                                 |

**No TypeScript. No frontend frameworks (React, Vue, Angular, etc.).**

## Architecture

```
Browser  ──REST API──▶  Supabase (Postgres + Auth + Storage)
```

- **Multi-page application (MPA)**: each screen is a separate HTML file with clean URL paths (`/dashboard`, not `/#/dashboard`). NOT a single-page app.
- **Vite** for dev server, bundling, hot reload, and multi-page entry points.
- **Supabase Auth** for authentication (email/password); **Supabase Storage** for file uploads.
- **`@supabase/supabase-js`** client library for all DB/Auth/Storage operations — never raw SQL from the frontend.
- **RLS-first security** — never trust the client. All access control is enforced at the DB level via Row Level Security policies.

## Modular Design

The app follows a **component-based, modular architecture**:

- Each component has a **single responsibility** with minimal dependencies on other components.
- Each component lives in its own file/folder — less code per file, less complexity, fewer bugs, easier to maintain.
- **Pages**: one folder per page under `src/pages/`, containing co-located HTML + JS + CSS. Each page imports only the shared modules it needs.
- **Shared components**: reusable UI elements (navbar, avatar, toast) each own their HTML structure, CSS, and JS behavior — built once, used everywhere.
- **Services**: domain logic (shifts, teams, leave, transfers) abstracted into dedicated modules under `src/shared/services/`.
- **No monolith scripts.** No god-files. If a module grows too large, split it.

## Project Structure

```
src/
├── pages/
│   ├── index/          ← landing page (index.html, index.js, index.css)
│   ├── login/          ← login
│   ├── register/       ← registration
│   ├── dashboard/      ← employee dashboard (my shifts, requests)
│   ├── schedule/       ← team schedule (calendar/list)
│   ├── transfers/      ← shift transfer requests
│   ├── leave/          ← time-off requests
│   └── profile/        ← user profile & settings
└── shared/             ← reusable modules (NOT a page)
    ├── supabase.js     ← single Supabase client instance
    ├── auth/           ← auth helpers & styles
    ├── components/     ← navbar/, avatar/, toast/ etc.
    ├── services/       ← shifts.js, teams.js, leave.js, transfers.js
    └── utils/          ← formatting & string utilities
```

New pages follow the same pattern: create a folder under `src/pages/`, add HTML + JS + CSS inside it.

Environment variables are prefixed with `VITE_` (e.g. `.env` contains `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).

## UI Guidelines

- **Bootstrap 5** for layout, grid, forms, buttons, modals, cards — minimize custom CSS.
- **Bootstrap Icons** for visual cues.
- **Responsive**: mobile-first. Schedule view must work on phones.
- **Toasts** for success/error feedback — never `alert()`.
- Consistent navbar across authenticated pages with role-aware links.
- Modern design with semantic HTML, consistent color scheme and typography.

## Coding Standards

- **Vanilla JS** with ES modules (`import`/`export`) — Vite handles bundling.
- `async/await` for all Supabase calls.
- `const`/`let` only — never `var`.
- Handle errors gracefully: user-friendly toasts + `console.error()` for details.
- Small, focused commits — each change should be testable and meaningful.

## Database Migrations — Hard Rules

All schema changes (tables, columns, indexes, RLS policies, triggers, functions, enums) **must** be tracked as SQL migration files under `supabase/migrations/`. No exceptions.

1. **Every schema change requires a migration file.** Never apply DDL without creating the `.sql` file locally.
2. **Always use `apply_migration`** (never `execute_sql`) so Supabase records the version in `supabase_migrations.schema_migrations`.
3. **After every `apply_migration`**, immediately write the same SQL to `supabase/migrations/<version>_<name>.sql`.
4. **Local files must match Supabase exactly.** Same versions, names, and SQL content.
5. **Commit migration files immediately** — never leave them out of a commit.
6. **Never apply schema changes manually** (dashboard SQL editor, etc.) without a migration file. If already done, create the file retroactively first.
7. **Verify parity before finishing DB work.** Compare remote migration history vs local files; resolve drift before marking tasks complete.
8. If parity cannot be verified, explicitly report the blocker — do not claim schema changes are complete.

**File naming:** `<timestamp>_<snake_case_description>.sql` (e.g. `20260221125524_create_profiles_table.sql`).

## AI Agent Rules

1. Follow the project structure — don't create files outside the conventions above.
2. Use the Supabase MCP (`.mcp.json`) for all database schema changes.
3. Follow the Database Migration rules above — they are **hard rules**, not guidelines.
4. Apply RLS thinking — all access control at the DB level, never trust the client.
5. Every Supabase call must have error handling with user-facing feedback.
