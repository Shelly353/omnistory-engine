create table if not exists public.workspace_cloud_state (
  project_id uuid not null,
  data_type text not null,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (project_id, data_type)
);
