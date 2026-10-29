-- Buyer ↔ seller messages about regular products (src/domain/messages.ts).
--
-- One conversation per buyer per product. Only the buyer and the seller (a
-- store, or an individual seller) can read it. Raffles have no chat.
--
-- Sellers can choose to let buyers call them: merchant_contacts.call_phone is
-- shown to buyers only inside a conversation with that seller.

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  buyer_id uuid not null references public.profiles (id) on delete cascade,
  merchant_id uuid not null references public.merchants (id),
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  buyer_read_at timestamptz not null default now(),
  seller_read_at timestamptz not null default 'epoch',
  unique (listing_id, buyer_id)
);
create index conversations_buyer_idx on public.conversations (buyer_id, last_message_at desc);
create index conversations_merchant_idx on public.conversations (merchant_id, last_message_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender text not null check (sender in ('buyer', 'seller')),
  sender_user_id uuid not null references public.profiles (id),
  body text not null check (length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index messages_conversation_idx on public.messages (conversation_id, created_at);

-- A seller's opt-in call number. Separate from merchants, which is public.
create table public.merchant_contacts (
  merchant_id uuid primary key references public.merchants (id) on delete cascade,
  call_phone text not null
);

create function private.in_conversation(p_conversation_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.conversations c
     where c.id = p_conversation_id and (c.buyer_id = auth.uid() or c.merchant_id = private.my_merchant_id()))
$$;

alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.merchant_contacts enable row level security;

create policy "buyer and seller read conversations" on public.conversations for select to authenticated
  using (buyer_id = (select auth.uid()) or merchant_id = (select private.my_merchant_id()));
create policy "buyer and seller read messages" on public.messages for select to authenticated
  using ((select private.in_conversation(conversation_id)));
create policy "own number, or buyers already talking to this seller" on public.merchant_contacts for select to authenticated
  using (
    merchant_id = (select private.my_merchant_id())
    or exists (select 1 from public.conversations c where c.merchant_id = merchant_contacts.merchant_id and c.buyer_id = (select auth.uid()))
  );

revoke all on public.conversations, public.messages, public.merchant_contacts from anon, authenticated;
grant select on public.conversations, public.messages, public.merchant_contacts to authenticated;

-- ---------------------------------------------------------------- RPCs

-- Opens (or reopens) the buyer's conversation about a product.
create function public.start_conversation(p_listing_id uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  l public.listings;
  v_id uuid;
begin
  perform private.require_buyer(v_uid);
  select * into l from public.listings where id = p_listing_id;
  if not found then perform private.fail('not_found', 'That item doesn’t exist.'); end if;
  if l.kind <> 'product' then perform private.fail('invalid_input', 'Raffle items are held and checked by DrawMart, so there’s no seller chat.'); end if;
  if l.status not in ('for_sale', 'sold') then perform private.fail('not_found', 'That item isn’t on sale.'); end if;
  if l.merchant_id = private.my_merchant_id() then perform private.fail('invalid_input', 'This is your own item.'); end if;

  insert into public.conversations (listing_id, buyer_id, merchant_id) values (l.id, v_uid, l.merchant_id)
  on conflict (listing_id, buyer_id) do nothing;
  select id into v_id from public.conversations where listing_id = l.id and buyer_id = v_uid;
  return v_id;
end $$;

-- messages.ts messageError, MAX_MESSAGES_PER_MINUTE
create function public.send_message(p_conversation_id uuid, p_body text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  c public.conversations;
  v_sender text;
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
begin
  select * into c from public.conversations where id = p_conversation_id for update;
  if not found then perform private.fail('not_found', 'That conversation doesn’t exist.'); end if;
  v_sender := case when c.buyer_id = v_uid then 'buyer' when c.merchant_id = private.my_merchant_id() then 'seller' end;
  if v_sender is null then perform private.fail('forbidden', 'This isn’t your conversation.'); end if;
  if v_body = '' then perform private.fail('invalid_input', 'Write a message first.'); end if;
  if length(v_body) > 1000 then perform private.fail('invalid_input', 'Keep it under 1,000 characters.'); end if;
  if (select count(*) from public.messages where conversation_id = c.id and sender_user_id = v_uid and created_at > now() - interval '1 minute') >= 20 then
    perform private.fail('invalid_input', 'You’re sending messages very fast. Wait a moment.');
  end if;

  insert into public.messages (conversation_id, sender, sender_user_id, body) values (c.id, v_sender, v_uid, v_body)
  returning id into v_id;
  update public.conversations
     set last_message_at = now(),
         buyer_read_at = case when v_sender = 'buyer' then now() else buyer_read_at end,
         seller_read_at = case when v_sender = 'seller' then now() else seller_read_at end
   where id = c.id;
  return v_id;
end $$;

create function public.mark_conversation_read(p_conversation_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.require_user();
begin
  update public.conversations
     set buyer_read_at = case when buyer_id = v_uid then now() else buyer_read_at end,
         seller_read_at = case when merchant_id = private.my_merchant_id() then now() else seller_read_at end
   where id = p_conversation_id and (buyer_id = v_uid or merchant_id = private.my_merchant_id());
end $$;

-- Every conversation this account is in, on either side, with unread counts.
create function public.list_conversations() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x."updatedAt" desc), '[]'::jsonb)
  from (
    select
      c.id,
      c.listing_id as "listingId",
      l.title as "listingTitle",
      l.images[1] as "listingImage",
      l.category,
      case when l.kind = 'product' then l.price_kobo else coalesce(l.fallback_price_kobo, l.price_kobo) end as "priceKobo",
      l.status as "listingStatus",
      m.name as "merchantName",
      p.display_name as "buyerName",
      case when c.buyer_id = auth.uid() then 'buyer' else 'seller' end as me,
      (select jsonb_build_object('body', mm.body, 'sender', mm.sender, 'createdAt', mm.created_at)
         from public.messages mm where mm.conversation_id = c.id order by mm.created_at desc limit 1) as "lastMessage",
      (select count(*)::int from public.messages mm
        where mm.conversation_id = c.id
          and case when c.buyer_id = auth.uid() then mm.sender = 'seller' and mm.created_at > c.buyer_read_at
                   else mm.sender = 'buyer' and mm.created_at > c.seller_read_at end) as unread,
      case when c.buyer_id = auth.uid() then (select mc.call_phone from public.merchant_contacts mc where mc.merchant_id = c.merchant_id) end as "callPhone",
      c.last_message_at as "updatedAt"
    from public.conversations c
    join public.listings l on l.id = c.listing_id
    join public.merchants m on m.id = c.merchant_id
    join public.profiles p on p.id = c.buyer_id
    where c.buyer_id = auth.uid() or c.merchant_id = private.my_merchant_id()
  ) x
$$;

-- null turns calls off.
create function public.set_call_phone(p_phone text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_merchant uuid := private.my_merchant_id();
begin
  if v_merchant is null then perform private.fail('forbidden', 'Only sellers can share a call number.'); end if;
  if p_phone is null or btrim(p_phone) = '' then
    delete from public.merchant_contacts where merchant_id = v_merchant;
    return;
  end if;
  if regexp_replace(p_phone, '[\s-]', '', 'g') !~ '^(\+?234|0)[789][01][0-9]{8}$' then
    perform private.fail('invalid_input', 'Enter a Nigerian mobile number, e.g. 0803 123 4567.');
  end if;
  insert into public.merchant_contacts (merchant_id, call_phone) values (v_merchant, btrim(p_phone))
  on conflict (merchant_id) do update set call_phone = excluded.call_phone;
end $$;

revoke execute on function
  private.in_conversation(uuid),
  public.start_conversation(uuid),
  public.send_message(uuid, text),
  public.mark_conversation_read(uuid),
  public.list_conversations(),
  public.set_call_phone(text)
from public, anon, authenticated;
grant execute on function private.in_conversation(uuid) to authenticated; -- used inside the messages policy
grant execute on function
  public.start_conversation(uuid),
  public.send_message(uuid, text),
  public.mark_conversation_read(uuid),
  public.list_conversations(),
  public.set_call_phone(text)
to authenticated;
