const http = require('http');
const fs = require('fs');
const BACKUP_DIR = '/root/keke_backups';
const PORT = 9588;

if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

function handleBackup(req, res, file) {
  if (req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        fs.writeFileSync(file, body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      } catch (e) {
        res.writeHead(500); res.end('{"ok":false}');
      }
    });
  } else {
    try {
      const data = fs.readFileSync(file, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(data);
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    }
  }
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const m = req.url.match(/^\/backup\/([a-z_-]+)$/);
  if (m) {
    handleBackup(req, res, BACKUP_DIR + '/' + m[1] + '.json');
  } else {
    res.writeHead(404); res.end('not found');
  }
});

server.listen(PORT, () => console.log('Backup server on port ' + PORT));
