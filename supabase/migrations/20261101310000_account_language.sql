-- The language a buyer chooses, remembered on their account so it follows them to a
-- new device. Null until they choose. src/i18n/languages.ts.
alter table public.profiles add column language text check (language in ('en', 'pcm'));

create function public.set_language(p_language text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.require_user();
begin
  if p_language is null or p_language not in ('en', 'pcm') then perform private.fail('invalid_input', 'That language isn’t available.'); end if;
  update public.profiles set language = p_language where id = v_uid;
end $$;

revoke execute on function public.set_language(text) from public, anon, authenticated;
grant execute on function public.set_language(text) to authenticated;
