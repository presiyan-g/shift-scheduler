# Shift Scheduler

A lightweight web app for small teams (10–50 employees) to manage work shifts, time-off requests, and shift transfers.

## Features

- **Shift management** — team managers create, assign, and template shifts
- **Team schedule** — calendar view of the full team's schedule
- **Shift templates** — reusable shift presets for faster scheduling
- **Leave requests** — employees submit time-off; team managers approve or deny
- **Shift transfers** — 3-step approval workflow (request → accept → manager approval)
- **Admin panel** — search, filter, and manage all users; toggle active/inactive status
- **Role-based access** — org roles and per-team roles enforce what each user can see and do

## Tech Stack

- **Frontend** — Vanilla JS, HTML, CSS, Bootstrap 5 (no frameworks)
- **Backend** — [Supabase](https://supabase.com) (Postgres, Auth, Storage, REST)
- **Build tool** — Vite
- **Deployment** — Netlify

## Getting Started

### Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project

### Setup

1. **Clone the repo**
   ```bash
   git clone https://github.com/your-username/shift-scheduler.git
   cd shift-scheduler
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment**

   Create a `.env` file in the project root:
   ```env
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```

4. **Apply database migrations**

   Run each file in `supabase/migrations/` against your Supabase project in order.

5. **Start the dev server**
   ```bash
   npm run dev
   ```

6. **Build for production**
   ```bash
   npm run build
   ```

## Project Structure

```
src/
├── pages/
│   ├── dashboard/     # Employee dashboard
│   ├── schedule/      # Team schedule calendar
│   ├── transfers/     # Shift transfer requests
│   ├── leave/         # Leave / time-off requests
│   ├── templates/     # Shift templates
│   ├── teams/         # Team management
│   ├── admin/         # Admin panel
│   ├── profile/       # User profile & settings
│   └── account/       # Account settings
└── shared/            # Supabase client, auth helpers, navbar, toasts
supabase/
└── migrations/        # SQL migration files (source of truth for DB schema)
```

## Roles

The app uses two independent role systems.

**Org-level roles** — assigned globally to each user:

| Role | Description |
|------|-------------|
| Super Admin | Full platform access; manages all users and org settings |
| Admin | Manages teams, users, and org-wide configuration |
| Employee | Self-service access: view schedule, submit requests |

**Team-level roles** — assigned per team, independent of org role:

| Role | Description |
|------|-------------|
| Manager | Creates/assigns shifts and approves requests for that team |
| Member | Views the team schedule and submits leave/transfer requests |

> An employee can be a Manager in Team A and a Member in Team B — team role is independent of org role.

## License

MIT
