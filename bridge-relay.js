#!/usr/bin/env node
const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = 9587;
let client = null;
let lastCmd = null;

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'POST' && req.url === '/command') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const cmd = JSON.parse(body);
        lastCmd = cmd;
        if (client && client.readyState === 1) {
          client.send(JSON.stringify(cmd));
          res.end(JSON.stringify({ ok: true, delivered: true }));
        } else {
          res.writeHead(503);
          res.end(JSON.stringify({ ok: false, error: 'no client connected' }));
        }
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'bad json' }));
      }
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/status') {
    res.end(JSON.stringify({
      client: client && client.readyState === 1 ? 'connected' : 'disconnected',
      lastCmd,
      uptime: process.uptime() | 0
    }));
    return;
  }

  res.writeHead(404);
  res.end('{"error":"not found"}');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  console.log(`[bridge] client connected from ${ip}`);
  client = ws;

  ws.on('close', () => {
    console.log('[bridge] client disconnected');
    if (client === ws) client = null;
  });

  ws.on('error', (e) => {
    console.log('[bridge] ws error:', e.message);
    if (client === ws) client = null;
  });

  ws.send(JSON.stringify({ type: 'hello', msg: 'bridge relay ready' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[bridge-relay] listening on :${PORT}`);
});
