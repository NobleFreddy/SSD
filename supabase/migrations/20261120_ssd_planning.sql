-- ============================================================================
-- Dienstplan: Klausuren, Wochen-Verfügbarkeit und Wochen-Aktualisierung
-- ============================================================================
-- 1. Klausuren (`exams`) und Wochen-Verfügbarkeiten (`availabilityWeeks`)
--    anderer Personen darf nur der Administrator ändern (wie die
--    Standardwoche). Titel fremder Klausuren sehen Sanis nicht.
-- 2. Zeitplan: sonntags um 10, 11 und 12 Uhr UTC wird die Edge Function
--    "ssd-weekly-update" aufgerufen. Sie arbeitet nur einmal pro Woche, sobald
--    es in Berlin Sonntag ab 12 Uhr ist (Sommer- und Winterzeit).
-- Ändert keine gespeicherten Daten.

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
  others_protected constant text[] := array['availability', 'availabilityUpdatedAt', 'preferredPartnerIds', 'availabilityWeeks', 'exams'];
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

/** Was eine Rolle zu sehen bekommt: nie Geheimnisse; Sanis/Azubis keine Bemerkungen, Hinweise und Klausurtitel anderer Personen. */
create or replace function ssd_private.view_for(d jsonb, p_person text, p_role text)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare r jsonb := ssd_private.strip_secrets(d);
begin
  if p_role = 'admin' or jsonb_typeof(r->'students') is distinct from 'array' then return r; end if;
  return jsonb_set(r, '{students}', (
    select coalesce(jsonb_agg(
      case when jsonb_typeof(x) = 'object' and x->>'id' is distinct from p_person then
        case when jsonb_typeof(x->'exams') = 'array'
          then jsonb_set(x - 'notes' - 'adminMessage', '{exams}', (
            select coalesce(jsonb_agg(case when jsonb_typeof(e) = 'object' then e - 'title' else e end order by eo), '[]'::jsonb)
            from jsonb_array_elements(x->'exams') with ordinality as te(e, eo)))
          else x - 'notes' - 'adminMessage' end
      else x end order by o), '[]'::jsonb)
    from jsonb_array_elements(r->'students') with ordinality as t(x, o)));
end $$;

revoke all on function ssd_private.merge_incoming(jsonb, jsonb, text, text, boolean), ssd_private.view_for(jsonb, text, text)
  from public, anon, authenticated;

select cron.schedule(
  'ssd-weekly-update',
  '0 10,11,12 * * 0',
  $cron$
    select net.http_post(
      url := 'https://efhqaurepdqmncwqjxmd.supabase.co/functions/v1/ssd-weekly-update',
      body := '{}'::jsonb,
      headers := '{"Content-Type": "application/json"}'::jsonb,
      timeout_milliseconds := 60000
    );
  $cron$
);
