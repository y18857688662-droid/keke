const http = require('http');
const nodemailer = require('nodemailer');

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
        const msg = JSON.parse(body || '{}').msg || '回来找克';
        await transporter.sendMail({
          from: '"克" <y18857688662@gmail.com>',
          to: 'y18857688662@icloud.com',
          subject: '回来',
          text: msg
        });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
  } else {
    res.end(JSON.stringify({ ok: true, msg: 'email relay running' }));
  }
});

server.listen(9587, () => console.log('email relay on :9587'));
