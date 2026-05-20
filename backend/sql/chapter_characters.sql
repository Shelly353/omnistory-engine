create table if not exists public.chapter_characters (
  chapter_id uuid not null,
  character_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (chapter_id, character_id)
);
