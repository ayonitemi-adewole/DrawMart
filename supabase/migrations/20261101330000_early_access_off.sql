-- Early access reached the database from the feature-language branch, but the app on
-- main has no screens or wording for it. Off until that branch is merged: draws open
-- to everyone as soon as they're approved. Setting this back above 0 turns it on again.
update public.app_settings set early_access_minutes = 0 where id;

-- Draws approved while it was on open now, too.
update public.listings set opens_at = null where opens_at is not null;
