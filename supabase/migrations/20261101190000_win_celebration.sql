-- A winner is greeted with a pop-up the next time they open the app, once,
-- on whichever device that is. Wins already read have been seen, so they don't pop up.
alter table public.notifications add column celebrated_at timestamptz;

update public.notifications set celebrated_at = read_at where kind = 'draw_won' and read_at is not null;

create function public.mark_win_celebrated(p_listing_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.require_user();
begin
  update public.notifications set celebrated_at = now()
  where user_id = v_uid and listing_id = p_listing_id and kind = 'draw_won' and celebrated_at is null;
end $$;

revoke execute on function public.mark_win_celebrated(uuid) from public, anon;
grant execute on function public.mark_win_celebrated(uuid) to authenticated;
