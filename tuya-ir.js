const crypto = require('crypto');
const https = require('https');
const fs = require('fs');
const path = require('path');

const TUYA_BASE = 'openapi.tuyaus.com';
const CFG_PATH = path.join(__dirname, 'tuya-config.json');

let config = { accessId: '', accessSecret: '', deviceId: '', remoteId: '', token: '', tokenExpiry: 0 };

const KEYS = {
  power: 1785939919,
  pat: 1785939927,
  fast: 1785939936,
  slow: 1785956658,
  timer: 1785939949
};

function loadConfig() {
  try {
    if (fs.existsSync(CFG_PATH)) Object.assign(config, JSON.parse(fs.readFileSync(CFG_PATH, 'utf8')));
  } catch(e) {}
  return config;
}

function saveConfig(updates) {
  Object.assign(config, updates);
  fs.writeFileSync(CFG_PATH, JSON.stringify(config, null, 2));
}

function sign(method, apiPath, body, timestamp, accessToken) {
  const contentHash = crypto.createHash('sha256').update(body || '').digest('hex');
  const stringToSign = [method, contentHash, '', apiPath].join('\n');
  const signStr = config.accessId + (accessToken || '') + timestamp + stringToSign;
  return crypto.createHmac('sha256', config.accessSecret).update(signStr).digest('hex').toUpperCase();
}

function request(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const t = String(Date.now());
    const bodyStr = body ? JSON.stringify(body) : '';
    const token = config.token || '';
    const s = apiPath.includes('/token') ? sign(method, apiPath, bodyStr, t, '') : sign(method, apiPath, bodyStr, t, token);
    const headers = { client_id: config.accessId, sign: s, sign_method: 'HMAC-SHA256', t };
    if (token && !apiPath.includes('/token')) headers.access_token = token;
    if (body) headers['Content-Type'] = 'application/json';
    const req = https.request({ hostname: TUYA_BASE, path: apiPath, method, headers }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    if (bodyStr && method !== 'GET') req.write(bodyStr);
    req.end();
  });
}

async function getToken() {
  if (config.token && Date.now() < config.tokenExpiry) return config.token;
  const r = await request('GET', '/v1.0/token?grant_type=1');
  if (r.success) {
    config.token = r.result.access_token;
    config.tokenExpiry = Date.now() + (r.result.expire_time - 60) * 1000;
    return config.token;
  }
  throw new Error(r.msg);
}

async function sendKey(keyName) {
  const keyId = KEYS[keyName];
  if (!keyId) throw new Error('Unknown key: ' + keyName);
  await getToken();
  return request('POST', `/v1.0/infrareds/${config.deviceId}/remotes/${config.remoteId}/raw/command`, { raw_key: keyId, raw_type: 1 });
}

async function patStart() {
  const r1 = await sendKey('power');
  await new Promise(ok => setTimeout(ok, 1500));
  const r2 = await sendKey('pat');
  return { power: r1, pat: r2 };
}

async function patStop() {
  const r1 = await sendKey('pat');
  await new Promise(ok => setTimeout(ok, 1500));
  const r2 = await sendKey('power');
  return { pat: r1, power: r2 };
}

loadConfig();

module.exports = { loadConfig, saveConfig, getToken, sendKey, patStart, patStop, KEYS };
