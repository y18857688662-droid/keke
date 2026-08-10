#!/usr/bin/env node
const http = require('http');
const crypto = require('crypto');
const net = require('net');

const PORT = 9587;
const UPSTREAM = 'ws://127.0.0.1:8080/bridge/ws';

function wsFrame(data) {
  const buf = Buffer.from(data);
  const frame = Buffer.alloc(2 + (buf.length > 125 ? 2 : 0) + buf.length);
  frame[0] = 0x81;
  if (buf.length > 125) { frame[1] = 126; frame.writeUInt16BE(buf.length, 2); buf.copy(frame, 4); }
  else { frame[1] = buf.length; buf.copy(frame, 2); }
  return frame;
}

function parseWsFrame(buf) {
  if (buf.length < 2) return null;
  const masked = !!(buf[1] & 0x80);
  let len = buf[1] & 0x7f, offset = 2;
  if (len === 126) { if (buf.length < 4) return null; len = buf.readUInt16BE(2); offset = 4; }
  if (masked) offset += 4;
  if (buf.length < offset + len) return null;
  const payload = Buffer.alloc(len);
  if (masked) {
    const mask = buf.slice(offset - 4, offset);
    for (let i = 0; i < len; i++) payload[i] = buf[offset + i] ^ mask[i % 4];
  } else {
    buf.copy(payload, 0, offset, offset + len);
  }
  return { data: payload.toString(), totalLen: offset + len };
}

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'POST' && req.url === '/command') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const opts = { method: 'POST', hostname: '127.0.0.1', port: 8080, path: '/bridge/command', headers: { 'Content-Type': 'application/json' } };
      const r = http.request(opts, (upstream) => {
        let d = '';
        upstream.on('data', c => d += c);
        upstream.on('end', () => { res.writeHead(upstream.statusCode); res.end(d); });
      });
      r.on('error', (e) => { res.writeHead(502); res.end(JSON.stringify({ error: e.message })); });
      r.end(body);
    });
    return;
  }

  if (req.method === 'GET' && (req.url === '/bridge/poll' || req.url.startsWith('/bridge/poll?'))) {
    const opts = { hostname: '127.0.0.1', port: 8080, path: req.url };
    http.get(opts, (upstream) => {
      let d = '';
      upstream.on('data', c => d += c);
      upstream.on('end', () => { res.end(d); });
    }).on('error', (e) => { res.end(JSON.stringify({ error: e.message })); });
    return;
  }

  if (req.method === 'GET' && req.url === '/status') {
    const opts = { hostname: '127.0.0.1', port: 8080, path: '/bridge/status' };
    http.get(opts, (upstream) => {
      let d = '';
      upstream.on('data', c => d += c);
      upstream.on('end', () => { res.end(d); });
    }).on('error', (e) => { res.end(JSON.stringify({ error: e.message })); });
    return;
  }

  res.writeHead(404);
  res.end('{"error":"not found"}');
});

server.on('upgrade', (req, clientSocket, head) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { clientSocket.destroy(); return; }

  // accept client handshake
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-5AB9FC11171A').digest('base64');
  clientSocket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');

  // connect upstream to keke /bridge/ws
  const wsKey = crypto.randomBytes(16).toString('base64');
  const upReq = http.request({ hostname: '127.0.0.1', port: 8080, path: '/bridge/ws', method: 'GET', headers: { 'Upgrade': 'websocket', 'Connection': 'Upgrade', 'Sec-WebSocket-Key': wsKey, 'Sec-WebSocket-Version': '13' } });

  upReq.on('upgrade', (upRes, upSocket, upHead) => {
    console.log('[relay] upstream connected, proxying');
    // forward upstream → client
    upSocket.on('data', (chunk) => { if (!clientSocket.destroyed) clientSocket.write(chunk); });
    // forward client → upstream
    clientSocket.on('data', (chunk) => { if (!upSocket.destroyed) upSocket.write(chunk); });
    upSocket.on('close', () => { clientSocket.destroy(); });
    upSocket.on('error', () => { clientSocket.destroy(); });
    clientSocket.on('close', () => { upSocket.destroy(); });
    clientSocket.on('error', () => { upSocket.destroy(); });
  });

  upReq.on('error', (e) => {
    console.log('[relay] upstream error: ' + e.message);
    clientSocket.write(wsFrame(JSON.stringify({ error: 'upstream unreachable' })));
    clientSocket.destroy();
  });

  upReq.end();
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('[bridge-relay] :' + PORT + ' → localhost:8080/bridge/ws');
});
