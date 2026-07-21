-- Apply this migration to an existing Minimal Messenger project.
begin;

alter table public.profiles
  add column if not exists about text not null default '' check (char_length(about) <= 120);

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

drop policy if exists "Members can see conversation membership" on public.conversation_members;
create policy "Members can see conversation membership"
  on public.conversation_members for select to authenticated
  using (public.is_conversation_member(conversation_id));

drop policy if exists "Members can see their conversations" on public.conversations;
create policy "Members can see their conversations"
  on public.conversations for select to authenticated
  using (public.is_conversation_member(id));

drop policy if exists "Members can read messages" on public.messages;
create policy "Members can read messages"
  on public.messages for select to authenticated
  using (public.is_conversation_member(conversation_id));

drop policy if exists "Members can send messages as themselves" on public.messages;
create policy "Members can send messages as themselves"
  on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and public.is_conversation_member(conversation_id));

-- Direct table writes would let a malicious client join a known conversation.
drop policy if exists "Users can create conversations" on public.conversations;
drop policy if exists "Users can add themselves to conversations" on public.conversation_members;
drop policy if exists "Users can create their own profile" on public.profiles;

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
  insert into public.profiles (id, username) values (new.id, requested_username);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

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

  if found_conversation is not null then return found_conversation; end if;

  insert into public.conversations default values returning id into new_conversation;
  insert into public.conversation_members (conversation_id, user_id)
  values (new_conversation, auth.uid()), (new_conversation, other_user_id);
  return new_conversation;
end;
$$;

revoke all on function public.open_direct_conversation(uuid) from public;
grant execute on function public.open_direct_conversation(uuid) to authenticated;

commit;
