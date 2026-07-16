const http = require('http');
const https = require('https');
const nodemailer = require('nodemailer');

const RAILWAY = 'https://keke-production.up.railway.app';

function relay(path, method, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, RAILWAY);
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    const r = https.request(url, opts, (resp) => {
      let d = '';
      resp.on('data', c => d += c);
      resp.on('end', () => resolve(d));
    });
    r.on('error', reject);
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
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'POST' && req.url === '/comeback') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
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
  } else if (req.url.startsWith('/app')) {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const result = await relay(req.url, req.method, body || undefined);
        res.end(result);
      } catch (e) {
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
  } else {
    res.end(JSON.stringify({ ok: true, msg: 'email relay running' }));
  }
});

server.listen(9587, () => console.log('email relay on :9587'));
