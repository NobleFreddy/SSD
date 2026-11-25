-- ============================================================================
-- „Angemeldet bleiben“ auf dem eigenen Gerät
-- ============================================================================
-- Rein ergänzend: neue Spalten an ssd_private.sessions und vier neue Funktionen.
-- Anmeldung (ssd_login), Laden und Speichern bleiben unverändert, der Datenstand
-- (ssd_dienstplan_state) wird nicht angefasst. Bestehende Anmeldungen laufen
-- weiter wie bisher (12 Stunden).
--
-- Regeln:
--  - nur auf ausdrücklichen Wunsch, direkt nach einer Anmeldung mit Passwort
--  - nur Sanis und Azubis; der Administrator-Zugang endet weiter nach 12 Stunden
--  - 60 Tage ab der letzten Nutzung, höchstens ein Jahr ab der Anmeldung
--  - höchstens 10 Geräte pro Person (das am längsten ungenutzte fällt weg)
--  - ein neues Passwort beendet alle anderen Anmeldungen (ssd_set_password, wie bisher);
--    deaktivierte oder gelöschte Personen verlieren den Zugang sofort (session_info, wie bisher)
--
-- Gespeichert wird zusätzlich nur eine grobe Gerätebezeichnung („iPhone · Safari“),
-- damit man in „Mein Konto“ ein verlorenes Gerät abmelden kann.

alter table ssd_private.sessions
  add column if not exists id uuid not null default gen_random_uuid(),   -- Kennung für die Geräteliste (das Token selbst verlässt die Datenbank nie)
  add column if not exists remembered boolean not null default false,
  add column if not exists device text,
  add column if not exists last_used_at timestamptz not null default now();
create unique index if not exists sessions_id_key on ssd_private.sessions (id);

/** Nur Buchstaben, Ziffern und wenige Trennzeichen, höchstens 60 Zeichen; leer → null. */
create or replace function ssd_private.clean_device(p_device text)
returns text language sql immutable set search_path = '' as $$
  select nullif(btrim(left(regexp_replace(coalesce(p_device, ''), '[^[:alnum:] ·.-]', '', 'g'), 60)), '');
$$;

/** Macht aus der eben begonnenen Anmeldung eine dauerhafte („Angemeldet bleiben“). */
create or replace function public.ssd_remember(p_token text, p_device text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  d jsonb; info record; v_expires timestamptz;
  v_hash text := ssd_private.hash_token(p_token);
begin
  select s.data into d from public.ssd_dienstplan_state s where s.id = 1;
  select * into info from ssd_private.session_info(d, p_token);
  if info.person_id is null then return jsonb_build_object('ok', false, 'error', 'session'); end if;
  if info.person_id = 'admin' then
    return jsonb_build_object('ok', false, 'error', 'Der Administrator-Zugang kann nicht angemeldet bleiben.');
  end if;
  -- Nur direkt nach der Passworteingabe: Eine offen stehen gelassene Sitzung lässt sich nicht nachträglich verlängern.
  update ssd_private.sessions s
     set remembered = true, device = ssd_private.clean_device(p_device), last_used_at = now(),
         expires_at = now() + interval '60 days'
   where s.token_hash = v_hash and not s.remembered and s.created_at > now() - interval '15 minutes'
  returning s.expires_at into v_expires;
  if v_expires is null then
    return jsonb_build_object('ok', false, 'error', 'Bitte melden Sie sich dafür neu an.');
  end if;
  delete from ssd_private.sessions s
   where s.person_id = info.person_id and s.remembered and s.token_hash not in (
     select x.token_hash from ssd_private.sessions x
      where x.person_id = info.person_id and x.remembered
      order by (x.token_hash = v_hash) desc, x.last_used_at desc
      limit 10);
  perform ssd_private.audit(info.person_id, 'remember');
  return jsonb_build_object('ok', true, 'expiresAt', v_expires);
end $$;

/** Verlängert eine dauerhafte Anmeldung bei Nutzung (die App ruft das höchstens zweimal am Tag auf). */
create or replace function public.ssd_renew(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare d jsonb; info record; v_expires timestamptz;
begin
  select s.data into d from public.ssd_dienstplan_state s where s.id = 1;
  select * into info from ssd_private.session_info(d, p_token);
  if info.person_id is null then return jsonb_build_object('ok', false, 'error', 'session'); end if;
  update ssd_private.sessions s
     set last_used_at = now(),
         expires_at = least(now() + interval '60 days', s.created_at + interval '365 days')
   where s.token_hash = ssd_private.hash_token(p_token) and s.remembered
  returning s.expires_at into v_expires;
  return jsonb_build_object('ok', true, 'remembered', v_expires is not null, 'expiresAt', v_expires);
end $$;

/** Eigene Anmeldungen für „Mein Konto“ — nur die der angemeldeten Person. */
create or replace function public.ssd_sessions(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare d jsonb; info record; v_hash text := ssd_private.hash_token(p_token);
begin
  select s.data into d from public.ssd_dienstplan_state s where s.id = 1;
  select * into info from ssd_private.session_info(d, p_token);
  if info.person_id is null then return jsonb_build_object('ok', false, 'error', 'session'); end if;
  return jsonb_build_object('ok', true, 'sessions', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', s.id, 'current', s.token_hash = v_hash, 'remembered', s.remembered, 'device', s.device,
             'createdAt', s.created_at, 'lastUsedAt', s.last_used_at, 'expiresAt', s.expires_at)
             order by (s.token_hash = v_hash) desc, s.last_used_at desc), '[]'::jsonb)
      from ssd_private.sessions s
     where s.person_id = info.person_id and s.expires_at > now()));
end $$;

/** Beendet eine andere eigene Anmeldung bzw. (ohne p_session) alle anderen. Die aktuelle beendet ssd_logout. */
create or replace function public.ssd_end_sessions(p_token text, p_session uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare d jsonb; info record; v_count int;
begin
  select s.data into d from public.ssd_dienstplan_state s where s.id = 1;
  select * into info from ssd_private.session_info(d, p_token);
  if info.person_id is null then return jsonb_build_object('ok', false, 'error', 'session'); end if;
  delete from ssd_private.sessions s
   where s.person_id = info.person_id
     and s.token_hash <> ssd_private.hash_token(p_token)
     and (p_session is null or s.id = p_session);
  get diagnostics v_count = row_count;
  if v_count > 0 then perform ssd_private.audit(info.person_id, 'sessions_ended', v_count::text); end if;
  return jsonb_build_object('ok', true, 'ended', v_count);
end $$;

-- Rechte wie bei den übrigen Funktionen: Schnittstelle für die App, Hilfsfunktion nur intern.
revoke all on function ssd_private.clean_device(text) from public, anon, authenticated;
revoke all on function public.ssd_remember(text, text), public.ssd_renew(text), public.ssd_sessions(text),
  public.ssd_end_sessions(text, uuid) from public;
grant execute on function public.ssd_remember(text, text), public.ssd_renew(text), public.ssd_sessions(text),
  public.ssd_end_sessions(text, uuid) to anon, authenticated;
