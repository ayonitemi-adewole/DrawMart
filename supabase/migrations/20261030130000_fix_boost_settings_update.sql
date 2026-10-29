-- Supabase rejects an UPDATE without a WHERE clause from API calls
-- (pg_safeupdate), even for the one-row app_settings table.
create or replace function public.set_boost_settings(p_min_active_buyers int, p_forced_on boolean, p_max_active int) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  if p_min_active_buyers is null or p_min_active_buyers < 0 then perform private.fail('invalid_input', 'Enter how many active buyers unlock boosts.'); end if;
  if p_max_active is null or p_max_active < 1 then perform private.fail('invalid_input', 'Allow at least one boost at a time.'); end if;
  update public.app_settings
     set boost_min_active_buyers = p_min_active_buyers, boosts_forced_on = coalesce(p_forced_on, false), boost_max_active = p_max_active
   where id;
end $$;
