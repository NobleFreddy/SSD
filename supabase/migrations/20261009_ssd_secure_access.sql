-- ============================================================================
-- Dienstplan: serverseitige Anmeldung und Zugriffskontrolle (Teil 1, additiv)
-- ============================================================================
-- Die App greift nur noch über die Funktionen public.ssd_* (RPC) auf die Daten
-- zu. Passwörter liegen als bcrypt-Hash in ssd_private.credentials und
-- verlassen die Datenbank nie; Sitzungen laufen über zufällige Tokens, von
-- denen nur der Hash gespeichert wird. Beim Laden bekommt jede Rolle nur, was
-- sie braucht, beim Speichern übernimmt der Server von Sanis/Azubis nur die
-- Bereiche, die sie ändern dürfen.
--
-- Diese Migration ist additiv: Die bisherige direkte Tabellenfreigabe bleibt
-- bestehen, bis die neue App-Version online ist. Danach schaltet
-- 20261009_ssd_secure_access_cutover.sql den direkten Zugriff ab.

-- ---------------------------------------------------------------------------
-- Private Tabellen (nicht über die API erreichbar)
-- ---------------------------------------------------------------------------

create table if not exists ssd_private.credentials (
  person_id text primary key,            -- 'admin', 'schulcode' oder ID einer Person aus dem Datenbestand
  pw_hash text not null,                 -- bcrypt, übergangsweise 'legacy-sha256:<salt>:<hash>'
  must_change boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists ssd_private.sessions (
  token_hash text primary key,
  person_id text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists sessions_person_idx on ssd_private.sessions (person_id);

create table if not exists ssd_private.login_attempts (
  id bigint generated always as identity primary key,
  username text not null,
  at timestamptz not null default now(),
  success boolean not null
);
create index if not exists login_attempts_user_idx on ssd_private.login_attempts (username, at);

create table if not exists ssd_private.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  person_id text,
  action text not null,
  detail text
);
create index if not exists audit_log_at_idx on ssd_private.audit_log (at);

alter table ssd_private.credentials enable row level security;
alter table ssd_private.sessions enable row level security;
alter table ssd_private.login_attempts enable row level security;
alter table ssd_private.audit_log enable row level security;
revoke all on ssd_private.credentials, ssd_private.sessions, ssd_private.login_attempts, ssd_private.audit_log
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Hilfsfunktionen
-- ---------------------------------------------------------------------------

create or replace function ssd_private.hash_token(p_token text)
returns text language sql immutable set search_path = '' as $$
  select encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
$$;

create or replace function ssd_private.json_true(v jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(v = 'true'::jsonb, false);
$$;

create or replace function ssd_private.audit(p_person text, p_action text, p_detail text default null)
returns void language sql security definer set search_path = '' as $$
  insert into ssd_private.audit_log (person_id, action, detail) values (p_person, p_action, left(p_detail, 300));
$$;

create or replace function ssd_private.student_by_id(d jsonb, p_id text)
returns jsonb language sql immutable set search_path = '' as $$
  select x from jsonb_array_elements(case when jsonb_typeof(d->'students') = 'array' then d->'students' else '[]'::jsonb end) x
  where jsonb_typeof(x) = 'object' and x->>'id' = p_id
  limit 1;
$$;

create or replace function ssd_private.student_by_username(d jsonb, p_username text)
returns jsonb language sql immutable set search_path = '' as $$
  select x from jsonb_array_elements(case when jsonb_typeof(d->'students') = 'array' then d->'students' else '[]'::jsonb end) x
  where jsonb_typeof(x) = 'object' and lower(x->>'username') = lower(trim(p_username))
  limit 1;
$$;

create or replace function ssd_private.normalize_code(p_code text)
returns text language sql immutable set search_path = '' as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[[:space:]-]', '', 'g'));
$$;

/** Entfernt alle Zugangsgeheimnisse aus dem Datenbestand. */
create or replace function ssd_private.strip_secrets(d jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare r jsonb := d;
begin
  if jsonb_typeof(r) is distinct from 'object' then return r; end if;
  if jsonb_typeof(r->'admin') = 'object' then
    r := jsonb_set(r, '{admin}', (r->'admin') - 'passwordHash' - 'salt');
  end if;
  if jsonb_typeof(r->'settings') = 'object' then
    r := jsonb_set(r, '{settings}', (r->'settings') - 'registrationCodeHash' - 'registrationCodeSalt');
  end if;
  if jsonb_typeof(r->'students') = 'array' then
    r := jsonb_set(r, '{students}', (
      select coalesce(jsonb_agg(case when jsonb_typeof(x) = 'object' then x - 'passwordHash' - 'salt' else x end order by o), '[]'::jsonb)
      from jsonb_array_elements(r->'students') with ordinality as t(x, o)));
  end if;
  return r;
end $$;

/** Was eine Rolle zu sehen bekommt: nie Geheimnisse; Sanis/Azubis keine Bemerkungen und Hinweise zu anderen Personen. */
create or replace function ssd_private.view_for(d jsonb, p_person text, p_role text)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare r jsonb := ssd_private.strip_secrets(d);
begin
  if p_role = 'admin' or jsonb_typeof(r->'students') is distinct from 'array' then return r; end if;
  return jsonb_set(r, '{students}', (
    select coalesce(jsonb_agg(case when jsonb_typeof(x) = 'object' and x->>'id' is distinct from p_person
                                   then x - 'notes' - 'adminMessage' else x end order by o), '[]'::jsonb)
    from jsonb_array_elements(r->'students') with ordinality as t(x, o)));
end $$;

/** Passwort-Hash einer Person; übergangsweise auch der alte SHA-256-Hash aus dem Datenbestand. */
create or replace function ssd_private.stored_hash(d jsonb, p_person text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare h text; rec jsonb;
begin
  select c.pw_hash into h from ssd_private.credentials c where c.person_id = p_person;
  if h is not null then return h; end if;
  if p_person = 'schulcode' then
    if coalesce(d #>> '{settings,registrationCodeHash}', '') ~ '^[0-9a-f]{64}$' and coalesce(d #>> '{settings,registrationCodeSalt}', '') <> '' then
      return 'legacy-sha256:' || (d #>> '{settings,registrationCodeSalt}') || ':' || (d #>> '{settings,registrationCodeHash}');
    end if;
    return null;
  end if;
  rec := case when p_person = 'admin' then d->'admin' else ssd_private.student_by_id(d, p_person) end;
  if jsonb_typeof(rec) = 'object' and coalesce(rec->>'passwordHash', '') ~ '^[0-9a-f]{64}$' and coalesce(rec->>'salt', '') <> '' then
    return 'legacy-sha256:' || (rec->>'salt') || ':' || (rec->>'passwordHash');
  end if;
  return null;
end $$;

create or replace function ssd_private.check_password(p_password text, p_hash text)
returns boolean language plpgsql stable set search_path = '' as $$
begin
  if p_password is null or p_hash is null then return false; end if;
  if p_hash like '$2%' then
    return extensions.crypt(p_password, p_hash) = p_hash;
  elsif p_hash like 'legacy-sha256:%' then
    -- Verfahren der früheren App-Version: SHA-256 über "<salt>::<passwort>"
    return encode(extensions.digest(split_part(p_hash, ':', 2) || '::' || p_password, 'sha256'), 'hex') = split_part(p_hash, ':', 3);
  end if;
  return false;
end $$;

create or replace function ssd_private.set_credentials(p_person text, p_password text, p_must_change boolean)
returns void language sql security definer set search_path = '' as $$
  insert into ssd_private.credentials (person_id, pw_hash, must_change, updated_at)
  values (p_person, extensions.crypt(p_password, extensions.gen_salt('bf', 10)), p_must_change, now())
  on conflict (person_id) do update
    set pw_hash = excluded.pw_hash, must_change = excluded.must_change, updated_at = now();
$$;

create or replace function ssd_private.new_session(p_person text)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare v_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  insert into ssd_private.sessions (token_hash, person_id, expires_at)
  values (ssd_private.hash_token(v_token), p_person, now() + interval '12 hours');
  return v_token;
end $$;

/** Gültige Sitzung → Person, Rolle, Team-Leitung. Deaktivierte oder gelöschte Personen verlieren den Zugang sofort. */
create or replace function ssd_private.session_info(d jsonb, p_token text, out person_id text, out role text, out is_lead boolean)
returns record language plpgsql stable security definer set search_path = '' as $$
declare v_pid text; rec jsonb;
begin
  if p_token is null or length(p_token) < 32 then return; end if;
  select s.person_id into v_pid from ssd_private.sessions s
   where s.token_hash = ssd_private.hash_token(p_token) and s.expires_at > now();
  if v_pid is null then return; end if;
  if v_pid = 'admin' then
    person_id := 'admin'; role := 'admin'; is_lead := true;
    return;
  end if;
  rec := ssd_private.student_by_id(d, v_pid);
  if rec is null or not ssd_private.json_true(rec->'active') then return; end if;
  person_id := v_pid;
  role := coalesce(nullif(rec->>'role', ''), 'student');
  is_lead := coalesce(rec->>'leadershipRole', '') <> '';
end $$;

/** Übergangszeit: alte Hashes im Datenbestand gehen beim Speichern durch die neue App nicht verloren. */
create or replace function ssd_private.reattach_legacy_secrets(stored jsonb, r jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare res jsonb := r;
begin
  if jsonb_typeof(stored->'admin') = 'object' and (stored->'admin') ? 'passwordHash' and jsonb_typeof(res->'admin') = 'object' then
    res := jsonb_set(res, '{admin}', (res->'admin') || jsonb_build_object('passwordHash', stored #> '{admin,passwordHash}', 'salt', stored #> '{admin,salt}'));
  end if;
  if jsonb_typeof(stored->'settings') = 'object' and coalesce(stored #>> '{settings,registrationCodeHash}', '') <> '' and jsonb_typeof(res->'settings') = 'object' then
    res := jsonb_set(res, '{settings}', (res->'settings') || jsonb_build_object(
      'registrationCodeHash', stored #> '{settings,registrationCodeHash}', 'registrationCodeSalt', stored #> '{settings,registrationCodeSalt}'));
  end if;
  if jsonb_typeof(res->'students') = 'array' and jsonb_typeof(stored->'students') = 'array' then
    res := jsonb_set(res, '{students}', (
      select coalesce(jsonb_agg(
        case when jsonb_typeof(x) = 'object' and coalesce(ssd_private.student_by_id(stored, x->>'id') ? 'passwordHash', false)
             then x || jsonb_build_object('passwordHash', ssd_private.student_by_id(stored, x->>'id')->'passwordHash',
                                          'salt', ssd_private.student_by_id(stored, x->>'id')->'salt')
             else x end order by o), '[]'::jsonb)
      from jsonb_array_elements(res->'students') with ordinality as t(x, o)));
  end if;
  return res;
end $$;

/**
 * Führt einen gespeicherten und einen eingehenden Stand zusammen.
 * Administrator: übernimmt alles außer Zugangsgeheimnissen.
 * Sanis/Azubis (auch Sanisprecher:innen): Einstellungen, Kalender, Schule und
 * Administrator-Daten bleiben unverändert; bei Personen bleiben Stammdaten,
 * Rolle, Funktion, Bemerkungen und Freischaltung geschützt; fremde
 * Verfügbarkeiten und Wunschpartner:innen ebenfalls. Neue Personen kommen nur
 * über ssd_register hinzu, löschen dürfen nur Sanisprecher:innen – und nur
 * Registrierungen, die noch auf Freischaltung warten.
 */
create or replace function ssd_private.merge_incoming(stored jsonb, incoming jsonb, p_person text, p_role text, p_is_lead boolean)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  res jsonb := ssd_private.strip_secrets(incoming);
  stored_students jsonb := case when jsonb_typeof(stored->'students') = 'array' then stored->'students' else '[]'::jsonb end;
  incoming_students jsonb := case when jsonb_typeof(res->'students') = 'array' then res->'students' else '[]'::jsonb end;
  merged jsonb := '[]'::jsonb;
  s jsonb; inc jsonb; m jsonb; k text; ids text[];
  protected constant text[] := array['id', 'username', 'firstName', 'lastName', 'role', 'leadershipRole', 'gender',
    'schoolClass', 'yearGroup', 'maxDutiesPerWeek', 'notes', 'adminMessage', 'createdAt', 'passwordHash', 'salt',
    'active', 'pendingApproval'];
  others_protected constant text[] := array['availability', 'availabilityUpdatedAt', 'preferredPartnerIds'];
begin
  if p_role = 'admin' then
    res := ssd_private.reattach_legacy_secrets(stored, res);
    -- Die Einrichtung bleibt abgeschlossen (sonst ließe sie sich von außen neu starten).
    if ssd_private.json_true(stored #> '{meta,setupComplete}') then
      res := jsonb_set(res, '{meta}', coalesce(case when jsonb_typeof(res->'meta') = 'object' then res->'meta' end, '{}'::jsonb)
        || '{"setupComplete": true}'::jsonb);
      if jsonb_typeof(res->'admin') is distinct from 'object' or coalesce(res #>> '{admin,username}', '') = '' then
        res := jsonb_set(res, '{admin}', stored->'admin');
      end if;
    end if;
    return res;
  end if;

  foreach k in array array['admin', 'settings', 'school', 'dutyBlockConfig', 'specialDays', 'version'] loop
    if stored ? k then res := jsonb_set(res, array[k], stored->k); else res := res - k; end if;
  end loop;
  res := jsonb_set(res, '{meta}', coalesce(case when jsonb_typeof(stored->'meta') = 'object' then stored->'meta' end, '{}'::jsonb)
    || jsonb_build_object('lastModifiedAt', coalesce(res #> '{meta,lastModifiedAt}', stored #> '{meta,lastModifiedAt}')));

  for s in select x from jsonb_array_elements(stored_students) x loop
    inc := (select x from jsonb_array_elements(incoming_students) x where jsonb_typeof(x) = 'object' and x->>'id' = s->>'id' limit 1);
    if inc is null then
      if p_is_lead and ssd_private.json_true(s->'pendingApproval') then continue; end if; -- abgelehnte Registrierung
      merged := merged || jsonb_build_array(s);
      continue;
    end if;
    m := inc;
    foreach k in array protected loop
      if s ? k then m := jsonb_set(m, array[k], s->k); else m := m - k; end if;
    end loop;
    if p_is_lead and ssd_private.json_true(s->'pendingApproval') then
      -- Freischaltung durch die Team-Leitung
      m := m || jsonb_build_object('active', coalesce(inc->'active', s->'active'),
                                   'pendingApproval', coalesce(inc->'pendingApproval', s->'pendingApproval'));
    end if;
    if s->>'id' is distinct from p_person then
      foreach k in array others_protected loop
        if s ? k then m := jsonb_set(m, array[k], s->k); else m := m - k; end if;
      end loop;
      if not p_is_lead then
        if s ? 'availabilityReminderAt' then m := jsonb_set(m, '{availabilityReminderAt}', s->'availabilityReminderAt');
        else m := m - 'availabilityReminderAt'; end if;
      end if;
    end if;
    merged := merged || jsonb_build_array(m);
  end loop;

  -- Wunschpartner:innen, die es nicht mehr gibt, austragen
  ids := array(select x->>'id' from jsonb_array_elements(merged) x);
  merged := (
    select coalesce(jsonb_agg(
      case when jsonb_typeof(x->'preferredPartnerIds') = 'array' then
        jsonb_set(x, '{preferredPartnerIds}', coalesce((
          select jsonb_agg(p) from jsonb_array_elements(x->'preferredPartnerIds') p where p #>> '{}' = any (ids)), '[]'::jsonb))
      else x end order by o), '[]'::jsonb)
    from jsonb_array_elements(merged) with ordinality as t(x, o));
  return jsonb_set(res, '{students}', merged);
end $$;

-- ---------------------------------------------------------------------------
-- Öffentliche Funktionen (RPC) — die einzige Schnittstelle der App
-- ---------------------------------------------------------------------------

/** Was die Anmeldeseite und die Datenschutzhinweise ohne Anmeldung brauchen — keine personenbezogenen Daten. */
create or replace function public.ssd_public_info()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare d jsonb;
begin
  select s.data into d from public.ssd_dienstplan_state s where s.id = 1;
  d := coalesce(d, '{}'::jsonb);
  return jsonb_build_object(
    'setupComplete', ssd_private.json_true(d #> '{meta,setupComplete}') and jsonb_typeof(d->'admin') = 'object',
    'schoolName', coalesce(d #>> '{school,name}', ''),
    'selfRegistration', coalesce(d #> '{settings,allowSelfRegistration}', 'true'::jsonb) = 'true'::jsonb,
    'hasRegistrationCode', ssd_private.stored_hash(d, 'schulcode') is not null,
    'privacy', coalesce(case when jsonb_typeof(d #> '{settings,privacy}') = 'object' then d #> '{settings,privacy}' end, '{}'::jsonb),
    'retention', coalesce(case when jsonb_typeof(d #> '{settings,retention}') = 'object' then d #> '{settings,retention}' end, '{}'::jsonb),
    'teamsEnabled', ssd_private.json_true(d #> '{settings,teams,enabled}'));
end $$;

create or replace function public.ssd_login(p_role text, p_username text, p_password text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  d jsonb; rec jsonb; v_pid text; v_hash text; v_fails int; v_must boolean;
  v_user text := lower(trim(coalesce(p_username, '')));
begin
  if v_user = '' or coalesce(p_password, '') = '' then
    return jsonb_build_object('ok', false, 'error', 'Bitte Benutzername und Passwort eingeben.');
  end if;
  select count(*) into v_fails from ssd_private.login_attempts a
   where a.username = v_user and not a.success and a.at > now() - interval '15 minutes';
  if v_fails >= 8 then
    return jsonb_build_object('ok', false, 'error', 'Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.');
  end if;

  select s.data into d from public.ssd_dienstplan_state s where s.id = 1;
  if p_role = 'admin' then
    if lower(coalesce(d #>> '{admin,username}', '')) = v_user then v_pid := 'admin'; end if;
  else
    rec := ssd_private.student_by_username(d, v_user);
    v_pid := rec->>'id';
  end if;
  if v_pid is not null then v_hash := ssd_private.stored_hash(d, v_pid); end if;
  if v_hash is null then
    perform extensions.crypt(p_password, '$2a$10$0123456789abcdefghijkl'); -- gleiche Rechenzeit wie bei vorhandenen Konten
  end if;
  if v_hash is null or not ssd_private.check_password(p_password, v_hash) then
    insert into ssd_private.login_attempts (username, success) values (v_user, false);
    if v_pid is not null then perform ssd_private.audit(v_pid, 'login_failed'); end if;
    return jsonb_build_object('ok', false, 'error', 'Benutzername oder Passwort ist falsch.');
  end if;
  if v_pid <> 'admin' and not ssd_private.json_true(rec->'active') then
    return jsonb_build_object('ok', false, 'error', case when ssd_private.json_true(rec->'pendingApproval')
      then 'Ihr Konto wartet noch auf die Freischaltung durch die Administration oder die Sanisprecher:innen.'
      else 'Dieses Konto ist deaktiviert. Bitte an den Administrator wenden.' end);
  end if;

  if v_hash not like '$2%' then
    perform ssd_private.set_credentials(v_pid, p_password, false); -- alten SHA-256-Hash durch bcrypt ersetzen
  end if;
  select c.must_change into v_must from ssd_private.credentials c where c.person_id = v_pid;
  insert into ssd_private.login_attempts (username, success) values (v_user, true);
  perform ssd_private.audit(v_pid, 'login');
  return jsonb_build_object(
    'ok', true,
    'token', ssd_private.new_session(v_pid),
    'role', case when v_pid = 'admin' then 'admin' else coalesce(nullif(rec->>'role', ''), 'student') end,
    'personId', case when v_pid = 'admin' then null else v_pid end,
    'mustChangePassword', coalesce(v_must, false),
    'weakPassword', length(p_password) < 10);
end $$;

create or replace function public.ssd_logout(p_token text)
returns void language sql volatile security definer set search_path = '' as $$
  delete from ssd_private.sessions where token_hash = ssd_private.hash_token(p_token);
$$;

create or replace function public.ssd_load(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare d jsonb; v bigint; info record;
begin
  select s.data, s.version into d, v from public.ssd_dienstplan_state s where s.id = 1;
  select * into info from ssd_private.session_info(d, p_token);
  if info.person_id is null then return jsonb_build_object('ok', false, 'error', 'session'); end if;
  return jsonb_build_object('ok', true, 'data', ssd_private.view_for(d, info.person_id, info.role), 'version', v,
    'role', info.role, 'personId', case when info.person_id = 'admin' then null else info.person_id end);
end $$;

create or replace function public.ssd_version(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare d jsonb; v bigint; info record;
begin
  select s.data, s.version into d, v from public.ssd_dienstplan_state s where s.id = 1;
  select * into info from ssd_private.session_info(d, p_token);
  if info.person_id is null then return jsonb_build_object('ok', false, 'error', 'session'); end if;
  return jsonb_build_object('ok', true, 'version', v);
end $$;

create or replace function public.ssd_save(p_token text, p_data jsonb, p_expected_version bigint)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare d jsonb; v bigint; info record; merged jsonb; ids text[];
begin
  if jsonb_typeof(p_data) is distinct from 'object' or jsonb_typeof(p_data->'students') is distinct from 'array' then
    return jsonb_build_object('ok', false, 'error', 'Ungültiges Datenformat.');
  end if;
  if pg_column_size(p_data) > 4000000 then
    return jsonb_build_object('ok', false, 'error', 'Der Datenbestand ist zu groß.');
  end if;
  select s.data, s.version into d, v from public.ssd_dienstplan_state s where s.id = 1 for update;
  select * into info from ssd_private.session_info(d, p_token);
  if info.person_id is null then return jsonb_build_object('ok', false, 'error', 'session'); end if;
  if p_expected_version is distinct from v then
    return jsonb_build_object('ok', false, 'conflict', true, 'data', ssd_private.view_for(d, info.person_id, info.role), 'version', v);
  end if;

  merged := ssd_private.merge_incoming(d, p_data, info.person_id, info.role, info.is_lead);
  update public.ssd_dienstplan_state set data = merged, version = v + 1, updated_at = now() where id = 1;

  -- Zugänge gelöschter Personen sofort entfernen
  ids := array(select x->>'id' from jsonb_array_elements(merged->'students') x);
  delete from ssd_private.credentials c where c.person_id not in ('admin', 'schulcode') and not (c.person_id = any (ids));
  delete from ssd_private.sessions s where s.person_id <> 'admin' and not (s.person_id = any (ids));

  perform ssd_private.audit(info.person_id, 'save', 'Version ' || (v + 1));
  return jsonb_build_object('ok', true, 'version', v + 1);
end $$;

create or replace function public.ssd_register(p_student jsonb, p_password text, p_code text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  d jsonb; v bigint; rec jsonb; v_code_hash text; v_active boolean; v_recent int; v_fails int;
  v_id text := coalesce(p_student->>'id', '');
  v_user text := trim(coalesce(p_student->>'username', ''));
  v_role text := coalesce(nullif(p_student->>'role', ''), 'student');
  v_gender text := coalesce(nullif(p_student->>'gender', ''), 'n');
  v_year jsonb := p_student->'yearGroup';
begin
  if jsonb_typeof(p_student) is distinct from 'object' or pg_column_size(p_student) > 20000 then
    return jsonb_build_object('ok', false, 'error', 'Ungültige Angaben.');
  end if;
  select s.data, s.version into d, v from public.ssd_dienstplan_state s where s.id = 1 for update;
  if not ssd_private.json_true(d #> '{meta,setupComplete}')
     or coalesce(d #> '{settings,allowSelfRegistration}', 'true'::jsonb) <> 'true'::jsonb then
    return jsonb_build_object('ok', false, 'error', 'Die Selbstregistrierung ist derzeit nicht möglich.');
  end if;
  select count(*) into v_recent from ssd_private.audit_log a where a.action = 'register' and a.at > now() - interval '1 hour';
  if v_recent >= 30 then
    return jsonb_build_object('ok', false, 'error', 'Gerade gehen sehr viele Registrierungen ein. Bitte später erneut versuchen.');
  end if;

  if v_id !~ '^stu_[a-z0-9]{6,24}$' or ssd_private.student_by_id(d, v_id) is not null
     or v_role not in ('student', 'azubi') or v_gender not in ('w', 'm', 'd', 'n') then
    return jsonb_build_object('ok', false, 'error', 'Ungültige Angaben.');
  end if;
  if length(trim(coalesce(p_student->>'firstName', ''))) not between 1 and 60
     or length(trim(coalesce(p_student->>'lastName', ''))) not between 1 and 60 then
    return jsonb_build_object('ok', false, 'error', 'Bitte Vor- und Nachnamen angeben.');
  end if;
  if v_user !~ '^[A-Za-z0-9._-]{3,32}$' then
    return jsonb_build_object('ok', false, 'error', 'Benutzername: 3–32 Zeichen, nur Buchstaben/Zahlen/._-');
  end if;
  if ssd_private.student_by_username(d, v_user) is not null or lower(coalesce(d #>> '{admin,username}', '')) = lower(v_user) then
    return jsonb_build_object('ok', false, 'error', 'Dieser Benutzername ist bereits vergeben.');
  end if;
  if length(coalesce(p_password, '')) not between 10 and 200 then
    return jsonb_build_object('ok', false, 'error', 'Das Passwort muss mindestens 10 Zeichen lang sein.');
  end if;
  if jsonb_typeof(v_year) is distinct from 'number' then
    v_year := 'null'::jsonb;
  elsif (v_year #>> '{}')::numeric not between 2000 and 2100 then
    v_year := 'null'::jsonb;
  end if;

  v_code_hash := ssd_private.stored_hash(d, 'schulcode');
  v_active := false;
  if v_code_hash is not null then
    select count(*) into v_fails from ssd_private.login_attempts a
     where a.username = '#schulcode' and not a.success and a.at > now() - interval '15 minutes';
    if v_fails >= 20 then
      return jsonb_build_object('ok', false, 'error', 'Zu viele falsche Schulcodes. Bitte in 15 Minuten erneut versuchen.');
    end if;
    if not ssd_private.check_password(ssd_private.normalize_code(p_code), v_code_hash) then
      insert into ssd_private.login_attempts (username, success) values ('#schulcode', false);
      return jsonb_build_object('ok', false, 'error', 'Der Schulcode ist nicht korrekt. Bitte prüfen Sie die Eingabe.');
    end if;
    v_active := true;
  end if;

  rec := (p_student - 'passwordHash' - 'salt') || jsonb_build_object(
    'id', v_id, 'username', v_user,
    'firstName', trim(p_student->>'firstName'), 'lastName', trim(p_student->>'lastName'),
    'role', v_role, 'gender', v_gender,
    'schoolClass', left(trim(coalesce(p_student->>'schoolClass', '')), 20),
    'yearGroup', v_year,
    'leadershipRole', null, 'notes', '', 'adminMessage', '', 'maxDutiesPerWeek', null,
    'preferredPartnerIds', '[]'::jsonb, 'dutyLog', '[]'::jsonb, 'availabilityReminderAt', null,
    'active', v_active, 'pendingApproval', not v_active,
    'createdAt', to_jsonb(now()));
  update public.ssd_dienstplan_state
     set data = jsonb_set(d, '{students}', case when jsonb_typeof(d->'students') = 'array' then d->'students' else '[]'::jsonb end || jsonb_build_array(rec)),
         version = v + 1, updated_at = now()
   where id = 1;
  perform ssd_private.set_credentials(v_id, p_password, false);
  perform ssd_private.audit(v_id, 'register', case when v_active then 'mit Schulcode' else 'wartet auf Freischaltung' end);
  if v_active then
    return jsonb_build_object('ok', true, 'token', ssd_private.new_session(v_id), 'personId', v_id, 'role', v_role);
  end if;
  return jsonb_build_object('ok', true, 'pending', true);
end $$;

create or replace function public.ssd_setup(p_data jsonb, p_username text, p_password text, p_code text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare d jsonb; v bigint; v_exists boolean; res jsonb; v_code text := ssd_private.normalize_code(p_code);
begin
  select s.data, s.version into d, v from public.ssd_dienstplan_state s where s.id = 1 for update;
  v_exists := found;
  if v_exists and ssd_private.json_true(d #> '{meta,setupComplete}') and jsonb_typeof(d->'admin') = 'object' then
    return jsonb_build_object('ok', false, 'error', 'Die Einrichtung ist bereits abgeschlossen.');
  end if;
  if jsonb_typeof(p_data) is distinct from 'object' or jsonb_typeof(p_data->'students') is distinct from 'array' then
    return jsonb_build_object('ok', false, 'error', 'Ungültiges Datenformat.');
  end if;
  if trim(coalesce(p_username, '')) !~ '^[A-Za-z0-9._-]{3,32}$' then
    return jsonb_build_object('ok', false, 'error', 'Der Benutzername ist ungültig (3–32 Zeichen, Buchstaben/Zahlen/._-).');
  end if;
  if length(coalesce(p_password, '')) not between 10 and 200 then
    return jsonb_build_object('ok', false, 'error', 'Das Passwort muss mindestens 10 Zeichen lang sein.');
  end if;
  if v_code <> '' and length(v_code) < 6 then
    return jsonb_build_object('ok', false, 'error', 'Der Schulcode muss mindestens 6 Zeichen haben.');
  end if;

  res := ssd_private.strip_secrets(p_data);
  res := jsonb_set(res, '{admin}', jsonb_build_object('username', trim(p_username)));
  res := jsonb_set(res, '{meta}', coalesce(case when jsonb_typeof(res->'meta') = 'object' then res->'meta' end, '{}'::jsonb) || '{"setupComplete": true}'::jsonb);
  if v_exists then
    update public.ssd_dienstplan_state set data = res, version = v + 1, updated_at = now() where id = 1;
  else
    insert into public.ssd_dienstplan_state (id, data, version, updated_at) values (1, res, 1, now());
  end if;
  delete from ssd_private.credentials;
  delete from ssd_private.sessions;
  perform ssd_private.set_credentials('admin', p_password, false);
  if v_code <> '' then perform ssd_private.set_credentials('schulcode', v_code, false); end if;
  perform ssd_private.audit('admin', 'setup');
  return jsonb_build_object('ok', true, 'token', ssd_private.new_session('admin'), 'role', 'admin', 'personId', null);
end $$;

create or replace function public.ssd_set_password(p_token text, p_person text, p_new_password text, p_current_password text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare d jsonb; info record; v_target text := coalesce(p_person, ''); v_own boolean;
begin
  select s.data into d from public.ssd_dienstplan_state s where s.id = 1;
  select * into info from ssd_private.session_info(d, p_token);
  if info.person_id is null then return jsonb_build_object('ok', false, 'error', 'session'); end if;
  v_own := v_target = info.person_id;
  if v_target = '' or v_target = 'schulcode' or (not v_own and info.role <> 'admin') then
    return jsonb_build_object('ok', false, 'error', 'Dafür fehlt die Berechtigung.');
  end if;
  if v_target <> 'admin' and ssd_private.student_by_id(d, v_target) is null then
    return jsonb_build_object('ok', false, 'error', 'Diese Person ist (noch) nicht gespeichert.');
  end if;
  if length(coalesce(p_new_password, '')) not between 10 and 200 then
    return jsonb_build_object('ok', false, 'error', 'Das Passwort muss mindestens 10 Zeichen lang sein.');
  end if;
  if v_own and not ssd_private.check_password(coalesce(p_current_password, ''), ssd_private.stored_hash(d, v_target)) then
    return jsonb_build_object('ok', false, 'error', 'Das aktuelle Passwort ist nicht korrekt.');
  end if;
  -- Vom Administrator vergebene Passwörter muss die Person bei der nächsten Anmeldung ändern.
  perform ssd_private.set_credentials(v_target, p_new_password, not v_own);
  delete from ssd_private.sessions s where s.person_id = v_target and s.token_hash <> ssd_private.hash_token(p_token);
  perform ssd_private.audit(info.person_id, 'password_set', case when v_own then 'eigenes Passwort' else 'für ' || v_target end);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.ssd_set_registration_code(p_token text, p_code text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare d jsonb; info record; v_code text := ssd_private.normalize_code(p_code);
begin
  select s.data into d from public.ssd_dienstplan_state s where s.id = 1 for update;
  select * into info from ssd_private.session_info(d, p_token);
  if info.person_id is null then return jsonb_build_object('ok', false, 'error', 'session'); end if;
  if info.role <> 'admin' then return jsonb_build_object('ok', false, 'error', 'Dafür fehlt die Berechtigung.'); end if;
  if v_code = '' then
    delete from ssd_private.credentials where person_id = 'schulcode';
  elsif length(v_code) < 6 then
    return jsonb_build_object('ok', false, 'error', 'Der Schulcode muss mindestens 6 Zeichen haben.');
  else
    perform ssd_private.set_credentials('schulcode', v_code, false);
  end if;
  -- alter Hash aus der Übergangszeit
  if coalesce(d #>> '{settings,registrationCodeHash}', '') <> '' then
    update public.ssd_dienstplan_state
       set data = jsonb_set(data, '{settings}', (data->'settings') - 'registrationCodeHash' - 'registrationCodeSalt'),
           version = version + 1, updated_at = now()
     where id = 1;
  end if;
  perform ssd_private.audit(info.person_id, 'registration_code', case when v_code = '' then 'entfernt' else 'gesetzt' end);
  return jsonb_build_object('ok', true, 'hasRegistrationCode', v_code <> '');
end $$;

/** "Alle Daten zurücksetzen": nur mit Administrator-Passwort; Administrator-Zugang und Schulname bleiben erhalten. */
create or replace function public.ssd_reset_all(p_token text, p_password text, p_data jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare d jsonb; v bigint; info record; res jsonb;
begin
  select s.data, s.version into d, v from public.ssd_dienstplan_state s where s.id = 1 for update;
  select * into info from ssd_private.session_info(d, p_token);
  if info.person_id is null then return jsonb_build_object('ok', false, 'error', 'session'); end if;
  if info.role <> 'admin' then return jsonb_build_object('ok', false, 'error', 'Dafür fehlt die Berechtigung.'); end if;
  if not ssd_private.check_password(coalesce(p_password, ''), ssd_private.stored_hash(d, 'admin')) then
    return jsonb_build_object('ok', false, 'error', 'Das Passwort ist nicht korrekt.');
  end if;
  if jsonb_typeof(p_data) is distinct from 'object' or jsonb_typeof(p_data->'students') is distinct from 'array' then
    return jsonb_build_object('ok', false, 'error', 'Ungültiges Datenformat.');
  end if;
  if not exists (select 1 from ssd_private.credentials where person_id = 'admin') then
    perform ssd_private.set_credentials('admin', p_password, false);
  end if;
  res := ssd_private.strip_secrets(p_data);
  res := jsonb_set(res, '{admin}', jsonb_build_object('username', d #>> '{admin,username}'));
  if jsonb_typeof(d->'school') = 'object' then res := jsonb_set(res, '{school}', d->'school'); end if;
  res := jsonb_set(res, '{meta}', coalesce(case when jsonb_typeof(res->'meta') = 'object' then res->'meta' end, '{}'::jsonb) || '{"setupComplete": true}'::jsonb);
  update public.ssd_dienstplan_state set data = res, version = v + 1, updated_at = now() where id = 1;
  delete from ssd_private.credentials where person_id <> 'admin';
  delete from ssd_private.sessions where person_id <> 'admin';
  perform ssd_private.audit('admin', 'reset_all');
  return jsonb_build_object('ok', true, 'version', v + 1);
end $$;

/** Für den "wach halten"-Job im GitHub-Repository — liefert keine Daten. */
create or replace function public.ssd_ping()
returns boolean language sql stable security definer set search_path = '' as $$
  select true;
$$;

-- ---------------------------------------------------------------------------
-- Live-Aktualisierung: nur die neue Versionsnummer wird verschickt, keine Daten
-- ---------------------------------------------------------------------------

create or replace function ssd_private.broadcast_state_version()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform realtime.send(jsonb_build_object('version', new.version), 'state_changed', 'ssd_state', false);
  exception when others then
    null; -- reiner Komfort: Speichern darf daran nie scheitern
  end;
  return null;
end $$;

drop trigger if exists ssd_state_broadcast on public.ssd_dienstplan_state;
create trigger ssd_state_broadcast
  after update on public.ssd_dienstplan_state
  for each row when (old.version is distinct from new.version)
  execute function ssd_private.broadcast_state_version();

-- ---------------------------------------------------------------------------
-- Aufräumen: abgelaufene Sitzungen, Anmeldeversuche (1 Tag), Protokoll (90 Tage)
-- ---------------------------------------------------------------------------

create or replace function ssd_private.housekeeping()
returns void language plpgsql security definer set search_path = '' as $$
declare ids text[];
begin
  delete from ssd_private.sessions where expires_at < now();
  delete from ssd_private.login_attempts where at < now() - interval '1 day';
  delete from ssd_private.audit_log where at < now() - interval '90 days';
  ids := array(select x->>'id' from public.ssd_dienstplan_state s, jsonb_array_elements(s.data->'students') x where s.id = 1);
  delete from ssd_private.credentials c where c.person_id not in ('admin', 'schulcode') and not (c.person_id = any (ids));
end $$;

select cron.schedule('ssd-housekeeping', '23 3 * * *', 'select ssd_private.housekeeping()');

-- ---------------------------------------------------------------------------
-- Rechte
-- ---------------------------------------------------------------------------

revoke all on all functions in schema ssd_private from public, anon, authenticated;

revoke all on function public.ssd_public_info(), public.ssd_login(text, text, text), public.ssd_logout(text),
  public.ssd_load(text), public.ssd_version(text), public.ssd_save(text, jsonb, bigint),
  public.ssd_register(jsonb, text, text), public.ssd_setup(jsonb, text, text, text),
  public.ssd_set_password(text, text, text, text), public.ssd_set_registration_code(text, text),
  public.ssd_reset_all(text, text, jsonb), public.ssd_ping()
  from public;

grant execute on function public.ssd_public_info(), public.ssd_login(text, text, text), public.ssd_logout(text),
  public.ssd_load(text), public.ssd_version(text), public.ssd_save(text, jsonb, bigint),
  public.ssd_register(jsonb, text, text), public.ssd_setup(jsonb, text, text, text),
  public.ssd_set_password(text, text, text, text), public.ssd_set_registration_code(text, text),
  public.ssd_reset_all(text, text, jsonb), public.ssd_ping()
  to anon, authenticated;
