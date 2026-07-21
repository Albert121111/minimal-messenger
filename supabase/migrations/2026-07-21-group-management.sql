-- Group administration: rename, member roles, removal and safe leaving.
begin;

create or replace function public.rename_group_conversation(target_conversation_id uuid, new_title text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cleaned_title text := trim(new_title);
begin
  if not public.is_conversation_admin(target_conversation_id) then
    raise exception 'Only group admins can rename a group';
  end if;
  if char_length(cleaned_title) not between 2 and 60 then
    raise exception 'Group title must contain 2-60 characters';
  end if;

  update public.conversations
  set title = cleaned_title
  where id = target_conversation_id and kind = 'group';

  if not found then
    raise exception 'Conversation is not a group';
  end if;
end;
$$;

create or replace function public.set_group_member_role(target_conversation_id uuid, target_user_id uuid, new_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_role text;
begin
  if not public.is_conversation_admin(target_conversation_id) then
    raise exception 'Only group admins can manage roles';
  end if;
  if new_role not in ('admin', 'member') then
    raise exception 'Invalid group role';
  end if;
  if not exists (select 1 from public.conversations where id = target_conversation_id and kind = 'group') then
    raise exception 'Conversation is not a group';
  end if;

  select role into current_role
  from public.conversation_members
  where conversation_id = target_conversation_id and user_id = target_user_id;

  if current_role is null then
    raise exception 'User is not a group member';
  end if;
  if current_role = 'admin' and new_role = 'member'
    and (select count(*) from public.conversation_members where conversation_id = target_conversation_id and role = 'admin') <= 1 then
    raise exception 'Assign another admin before removing the last admin role';
  end if;

  update public.conversation_members
  set role = new_role
  where conversation_id = target_conversation_id and user_id = target_user_id;
end;
$$;

create or replace function public.remove_group_member(target_conversation_id uuid, target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_role text;
begin
  if not public.is_conversation_admin(target_conversation_id) then
    raise exception 'Only group admins can remove members';
  end if;
  if target_user_id = auth.uid() then
    raise exception 'Use leave group to remove yourself';
  end if;
  if not exists (select 1 from public.conversations where id = target_conversation_id and kind = 'group') then
    raise exception 'Conversation is not a group';
  end if;

  select role into current_role
  from public.conversation_members
  where conversation_id = target_conversation_id and user_id = target_user_id;

  if current_role is null then
    raise exception 'User is not a group member';
  end if;
  if current_role = 'admin'
    and (select count(*) from public.conversation_members where conversation_id = target_conversation_id and role = 'admin') <= 1 then
    raise exception 'Assign another admin before removing the last admin';
  end if;

  delete from public.conversation_members
  where conversation_id = target_conversation_id and user_id = target_user_id;
end;
$$;

create or replace function public.leave_group_conversation(target_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  next_admin uuid;
begin
  if not public.is_conversation_member(target_conversation_id) then
    raise exception 'Not a conversation member';
  end if;
  if not exists (select 1 from public.conversations where id = target_conversation_id and kind = 'group') then
    raise exception 'Conversation is not a group';
  end if;

  delete from public.conversation_members
  where conversation_id = target_conversation_id and user_id = auth.uid();

  if not exists (select 1 from public.conversation_members where conversation_id = target_conversation_id) then
    delete from public.conversations where id = target_conversation_id;
    return;
  end if;

  if not exists (
    select 1 from public.conversation_members
    where conversation_id = target_conversation_id and role = 'admin'
  ) then
    select user_id into next_admin
    from public.conversation_members
    where conversation_id = target_conversation_id
    order by joined_at, user_id
    limit 1;

    update public.conversation_members
    set role = 'admin'
    where conversation_id = target_conversation_id and user_id = next_admin;
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
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversations'
  ) then
    execute 'alter publication supabase_realtime add table public.conversations';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversation_members'
  ) then
    execute 'alter publication supabase_realtime add table public.conversation_members';
  end if;
end;
$$;

commit;
