-- Supabase schema for TrackBit
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

create table if not exists plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null,
  date timestamptz,
  created_at timestamptz default now()
);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  plan_id uuid,
  title text not null,
  description text,
  due timestamptz,
  status text default 'todo',
  priority int default 0,
  created_at timestamptz default now()
);

-- Enable row level security
alter table tasks enable row level security;
create policy "Users can manage their tasks" on tasks for all using (auth.uid() = user_id);

alter table plans enable row level security;
create policy "Users can manage their plans" on plans for all using (auth.uid() = user_id);
