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

-- Organisational memory: tenants, departments, roles, meeting-level access and audit.

create table if not exists organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references users(id) on delete cascade,
  retention_days integer not null default 365 check (retention_days between 30 and 3650),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organisations_name_length check (length(trim(name)) between 1 and 120)
);

create table if not exists departments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  constraint departments_name_length check (length(trim(name)) between 1 and 80),
  unique (id, org_id)
);

create unique index if not exists departments_org_name_idx on departments (org_id, lower(name));

create table if not exists org_members (
  org_id uuid not null references organisations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'manager', 'member')),
  department_id uuid,
  joined_at timestamptz not null default now(),
  primary key (org_id, user_id),
  foreign key (department_id, org_id) references departments(id, org_id) on delete set null
);

create index if not exists org_members_user_idx on org_members (user_id);

alter table captures add column if not exists org_id uuid references organisations(id) on delete cascade;
alter table captures add column if not exists department_id uuid references departments(id) on delete set null;
alter table captures add column if not exists visibility text not null default 'private'
  check (visibility in ('private', 'department', 'organisation'));
alter table captures add column if not exists sensitivity text not null default 'standard'
  check (sensitivity in ('standard', 'confidential'));

create index if not exists captures_org_created_idx on captures (org_id, created_at desc) where org_id is not null;

create table if not exists capture_grants (
  capture_id uuid not null references captures(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  granted_by uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (capture_id, user_id)
);

create index if not exists capture_grants_user_idx on capture_grants (user_id);

create table if not exists audit_events (
  id bigserial primary key,
  org_id uuid not null references organisations(id) on delete cascade,
  actor_id uuid references users(id) on delete set null,
  action text not null,
  capture_id uuid references captures(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists audit_events_org_created_idx on audit_events (org_id, created_at desc);

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

drop trigger if exists organisations_set_updated_at on organisations;
create trigger organisations_set_updated_at
before update on organisations
for each row execute function set_updated_at();

insert into schema_migrations (version)
values ('001_initial')
on conflict (version) do nothing;

insert into schema_migrations (version)
values ('002_org_memory')
on conflict (version) do nothing;
