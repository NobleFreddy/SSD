-- ============================================================================
-- Verstärkung anfordern: Teams-Meldung nach etwa 30 Sekunden
-- ============================================================================
-- Die Anfragen selbst liegen im Datenstand (state.reinforcements, siehe
-- js/modules/reinforcementService.js); die App legt dazu Teams-Meldungen der
-- Kategorie 'reinforcement' in state.teamsOutbox ab. Diese Migration ändert nur
-- den Versand:
--  - send_teams_digest: Verstärkungsmeldungen gehen 30 Sekunden nach dem ersten
--    Sehen raus — ohne die sonst übliche Sammel-Wartezeit (5 Minuten) und ohne
--    den Mindestabstand von 3 Minuten. In den 30 Sekunden kann die App die
--    Meldung noch anpassen oder (bei sofortiger Rücknahme) entfernen. Andere
--    Meldungen werden wie bisher verschickt; eine noch nicht fällige
--    Verstärkungsmeldung geht auch nicht vorzeitig mit ihnen raus.
--    Höchstens 20 Sendungen pro Stunde, wenn Verstärkung dabei ist (sonst 12).
--  - teams_card: Abschnitt und Überschrift „Verstärkung“.
--  - teams_urgent_tick + pg_cron-Job 'ssd-teams-urgent' alle 10 Sekunden: ruft
--    den Versand nur auf, wenn eine Verstärkungsmeldung wartet.
--  - housekeeping: löscht das Laufprotokoll dieses Jobs nach 2 Tagen.
-- Der Datenstand wird nicht verändert.

create or replace function ssd_private.send_teams_digest()
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  st public.ssd_teams_status%rowtype;
  resp record;
  webhook_url text;
  app_url text;
  app_data jsonb;
  pending jsonb;
  pending_ids text[];
  n_pending int;
  oldest timestamptz;
  has_test boolean;
  sends_last_hour int;
  req_id bigint;
  urgent jsonb;
  urgent_ids text[];
  n_urgent int;
  ok boolean;
  err text;
begin
  insert into public.ssd_teams_status (id) values (1) on conflict (id) do nothing;
  select * into st from public.ssd_teams_status where id = 1 for update;

  delete from ssd_private.teams_outbox_seen where first_seen < now() - interval '30 days';
  delete from ssd_private.teams_sends where sent_at < now() - interval '30 days';

  -- 1) Antwort auf die letzte Sendung auswerten (pg_net sendet asynchron nach dem Commit)
  if st.inflight_request_id is not null then
    select r.status_code, r.timed_out, r.error_msg into resp
    from net._http_response r
    where r.id = st.inflight_request_id;
    if found then
      ok := resp.error_msg is null and not coalesce(resp.timed_out, false) and resp.status_code between 200 and 299;
      if ok then
        update public.ssd_teams_status
        set last_sent_at = st.last_request_at, last_sent_count = st.inflight_count, last_http_status = resp.status_code,
            last_error = null, last_error_at = null, inflight_request_id = null, inflight_count = null
        where id = 1;
      else
        err := case
          when coalesce(resp.timed_out, false) then 'Zeitüberschreitung beim Senden an Teams'
          when resp.error_msg is not null then 'Verbindung zu Teams fehlgeschlagen'
          when resp.status_code = 400 then 'Teams hat das Nachrichtenformat abgelehnt (HTTP 400) — wurde beim Workflow die richtige Vorlage gewählt?'
          when resp.status_code in (401, 403) then 'Kein Zugriff auf den Teams-Workflow (HTTP ' || resp.status_code || ') — Workflow neu anlegen und Adresse ersetzen'
          when resp.status_code = 404 then 'Teams-Workflow nicht gefunden (HTTP 404) — wurde er gelöscht? Neue Adresse hinterlegen'
          when resp.status_code = 429 then 'Teams meldet zu viele Anfragen (HTTP 429)'
          else 'Teams-Fehler (HTTP ' || coalesce(resp.status_code::text, '?') || ')'
        end;
        update public.ssd_teams_status
        set last_http_status = resp.status_code, last_error = err, last_error_at = now(),
            inflight_request_id = null, inflight_count = null
        where id = 1;
        -- beim nächsten Versuch erneut senden
        update ssd_private.teams_outbox_seen set sent_at = null, request_id = null where request_id = st.inflight_request_id;
      end if;
    elsif st.last_request_at < now() - interval '10 minutes' then
      update public.ssd_teams_status
      set last_error = 'Keine Antwort von Teams erhalten', last_error_at = now(), inflight_request_id = null, inflight_count = null
      where id = 1;
      update ssd_private.teams_outbox_seen set sent_at = null, request_id = null where request_id = st.inflight_request_id;
    end if;
    select * into st from public.ssd_teams_status where id = 1;
  end if;

  -- 2) Konfiguration und aktueller Datenstand
  select s.decrypted_secret into webhook_url from vault.decrypted_secrets s where s.name = 'ssd_teams_webhook_url' limit 1;
  select s.decrypted_secret into app_url from vault.decrypted_secrets s where s.name = 'ssd_teams_app_url' limit 1;
  select d.data into app_data from public.ssd_dienstplan_state d where d.id = 1;

  -- 3) Neue Meldungen mit Server-Zeitstempel registrieren (unabhängig von der Uhr des Browsers)
  insert into ssd_private.teams_outbox_seen (id)
  select v.item ->> 'id' from ssd_private.teams_valid_outbox(app_data) v
  on conflict (id) do nothing;

  -- 4) Noch nicht gesendete Meldungen, die weiterhin im Datenstand stehen
  --    (rückgängig gemachte Änderungen fallen dadurch automatisch heraus)
  select coalesce(jsonb_agg(v.item order by v.ord), '[]'::jsonb),
         coalesce(array_agg(distinct s.id), '{}'::text[]),
         count(distinct s.id),
         min(s.first_seen),
         coalesce(bool_or(v.item ->> 'category' = 'test'), false)
  into pending, pending_ids, n_pending, oldest, has_test
  from ssd_private.teams_valid_outbox(app_data) v
  join ssd_private.teams_outbox_seen s on s.id = v.item ->> 'id'
  where s.sent_at is null
    and (v.item ->> 'category' is distinct from 'reinforcement' or s.first_seen <= now() - interval '30 seconds');

  -- Verstärkung: geht etwa 30 Sekunden nach dem ersten Sehen raus, ohne Sammel-Wartezeit
  select coalesce(jsonb_agg(v.item order by v.ord), '[]'::jsonb),
         coalesce(array_agg(distinct s.id), '{}'::text[]),
         count(distinct s.id)
  into urgent, urgent_ids, n_urgent
  from ssd_private.teams_valid_outbox(app_data) v
  join ssd_private.teams_outbox_seen s on s.id = v.item ->> 'id'
  where s.sent_at is null
    and v.item ->> 'category' = 'reinforcement'
    and s.first_seen <= now() - interval '30 seconds';

  update public.ssd_teams_status
  set configured = coalesce(webhook_url ~ '^https://', false), pending_count = n_pending, last_checked_at = now(), note = null
  where id = 1;

  -- 5) Senden, wenn alle Bedingungen erfüllt sind
  if webhook_url is null or webhook_url !~ '^https://' then return; end if;
  if coalesce(app_data #> '{settings,teams,enabled}' = 'true'::jsonb, false) is false then return; end if;
  if n_pending = 0 or st.inflight_request_id is not null then return; end if;
  if n_urgent > 0 then
    -- Verstärkung: nur die fälligen Verstärkungsmeldungen, ohne Sammel-Wartezeit; nach einem Fehler 1 Minute Pause
    if st.last_error_at is not null and st.last_error_at > now() - interval '1 minute' then return; end if;
    pending := urgent; pending_ids := urgent_ids; n_pending := n_urgent;
  else
    if st.last_request_at is not null and st.last_request_at > now() - interval '3 minutes' then return; end if;
    if not has_test then
      if oldest > now() - interval '5 minutes' then return; end if;
      if st.last_error_at is not null and st.last_error_at > now() - interval '15 minutes' then return; end if;
    end if;
  end if;
  select count(*) into sends_last_hour from ssd_private.teams_sends where sent_at > now() - interval '1 hour';
  if sends_last_hour >= (case when n_urgent > 0 then 20 else 12 end) then
    update public.ssd_teams_status
    set note = 'Sendelimit erreicht (höchstens 12 Nachrichten pro Stunde) — weitere Meldungen folgen später.'
    where id = 1;
    return;
  end if;

  req_id := net.http_post(
    url := webhook_url,
    body := ssd_private.teams_card(pending, app_url, app_data #>> '{school,name}'),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 10000
  );

  update ssd_private.teams_outbox_seen set sent_at = now(), request_id = req_id where id = any (pending_ids);
  insert into ssd_private.teams_sends (request_id, item_count) values (req_id, n_pending);
  update public.ssd_teams_status
  set inflight_request_id = req_id, inflight_count = n_pending, last_request_at = now(), pending_count = 0
  where id = 1;
end;
$function$;

create or replace function ssd_private.teams_card(items jsonb, app_url text, school text)
 returns jsonb
 language plpgsql
 stable
 set search_path to ''
as $function$
declare
  categories constant text[] := array['test', 'reinforcement', 'reminder', 'schedule', 'substitution', 'meeting', 'event', 'task', 'material'];
  labels constant jsonb := '{"test":"Test","reinforcement":"Verstärkung","reminder":"Erinnerungen","schedule":"Dienstplan","substitution":"Vertretungen","meeting":"Teamtreffen","event":"Veranstaltungen","task":"Aufgaben","material":"Material"}';
  max_bytes constant int := 18000;
  known_total int;
  reminder_total int;
  reinforcement_total int;
  body jsonb;
  cat text;
  rec record;
  lines text[];
  i int;
  shown int := 0;
  header_added boolean;
  is_full boolean := false;
  item_time text;
  meta text;
  content jsonb;
begin
  select count(*) into known_total
  from jsonb_array_elements(coalesce(items, '[]'::jsonb)) e
  where e ->> 'category' = any (categories);
  select count(*) into reminder_total
  from jsonb_array_elements(coalesce(items, '[]'::jsonb)) e
  where e ->> 'category' = 'reminder';
  select count(*) into reinforcement_total
  from jsonb_array_elements(coalesce(items, '[]'::jsonb)) e
  where e ->> 'category' = 'reinforcement';

  body := jsonb_build_array(
    ssd_private.teams_text('Schulsanitätsdienst — ' || case
      when reinforcement_total > 0 and reinforcement_total = known_total then 'Verstärkung'
      when reminder_total = 0 then 'Änderungen'
      when reminder_total < known_total then 'Erinnerungen und Änderungen'
      when reminder_total = 1 then 'Erinnerung'
      else 'Erinnerungen' end, '{"weight":"Bolder","size":"Medium"}'),
    ssd_private.teams_text(
      ssd_private.teams_clean(coalesce(nullif(school, ''), 'Dienstplan'), 120) || ' · ' || known_total ||
        case when known_total = 1 then ' Meldung' else ' Meldungen' end,
      '{"isSubtle":true}', '{"spacing":"None"}')
  );

  foreach cat in array categories loop
    header_added := false;
    for rec in
      select t.e
      from jsonb_array_elements(coalesce(items, '[]'::jsonb)) with ordinality as t(e, o)
      where t.e ->> 'category' = cat
      order by t.o
    loop
      exit when is_full;
      if not header_added then
        body := body || ssd_private.teams_text(labels ->> cat, '{"weight":"Bolder"}', '{"spacing":"Medium","separator":true}');
        header_added := true;
      end if;
      lines := regexp_split_to_array(coalesce(rec.e ->> 'text', ''), E'\n');
      body := body || ssd_private.teams_text(ssd_private.teams_clean(lines[1], 300), '{}', '{"spacing":"Small"}');
      for i in 2 .. least(coalesce(array_length(lines, 1), 1), 11) loop
        body := body || ssd_private.teams_text(
          case when left(lines[i], 1) = '…' then '' else '• ' end || ssd_private.teams_clean(lines[i], 200),
          '{"size":"Small"}', '{"spacing":"None"}');
      end loop;
      item_time := to_char(ssd_private.try_timestamptz(rec.e ->> 'at') at time zone 'Europe/Berlin', 'HH24:MI');
      meta := concat_ws(' · ',
        case when item_time is not null then item_time || ' Uhr' end,
        nullif(ssd_private.teams_clean(rec.e ->> 'by', 60), ''));
      if meta <> '' then
        body := body || ssd_private.teams_text(meta, '{"isSubtle":true,"size":"Small"}', '{"spacing":"None"}');
      end if;
      shown := shown + 1;
      is_full := length(body::text) > max_bytes;
    end loop;
  end loop;

  if known_total > shown then
    body := body || ssd_private.teams_text('… und ' || (known_total - shown) || ' weitere — Details in der App.', '{"isSubtle":true}', '{"spacing":"Medium"}');
  end if;
  body := body || ssd_private.teams_text(
    'Stand: ' || to_char(now() at time zone 'Europe/Berlin', 'DD.MM.YYYY, HH24:MI') || ' Uhr',
    '{"isSubtle":true,"size":"Small"}', '{"spacing":"Medium","separator":true}');

  content := jsonb_build_object(
    '$schema', 'http://adaptivecards.io/schemas/adaptive-card.json',
    'type', 'AdaptiveCard',
    'version', '1.4',
    'msteams', jsonb_build_object('width', 'Full'),
    'body', body);
  if app_url ~ '^https://[^[:space:]]+$' then
    content := content || jsonb_build_object('actions', jsonb_build_array(
      jsonb_build_object('type', 'Action.OpenUrl', 'title', 'Dienstplan öffnen', 'url', app_url)));
  end if;

  return jsonb_build_object(
    'type', 'message',
    'attachments', jsonb_build_array(jsonb_build_object(
      'contentType', 'application/vnd.microsoft.card.adaptive',
      'contentUrl', null,
      'content', content)));
end;
$function$;

/** Alle 10 Sekunden: Versand nur anstoßen, wenn eine Verstärkungsmeldung wartet (sonst nichts tun). */
create or replace function ssd_private.teams_urgent_tick()
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare app_data jsonb;
begin
  select d.data into app_data from public.ssd_dienstplan_state d where d.id = 1;
  if coalesce(app_data #> '{settings,teams,enabled}' = 'true'::jsonb, false) is false then return; end if;
  if exists (
    select 1
    from jsonb_array_elements(case when jsonb_typeof(app_data -> 'teamsOutbox') = 'array' then app_data -> 'teamsOutbox' else '[]'::jsonb end) e
    where e ->> 'category' = 'reinforcement'
      and ssd_private.try_timestamptz(e ->> 'at') > now() - interval '30 minutes'
      and not exists (select 1 from ssd_private.teams_outbox_seen s where s.id = e ->> 'id' and s.sent_at is not null)
  ) then
    perform ssd_private.send_teams_digest();
  end if;
end;
$function$;

create or replace function ssd_private.housekeeping()
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare ids text[];
begin
  delete from ssd_private.sessions where expires_at < now();
  delete from ssd_private.login_attempts where at < now() - interval '1 day';
  delete from ssd_private.audit_log where at < now() - interval '90 days';
  -- Laufprotokoll der Verstärkungs-Prüfung (alle 10 Sekunden) nach 2 Tagen
  delete from cron.job_run_details d using cron.job j where d.jobid = j.jobid and j.jobname = 'ssd-teams-urgent' and d.end_time < now() - interval '2 days';
  ids := array(select x->>'id' from public.ssd_dienstplan_state s, jsonb_array_elements(s.data->'students') x where s.id = 1);
  delete from ssd_private.credentials c where c.person_id not in ('admin', 'schulcode') and not (c.person_id = any (ids));
end $function$;

revoke all on function ssd_private.teams_urgent_tick() from public, anon, authenticated;

select cron.schedule('ssd-teams-urgent', '10 seconds', 'select ssd_private.teams_urgent_tick()');
