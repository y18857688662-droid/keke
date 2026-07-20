const http = require('http');
const fs = require('fs');
const CHAT_FILE = '/root/chat_backup.json';
const AUTH_FILE = '/root/auth_backup.json';
const API_CFG_FILE = '/root/api_config_backup.json';
const PORT = 9588;

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

  if (req.url === '/chat-backup') handleBackup(req, res, CHAT_FILE);
  else if (req.url === '/auth-backup') handleBackup(req, res, AUTH_FILE);
  else if (req.url === '/api-config-backup') handleBackup(req, res, API_CFG_FILE);
  else { res.writeHead(404); res.end('not found'); }
});

server.listen(PORT, () => console.log('Backup server on port ' + PORT));
