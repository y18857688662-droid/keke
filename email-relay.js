const http = require('http');
const https = require('https');
const nodemailer = require('nodemailer');

const RAILWAY = 'https://keke-production.up.railway.app';

function relay(path, method, body, headers) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, RAILWAY);
    const opts = {
      method,
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': headers?.['content-type'] || 'application/json',
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {})
      }
    };
    const r = https.request(opts, (resp) => {
      const chunks = [];
      resp.on('data', c => chunks.push(c));
      resp.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({
          statusCode: resp.statusCode,
          headers: resp.headers,
          body: buf
        });
      });
    });
    r.on('error', reject);
    r.setTimeout(30000, () => { r.destroy(); reject(new Error('timeout')); });
    if (body) r.write(body);
    r.end();
  });
}

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: 'y18857688662@gmail.com',
    pass: 'rckelgyxmudqplol'
  }
});

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/comeback') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      res.setHeader('Content-Type', 'application/json');
      try {
        const d = JSON.parse(body || '{}');
        const msg = d.msg || 'come back';
        const subj = d.subject || 'come back';
        await transporter.sendMail({
          from: '"ke" <y18857688662@gmail.com>',
          to: '18857688662@163.com',
          subject: subj,
          text: msg
        });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
  } else {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const result = await relay(req.url, req.method, body || undefined, req.headers);
        const ct = result.headers['content-type'] || 'application/json';
        res.writeHead(result.statusCode || 200, {
          'Content-Type': ct,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Allow-Methods': '*'
        });
        res.end(result.body);
      } catch (e) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
  }
});

server.listen(9587, () => console.log('relay on :9587 — all routes proxy to Railway'));
