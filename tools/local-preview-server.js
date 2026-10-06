/**
 * Optionaler, abhängigkeitsfreier Node.js-Server zum lokalen Testen der
 * Dienstplan-Anwendung über "http://" statt "file://".
 *
 * Die Anwendung selbst benötigt KEINEN Server (siehe README.md) — dieses
 * Skript ist reine Komfort-Tooling für Entwicklung/Vorschau, z. B. wenn:
 *   - der Browser ES-Module/fetch()-Beschränkungen für file:// hat,
 *   - die App im Schulnetzwerk auf mehreren Rechnern getestet werden soll.
 *
 * Aufruf:  node tools/local-preview-server.js [Ordner] [Port]
 * Standard: Projektordner (eine Ebene über diesem Skript), Port 8080.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const PORT = Number(process.argv[3] || 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.resolve(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found: ' + urlPath); return; }
    const ext = path.extname(filePath).toLowerCase();
    // no-store: beim Entwickeln immer den aktuellen Stand laden statt einer zwischengespeicherten Datei
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`Dienstplan-Vorschau läuft unter http://localhost:${PORT}`));
