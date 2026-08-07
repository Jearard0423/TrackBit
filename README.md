# TrackBit

Minimal starter scaffold for TrackBit — a personal plan organizer.

Getting started:

1. Copy `.env.example` to `.env` and fill in your Supabase project values.
2. Install dependencies:

```bash
npm install
```

3. Run dev server:

```bash
npm run dev
```

4. Run the SQL in `sql/schema.sql` inside the Supabase SQL editor to create tables and RLS policies.

This repository contains a minimal React + Vite app with Login, Register, and a Dashboard wired to Supabase.
# TrackBit
TrackBit is a plan organizer application where you set and plan your tasks for everyday workload.

Security
 - If you accidentally shared a Supabase service key (like `service_role`), rotate it immediately in the Supabase dashboard.
 - Never store `service_role` or other secret keys in client-side env vars (those starting with `VITE_`) — those are exposed to browsers.
 - For development, keep secrets in a local `.env` (this repo ignores `.env`) and never commit it.
 - Use server-side environment variables or Supabase Edge Functions for privileged operations that require the `service_role` key.

If a secret was leaked, create a new key in the Supabase project settings and replace the leaked key wherever it's used (local `.env` or your hosting provider's secret store).

Branding / logo
- Put your provided logo image into `/public/logo.png`. The app will load it as the top-left logo and favicon.

