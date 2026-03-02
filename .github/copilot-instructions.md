# copilot-instructions.md — Shift Scheduler

## Project Overview

**Shift Scheduler** is a web application for small companies (10–50 employees) to manage work shifts, time-off requests, and shift transfers. Managers create and assign shifts; employees view their schedules and submit requests. An admin oversees the entire organization.

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
- For each page/feature, create a dedicated folder that contains all related files (HTML, JS, CSS together — never split by file type)
- **CSS**: Bootstrap 5 via CDN or npm, plus a per-page or shared `styles.css` for custom overrides.
- **Environment variables**: prefixed with `VITE_` so Vite exposes them to client code.

### Folder structure

```
shift-scheduler/
├── src/
│   ├── pages/
│   │   ├── index/              ← public landing / marketing page
│   │   │   ├── index.html
│   │   │   ├── index.js
│   │   │   └── index.css
│   │   ├── login/              ← login page
│   │   │   ├── login.html
│   │   │   ├── login.js
│   │   │   └── login.css
│   │   ├── register/           ← registration page
│   │   │   ├── register.html
│   │   │   ├── register.js
│   │   │   └── register.css
│   │   ├── dashboard/          ← employee dashboard (my shifts, pending requests)
│   │   │   ├── dashboard.html
│   │   │   ├── dashboard.js
│   │   │   └── dashboard.css
│   │   ├── schedule/           ← team schedule (calendar/list view)
│   │   │   ├── schedule.html
│   │   │   ├── schedule.js
│   │   │   └── schedule.css
│   │   ├── transfers/              ← shift transfer requests
│   │   │   ├── transfers.html
│   │   │   ├── transfers.js
│   │   │   └── transfers.css
│   │   ├── leave/              ← time-off / leave requests
│   │   │   ├── leave.html
│   │   │   ├── leave.js
│   │   │   └── leave.css
│   │   └── profile/            ← user profile & settings
│   │       ├── profile.html
│   │       ├── profile.js
│   │       └── profile.css
│   └── shared/                 ← reusable modules (NOT a page)
│       ├── supabase.js         ← Supabase client initialisation (single instance)
│       ├── auth/               ← auth helpers & shared auth styles
│       │   ├── auth.js
│       │   └── auth.css
│       ├── components/         ← reusable UI components
│       │   ├── navbar/
│       │   │   ├── navbar.js
│       │   │   └── navbar.css
│       │   ├── avatar/
│       │   │   ├── avatar.js
│       │   │   └── avatar.css
│       │   └── toast/
│       │       └── toast.js
│       ├── services/           ← domain data services
│       │   ├── shifts.js
│       │   ├── teams.js
│       │   ├── leave.js
│       │   └── transfers.js
│       └── utils/              ← formatting & string utilities
│           └── formatting.js
├── .env                        ← VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
├── vite.config.js
└── package.json
```

> New pages follow the same pattern: create a new folder under `src/`, add the HTML/JS/CSS inside it.

## Key Pages (planned — may evolve)

- Landing page (`/`) — public marketing page
- Login page (`/login`) — email/password sign-in
- Register page (`/register`) — new account creation
- Dashboard (my shifts, my pending requests)
- Team schedule (calendar/list view)
- Transfer requests, Leave requests
- Profile

## Database Migrations

**This is a hard rule for the project. No exceptions.**

All database schema changes (tables, columns, indexes, RLS policies, triggers, functions, enums) must be tracked as SQL migration files under `supabase/migrations/`. These files are committed to Git and serve as the single source of truth for the database schema — both for documentation and for reproducibility.

### Rules

- **Every schema change requires a migration file.** Never apply a schema change in Supabase without also creating the corresponding `.sql` file locally.
- **Local files must match Supabase exactly.** The migrations listed in Supabase (`supabase_migrations.schema_migrations`) and the files in `supabase/migrations/` must always be identical — same versions, same names, same SQL.
- **Migration files are committed immediately.** Any time a migration is applied to Supabase, the matching local file is committed to Git in the same change. Never leave them out of a commit.
- **Never apply schema changes manually** (via the Supabase dashboard SQL editor or any other tool) without also creating the migration file. If a manual change was already made, export its SQL and create the file retroactively before doing any further work.
- **Verify parity before finishing DB work.** Before marking any DB-related task complete, compare remote migration history vs local files. If they differ, resolve the drift first.
- **File naming:** `<timestamp>_<snake_case_description>.sql` — e.g. `20260221125524_create_profiles_table.sql`. Use the same timestamp format Supabase uses.

### Folder

```
supabase/
└── migrations/
    ├── 20260221125524_create_profiles_table.sql
    ├── 20260221125549_fix_update_updated_at_search_path.sql
    └── ...  ← every future migration goes here
```

> When using the Supabase MCP to apply a migration, always use `apply_migration` (not `execute_sql`) so the version is recorded in `supabase_migrations.schema_migrations`. Then immediately write the same SQL to a local file and commit it.

---

## Pages and Navigation
- Split the app into multiple HTML pages.
- Use routing to navigate between pages.
- Use clean URL paths (e.g. `/dashboard`) instead of hash-based routing.

## UI Guidelines

- Build **shared UI elements** once and reuse them across pages rather than duplicating markup. This includes the navbar, footer, and any other elements that appear on multiple pages. Each component should own its own HTML structure, CSS styles, and JS behavior.
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
11. Use the Supabase MCP config in `.vscode/mcp.json`for any database schema changes, including creating tables, defining RLS policies, and setting up relationships.
12. **Follow the Database Migrations rules** (see dedicated section above) — they are hard project rules, not optional guidelines.
13. **Always use `apply_migration`** (never `execute_sql`) for DDL so Supabase records the version in `supabase_migrations.schema_migrations`.
14. **After every `apply_migration` call**, immediately write the same SQL to `supabase/migrations/<version>_<name>.sql` and include it in the same Git commit.
15. **Verify migration parity** before finishing any DB-related task: check that every version in `supabase_migrations.schema_migrations` has a matching local file and vice versa. Resolve any drift before marking the task complete.
16. If migration parity cannot be verified (missing access, missing credentials, CLI/MCP failure), explicitly report the blocker and do not claim schema changes are complete.



