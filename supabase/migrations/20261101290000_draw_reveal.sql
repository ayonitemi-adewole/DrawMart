-- Every ticket holder now sees how a draw turned out when they next open the app,
-- not just the winner. It shows once per draw across devices, stored the same way.
alter table public.push_preferences add column draw_reveal boolean not null default true;

-- Losses from before this: nobody should open the app to a string of old results.
update public.notifications set celebrated_at = now() where kind = 'draw_lost' and celebrated_at is null;

create or replace function public.mark_win_celebrated(p_listing_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.require_user();
begin
  update public.notifications set celebrated_at = now()
  where user_id = v_uid and listing_id = p_listing_id and kind in ('draw_won', 'draw_lost') and celebrated_at is null;
end $$;

-- Same as before, with the result pop-up added. It's a setting for the app, not for
-- push, so nothing else reads it.
create or replace function public.set_push_preference(p_category text, p_enabled boolean) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.require_user();
begin
  perform private.require_buyer(v_uid);
  insert into public.push_preferences (user_id) values (v_uid) on conflict (user_id) do nothing;
  case p_category
    when 'wins' then update public.push_preferences set wins = p_enabled where user_id = v_uid;
    when 'drawResults' then update public.push_preferences set draw_results = p_enabled where user_id = v_uid;
    when 'orders' then update public.push_preferences set orders = p_enabled where user_id = v_uid;
    when 'messages' then update public.push_preferences set messages = p_enabled where user_id = v_uid;
    when 'savedItems' then update public.push_preferences set saved_items = p_enabled where user_id = v_uid;
    when 'drawReveal' then update public.push_preferences set draw_reveal = p_enabled where user_id = v_uid;
    else perform private.fail('invalid_input', 'That isn’t a kind of notification.');
  end case;
end $$;
