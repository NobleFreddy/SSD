// Wochen-Aktualisierung des Dienstplans — Supabase Edge Function.
//
// Ein pg_cron-Job ruft die Funktion sonntags um 10, 11 und 12 Uhr UTC auf
// (siehe supabase/migrations/20261120_ssd_planning.sql). Sie arbeitet nur,
// wenn es in Berlin Sonntag ab 12 Uhr ist und die kommende Woche noch nicht
// geprüft wurde; jeder andere Aufruf ändert nichts. Dann sucht sie für die
// kommende Woche Ersatz für verhinderte Personen — mit demselben Code wie die
// App (app.js, erzeugt mit tools/build-weekly-function.js).
//
// ?dryRun=1 liefert nur eine Vorschau (Anzahlen, keine Namen) und speichert nichts.
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import { createApp } from './app.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request) => {
  const dryRun = new URL(req.url).searchParams.get('dryRun') === '1';
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: row, error } = await supabase.from('ssd_dienstplan_state').select('data, version').eq('id', 1).single();
    if (error || !row) return json({ ok: false, error: 'Datenstand nicht lesbar' }, 500);

    const app = createApp(row.data);
    const due = app.WeeklyUpdateService.dueInfo(new Date());
    if (dryRun) {
      const preview = app.WeeklyUpdateService.run({ mondayIso: due.mondayIso, dryRun: true });
      return json({ ok: true, dryRun: true, due: due.due, reason: due.reason ?? null, summary: preview.summary });
    }
    if (!due.due) return json({ ok: true, skipped: due.reason, mondayIso: due.mondayIso });

    const result = app.WeeklyUpdateService.run({ mondayIso: due.mondayIso, trigger: 'auto' });
    const { data: saved, error: saveError } = await supabase
      .from('ssd_dienstplan_state')
      .update({ data: app.Store.getState(), version: row.version + 1, updated_at: new Date().toISOString() })
      .eq('id', 1)
      .eq('version', row.version)
      .select('version');
    if (saveError) return json({ ok: false, error: 'Speichern fehlgeschlagen' }, 500);
    if (saved && saved.length) return json({ ok: true, summary: result.summary });
    // Jemand hat zwischendurch gespeichert: neu laden und noch einmal prüfen.
  }
  return json({ ok: false, error: 'Konflikt beim Speichern' }, 409);
});
