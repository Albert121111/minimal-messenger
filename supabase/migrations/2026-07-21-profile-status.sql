-- Add a short public status to profiles in an existing project.
alter table public.profiles
  add column if not exists about text not null default '' check (char_length(about) <= 120);
