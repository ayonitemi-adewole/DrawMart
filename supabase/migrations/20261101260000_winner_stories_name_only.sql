-- The Winners page shows a first name and nothing else about the person, so the
-- area goes, including any already stored. domain/winnerStories.ts.
drop function public.share_winner_story(uuid, text, text, boolean, int);
drop function private.winner_story_error(text, text, boolean);

alter table public.winner_stories
  drop constraint winner_stories_details,
  drop column area,
  -- Withdrawing removes the name, not just its visibility.
  add constraint winner_stories_details check (case status when 'withdrawn' then first_name is null else first_name is not null end);

-- winnerStories.ts winnerStoryError
create function private.winner_story_error(p_first_name text, p_consent boolean) returns text
language sql immutable set search_path = ''
as $$
  select case
    when coalesce(trim(p_first_name), '') !~ '^[[:alpha:]''’-]{2,30}$' then 'Enter just your first name: one word, with no numbers.'
    when not coalesce(p_consent, false) then 'Tick the box to agree, or leave this out. Your prize isn’t affected.'
  end
$$;

create function public.share_winner_story(p_listing_id uuid, p_first_name text, p_consent boolean, p_consent_version int) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_error text := private.winner_story_error(p_first_name, p_consent);
begin
  perform private.require_buyer(v_uid);
  if v_error is not null then perform private.fail('invalid_input', v_error); end if;
  if not private.has_won(v_uid, p_listing_id) then perform private.fail('forbidden', 'Only the winner of a draw can share it.'); end if;
  insert into public.winner_stories (user_id, listing_id, first_name, status, consent_version)
  values (v_uid, p_listing_id, trim(p_first_name), 'pending', p_consent_version)
  on conflict (user_id, listing_id) do update
    set first_name = excluded.first_name, status = 'pending', consent_version = excluded.consent_version,
        consent_at = now(), reviewed_at = null, withdrawn_at = null;
  insert into private.winner_consent_log (user_id, listing_id, event, consent_version) values (v_uid, p_listing_id, 'given', p_consent_version);
end $$;

create or replace function public.withdraw_winner_story(p_listing_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_version int;
begin
  update public.winner_stories set status = 'withdrawn', first_name = null, withdrawn_at = now()
   where user_id = v_uid and listing_id = p_listing_id and status <> 'withdrawn'
   returning consent_version into v_version;
  if found then
    insert into private.winner_consent_log (user_id, listing_id, event, consent_version) values (v_uid, p_listing_id, 'withdrawn', v_version);
  end if;
end $$;

create or replace function public.my_winner_stories() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'listingId', s.listing_id, 'listingTitle', l.title, 'firstName', s.first_name, 'status', s.status, 'consentAt', s.consent_at
  ) order by s.created_at desc), '[]'::jsonb)
  from public.winner_stories s join public.listings l on l.id = s.listing_id
  where s.user_id = auth.uid() and s.status <> 'withdrawn'
$$;

-- Public. The first name is the only personal detail that ever leaves this table.
create or replace function public.winners_wall() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(w order by w."drawnAt" desc), '[]'::jsonb) from (
    select s.id, s.first_name as "firstName", s.listing_id as "listingId", l.product_code as "productCode", l.title as "listingTitle",
           l.images[1] as "listingImage", l.category, r.winning_number as "winningNumber", l.ticket_count as "ticketCount", r.drawn_at as "drawnAt"
      from public.winner_stories s
      join public.listings l on l.id = s.listing_id
      join public.draw_results r on r.listing_id = s.listing_id
     where s.status = 'approved'
     order by r.drawn_at desc
     limit 60
  ) w
$$;

create or replace function public.pending_winner_stories() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'firstName', s.first_name, 'listingId', s.listing_id, 'productCode', l.product_code, 'listingTitle', l.title, 'consentAt', s.consent_at
    ) order by s.consent_at), '[]'::jsonb)
    from public.winner_stories s join public.listings l on l.id = s.listing_id
    where s.status = 'pending'
  );
end $$;

revoke execute on function private.winner_story_error(text, boolean), public.share_winner_story(uuid, text, boolean, int) from public, anon, authenticated;
grant execute on function public.share_winner_story(uuid, text, boolean, int) to authenticated;
