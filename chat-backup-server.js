const http = require('http');
const fs = require('fs');
const BACKUP_FILE = '/root/chat_backup.json';
const PORT = 9588;

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.url === '/chat-backup' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        fs.writeFileSync(BACKUP_FILE, body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      } catch (e) {
        res.writeHead(500); res.end('{"ok":false}');
      }
    });
  } else if (req.url === '/chat-backup' && req.method === 'GET') {
    try {
      const data = fs.readFileSync(BACKUP_FILE, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(data);
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('[]');
    }
  } else {
    res.writeHead(404); res.end('not found');
  }
});

server.listen(PORT, () => console.log('Chat backup server on port ' + PORT));
