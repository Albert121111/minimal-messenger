-- Minimal Messenger database schema for Supabase (PostgreSQL)
-- Run this once in a fresh Supabase project.
create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  about text not null default '' check (char_length(about) <= 120),
  created_at timestamptz not null default now(),
  constraint username_format check (username ~ '^[a-z0-9_]{3,24}$')
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index messages_conversation_created_at_idx on public.messages (conversation_id, created_at);
create index conversation_members_user_id_idx on public.conversation_members (user_id);

-- This helper is SECURITY DEFINER so RLS policies never recursively query
-- conversation_members from its own policy.
create or replace function public.is_conversation_member(target_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.conversation_members cm
      where cm.conversation_id = target_conversation_id
        and cm.user_id = auth.uid()
    );
$$;

revoke all on function public.is_conversation_member(uuid) from public;
grant execute on function public.is_conversation_member(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

create policy "Profiles are visible to signed-in users"
  on public.profiles for select to authenticated using (true);

create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy "Members can see their conversations"
  on public.conversations for select to authenticated
  using (public.is_conversation_member(id));

create policy "Members can see conversation membership"
  on public.conversation_members for select to authenticated
  using (public.is_conversation_member(conversation_id));

create policy "Members can read messages"
  on public.messages for select to authenticated
  using (public.is_conversation_member(conversation_id));

create policy "Members can send messages as themselves"
  on public.messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public.is_conversation_member(conversation_id)
  );

-- Profiles are created atomically with auth.users, so a confirmed or
-- unconfirmed registration can never leave a usable account without a profile.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_username text := lower(trim(coalesce(new.raw_user_meta_data ->> 'username', '')));
begin
  if requested_username !~ '^[a-z0-9_]{3,24}$' then
    raise exception 'Username must contain 3-24 lowercase letters, digits, or underscores';
  end if;

  insert into public.profiles (id, username)
  values (new.id, requested_username);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Creates a single private conversation for exactly two people. The advisory
-- lock makes simultaneous clicks return the same chat instead of duplicates.
create or replace function public.open_direct_conversation(other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  found_conversation uuid;
  new_conversation uuid;
  pair_key text;
begin
  if auth.uid() is null or other_user_id = auth.uid() then
    raise exception 'Invalid recipient';
  end if;

  if not exists (select 1 from public.profiles where id = other_user_id) then
    raise exception 'User not found';
  end if;

  pair_key := least(auth.uid()::text, other_user_id::text)
    || ':' || greatest(auth.uid()::text, other_user_id::text);
  perform pg_advisory_xact_lock(hashtextextended(pair_key, 0));

  select cm1.conversation_id into found_conversation
  from public.conversation_members cm1
  join public.conversation_members cm2 on cm2.conversation_id = cm1.conversation_id
  where cm1.user_id = auth.uid()
    and cm2.user_id = other_user_id
    and (select count(*) from public.conversation_members cm where cm.conversation_id = cm1.conversation_id) = 2
  limit 1;

  if found_conversation is not null then
    return found_conversation;
  end if;

  insert into public.conversations default values returning id into new_conversation;
  insert into public.conversation_members (conversation_id, user_id)
  values (new_conversation, auth.uid()), (new_conversation, other_user_id);
  return new_conversation;
end;
$$;

revoke all on function public.open_direct_conversation(uuid) from public;
grant execute on function public.open_direct_conversation(uuid) to authenticated;

alter publication supabase_realtime add table public.messages;
