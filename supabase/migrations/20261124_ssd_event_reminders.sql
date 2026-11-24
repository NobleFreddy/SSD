-- ============================================================================
-- Dienstplan: Teams-Erinnerungen an Veranstaltungen
-- ============================================================================
-- Die Erinnerungen entstehen bei jedem Lauf von `send_teams_digest()` (jede
-- Minute) neu aus dem Datenstand: Titel, Zeit, Ort und Anzahl der Anmeldungen,
-- keine Namen. Gemerkt wird nur, welche Erinnerung schon gesendet wurde
-- (`ssd_private.teams_outbox_seen`, wie bei allen Teams-Meldungen). Wird eine
-- Veranstaltung gelöscht oder verlegt, fällt ihre Erinnerung von selbst weg.
--
-- Einstellungen: settings.teams.eventReminders (Standardwerte wie in
-- js/core/models.js; dieselben Regeln wie in js/modules/eventReminderService.js).
-- Ändert keine gespeicherten Daten.

/** Zum Zeitpunkt p_now fällige Erinnerungen, im Format der Teams-Meldungen. */
create or replace function ssd_private.event_reminder_items(app_data jsonb, p_now timestamptz)
returns table(item jsonb, ord bigint)
language sql stable set search_path = '' as $$
  with raw as (
    select case when jsonb_typeof(app_data #> '{settings,teams,eventReminders}') = 'object'
                then app_data #> '{settings,teams,eventReminders}' else '{}'::jsonb end as c
  ),
  opts as (
    select
      (c -> 'enabled') is distinct from 'false'::jsonb as enabled,
      case when jsonb_typeof(c -> 'days') = 'array' then array(
        select distinct n from (
          select case when jsonb_typeof(v) = 'number' and v #>> '{}' ~ '^[0-9]{1,2}$' then (v #>> '{}')::int end as n
          from jsonb_array_elements(case when jsonb_typeof(c -> 'days') = 'array' then c -> 'days' else '[]'::jsonb end) v) x
        where n between 0 and 60) else array[7, 1] end as days,
      case when jsonb_typeof(c -> 'openDays') = 'array' then array(
        select distinct n from (
          select case when jsonb_typeof(v) = 'number' and v #>> '{}' ~ '^[0-9]{1,2}$' then (v #>> '{}')::int end as n
          from jsonb_array_elements(case when jsonb_typeof(c -> 'openDays') = 'array' then c -> 'openDays' else '[]'::jsonb end) v) x
        where n between 0 and 60) else array[14, 3] end as open_days,
      case when c ->> 'time' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then (c ->> 'time')::time else time '16:00' end as at_time,
      (p_now at time zone 'Europe/Berlin')::date as today
    from raw
  ),
  team as (
    select count(*)::int as size
    from jsonb_array_elements(case when jsonb_typeof(app_data -> 'students') = 'array' then app_data -> 'students' else '[]'::jsonb end) s
    where s -> 'active' = 'true'::jsonb and (s -> 'pendingApproval') is distinct from 'true'::jsonb
  ),
  ev as (
    select
      e ->> 'id' as eid,
      left(coalesce(nullif(btrim(regexp_replace(coalesce(e ->> 'title', ''), '[[:space:]]+', ' ', 'g')), ''), 'Veranstaltung'), 120) as title,
      left(btrim(regexp_replace(coalesce(e ->> 'location', ''), '[[:space:]]+', ' ', 'g')), 80) as place,
      case when e ->> 'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
           then (ssd_private.try_timestamptz((e ->> 'date') || 'T12:00:00Z') at time zone 'UTC')::date end as day,
      case when e ->> 'startTime' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then (e ->> 'startTime')::time end as t_start,
      case when e ->> 'endTime' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then (e ->> 'endTime')::time end as t_end,
      case when jsonb_typeof(e -> 'capacity') = 'number' and e ->> 'capacity' ~ '^[0-9]{1,5}$' then (e ->> 'capacity')::int end as cap,
      case when jsonb_typeof(e -> 'participantIds') = 'array' then jsonb_array_length(e -> 'participantIds') else 0 end as signed,
      ssd_private.try_timestamptz(e ->> 'createdAt') as created
    from jsonb_array_elements(case when jsonb_typeof(app_data -> 'events') = 'array' then app_data -> 'events' else '[]'::jsonb end) e
    where jsonb_typeof(e) = 'object' and coalesce(e ->> 'id', '') <> ''
  ),
  due as (
    select ev.*, o.today, k.n,
      k.n = any (o.days) as always,
      (ev.day - k.n + o.at_time) at time zone 'Europe/Berlin' as due_at,
      (ev.day + coalesce(ev.t_start, time '23:59')) at time zone 'Europe/Berlin' as start_at,
      case when ev.cap is null then ev.signed < team.size else ev.signed < ev.cap end as incomplete,
      case when ev.cap is not null then greatest(ev.cap - ev.signed, 0) end as free
    from ev
    cross join opts o
    cross join team
    cross join lateral (select distinct unnest(o.days || o.open_days) as n) k
    where o.enabled and ev.day is not null
  ),
  ready as (
    select d.*,
      case d.day - d.today when 0 then 'heute' when 1 then 'morgen' else 'in ' || (d.day - d.today) || ' Tagen' end
        || ', ' || (array['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'])[extract(isodow from d.day)::int]
        || ', ' || to_char(d.day, 'DD.MM.YYYY')
        || case when d.t_start is not null and d.t_end is not null then ', ' || to_char(d.t_start, 'HH24:MI') || '–' || to_char(d.t_end, 'HH24:MI') || ' Uhr'
                when d.t_start is not null then ', ab ' || to_char(d.t_start, 'HH24:MI') || ' Uhr' else '' end
        || case when d.place <> '' then ', ' || d.place else '' end as when_text
    from due d
    -- Bis zu 24 Stunden nachholen (z. B. wenn Teams nicht erreichbar war), aber nie nach
    -- Beginn und nie für Zeitpunkte, zu denen es die Veranstaltung noch nicht gab.
    where p_now >= d.due_at and p_now < d.due_at + interval '24 hours'
      and d.due_at < d.start_at and p_now < d.start_at
      and (d.created is null or date_trunc('minute', d.created) <= d.due_at)
      and (d.always or d.incomplete)
  )
  select
    jsonb_build_object(
      'id', 'rem-' || md5(r.eid || '|' || r.day || '|' || r.n),
      'category', 'reminder',
      'at', to_char(r.due_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'by', 'Automatische Erinnerung',
      'text',
        case when r.always then 'Erinnerung: '
             when r.cap is null then 'Noch nicht alle angemeldet: '
             when r.free = 1 then 'Noch 1 Platz frei: '
             else 'Noch ' || r.free || ' Plätze frei: ' end
        || r.title || ' — ' || r.when_text || E'\n'
        || case when r.cap is null then
                  case when r.signed = 0 then 'Bisher ist noch niemand angemeldet.' else 'Bisher ' || r.signed || ' angemeldet.' end
                  || case when r.incomplete then ' Wer mithelfen möchte, bitte in der App unter „Veranstaltungen“ anmelden.' else '' end
                when r.free = 0 then 'Alle Plätze sind besetzt (' || r.signed || ' von ' || r.cap || ').'
                else r.signed || ' von ' || r.cap || ' angemeldet'
                  || case when not r.always then '' when r.free = 1 then ' — noch 1 Platz frei' else ' — noch ' || r.free || ' Plätze frei' end
                  || '. Bitte in der App unter „Veranstaltungen“ anmelden.' end
    ),
    1000000 + row_number() over (order by r.start_at, r.title, r.n)
  from ready r
  order by r.start_at, r.title, r.n
  limit 20;
$$;

/** Meldungen aus dem Datenstand (höchstens 24 Stunden alt) und fällige Erinnerungen. */
create or replace function ssd_private.teams_valid_outbox(app_data jsonb)
returns table(item jsonb, ord bigint)
language sql stable set search_path = '' as $$
  (select t.e, t.ord
   from jsonb_array_elements(
          case when jsonb_typeof(app_data -> 'teamsOutbox') = 'array' then app_data -> 'teamsOutbox' else '[]'::jsonb end
        ) with ordinality as t(e, ord)
   where jsonb_typeof(t.e) = 'object'
     and length(coalesce(t.e ->> 'id', '')) between 1 and 64
     -- Erinnerungen erzeugt nur der Server.
     and t.e ->> 'id' not like 'rem-%'
     and t.e ->> 'category' is distinct from 'reminder'
     and ssd_private.try_timestamptz(t.e ->> 'at') > now() - interval '24 hours'
   order by t.ord desc
   limit 200)
  union all
  select r.item, r.ord from ssd_private.event_reminder_items(app_data, now()) r;
$$;

/** Teams-Karte: zusätzlich die Kategorie „Erinnerungen“ und ein passender Titel. */
create or replace function ssd_private.teams_card(items jsonb, app_url text, school text)
returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  categories constant text[] := array['test', 'reminder', 'schedule', 'substitution', 'meeting', 'event', 'task', 'material'];
  labels constant jsonb := '{"test":"Test","reminder":"Erinnerungen","schedule":"Dienstplan","substitution":"Vertretungen","meeting":"Teamtreffen","event":"Veranstaltungen","task":"Aufgaben","material":"Material"}';
  max_bytes constant int := 18000;
  known_total int;
  reminder_total int;
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

  body := jsonb_build_array(
    ssd_private.teams_text('Schulsanitätsdienst — ' || case
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
$$;

revoke all on function ssd_private.event_reminder_items(jsonb, timestamptz), ssd_private.teams_valid_outbox(jsonb),
  ssd_private.teams_card(jsonb, text, text)
  from public, anon, authenticated;
