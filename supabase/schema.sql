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

-- Expanded messenger feature layer. Kept here as well as in the incremental
-- migration so a brand-new Supabase project can be initialized in one pass.

+alter table public.profiles
  add column if not exists avatar_emoji text not null default '🙂' check (char_length(avatar_emoji) between 1 and 12),
  add column if not exists last_seen_at timestamptz not null default now();

alter table public.conversations
  add column if not exists kind text not null default 'direct' check (kind in ('direct', 'group')),
  add column if not exists title text check (char_length(title) between 2 and 60),
  add column if not exists created_by uuid references public.profiles(id) on delete set null,
  add column if not exists pinned_message_id uuid references public.messages(id) on delete set null,
  add column if not exists pinned_at timestamptz;

alter table public.conversation_members
  add column if not exists role text not null default 'member' check (role in ('admin', 'member')),
  add column if not exists last_read_at timestamptz not null default now();

alter table public.messages
  add column if not exists reply_to uuid references public.messages(id) on delete set null,
  add column if not exists edited_at timestamptz,
  add column if not exists deleted_at timestamptz,
  add column if not exists attachment_path text,
  add column if not exists attachment_name text check (char_length(attachment_name) <= 180),
  add column if not exists attachment_type text check (char_length(attachment_type) <= 120);

create table if not exists public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 12),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create index if not exists messages_reply_to_idx on public.messages (reply_to);
create index if not exists message_reactions_message_id_idx on public.message_reactions (message_id);
create index if not exists conversation_members_read_state_idx on public.conversation_members (conversation_id, last_read_at);

-- Existing direct chats have no creator. Group chats always have an admin.
create or replace function public.is_conversation_admin(target_conversation_id uuid)
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
        and cm.role = 'admin'
    );
$$;

revoke all on function public.is_conversation_admin(uuid) from public;
grant execute on function public.is_conversation_admin(uuid) to authenticated;

-- Table writes that change membership or message ownership stay behind RPCs.
revoke insert, update, delete on public.conversation_members from authenticated;
revoke update, delete on public.messages from authenticated;
revoke update on public.profiles from authenticated;
grant update (about, avatar_emoji, last_seen_at) on public.profiles to authenticated;

alter table public.message_reactions enable row level security;

drop policy if exists "Members can see message reactions" on public.message_reactions;
create policy "Members can see message reactions"
  on public.message_reactions for select to authenticated
  using (
    exists (
      select 1 from public.messages m
      where m.id = message_id
        and public.is_conversation_member(m.conversation_id)
    )
  );

drop policy if exists "Members can add their reactions" on public.message_reactions;
create policy "Members can add their reactions"
  on public.message_reactions for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.messages m
      where m.id = message_id
        and public.is_conversation_member(m.conversation_id)
    )
  );

drop policy if exists "Users can remove their reactions" on public.message_reactions;
create policy "Users can remove their reactions"
  on public.message_reactions for delete to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.messages m
      where m.id = message_id
        and public.is_conversation_member(m.conversation_id)
    )
  );

create or replace function public.mark_conversation_read(target_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_conversation_member(target_conversation_id) then
    raise exception 'Not a conversation member';
  end if;

  update public.conversation_members
  set last_read_at = now()
  where conversation_id = target_conversation_id and user_id = auth.uid();
end;
$$;

create or replace function public.edit_message(target_message_id uuid, replacement_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cleaned_body text := trim(replacement_body);
begin
  if char_length(cleaned_body) not between 1 and 2000 then
    raise exception 'Message must contain 1-2000 characters';
  end if;

  update public.messages
  set body = cleaned_body, edited_at = now()
  where id = target_message_id
    and sender_id = auth.uid()
    and deleted_at is null
    and public.is_conversation_member(conversation_id);

  if not found then
    raise exception 'Message cannot be edited';
  end if;
end;
$$;

create or replace function public.delete_message(target_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.messages
  set body = 'Сообщение удалено',
      deleted_at = now(),
      edited_at = null,
      reply_to = null,
      attachment_path = null,
      attachment_name = null,
      attachment_type = null
  where id = target_message_id
    and sender_id = auth.uid()
    and deleted_at is null
    and public.is_conversation_member(conversation_id);

  if not found then
    raise exception 'Message cannot be deleted';
  end if;
end;
$$;

create or replace function public.create_group_conversation(group_title text, invited_user_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_conversation uuid;
  cleaned_title text := trim(group_title);
  invited_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if char_length(cleaned_title) not between 2 and 60 then
    raise exception 'Group title must contain 2-60 characters';
  end if;

  select count(distinct user_id) into invited_count
  from (
    select unnest(coalesce(invited_user_ids, '{}'::uuid[])) as user_id
  ) invited
  where user_id <> auth.uid();

  if invited_count < 1 then
    raise exception 'Choose at least one participant';
  end if;

  if exists (
    select 1
    from (
      select distinct unnest(coalesce(invited_user_ids, '{}'::uuid[])) as user_id
    ) invited
    left join public.profiles p on p.id = invited.user_id
    where invited.user_id <> auth.uid() and p.id is null
  ) then
    raise exception 'One or more users do not exist';
  end if;

  insert into public.conversations (kind, title, created_by)
  values ('group', cleaned_title, auth.uid())
  returning id into new_conversation;

  insert into public.conversation_members (conversation_id, user_id, role)
  values (new_conversation, auth.uid(), 'admin');

  insert into public.conversation_members (conversation_id, user_id, role)
  select new_conversation, invited.user_id, 'member'
  from (
    select distinct unnest(coalesce(invited_user_ids, '{}'::uuid[])) as user_id
  ) invited
  where invited.user_id <> auth.uid();

  return new_conversation;
end;
$$;

create or replace function public.add_group_member(target_conversation_id uuid, target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_conversation_admin(target_conversation_id) then
    raise exception 'Only group admins can add members';
  end if;
  if not exists (select 1 from public.conversations where id = target_conversation_id and kind = 'group') then
    raise exception 'Conversation is not a group';
  end if;
  if not exists (select 1 from public.profiles where id = target_user_id) then
    raise exception 'User not found';
  end if;

  insert into public.conversation_members (conversation_id, user_id, role)
  values (target_conversation_id, target_user_id, 'member')
  on conflict (conversation_id, user_id) do nothing;
end;
$$;

create or replace function public.set_pinned_message(target_conversation_id uuid, target_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_conversation_member(target_conversation_id) then
    raise exception 'Not a conversation member';
  end if;
  if target_message_id is not null and not exists (
    select 1 from public.messages
    where id = target_message_id and conversation_id = target_conversation_id and deleted_at is null
  ) then
    raise exception 'Message does not belong to this conversation';
  end if;

  update public.conversations
  set pinned_message_id = target_message_id,
      pinned_at = case when target_message_id is null then null else now() end
  where id = target_conversation_id;
end;
$$;

revoke all on function public.mark_conversation_read(uuid) from public;
revoke all on function public.edit_message(uuid, text) from public;
revoke all on function public.delete_message(uuid) from public;
revoke all on function public.create_group_conversation(text, uuid[]) from public;
revoke all on function public.add_group_member(uuid, uuid) from public;
revoke all on function public.set_pinned_message(uuid, uuid) from public;
grant execute on function public.mark_conversation_read(uuid) to authenticated;
grant execute on function public.edit_message(uuid, text) to authenticated;
grant execute on function public.delete_message(uuid) to authenticated;
grant execute on function public.create_group_conversation(text, uuid[]) to authenticated;
grant execute on function public.add_group_member(uuid, uuid) to authenticated;
grant execute on function public.set_pinned_message(uuid, uuid) to authenticated;

-- Private attachment storage. The first path segment is always conversation_id.
create or replace function public.can_access_message_file(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, storage
as $$
declare
  target_conversation uuid;
begin
  begin
    target_conversation := split_part(object_name, '/', 1)::uuid;
  exception when invalid_text_representation then
    return false;
  end;
  return public.is_conversation_member(target_conversation);
end;
$$;

revoke all on function public.can_access_message_file(text) from public;
grant execute on function public.can_access_message_file(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('message-files', 'message-files', false, 15728640)
on conflict (id) do update set public = false, file_size_limit = 15728640;

drop policy if exists "Conversation members can read attachments" on storage.objects;
create policy "Conversation members can read attachments"
  on storage.objects for select to authenticated
  using (bucket_id = 'message-files' and public.can_access_message_file(name));

drop policy if exists "Conversation members can upload attachments" on storage.objects;
create policy "Conversation members can upload attachments"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'message-files' and public.can_access_message_file(name));

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_reactions'
  ) then
    execute 'alter publication supabase_realtime add table public.message_reactions';
  end if;
end;
$$;

-- Group administration layer. It comes after the group columns and helper
-- functions above so this schema also works when run on a new project.
create or replace function public.rename_group_conversation(target_conversation_id uuid, new_title text)
returns void language plpgsql security definer set search_path = public as $$
declare cleaned_title text := trim(new_title);
begin
  if not public.is_conversation_admin(target_conversation_id) then raise exception 'Only group admins can rename a group'; end if;
  if char_length(cleaned_title) not between 2 and 60 then raise exception 'Group title must contain 2-60 characters'; end if;
  update public.conversations set title = cleaned_title where id = target_conversation_id and kind = 'group';
  if not found then raise exception 'Conversation is not a group'; end if;
end;
$$;

create or replace function public.set_group_member_role(target_conversation_id uuid, target_user_id uuid, new_role text)
returns void language plpgsql security definer set search_path = public as $$
declare current_role text;
begin
  if not public.is_conversation_admin(target_conversation_id) then raise exception 'Only group admins can manage roles'; end if;
  if new_role not in ('admin', 'member') then raise exception 'Invalid group role'; end if;
  if not exists (select 1 from public.conversations where id = target_conversation_id and kind = 'group') then raise exception 'Conversation is not a group'; end if;
  select role into current_role from public.conversation_members where conversation_id = target_conversation_id and user_id = target_user_id;
  if current_role is null then raise exception 'User is not a group member'; end if;
  if current_role = 'admin' and new_role = 'member' and (select count(*) from public.conversation_members where conversation_id = target_conversation_id and role = 'admin') <= 1 then
    raise exception 'Assign another admin before removing the last admin role';
  end if;
  update public.conversation_members set role = new_role where conversation_id = target_conversation_id and user_id = target_user_id;
end;
$$;

create or replace function public.remove_group_member(target_conversation_id uuid, target_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare current_role text;
begin
  if not public.is_conversation_admin(target_conversation_id) then raise exception 'Only group admins can remove members'; end if;
  if target_user_id = auth.uid() then raise exception 'Use leave group to remove yourself'; end if;
  if not exists (select 1 from public.conversations where id = target_conversation_id and kind = 'group') then raise exception 'Conversation is not a group'; end if;
  select role into current_role from public.conversation_members where conversation_id = target_conversation_id and user_id = target_user_id;
  if current_role is null then raise exception 'User is not a group member'; end if;
  if current_role = 'admin' and (select count(*) from public.conversation_members where conversation_id = target_conversation_id and role = 'admin') <= 1 then
    raise exception 'Assign another admin before removing the last admin';
  end if;
  delete from public.conversation_members where conversation_id = target_conversation_id and user_id = target_user_id;
end;
$$;

create or replace function public.leave_group_conversation(target_conversation_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare next_admin uuid;
begin
  if not public.is_conversation_member(target_conversation_id) then raise exception 'Not a conversation member'; end if;
  if not exists (select 1 from public.conversations where id = target_conversation_id and kind = 'group') then raise exception 'Conversation is not a group'; end if;
  delete from public.conversation_members where conversation_id = target_conversation_id and user_id = auth.uid();
  if not exists (select 1 from public.conversation_members where conversation_id = target_conversation_id) then
    delete from public.conversations where id = target_conversation_id;
    return;
  end if;
  if not exists (select 1 from public.conversation_members where conversation_id = target_conversation_id and role = 'admin') then
    select user_id into next_admin from public.conversation_members where conversation_id = target_conversation_id order by joined_at, user_id limit 1;
    update public.conversation_members set role = 'admin' where conversation_id = target_conversation_id and user_id = next_admin;
  end if;
end;
$$;

revoke all on function public.rename_group_conversation(uuid, text) from public;
revoke all on function public.set_group_member_role(uuid, uuid, text) from public;
revoke all on function public.remove_group_member(uuid, uuid) from public;
revoke all on function public.leave_group_conversation(uuid) from public;
grant execute on function public.rename_group_conversation(uuid, text) to authenticated;
grant execute on function public.set_group_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.remove_group_member(uuid, uuid) to authenticated;
grant execute on function public.leave_group_conversation(uuid) to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversations') then
    execute 'alter publication supabase_realtime add table public.conversations';
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversation_members') then
    execute 'alter publication supabase_realtime add table public.conversation_members';
  end if;
end;
$$;
