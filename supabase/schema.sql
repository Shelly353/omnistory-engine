create extension if not exists pgcrypto;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  concept text not null default '',
  target_words integer not null default 200000,
  genre text not null default '',
  style_profile text not null default '默认商业网文',
  status text not null default 'concept',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.story_bibles (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  approved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.canon_facts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  fact_type text not null,
  subject text not null,
  predicate text not null,
  object text not null,
  scope text not null default 'global',
  source text not null default 'manual',
  introduced_at_chapter integer,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table if not exists public.characters (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  role text not null default '',
  faction text not null default '',
  identity text not null default '',
  personality text not null default '',
  core_desire text not null default '',
  goal text not null default '',
  motivation text not null default '',
  flaw text not null default '',
  fear text not null default '',
  skills text not null default '',
  limits text not null default '',
  voice_rules text not null default '',
  reuse_plan jsonb not null default '[]'::jsonb,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.secrets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  audience_view text not null default '',
  god_view text not null default '',
  status text not null default 'hidden',
  reveal_chapter integer,
  related_character_ids jsonb not null default '[]'::jsonb,
  related_event_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.foreshadowing_hooks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  setup_chapter integer,
  payoff_chapter integer,
  status text not null default 'planned',
  description text not null default '',
  misdirection text not null default '',
  payoff_method text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.story_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  event_order numeric not null default 1,
  title text not null,
  summary text not null default '',
  trigger text not null default '',
  actor_character_id uuid references public.characters(id) on delete set null,
  conflict_target text not null default '',
  result text not null default '',
  state_changes jsonb not null default '[]'::jsonb,
  related_character_ids jsonb not null default '[]'::jsonb,
  related_secret_ids jsonb not null default '[]'::jsonb,
  related_hook_ids jsonb not null default '[]'::jsonb,
  status text not null default 'planned',
  created_at timestamptz not null default now()
);

create table if not exists public.chapter_contracts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  chapter_number integer not null,
  title text not null,
  summary text not null default '',
  required_events jsonb not null default '[]'::jsonb,
  allowed_characters jsonb not null default '[]'::jsonb,
  forbidden_facts jsonb not null default '[]'::jsonb,
  secret_permissions jsonb not null default '{}'::jsonb,
  expected_start_state jsonb not null default '{}'::jsonb,
  expected_end_state jsonb not null default '{}'::jsonb,
  style_requirements text not null default '',
  status text not null default 'ready_to_draft',
  created_at timestamptz not null default now(),
  unique(project_id, chapter_number)
);

create table if not exists public.chapters (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  chapter_number integer not null,
  title text not null,
  outline text not null default '',
  content text not null default '',
  summary text not null default '',
  word_count integer not null default 0,
  status text not null default 'planned',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, chapter_number)
);

create table if not exists public.state_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  chapter_number integer not null,
  snapshot_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.state_transitions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  chapter_number integer not null,
  source_event_id uuid references public.story_events(id) on delete set null,
  target_type text not null,
  target_id text not null,
  before_state jsonb not null default '{}'::jsonb,
  after_state jsonb not null default '{}'::jsonb,
  evidence text not null default '',
  approved boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.proposed_facts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  chapter_number integer,
  fact_payload jsonb not null default '{}'::jsonb,
  risk_level text not null default 'medium',
  reason text not null default '',
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create table if not exists public.audit_findings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  chapter_number integer,
  finding_type text not null,
  severity text not null default 'warning',
  message text not null default '',
  suggested_fix text not null default '',
  status text not null default 'open',
  created_at timestamptz not null default now()
);

create table if not exists public.generation_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  operation text not null,
  input_payload jsonb not null default '{}'::jsonb,
  output_payload jsonb not null default '{}'::jsonb,
  model text not null default '',
  status text not null default 'success',
  created_at timestamptz not null default now()
);

alter table public.projects add column if not exists concept text not null default '';
alter table public.projects add column if not exists target_words integer not null default 200000;
alter table public.projects add column if not exists style_profile text not null default '默认商业网文';
alter table public.projects add column if not exists status text not null default 'concept';
alter table public.projects add column if not exists genre text not null default '';
alter table public.projects add column if not exists updated_at timestamptz not null default now();

alter table public.characters add column if not exists identity text not null default '';
alter table public.characters add column if not exists personality text not null default '';
alter table public.characters add column if not exists core_desire text not null default '';
alter table public.characters add column if not exists goal text not null default '';
alter table public.characters add column if not exists motivation text not null default '';
alter table public.characters add column if not exists flaw text not null default '';
alter table public.characters add column if not exists fear text not null default '';
alter table public.characters add column if not exists skills text not null default '';
alter table public.characters add column if not exists limits text not null default '';
alter table public.characters add column if not exists voice_rules text not null default '';
alter table public.characters add column if not exists reuse_plan jsonb not null default '[]'::jsonb;
alter table public.characters add column if not exists status text not null default 'active';
alter table public.characters add column if not exists updated_at timestamptz not null default now();

alter table public.foreshadowing_hooks add column if not exists title text not null default '';
alter table public.foreshadowing_hooks add column if not exists setup_chapter integer;
alter table public.foreshadowing_hooks add column if not exists payoff_chapter integer;
alter table public.foreshadowing_hooks add column if not exists misdirection text not null default '';
alter table public.foreshadowing_hooks add column if not exists payoff_method text not null default '';

alter table public.chapters add column if not exists outline text not null default '';
alter table public.chapters add column if not exists summary text not null default '';
alter table public.chapters add column if not exists word_count integer not null default 0;
alter table public.chapters add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chapters_project_chapter_number_unique'
  ) then
    alter table public.chapters add constraint chapters_project_chapter_number_unique unique(project_id, chapter_number);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chapter_contracts_project_chapter_number_unique'
  ) then
    alter table public.chapter_contracts add constraint chapter_contracts_project_chapter_number_unique unique(project_id, chapter_number);
  end if;
end $$;

alter table public.projects enable row level security;
alter table public.story_bibles enable row level security;
alter table public.canon_facts enable row level security;
alter table public.characters enable row level security;
alter table public.secrets enable row level security;
alter table public.foreshadowing_hooks enable row level security;
alter table public.story_events enable row level security;
alter table public.chapter_contracts enable row level security;
alter table public.chapters enable row level security;
alter table public.state_snapshots enable row level security;
alter table public.state_transitions enable row level security;
alter table public.proposed_facts enable row level security;
alter table public.audit_findings enable row level security;
alter table public.generation_runs enable row level security;

drop policy if exists "omnistory_backend_projects_all" on public.projects;
drop policy if exists "omnistory_backend_story_bibles_all" on public.story_bibles;
drop policy if exists "omnistory_backend_canon_facts_all" on public.canon_facts;
drop policy if exists "omnistory_backend_characters_all" on public.characters;
drop policy if exists "omnistory_backend_secrets_all" on public.secrets;
drop policy if exists "omnistory_backend_foreshadowing_hooks_all" on public.foreshadowing_hooks;
drop policy if exists "omnistory_backend_story_events_all" on public.story_events;
drop policy if exists "omnistory_backend_chapter_contracts_all" on public.chapter_contracts;
drop policy if exists "omnistory_backend_chapters_all" on public.chapters;
drop policy if exists "omnistory_backend_state_snapshots_all" on public.state_snapshots;
drop policy if exists "omnistory_backend_state_transitions_all" on public.state_transitions;
drop policy if exists "omnistory_backend_proposed_facts_all" on public.proposed_facts;
drop policy if exists "omnistory_backend_audit_findings_all" on public.audit_findings;
drop policy if exists "omnistory_backend_generation_runs_all" on public.generation_runs;

create policy "omnistory_backend_projects_all" on public.projects for all to anon, authenticated using (true) with check (true);
create policy "omnistory_backend_story_bibles_all" on public.story_bibles for all to anon, authenticated using (true) with check (true);
create policy "omnistory_backend_canon_facts_all" on public.canon_facts for all to anon, authenticated using (true) with check (true);
create policy "omnistory_backend_characters_all" on public.characters for all to anon, authenticated using (true) with check (true);
create policy "omnistory_backend_secrets_all" on public.secrets for all to anon, authenticated using (true) with check (true);
create policy "omnistory_backend_foreshadowing_hooks_all" on public.foreshadowing_hooks for all to anon, authenticated using (true) with check (true);
create policy "omnistory_backend_story_events_all" on public.story_events for all to anon, authenticated using (true) with check (true);
create policy "omnistory_backend_chapter_contracts_all" on public.chapter_contracts for all to anon, authenticated using (true) with check (true);
create policy "omnistory_backend_chapters_all" on public.chapters for all to anon, authenticated using (true) with check (true);
create policy "omnistory_backend_state_snapshots_all" on public.state_snapshots for all to anon, authenticated using (true) with check (true);
create policy "omnistory_backend_state_transitions_all" on public.state_transitions for all to anon, authenticated using (true) with check (true);
create policy "omnistory_backend_proposed_facts_all" on public.proposed_facts for all to anon, authenticated using (true) with check (true);
create policy "omnistory_backend_audit_findings_all" on public.audit_findings for all to anon, authenticated using (true) with check (true);
create policy "omnistory_backend_generation_runs_all" on public.generation_runs for all to anon, authenticated using (true) with check (true);
