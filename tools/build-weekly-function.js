// Erzeugt supabase/functions/ssd-weekly-update/app.js aus den App-Modulen, damit
// die Wochen-Aktualisierung auf dem Server exakt denselben Code ausführt wie die App.
// Nach Änderungen an den unten genannten Modulen erneut ausführen und die Funktion neu
// veröffentlichen:  node tools/build-weekly-function.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const MODULES = [
  'js/core/utils.js',
  'js/core/eventBus.js',
  'js/core/models.js',
  'js/core/storage.js',
  'js/modules/availabilityService.js',
  'js/modules/studentService.js',
  'js/modules/notificationService.js',
  'js/modules/calendarService.js',
  'js/modules/settingsService.js',
  'js/modules/distributionService.js',
  'js/modules/scheduler.js',
  'js/modules/statisticsService.js',
  'js/modules/substitutionService.js',
  'js/modules/weeklyUpdateService.js',
];

const parts = [
  '// ERZEUGT von tools/build-weekly-function.js — bitte nicht von Hand ändern.',
  '// Enthält die App-Module für die Wochen-Aktualisierung in einer eigenen,',
  '// abgeschlossenen Umgebung (kein DOM, keine Datenbankverbindung).',
  '',
  'export function createApp(initialData) {',
  '  const window = {};',
  '  const document = { hidden: false, addEventListener() {} };',
  '  const localStorage = { getItem: () => null, setItem() {}, removeItem() {} };',
  '  const sessionStorage = localStorage;',
  "  const location = { search: '', hash: '' };",
  '  window.addEventListener = () => {};',
  '  window.supabase = { createClient: () => ({}) };',
  '  window.SSD = {};',
  '  const SSD = window.SSD;',
  "  SSD.SupabaseConfig = { URL: '', ANON_KEY: '' };",
  '',
];
MODULES.forEach((rel) => {
  const source = fs.readFileSync(path.join(root, rel), 'utf8');
  if (/^\s*(import|export)\s/m.test(source)) throw new Error(`${rel} enthält import/export`);
  parts.push(`  // ---- ${rel} ----`);
  parts.push(source.split('\n').map((line) => (line ? `  ${line}` : line)).join('\n'));
});
parts.push(`
  // ---- Server-Ersatz für Store und Anmeldung ----
  let state = SSD.Storage.migrateIfNeeded(initialData);
  SSD.Store = {
    getState: () => state,
    isLoaded: () => true,
    commit(label, mutator) {
      mutator(state);
      state.meta = state.meta || {};
      state.meta.lastModifiedAt = new Date().toISOString();
    },
  };
  SSD.Auth = {
    getSession: () => null,
    isAdminSession: () => true,
    currentPersonId: () => null,
    canCoordinate: () => true,
    canManageItem: () => true,
  };
  return SSD;
}
`);
const out = path.join(root, 'supabase', 'functions', 'ssd-weekly-update', 'app.js');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, parts.join('\n'));
console.log(`${path.relative(root, out)} erzeugt (${MODULES.length} Module)`);
