-- OCEAN DIVE schema. Idempotent: safe to run more than once (also upgrades older versions).
-- Works on Supabase Postgres (paste into SQL Editor) and on the embedded local dev database.

create table if not exists sessions (
  id               uuid primary key default gen_random_uuid(),
  status           text not null default 'lobby',
  is_current       boolean not null default true,
  group_count      integer not null default 4,
  group_capacity   integer not null default 4,
  question_seconds integer not null default 25,
  version          bigint not null default 0,
  created_at       timestamptz not null default now(),
  completed_at     timestamptz
);
alter table sessions add column if not exists revealed_at timestamptz;
create unique index if not exists sessions_one_current on sessions (is_current) where is_current;

create table if not exists groups (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references sessions (id) on delete cascade,
  group_number integer not null,
  capacity     integer not null,
  created_at   timestamptz not null default now(),
  unique (session_id, group_number)
);
alter table groups add column if not exists full_at timestamptz;

create table if not exists participants (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references sessions (id) on delete cascade,
  group_id     uuid not null references groups (id) on delete cascade,
  token_hash   text not null unique,
  diver_number integer not null,
  display_name text,
  joined_at    timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (group_id, diver_number)
);
-- per-student progress (each diver plays the seven questions at their own pace)
alter table participants add column if not exists started_at timestamptz;
alter table participants add column if not exists current_index integer not null default 0;
alter table participants add column if not exists question_started_at timestamptz;
alter table participants add column if not exists finished_at timestamptz;
create index if not exists participants_session on participants (session_id);

create table if not exists answers (
  id                   uuid primary key default gen_random_uuid(),
  session_id           uuid not null references sessions (id) on delete cascade,
  participant_id       uuid not null references participants (id) on delete cascade,
  group_id             uuid not null references groups (id) on delete cascade,
  question_id          text not null,
  question_index       integer not null,
  raw_answer           text,
  normalized_answer    text,
  status               text not null check (status in ('answered', 'timeout')),
  is_correct           boolean not null default false,
  awarded_credit       integer not null default 0 check (awarded_credit in (0, 1)),
  personal_depth_after integer not null default 0,
  answered_at          timestamptz not null default now(),
  unique (session_id, participant_id, question_id)
);
create index if not exists answers_group on answers (group_id);

-- Supabase: lock tables down. The app talks to Postgres only from the server
-- (DATABASE_URL); browsers never query these tables directly.
alter table sessions enable row level security;
alter table groups enable row level security;
alter table participants enable row level security;
alter table answers enable row level security;

-- ===================================================================== v2: host + synchronized group rounds
-- The host opens the game (students wait until then).
alter table sessions add column if not exists opened_at timestamptz;

-- Each GROUP plays the seven questions together on one server-side clock.
alter table groups add column if not exists started_at timestamptz;
alter table groups add column if not exists current_index integer not null default 0;
alter table groups add column if not exists question_started_at timestamptz;
alter table groups add column if not exists finished_at timestamptz;
alter table groups add column if not exists roster_size integer;

-- One row per diver per question: their first correct answer, or a timeout (0 m).
-- UNIQUE makes double scoring impossible.
create table if not exists dive_results (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references sessions (id) on delete cascade,
  participant_id uuid not null references participants (id) on delete cascade,
  group_id       uuid not null references groups (id) on delete cascade,
  question_id    text not null,
  question_index integer not null,
  is_correct     boolean not null,
  depth_awarded  integer not null default 0 check (depth_awarded in (0, 10, 20, 30)),
  elapsed_ms     integer,
  raw_answer     text,
  created_at     timestamptz not null default now(),
  unique (participant_id, question_id)
);
create index if not exists dive_results_group on dive_results (group_id);

-- Every submitted attempt (right or wrong), for the answer history.
create table if not exists dive_attempts (
  id                uuid primary key default gen_random_uuid(),
  session_id        uuid not null references sessions (id) on delete cascade,
  participant_id    uuid not null references participants (id) on delete cascade,
  group_id          uuid not null references groups (id) on delete cascade,
  question_id       text not null,
  question_index    integer not null,
  raw_answer        text not null,
  normalized_answer text not null,
  is_correct        boolean not null,
  elapsed_ms        integer not null,
  submitted_at      timestamptz not null default now()
);
create index if not exists dive_attempts_participant on dive_attempts (participant_id, question_index);

-- Authenticated host browser sessions (only a hash of the cookie value is stored).
create table if not exists host_sessions (
  token_hash text primary key,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

alter table dive_results enable row level security;
alter table dive_attempts enable row level security;
alter table host_sessions enable row level security;
