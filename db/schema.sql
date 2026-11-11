-- JotBox core schema
-- Idempotent DDL: safe to run on every deploy or manually.

create table if not exists schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null default '',
  password_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_email_not_blank check (length(trim(email)) > 3),
  constraint users_name_length check (length(name) <= 80)
);

create index if not exists users_email_lower_idx on users (lower(email));

create table if not exists auth_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  user_agent text,
  ip text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint auth_sessions_expiry check (expires_at > created_at)
);

create index if not exists auth_sessions_user_idx on auth_sessions (user_id);
create index if not exists auth_sessions_expiry_idx on auth_sessions (expires_at);

create table if not exists captures (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  title text not null default 'Untitled session',
  kind text not null check (kind in ('meeting', 'seminar', 'lecture', 'voice')),
  status text not null check (status in ('live', 'processing', 'ready', 'failed')),
  duration_sec double precision not null default 0 check (duration_sec >= 0),
  scratch text not null default '',
  transcript jsonb not null default '[]'::jsonb,
  notes jsonb,
  has_audio boolean not null default false,
  error text,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint captures_title_length check (length(title) <= 200),
  constraint captures_scratch_length check (length(scratch) <= 200000)
);

create index if not exists captures_user_created_idx on captures (user_id, created_at desc);
create index if not exists captures_user_updated_idx on captures (user_id, updated_at desc);

create table if not exists auth_attempts (
  id bigserial primary key,
  kind text not null,
  key text not null,
  created_at timestamptz not null default now()
);

create index if not exists auth_attempts_lookup_idx on auth_attempts (kind, key, created_at desc);

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists users_set_updated_at on users;
create trigger users_set_updated_at
before update on users
for each row execute function set_updated_at();

drop trigger if exists captures_set_updated_at on captures;
create trigger captures_set_updated_at
before update on captures
for each row execute function set_updated_at();

insert into schema_migrations (version)
values ('001_initial')
on conflict (version) do nothing;
