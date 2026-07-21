-- Secure message forwarding, including a copied attachment uploaded by the client.
begin;

alter table public.messages
  add column if not exists forwarded_from_username text check (char_length(forwarded_from_username) between 3 and 24),
  add column if not exists forwarded_from_message_id uuid references public.messages(id) on delete set null;

create index if not exists messages_forwarded_from_message_id_idx
  on public.messages (forwarded_from_message_id);

-- Ordinary inserts cannot forge the forward label. Forwarded messages are
-- created only through the function below after both memberships are checked.
drop policy if exists "Members can send messages as themselves" on public.messages;
create policy "Members can send messages as themselves"
  on public.messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public.is_conversation_member(conversation_id)
    and forwarded_from_username is null
    and forwarded_from_message_id is null
  );

create or replace function public.forward_message(
  source_message_id uuid,
  target_conversation_id uuid,
  forwarded_attachment_path text default null,
  forwarded_attachment_name text default null,
  forwarded_attachment_type text default null
)
returns public.messages
language plpgsql
security definer
set search_path = public
as $$
declare
  source_message public.messages%rowtype;
  source_author text;
  original_message_id uuid;
  inserted_message public.messages%rowtype;
begin
  if auth.uid() is null or not public.is_conversation_member(target_conversation_id) then
    raise exception 'Not a conversation member';
  end if;

  select m.*, coalesce(m.forwarded_from_username, p.username)
    into source_message, source_author
  from public.messages m
  join public.profiles p on p.id = m.sender_id
  where m.id = source_message_id;

  if not found or not public.is_conversation_member(source_message.conversation_id) then
    raise exception 'Message is unavailable for forwarding';
  end if;
  if source_message.deleted_at is not null then
    raise exception 'Deleted messages cannot be forwarded';
  end if;

  original_message_id := coalesce(source_message.forwarded_from_message_id, source_message.id);

  if source_message.attachment_path is not null then
    if forwarded_attachment_path is null
      or forwarded_attachment_name is null
      or forwarded_attachment_type is null
      or forwarded_attachment_path not like target_conversation_id::text || '/%' then
      raise exception 'Attachment copy is required for forwarding';
    end if;
  else
    forwarded_attachment_path := null;
    forwarded_attachment_name := null;
    forwarded_attachment_type := null;
  end if;

  insert into public.messages (
    conversation_id,
    sender_id,
    body,
    attachment_path,
    attachment_name,
    attachment_type,
    forwarded_from_username,
    forwarded_from_message_id
  ) values (
    target_conversation_id,
    auth.uid(),
    source_message.body,
    forwarded_attachment_path,
    forwarded_attachment_name,
    forwarded_attachment_type,
    source_author,
    original_message_id
  ) returning * into inserted_message;

  return inserted_message;
end;
$$;

revoke all on function public.forward_message(uuid, uuid, text, text, text) from public;
grant execute on function public.forward_message(uuid, uuid, text, text, text) to authenticated;

commit;
