-- Google Business Profile connects with the Google Cloud OAuth client of the client's ORGANIZATION
-- (Settings → Integrations → Google Cloud OAuth: organization_credentials GOOGLE_GBP_CLIENT_ID / _SECRET), instead of
-- the per-user apps of migration 20261128000033 (google_oauth_apps, which never held a row, is left untouched, as is
-- integration_connections.oauth_app_owner).
--
-- A refresh token only works with the OAuth client that issued it. Each Business Profile connection records that
-- client's ID, so a refresh never sends a token to a different client: when an organization replaces its OAuth
-- client, its connections ask to be reconnected instead. Grants made before this column existed are filled in by the
-- first successful refresh (src/lib/integrations/gbp-service.ts). The code works before this is applied (no check).
-- Not readable by signed-in users (integration_connections has column-level grants; this column isn't among them).

alter table public.integration_connections add column if not exists oauth_client_id text
  check (oauth_client_id is null or char_length(oauth_client_id) between 10 and 300);

comment on column public.integration_connections.oauth_client_id is
  'Google OAuth client ID that made this Business Profile grant (the organization''s GOOGLE_GBP_CLIENT_ID at connect time).';

-- Rollback: alter table public.integration_connections drop column if exists oauth_client_id;
