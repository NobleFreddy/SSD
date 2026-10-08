-- ============================================================================
-- Dienstplan: Umstellung abschließen (Teil 2)
-- ============================================================================
-- Erst ausführen, wenn die neue App-Version (Anmeldung über ssd_login usw.)
-- online ist. Danach funktioniert die alte App-Version nicht mehr.
--
-- 1. Alte SHA-256-Hashes aus dem Datenbestand nach ssd_private.credentials
--    übernehmen. Beim nächsten Login ersetzt ssd_login sie durch bcrypt.
-- 2. Alle Zugangsgeheimnisse aus dem Datenbestand entfernen.
-- 3. Direkten Tabellenzugriff mit dem öffentlichen Schlüssel sperren — Lesen
--    und Schreiben nur noch über die ssd_*-Funktionen mit gültiger Sitzung.
-- 4. Den Datenbestand nicht mehr über Realtime "postgres_changes" verteilen;
--    die App erhält nur noch die Versionsnummer per Broadcast.

insert into ssd_private.credentials (person_id, pw_hash)
select 'admin', 'legacy-sha256:' || (d.data #>> '{admin,salt}') || ':' || (d.data #>> '{admin,passwordHash}')
from public.ssd_dienstplan_state d
where d.id = 1
  and coalesce(d.data #>> '{admin,passwordHash}', '') ~ '^[0-9a-f]{64}$'
  and coalesce(d.data #>> '{admin,salt}', '') <> ''
on conflict (person_id) do nothing;

insert into ssd_private.credentials (person_id, pw_hash)
select x->>'id', 'legacy-sha256:' || (x->>'salt') || ':' || (x->>'passwordHash')
from public.ssd_dienstplan_state d, jsonb_array_elements(d.data->'students') x
where d.id = 1
  and coalesce(x->>'passwordHash', '') ~ '^[0-9a-f]{64}$'
  and coalesce(x->>'salt', '') <> ''
on conflict (person_id) do nothing;

insert into ssd_private.credentials (person_id, pw_hash)
select 'schulcode', 'legacy-sha256:' || (d.data #>> '{settings,registrationCodeSalt}') || ':' || (d.data #>> '{settings,registrationCodeHash}')
from public.ssd_dienstplan_state d
where d.id = 1
  and coalesce(d.data #>> '{settings,registrationCodeHash}', '') ~ '^[0-9a-f]{64}$'
  and coalesce(d.data #>> '{settings,registrationCodeSalt}', '') <> ''
on conflict (person_id) do nothing;

update public.ssd_dienstplan_state
set data = ssd_private.strip_secrets(data), version = version + 1, updated_at = now()
where id = 1;

drop policy if exists "Public can read Dienstplan state" on public.ssd_dienstplan_state;
drop policy if exists "Public can update Dienstplan state" on public.ssd_dienstplan_state;
revoke all on table public.ssd_dienstplan_state from anon, authenticated;

do $$
begin
  if exists (select 1 from pg_publication_tables
             where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ssd_dienstplan_state') then
    alter publication supabase_realtime drop table public.ssd_dienstplan_state;
  end if;
end $$;
