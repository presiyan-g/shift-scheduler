Keep all SQL migration files in this directory.

Rules:
- Every schema/RLS/function/trigger change must produce a migration SQL file here.
- Local `supabase/migrations` and remote Supabase migration history must match.
- Pull/export remote migration SQL into this directory immediately after remote-only changes.
