-- A chat only exists once the buyer sends something. Opening "Message seller"
-- no longer creates a conversation; the first message does, in one step, so
-- a seller never sees an empty chat.

-- Chats opened but never written in.
delete from public.conversations c where not exists (select 1 from public.messages m where m.conversation_id = c.id);

drop function public.start_conversation(uuid);

-- Sends a buyer's message about a product, creating the conversation if this
-- is the first. Returns the conversation id.
create function public.send_first_message(p_listing_id uuid, p_body text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  l public.listings;
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
begin
  perform private.require_buyer(v_uid);
  select * into l from public.listings where id = p_listing_id;
  if not found then perform private.fail('not_found', 'That item doesn’t exist.'); end if;
  if l.kind <> 'product' then perform private.fail('invalid_input', 'Raffle items are held and checked by DrawMart, so there’s no seller chat.'); end if;
  if l.status not in ('for_sale', 'sold') then perform private.fail('not_found', 'That item isn’t on sale.'); end if;
  if l.merchant_id = private.my_merchant_id() then perform private.fail('invalid_input', 'This is your own item.'); end if;
  -- Check the text before creating anything (messages.ts messageError).
  if v_body = '' then perform private.fail('invalid_input', 'Write a message first.'); end if;
  if length(v_body) > 1000 then perform private.fail('invalid_input', 'Keep it under 1,000 characters.'); end if;

  insert into public.conversations (listing_id, buyer_id, merchant_id) values (l.id, v_uid, l.merchant_id)
  on conflict (listing_id, buyer_id) do nothing;
  select id into v_id from public.conversations where listing_id = l.id and buyer_id = v_uid;
  perform public.send_message(v_id, v_body);
  return v_id;
end $$;

revoke execute on function public.send_first_message(uuid, text) from public, anon, authenticated;
grant execute on function public.send_first_message(uuid, text) to authenticated;
