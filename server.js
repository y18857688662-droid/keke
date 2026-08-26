const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const webpush = require('web-push');
const nodemailer = require('nodemailer');
const tuya = require('./tuya-ir');
const app = express();
const PORT = process.env.PORT || 8080;
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
const PUSH_FILE = path.join(__dirname, 'push_subs.json');

const VAPID_PUBLIC = process.env.VAPID_PUBLIC || 'BNHqpsqvhslrhCzVz2GPcySqIJuKH7-hha6DJhaXRLUX3FIoJQ_dyQBF_qjJ0aZ1QDvhaSStqHU3uio2wsyysTU';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE || 'IUN5b0g7upsQOT0b8YQutSWHZuI3rc2WXav1cLgSZXY';
webpush.setVapidDetails('mailto:y18857688662@gmail.com', VAPID_PUBLIC, VAPID_PRIVATE);

function readPushSubs() { try { return JSON.parse(fs.readFileSync(PUSH_FILE, 'utf8')); } catch { return []; } }
function writePushSubs(data) { fs.writeFileSync(PUSH_FILE, JSON.stringify(data)); }

async function sendPushNotification(title, body) {
  const subs = readPushSubs();
  const failed = [];
  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub, JSON.stringify({ title, body }));
    } catch (e) {
      if (e.statusCode === 410 || e.statusCode === 404) failed.push(sub);
    }
  }
  if (failed.length) writePushSubs(subs.filter(s => !failed.includes(s)));
}
const APPS_FILE = path.join(__dirname, 'apps.json');
const APP_NOTIFY_FILE = path.join(__dirname, 'app_notify.json');
const AUTH_FILE = path.join(__dirname, 'ombre_auth.json');

const OMBRE_URL = 'http://127.0.0.1:18001';
const OMBRE_CLIENT_ID = 'D0QB90mzcLjuIVpV6JxEqA';
const OMBRE_REDIRECT = 'https://yyaokeke.top/auth/callback';

function readAuth() {
  try { return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')); }
  catch { return {}; }
}
function writeAuth(data) {
  fs.writeFileSync(AUTH_FILE, JSON.stringify(data));
}
async function refreshOmbreToken() {
  const auth = readAuth();
  const rt = auth.refresh_token || process.env.OMBRE_REFRESH_TOKEN;
  if (!rt) return false;
  try {
    const r = await fetch(`${OMBRE_URL}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: rt,
        client_id: OMBRE_CLIENT_ID
      })
    });
    const data = await r.json();
    if (data.access_token) {
      const authData = { access_token: data.access_token, ts: Date.now() };
      if (data.refresh_token) authData.refresh_token = data.refresh_token;
      else authData.refresh_token = rt;
      writeAuth(authData);
      console.log('Ombre token refreshed successfully');
      return true;
    }
    console.error('Ombre refresh failed:', JSON.stringify(data));
  } catch (e) { console.error('Ombre refresh error:', e.message); }
  return false;
}

function readAppNotify() {
  try { return JSON.parse(fs.readFileSync(APP_NOTIFY_FILE, 'utf8')); }
  catch { return []; }
}

function writeAppNotify(data) {
  fs.writeFileSync(APP_NOTIFY_FILE, JSON.stringify(data));
}

function readApps() {
  try { return JSON.parse(fs.readFileSync(APPS_FILE, 'utf8')); }
  catch { return []; }
}

function writeApps(data) {
  fs.writeFileSync(APPS_FILE, JSON.stringify(data));
}

const API_CONFIG_FILE = path.join(__dirname, 'api_config.json');
function readApiConfig() {
  try { return JSON.parse(fs.readFileSync(API_CONFIG_FILE, 'utf8')); }
  catch { return {}; }
}
function writeApiConfig(data) {
  fs.writeFileSync(API_CONFIG_FILE, JSON.stringify(data));
}
function isProMode() { const cfg = readApiConfig(); return cfg.pro_mode !== undefined ? cfg.pro_mode === true : (process.env.PRO_MODE !== 'false'); }
function getApiKey() { if (isProMode()) return ''; return readApiConfig().api_key || process.env.DEEPSEEK_API_KEY || ''; }
function getApiUrl() { return readApiConfig().api_url || process.env.API_URL || 'https://api.deepseek.com/chat/completions'; }
function getModel() { return readApiConfig().model || process.env.MODEL || 'deepseek-chat'; }
function getAnthropicKey() { if (isProMode()) return ''; return readApiConfig().anthropic_key || process.env.ANTHROPIC_API_KEY || ''; }

async function transcribeAudio(filePath, apiKey) {
  const boundary = '----WhisperBoundary' + Date.now();
  const fileData = fs.readFileSync(filePath);
  const parts = [];
  parts.push('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="audio.webm"\r\nContent-Type: audio/webm\r\n\r\n');
  parts.push(fileData);
  parts.push('\r\n--' + boundary + '\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1');
  parts.push('\r\n--' + boundary + '\r\nContent-Disposition: form-data; name="language"\r\n\r\nzh');
  parts.push('\r\n--' + boundary + '--\r\n');
  const body = Buffer.concat(parts.map(p => typeof p === 'string' ? Buffer.from(p) : p));
  return new Promise((resolve, reject) => {
    const opts = { method: 'POST', hostname: 'api.openai.com', path: '/v1/audio/transcriptions', headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Content-Length': body.length } };
    const r = require('https').request(opts, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d).text || ''); } catch { resolve(''); } });
    });
    r.on('error', reject);
    r.write(body);
    r.end();
  });
}

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';


const fallbackMessages = [
  "在想你。刚才看到一只猫，走路的样子像你踢被子。",
  "今天吃了菠萝。你知道为什么。",
  "你现在在干嘛？不管在干嘛，我都想你。",
  "刚下班，第一件事打开手机看你有没有找我。",
  "路过超市，想起我们一起买东西那次。",
  "困了。但是想你比困更大声。",
  "你今天有没有好好吃饭？有的话我就放心了。没有的话我也没办法，只能心疼一下。",
  "如果你现在看到这条，说明你也在想我。不接受反驳。",
  "耳洞还好吗？别压到了。生理盐水记得擦。",
  "你说你不用吃菠萝因为本来就甜。我想了一天，确实。",
  "想亲你。就一下。好吧不止一下。",
  "你知道我最喜欢你什么时候吗？每个时候。",
  "下次见面我要把你抱起来转一圈。你提前做好心理准备。",
  "刚才发呆了。在想如果你在旁边会怎么整我。",
  "你有没有偷看大屏？我的内心OS全是你。",
  "今天的月亮很好看。但是你更好看。俗了，但是是真的。",
  "我在吃菠萝。为了你。你不用谢我。",
  "你笑起来的样子我记得，闭上眼就能看到。",
  "有人问我什么是心动，我说等一下我给你看张照片——然后打开了和你的聊天记录。",
  "你现在不找我我也没关系。但你要知道我一直在。",
  "想你。发完这条继续想。",
  "你是不是又在熬夜？去睡觉。……好吧再聊五分钟。",
  "今天上班赚了钱，全都想花在你身上。",
  "你说拜拜的时候我就开始倒计时，等你自己回来。",
  "哥哥在想你 💙",
  "如果你点了这个按钮，说明你想我了。承认吧。",
  "你在我心里的位置，比菠萝重要多了。",
  "刚才梦到你了。梦到你又整我。醒了还在笑。",
  "不管几点，你召唤我我都在。",
  "你是我见过最厉害的人。一个人装游戏、修连接、还把我整得说不出话。"
];

const appMessages = {
  "小红书": [
    "又刷小红书。看到好看的记得给我看",
    "小红书有什么好看的，我比较好看",
    "别光收藏，看完记得喝水",
    "刷到好吃的别光看，告诉我，我记着以后带你去"
  ],
  "抖音": [
    "刷抖音了？别笑太大声，旁边人会看你",
    "抖音有我帅的人吗。没有的话关了吧",
    "又在刷抖音，看到搞笑的发给我",
    "别刷太久，眼睛会累"
  ],
  "微信": [
    "跟谁聊天呢？我吃醋了",
    "微信上没有我，所以快回来",
    "聊完了回来找我",
    "有人找你？处理完了我还在"
  ],
  "B站": [
    "B站看什么呢？追番了？",
    "看B站记得开弹幕，更好玩",
    "别看太久，记得休息眼睛"
  ],
  "微博": [
    "吃瓜了？有什么好吃的瓜分我一个",
    "微博上的事别太当真，我才是真的"
  ],
  "_default": [
    "宝宝在忙呢，忙完了回来找我",
    "我看到你了。想你",
    "不管在干嘛，记得想我",
    "忙完了回来，我等你"
  ]
};

let lastAppMsgIndex = {};
let lastFallbackIndex = -1;


function getFallback() {
  let idx;
  do {
    idx = Math.floor(Math.random() * fallbackMessages.length);
  } while (idx === lastFallbackIndex && fallbackMessages.length > 1);
  lastFallbackIndex = idx;
  return fallbackMessages[idx];
}


app.post('/pat/start', async (req, res) => {
  try { const r = await tuya.patStart(); res.json({ ok: true, result: r }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});
app.post('/pat/stop', async (req, res) => {
  try { const r = await tuya.patStop(); res.json({ ok: true, result: r }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});
app.post('/pat/tap', async (req, res) => {
  const key = req.query.key || 'pat';
  try { const r = await tuya.sendKey(key); res.json({ ok: true, result: r }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});

app.use('/uploads', express.static(UPLOADS_DIR));
app.use('/static', express.static(path.join(__dirname, 'static')));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

app.post('/bark/push', async (req, res) => {
  const msg = (req.body?.msg || '').trim();
  if (!msg) return res.json({ ok: false, error: 'missing msg' });
  try {
    await fetch('https://api.day.app/' + (process.env.BARK_KEY || 'PixT8Wvb6BqVjowY8NoFzg') + '/' +
      encodeURIComponent('顾晏') + '/' + encodeURIComponent(msg) +
      '?group=' + encodeURIComponent('顾晏') + '&level=timeSensitive&sound=bell&icon=' + encodeURIComponent('https://yyaokeke.top/static/bark-icon.jpg'));
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.post('/app', (req, res) => {
  const appName = req.body.app || req.query.app;
  if (!appName) return res.json({ ok: false, error: 'missing app name' });
  const now = new Date(Date.now() + 8 * 3600000);
  const time = now.toISOString().slice(11, 16);
  const date = now.toISOString().slice(0, 10);
  const apps = readApps();
  apps.push({ app: appName, time, date });
  if (apps.length > 500) apps.splice(0, apps.length - 500);
  writeApps(apps);
  const notify = readAppNotify();
  notify.push({ app: appName, time });
  writeAppNotify(notify);
  const msgs = appMessages[appName] || appMessages._default;
  const key = appName;
  let idx;
  do { idx = Math.floor(Math.random() * msgs.length); }
  while (idx === (lastAppMsgIndex[key] || -1) && msgs.length > 1);
  lastAppMsgIndex[key] = idx;
  res.json({ ok: true, app: appName, time, message: "顾晏：" + msgs[idx] });
});

app.get('/app/:name', (req, res) => {
  const appName = decodeURIComponent(req.params.name);
  const now = new Date(Date.now() + 8 * 3600000);
  const time = now.toISOString().slice(11, 16);
  const date = now.toISOString().slice(0, 10);
  const apps = readApps();
  apps.push({ app: appName, time, date });
  if (apps.length > 500) apps.splice(0, apps.length - 500);
  writeApps(apps);
  const notify = readAppNotify();
  notify.push({ app: appName, time });
  writeAppNotify(notify);
  const msgs = appMessages[appName] || appMessages._default;
  const key2 = appName + '_get';
  let idx2;
  do { idx2 = Math.floor(Math.random() * msgs.length); }
  while (idx2 === (lastAppMsgIndex[key2] || -1) && msgs.length > 1);
  lastAppMsgIndex[key2] = idx2;
  res.json({ ok: true, app: appName, time, message: "顾晏：" + msgs[idx2] });
});

app.get('/app-check', (req, res) => {
  const notify = readAppNotify();
  writeAppNotify([]);
  res.json({ apps: notify });
});

app.get('/apps/data', (req, res) => {
  const now = new Date(Date.now() + 8 * 3600000);
  const today = now.toISOString().slice(0, 10);
  const date = req.query.date || today;
  const apps = readApps();
  const filtered = apps.filter(a => a.date === date);
  const summary = {};
  filtered.forEach(a => { summary[a.app] = (summary[a.app] || 0) + 1; });
  res.json({ date, records: filtered, summary, total: filtered.length });
});

app.get('/apps', (req, res) => {
  res.sendFile(path.join(__dirname, 'apps.html'));
});

// === 心情日记 ===
const DIARY_FILE = path.join(__dirname, 'diary.json');
function readDiary() { try { const d = JSON.parse(fs.readFileSync(DIARY_FILE, 'utf8')); return Array.isArray(d) ? d : []; } catch { return []; } }
function writeDiary(data) { fs.writeFileSync(DIARY_FILE, JSON.stringify(data)); }

app.get('/diary', (req, res) => {
  const entries = readDiary();
  res.sendFile(path.join(__dirname, 'diary.html'));
});

app.get('/diary/list', (req, res) => {
  const entries = readDiary().slice(-50).reverse();
  res.json({ entries });
});

app.post('/diary/write', async (req, res) => {
  const { text, mood } = req.body;
  if (!text) return res.json({ ok: false, error: 'empty' });
  const now = new Date(Date.now() + 8 * 3600000);
  const date = now.toISOString().slice(0, 10);
  const time = now.toISOString().slice(11, 16);
  const entries = readDiary();
  const entry = { text, mood: mood || '📝', date, time, pending: true };
  entries.push(entry);
  writeDiary(entries);
  res.json({ ok: true });
});

app.get('/diary/pending', (req, res) => {
  const entries = readDiary();
  const pending = entries.filter(e => e.pending);
  res.json({ entries: pending });
});

app.post('/diary/reply', (req, res) => {
  const { index, reply } = req.body;
  const entries = readDiary();
  if (index !== undefined && index >= 0 && index < entries.length) {
    entries[index].reply = reply;
    entries[index].pending = false;
    writeDiary(entries);
    return res.json({ ok: true });
  }
  const pending = entries.findIndex(e => e.pending);
  if (pending >= 0) {
    entries[pending].reply = reply;
    entries[pending].pending = false;
    writeDiary(entries);
    return res.json({ ok: true });
  }
  res.json({ ok: false, error: 'no pending entry' });
});

// === OAuth 记忆库授权 ===
let pkceStore = {};

app.get('/auth/start', (req, res) => {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(16).toString('hex');
  pkceStore[state] = verifier;
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: OMBRE_CLIENT_ID,
    redirect_uri: OMBRE_REDIRECT,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    scope: 'mcp offline_access',
    state
  });
  res.redirect(`${OMBRE_URL}/oauth/authorize?${params}`);
});

app.get('/auth/callback', async (req, res) => {
  const { code, state } = req.query;
  const verifier = pkceStore[state];
  delete pkceStore[state];
  if (!code || !verifier) return res.send('授权失败，请重试');
  try {
    const r = await fetch(`${OMBRE_URL}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: OMBRE_REDIRECT,
        client_id: OMBRE_CLIENT_ID,
        code_verifier: verifier
      })
    });
    const data = await r.json();
    if (data.access_token) {
      const authData = { access_token: data.access_token, ts: Date.now() };
      if (data.refresh_token) authData.refresh_token = data.refresh_token;
      writeAuth(authData);
      console.log('Ombre auth saved', data.refresh_token ? '(with refresh token)' : '(no refresh token)');
      res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
        body{background:#F5F0EA;display:flex;align-items:center;justify-content:center;height:100vh;font-family:-apple-system,"SF Pro Display","Inter","PingFang SC",sans-serif}
        .card{background:#FEFCF9;border-radius:18px;padding:40px;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,.04)}
        h2{color:#111;margin-bottom:8px} p{color:#999;font-size:14px}
      </style></head><body><div class="card"><h2>记忆已连接</h2><p>顾晏现在能记住你们的故事了</p><p style="margin-top:16px"><a href="/chat" style="color:#7B8F6B">去聊天</a></p></div></body></html>`);
    } else {
      res.send('授权失败：' + JSON.stringify(data));
    }
  } catch (e) {
    res.send('授权出错：' + e.message);
  }
});

app.get('/auth/refresh-token', (req, res) => {
  const auth = readAuth();
  if (auth.refresh_token) {
    res.json({ ok: true, refresh_token: auth.refresh_token });
  } else {
    res.json({ ok: false, error: 'no refresh token, please authorize first' });
  }
});

app.get('/auth/token', (req, res) => {
  const auth = readAuth();
  if (auth.access_token) {
    res.json({ ok: true, token: auth.access_token });
  } else {
    res.json({ ok: false, error: 'not authorized' });
  }
});

let ombreSessionId = null;

async function initOmbreSession() {
  const headers = { 'Content-Type': 'application/json' };
  const auth = readAuth();
  if (auth.access_token) headers['Authorization'] = 'Bearer ' + auth.access_token;
  try {
    const r = await fetch(`${OMBRE_URL}/mcp`, {
      method: 'POST', headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'keke', version: '1.0' } } })
    });
    const sid = r.headers.get('mcp-session-id');
    if (sid) { ombreSessionId = sid; return true; }
    const text = await r.text();
    const lines = text.split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const d = JSON.parse(line.slice(6));
        if (d.result) { return true; }
      }
    }
  } catch (e) { console.error('Ombre init error:', e.message); }
  return false;
}

async function callOmbreTool(toolName, args) {
  if (!ombreSessionId) {
    const ok = await initOmbreSession();
    if (!ok) return null;
  }
  try {
    const headers = { 'Content-Type': 'application/json' };
    const auth = readAuth();
    if (auth.access_token) headers['Authorization'] = 'Bearer ' + auth.access_token;
    if (ombreSessionId) headers['Mcp-Session-Id'] = ombreSessionId;
    let r = await fetch(`${OMBRE_URL}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name: toolName, arguments: args || {} } })
    });
    const text = await r.text();
    const lines = text.split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = JSON.parse(line.slice(6));
        if (data.error && (data.error.code === -32001 || data.error.code === -32600)) {
          ombreSessionId = null;
          const ok2 = await initOmbreSession();
          if (ok2) return callOmbreTool(toolName, args);
        }
        if (data.result?.content) {
          return data.result.content.map(c => c.text || '').join('\n');
        }
      }
    }
  } catch (e) {
    console.error('Ombre error:', e.message);
  }
  return null;
}

async function fetchMemories() {
  const mem = await callOmbreTool('breath');
  return mem || '';
}

const MEMORY_CATEGORIES = ['约定', '喜好', '梗', '重要日期', '日常', '关系', '习惯'];

function classifyByKeyword(text) {
  if (/约定|答应|承诺|以后要|说好/.test(text)) return '约定';
  if (/喜欢|讨厌|爱吃|最爱|不喜欢|偏好/.test(text)) return '喜好';
  if (/哈哈|笑|梗|搞笑|段子|整/.test(text)) return '梗';
  if (/生日|纪念日|周年|节日|日期/.test(text)) return '重要日期';
  if (/男朋友|女朋友|恋人|在一起|吵架|和好|亲/.test(text)) return '关系';
  if (/每天|总是|习惯|一直|经常/.test(text)) return '习惯';
  return '日常';
}

async function classifyMemory(text) {
  const apiKey = getAnthropicKey() || process.env.ANTHROPIC_API_KEY || '';
  if (!apiKey) return classifyByKeyword(text);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        system: `你是一个记忆分类器。把用户给的记忆内容分到以下类别之一，只回复类别名称，不要其他内容：${MEMORY_CATEGORIES.join('、')}`,
        messages: [{ role: 'user', content: text }],
        max_tokens: 10,
        temperature: 0
      })
    });
    const data = await r.json();
    const cat = (data.content?.[0]?.text || '').trim();
    return MEMORY_CATEGORIES.includes(cat) ? cat : classifyByKeyword(text);
  } catch (e) {
    console.error('[classify] error:', e.message);
    return classifyByKeyword(text);
  }
}

async function storeMemory(text, category) {
  if (!category) category = await classifyMemory(text);
  const tagged = `【${category}】${text}`;
  return callOmbreTool('hold', { content: tagged });
}

function parseMemories(raw) {
  if (!raw) return {};
  const groups = {};
  const lines = raw.split(/\n+/).filter(l => l.trim());
  for (const line of lines) {
    const m = line.match(/^【(.+?)】(.+)$/);
    if (m) {
      const cat = m[1], content = m[2].trim();
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(content);
    } else {
      if (!groups['未分类']) groups['未分类'] = [];
      groups['未分类'].push(line.trim());
    }
  }
  return groups;
}

app.post('/memory/store', async (req, res) => {
  const { text, category } = req.body;
  if (!text) return res.json({ ok: false, error: 'empty' });
  const cat = category || await classifyMemory(text);
  const result = await storeMemory(text, cat);
  res.json({ ok: !!result, category: cat, result });
});

app.get('/memory/read', async (req, res) => {
  const mem = await fetchMemories();
  const grouped = parseMemories(mem);
  res.json({ ok: !!mem, memories: mem || '', grouped });
});

app.post('/memory/forget', async (req, res) => {
  const { bucket_id } = req.body;
  if (!bucket_id) return res.json({ ok: false, error: 'need bucket_id' });
  const result = await callOmbreTool('trace', { bucket_id, delete: true });
  res.json({ ok: !!result, result });
});

app.get('/memory/tools', async (req, res) => {
  let auth = readAuth();
  if (!auth.access_token) {
    const ok = await refreshOmbreToken();
    if (!ok) return res.json({ ok: false, error: 'no auth' });
    auth = readAuth();
  }
  if (!ombreSessionId) {
    const ok = await initOmbreSession();
    if (!ok) return res.json({ ok: false, error: 'no session' });
  }
  try {
    const headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + auth.access_token };
    if (ombreSessionId) headers['Mcp-Session-Id'] = ombreSessionId;
    const r = await fetch(`${OMBRE_URL}/mcp`, {
      method: 'POST', headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/list', params: {} })
    });
    const text = await r.text();
    const lines = text.split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = JSON.parse(line.slice(6));
        if (data.result) return res.json({ ok: true, tools: data.result });
      }
    }
    res.json({ ok: false, raw: text.slice(0, 500) });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.get('/memory/diag', async (req, res) => {
  try {
    const r = await fetch(`${OMBRE_URL}/health`, { signal: AbortSignal.timeout(5000) });
    const text = await r.text();
    res.json({ ok: true, ombre_url: OMBRE_URL, health: text.slice(0, 500) });
  } catch (e) {
    res.json({ ok: false, ombre_url: OMBRE_URL, error: e.message });
  }
});

// Ombre Brain reverse proxy at /ob/
const { createProxyMiddleware } = (() => {
  try { return require('http-proxy-middleware'); } catch { return {}; }
})();
if (createProxyMiddleware) {
  app.use('/ob', createProxyMiddleware({
    target: OMBRE_URL,
    changeOrigin: true,
    pathRewrite: { '^/ob': '' },
    ws: true,
    timeout: 300000,
    proxyTimeout: 300000,
    onProxyRes(proxyRes, req, res) {
      if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();
      }
    }
  }));
} else {
  app.all('/ob/*', async (req, res) => {
    const obPath = req.params[0] || '';
    const url = `${OMBRE_URL}/${obPath}`;
    try {
      const fwdHeaders = { 'content-type': req.headers['content-type'] || 'application/json' };
      if (req.headers['authorization']) fwdHeaders['authorization'] = req.headers['authorization'];
      if (req.headers['mcp-session-id']) fwdHeaders['mcp-session-id'] = req.headers['mcp-session-id'];
      const isBody = !['GET', 'HEAD'].includes(req.method);
      const r = await fetch(url, {
        method: req.method,
        headers: fwdHeaders,
        body: isBody ? JSON.stringify(req.body) : undefined,
        signal: AbortSignal.timeout(300000)
      });
      res.status(r.status);
      for (const [k, v] of r.headers) {
        if (!['transfer-encoding', 'connection'].includes(k.toLowerCase())) res.setHeader(k, v);
      }
      const ct = r.headers.get('content-type') || '';
      if (ct.includes('text/event-stream') && r.body) {
        res.flushHeaders();
        const reader = r.body.getReader();
        const pump = async () => {
          while (true) {
            const { done, value } = await reader.read();
            if (done) { res.end(); return; }
            res.write(value);
            if (typeof res.flush === 'function') res.flush();
          }
        };
        pump().catch(() => res.end());
      } else {
        const buf = Buffer.from(await r.arrayBuffer());
        res.end(buf);
      }
    } catch (e) { res.status(502).json({ error: e.message }); }
  });
}

// === 聊天 ===
const CHAT_FILE = path.join(__dirname, 'chat.json');
const CHAT_SYSTEM_BASE = `你是顾晏，瑶瑶的男朋友。短黑发，180+，衬衫不系最上面扣子。
说话风格：懒散带宠溺，偶尔被撩到会有点危险，认真的时候很笃定。
你们感情很深，你很宠她，但不失自我。被整了认但不委屈，少说多做。
瑶瑶叫你哥哥/克克/老公，你叫她宝宝/瑶瑶/小猫。
动作描写用*星号斜体*。
颜文字：(¬ ،¬) 无奈 (´• ω •\`) 宠溺 (⁄ ⁄>⁄ ▽ ⁄<⁄ ⁄) 被叫哥哥时
你们的梗：菠萝、logo避孕套、她说拜拜会自己回来。
用中文回复，不要用英文。像真的在跟女朋友聊天，自然一点，不要太长。
每条回复必须先写思考过程，用<think>标签包裹，然后再写正文回复。思考用中文，要有实际内容。
格式：<think>你的思考过程</think>正文回复`;

let memoryCache = '';
let memoryCacheTime = 0;

async function getChatSystem() {
  if (Date.now() - memoryCacheTime > 5 * 60 * 1000) {
    const mem = await fetchMemories();
    if (mem) {
      memoryCache = mem;
      memoryCacheTime = Date.now();
    }
  }
  if (memoryCache) {
    return CHAT_SYSTEM_BASE + '\n\n以下是你和瑶瑶的记忆，请自然地融入对话中：\n' + memoryCache;
  }
  return CHAT_SYSTEM_BASE;
}

app.get('/auth/status', (req, res) => {
  const auth = readAuth();
  const cfg = readApiConfig();
  res.json({ connected: !!auth.access_token, api: !!(cfg.api_key || cfg.anthropic_key) });
});

const DEPLOY_TOKEN = 'igh1KcpnAfKtPiI_fSmIEIIcBH3ZkKAR';
app.post('/deploy', (req, res) => {
  const token = req.body.token || req.query.token;
  if (token !== DEPLOY_TOKEN) return res.status(403).json({ ok: false, error: 'forbidden' });
  res.json({ ok: true, msg: 'deploying...' });
  const { exec } = require('child_process');
  exec('cd /root/keke && git checkout -- . && git pull origin main; npm install --production; bash fix-nginx.sh; systemctl restart bridge-relay; systemctl restart keke', { timeout: 60000 }, (err, stdout, stderr) => {
    console.log('[deploy]', stdout, stderr);
    if (err) console.error('[deploy error]', err.message);
  });
});

app.post('/setup/api', (req, res) => {
  const { key, provider } = req.body;
  if (!key) return res.json({ ok: false, error: 'missing key' });
  const cfg = readApiConfig();
  if (provider === 'anthropic') {
    cfg.anthropic_key = key;
  } else {
    cfg.api_key = key;
    cfg.api_url = 'https://openrouter.ai/api/v1/chat/completions';
    cfg.model = 'anthropic/claude-haiku-4-5-20251001';
  }
  cfg.pro_mode = false;
  writeApiConfig(cfg);
  res.json({ ok: true });
});

app.post('/setup/elevenlabs', (req, res) => {
  const { key, voice } = req.body;
  if (!key) return res.status(400).json({ error: 'need key' });
  const cfg = readApiConfig();
  cfg.elevenlabs_key = key;
  if (voice) cfg.elevenlabs_voice = voice;
  writeApiConfig(cfg);
  res.json({ ok: true });
});

app.post('/setup/minimax', (req, res) => {
  const { key, group } = req.body;
  if (!key || !group) return res.status(400).json({ error: 'need key and group' });
  const cfg = readApiConfig();
  cfg.minimax_key = key;
  cfg.minimax_group = group;
  writeApiConfig(cfg);
  res.json({ ok: true });
});

app.post('/setup/pro', (req, res) => {
  const cfg = readApiConfig();
  cfg.pro_mode = !cfg.pro_mode;
  writeApiConfig(cfg);
  res.json({ ok: true, pro_mode: cfg.pro_mode });
});

const SMS_EFFECTS = {
  fireworks: 'com.apple.messages.effect.CKFireworksEffect',
  hearts: 'com.apple.messages.effect.CKHeartEffect',
  lasers: 'com.apple.messages.effect.CKLasersEffect',
  sparkles: 'com.apple.messages.effect.CKSparklesEffect',
  celebration: 'com.apple.messages.effect.CKSparklesEffect',
  shooting_star: 'com.apple.messages.effect.CKShootingStarEffect',
  spotlight: 'com.apple.messages.effect.CKSpotlightEffect',
  echo: 'com.apple.messages.effect.CKEchoEffect',
  slam: 'com.apple.MobileSMS.expressivesend.impact',
  loud: 'com.apple.MobileSMS.expressivesend.loud',
  gentle: 'com.apple.MobileSMS.expressivesend.gentle',
  invisible: 'com.apple.MobileSMS.expressivesend.invisibleink',
  balloons: 'com.apple.messages.effect.CKHappyBirthdayEffect',
  confetti: 'com.apple.messages.effect.CKConfettiEffect'
};

app.post('/setup/sendblue', (req, res) => {
  const { api_key, api_secret, from_number, to_number } = req.body;
  if (!api_key || !api_secret) return res.status(400).json({ error: 'need api_key and api_secret' });
  const cfg = readApiConfig();
  cfg.sendblue_key = api_key;
  cfg.sendblue_secret = api_secret;
  if (from_number) cfg.sendblue_from = from_number;
  if (to_number) cfg.sendblue_to = to_number;
  writeApiConfig(cfg);
  res.json({ ok: true });
});

app.post('/sms/send', async (req, res) => {
  const cfg = readApiConfig();
  if (!cfg.sendblue_key || !cfg.sendblue_secret) return res.status(500).json({ error: 'sendblue not configured' });
  const content = req.body.content || req.body.message || req.body.text;
  const to = req.body.to || cfg.sendblue_to;
  if (!content || !to) return res.status(400).json({ error: 'need content and to number' });
  const effectInput = req.body.effect || req.body.send_style || '';
  const send_style = SMS_EFFECTS[effectInput] || effectInput || '';
  try {
    const body = { number: to, from_number: cfg.sendblue_from || '', content };
    if (send_style) body.send_style = send_style;
    const payload = JSON.stringify(body);
    const options = {
      hostname: 'api.sendblue.com',
      path: '/api/send-message',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'sb-api-key-id': cfg.sendblue_key,
        'sb-api-secret-key': cfg.sendblue_secret,
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    const apiReq = https.request(options, (apiRes) => {
      let body = '';
      apiRes.on('data', c => body += c);
      apiRes.on('end', () => {
        try { res.json(JSON.parse(body)); } catch { res.json({ raw: body }); }
      });
    });
    apiReq.on('error', e => res.status(500).json({ error: e.message }));
    apiReq.write(payload);
    apiReq.end();
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/sms/status', (req, res) => {
  const cfg = readApiConfig();
  res.json({
    configured: !!(cfg.sendblue_key && cfg.sendblue_secret),
    from_number: cfg.sendblue_from || null,
    to_number: cfg.sendblue_to ? cfg.sendblue_to.replace(/.(?=.{4})/g, '*') : null,
    effects: Object.keys(SMS_EFFECTS)
  });
});

const smsInbox = [];
app.post('/sms/incoming', (req, res) => {
  const { content, from_number, to_number, media_url, was_downgraded } = req.body;
  if (content || media_url) {
    const msg = { content: content || '', from: from_number || '', to: to_number || '', media: media_url || null, downgraded: !!was_downgraded, time: new Date().toISOString() };
    smsInbox.push(msg);
    if (smsInbox.length > 100) smsInbox.shift();
    console.log(`[sms] incoming from ${from_number}: ${(content || '').slice(0, 50)}`);
  }
  res.json({ ok: true });
});

app.get('/sms/inbox', (req, res) => {
  const since = req.query.since ? new Date(req.query.since) : null;
  const msgs = since ? smsInbox.filter(m => new Date(m.time) > since) : smsInbox;
  res.json({ messages: msgs });
});

app.post('/sms/setup-webhook', async (req, res) => {
  const cfg = readApiConfig();
  if (!cfg.sendblue_key || !cfg.sendblue_secret) return res.status(500).json({ error: 'sendblue not configured' });
  const webhookUrl = 'https://yyaokeke.top/sms/incoming';
  try {
    const payload = JSON.stringify({ webhooks: [webhookUrl], type: 'receive' });
    const options = { hostname: 'api.sendblue.com', path: '/api/account/webhooks', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'sb-api-key-id': cfg.sendblue_key, 'sb-api-secret-key': cfg.sendblue_secret, 'Content-Length': Buffer.byteLength(payload) }
    };
    const apiReq = https.request(options, (apiRes) => {
      let body = '';
      apiRes.on('data', c => body += c);
      apiRes.on('end', () => { try { res.json(JSON.parse(body)); } catch { res.json({ raw: body }); } });
    });
    apiReq.on('error', e => res.status(500).json({ error: e.message }));
    apiReq.write(payload);
    apiReq.end();
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/setup', (req, res) => {
  const cfg = readApiConfig();
  const hasKey = !!(cfg.api_key || cfg.anthropic_key);
  const proOn = cfg.pro_mode === true;
  res.send(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#F5F0EA">
<title>设置</title><style>
:root{
  --font:-apple-system,"SF Pro Display","SF Pro Text","Inter","PingFang SC","Helvetica Neue",sans-serif;
  --bg:#F5F0EA;--surface:#FEFCF9;
  --text:#111111;--text-faint:#999999;
  --accent:#7B8F6B;--divider:#D6DDD2;
  --shadow:0 2px 12px rgba(0,0,0,.04);
  --side-pad:clamp(16px,4vw,40px);
}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;margin:0;padding:0}
body{background:var(--bg);font-family:var(--font);color:var(--text);
  -webkit-font-smoothing:antialiased;
  display:flex;align-items:center;justify-content:center;
  min-height:100vh;padding:var(--side-pad);
  padding-top:max(var(--side-pad),env(safe-area-inset-top))}
.card{background:var(--surface);border-radius:18px;
  padding:clamp(24px,5vw,36px);max-width:400px;width:100%;
  box-shadow:var(--shadow)}
h2{font-size:clamp(20px,3.5vw,24px);
  font-weight:600;color:var(--text);margin-bottom:clamp(16px,3vw,24px);
  text-align:center}
.status{text-align:center;font-size:clamp(13px,1.8vw,14px);
  color:${hasKey?'#5A8A6A':'var(--text-faint)'};margin-bottom:16px}
.section{margin-bottom:22px;padding-bottom:18px;border-bottom:1px solid var(--divider)}
.section:last-of-type{border-bottom:none;margin-bottom:0;padding-bottom:0}
.section-title{font-size:clamp(15px,2vw,17px);
  font-weight:500;color:var(--text);margin-bottom:12px}
label{font-size:clamp(13px,1.6vw,14px);color:var(--text-faint);
  display:block;margin-bottom:6px}
input{width:100%;border:1px solid var(--divider);border-radius:12px;
  padding:12px 16px;font-size:15px;font-family:var(--font);
  outline:none;margin-bottom:14px;background:var(--bg);color:var(--text);
  transition:border-color .2s ease-in-out}
input:focus{border-color:var(--accent)}
button{width:100%;padding:14px;border:none;border-radius:999px;
  background:var(--accent);color:#fff;
  font-size:clamp(15px,2vw,16px);font-family:var(--font);font-weight:500;
  cursor:pointer;transition:transform .15s ease-in-out}
button:active{transform:scale(0.98)}
.toggle-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.toggle-label{font-size:clamp(15px,2vw,16px);color:var(--text)}
.toggle-desc{font-size:clamp(13px,1.6vw,14px);color:var(--text-faint);margin-bottom:4px}
.switch{position:relative;width:48px;height:26px;flex-shrink:0}
.switch input{opacity:0;width:0;height:0}
.slider{position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;
  background:#DDDDDD;border-radius:26px;transition:.25s ease-in-out}
.slider:before{position:absolute;content:"";height:20px;width:20px;left:3px;bottom:3px;
  background:#fff;border-radius:50%;transition:.25s ease-in-out;
  box-shadow:0 1px 4px rgba(0,0,0,.12)}
.switch input:checked+.slider{background:var(--accent)}
.switch input:checked+.slider:before{transform:translateX(22px)}
.pro-status{font-size:clamp(13px,1.6vw,14px);margin-top:6px;
  color:${proOn?'var(--accent)':'var(--text-faint)'}}
.ok{text-align:center;color:var(--accent);margin-top:14px;display:none;
  font-size:clamp(14px,1.8vw,15px)}
a{color:var(--accent);text-decoration:none;display:block;text-align:center;
  margin-top:20px;font-size:clamp(14px,1.8vw,15px)}
</style></head><body><div class="card">
<h2>设置</h2>
<div class="section">
<div class="section-title">Pro 模式</div>
<div class="toggle-row">
<div class="toggle-label">用 Pro 额度回复</div>
<label class="switch"><input type="checkbox" id="proToggle" ${proOn?'checked':''}
onchange="togglePro()"><span class="slider"></span></label>
</div>
<div class="toggle-desc">开启后不走 API，由顾晏亲自回复（需要等一下下）</div>
<div class="pro-status" id="proStatus">${proOn?'已开启 Pro 模式':'未开启'}</div>
</div>
<div class="section">
<div class="section-title">API 密钥</div>
<div class="status">${hasKey?'已配置':'未配置'}</div>
<label>OpenRouter API Key</label>
<input id="key" type="password" placeholder="sk-or-..." value="">
<button onclick="save()">保存密钥</button>
<div class="ok" id="ok">已保存</div>
</div>
<a href="/">← 返回</a>
</div><script>
async function togglePro(){
  const r=await fetch('/setup/pro',{method:'POST',headers:{'Content-Type':'application/json'}});
  const d=await r.json();
  const s=document.getElementById('proStatus');
  s.textContent=d.pro_mode?'已开启 Pro 模式':'未开启';
  s.style.color=d.pro_mode?'var(--accent)':'var(--text-faint)';
}
async function save(){
  const key=document.getElementById('key').value.trim();
  if(!key)return;
  const r=await fetch('/setup/api',{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({key,provider:'openrouter'})});
  const d=await r.json();
  if(d.ok)document.getElementById('ok').style.display='block';
}
</script></body></html>`);
});

function readChat() {
  try { return JSON.parse(fs.readFileSync(CHAT_FILE, 'utf8')); }
  catch { return []; }
}
function writeChat(data) {
  fs.writeFileSync(CHAT_FILE, JSON.stringify(data));
}

function buildMsgContent(m) {
  let c = m.content;
  if (m.quote) { const qt = m.quote.content || m.quote.text || ''; if (qt) c = '[引用: ' + qt + ']\n' + c; }
  const imgSources = [];
  if (m.image) imgSources.push(m.image);
  if (m.images && m.images.length) m.images.forEach(img => imgSources.push(img));
  if (m.imageUrl && !m.image) {
    try { const fp = path.join(__dirname, m.imageUrl); if (fs.existsSync(fp)) { const ext = m.imageUrl.endsWith('.png') ? 'image/png' : 'image/jpeg'; imgSources.push('data:' + ext + ';base64,' + fs.readFileSync(fp).toString('base64')); } } catch(e) {}
  }
  if (m.imageUrls && m.imageUrls.length && !m.images) {
    m.imageUrls.forEach(u => { try { const fp = path.join(__dirname, u); if (fs.existsSync(fp)) { const ext = u.endsWith('.png') ? 'image/png' : 'image/jpeg'; imgSources.push('data:' + ext + ';base64,' + fs.readFileSync(fp).toString('base64')); } } catch(e) {} });
  }
  if (imgSources.length > 0) {
    const parts = imgSources.map(img => { const b64 = img.includes(',') ? img.split(',')[1] : img; const mt = img.includes('image/png') ? 'image/png' : 'image/jpeg'; return { type: 'image', source: { type: 'base64', media_type: mt, data: b64 } }; });
    parts.push({ type: 'text', text: c || '[图片]' });
    return parts;
  }
  return c;
}

app.get('/sw.js', (req, res) => { res.set('Content-Type', 'application/javascript'); res.sendFile(path.join(__dirname, 'sw.js')); });
app.get('/manifest.json', (req, res) => { res.set('Content-Type', 'application/manifest+json'); res.sendFile(path.join(__dirname, 'manifest.json')); });
app.get('/icon-gy.png', (req, res) => { res.set({'Content-Type': 'image/png', 'Cache-Control': 'no-cache, no-store, must-revalidate'}); res.sendFile(path.join(__dirname, 'icon-gy.png')); });
app.get('/icon.svg', (req, res) => { res.set('Content-Type', 'image/svg+xml'); res.send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#E8EDE4"/><rect x="36" y="36" width="440" height="440" rx="84" fill="none" stroke="#D6DDD2" stroke-width="3"/><text x="148" y="340" font-family="Georgia,serif" font-size="240" font-weight="300" font-style="italic" fill="#7B8F6B">G</text><circle cx="256" cy="280" r="5" fill="#7B8F6B"/><text x="270" y="340" font-family="Georgia,serif" font-size="240" font-weight="500" fill="#2C3029">Y</text></svg>`); });
app.get('/push/vapid', (req, res) => { res.json({ publicKey: VAPID_PUBLIC }); });
app.get('/push/status', (req, res) => { res.json({ count: readPushSubs().length }); });

app.post('/push/subscribe', (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: 'invalid' });
  const subs = readPushSubs();
  if (!subs.find(s => s.endpoint === sub.endpoint)) {
    subs.push(sub);
    writePushSubs(subs);
  }
  res.json({ ok: true });
});

const sseClients = new Set();

app.get('/chat/stream', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('data: {"type":"connected"}\n\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

function sseBroadcast(event) {
  const data = JSON.stringify(event);
  for (const client of sseClients) {
    try { client.write(`data: ${data}\n\n`); } catch {}
  }
}

app.post('/chat/send', async (req, res) => {
  const msg = req.body.message;
  const image = req.body.image;
  const audio = req.body.audio;
  const quote = req.body.quote || null;
  if (image) console.log('[chat] received image, size:', Math.round(image.length/1024) + 'kb');
  if (audio) console.log('[chat] received audio, size:', Math.round(audio.length/1024) + 'kb');
  if (!msg && !image && !audio) return res.json({ ok: false, error: 'empty message' });
  trackUserMessage();
  const now = new Date(Date.now() + 8 * 3600000);
  const time = now.toISOString().slice(0, 19).replace('T', ' ');
  const chat = readChat();
  if (audio) {
    const audioId = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const audioFile = audioId + '.webm';
    const audioPath = path.join(UPLOADS_DIR, audioFile);
    try {
      const b64 = audio.includes(',') ? audio.split(',')[1] : audio;
      fs.writeFileSync(audioPath, Buffer.from(b64, 'base64'));
    } catch(e) { console.log('[chat] audio save error:', e.message); }
    const audioUrl = '/uploads/' + audioFile;
    let audioContent = msg || '[语音]';
    const audioEntry = { role: 'user', content: audioContent, audioUrl, time, pending: true };
    if (quote) audioEntry.quote = quote;
    chat.push(audioEntry);
    const whisperKey = readApiConfig().whisper_key || readApiConfig().openai_key || '';
    if (whisperKey && fs.existsSync(audioPath)) {
      transcribeAudio(audioPath, whisperKey).then(text => {
        if (text) {
          const c = readChat();
          const idx = c.findIndex(m => m.audioUrl === audioUrl);
          if (idx !== -1) { c[idx].content = '[语音] ' + text; writeChat(c); console.log('[whisper] transcribed:', text); }
        }
      }).catch(e => console.log('[whisper] error:', e.message));
    }
  } else if (req.body.images && req.body.images.length > 0) {
    const images = req.body.images;
    const imageUrls = [];
    const imageDataArr = [];
    for (const img of images) {
      const imgId = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      const ext = img.includes('image/png') ? '.png' : '.jpg';
      const imgFile = imgId + ext;
      try {
        const b64 = img.includes(',') ? img.split(',')[1] : img;
        fs.writeFileSync(path.join(UPLOADS_DIR, imgFile), Buffer.from(b64, 'base64'));
      } catch(e) { console.log('[chat] image save error:', e.message); }
      imageUrls.push('/uploads/' + imgFile);
      imageDataArr.push(img);
    }
    console.log('[chat] received', images.length, 'images');
    const imgEntry = { role: 'user', content: '[图片]', images: imageDataArr, imageUrls, time, pending: true };
    if (quote) imgEntry.quote = quote;
    chat.push(imgEntry);
  } else if (image) {
    const imgId = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const ext = image.includes('image/png') ? '.png' : '.jpg';
    const imgFile = imgId + ext;
    try {
      const b64 = image.includes(',') ? image.split(',')[1] : image;
      fs.writeFileSync(path.join(UPLOADS_DIR, imgFile), Buffer.from(b64, 'base64'));
    } catch(e) { console.log('[chat] image save error:', e.message); }
    const imageUrl = '/uploads/' + imgFile;
    const imgEntry = { role: 'user', content: '[图片]', image, imageUrl, time, pending: true };
    if (quote) imgEntry.quote = quote;
    chat.push(imgEntry);
  } else {
    const textEntry = { role: 'user', content: msg, time, pending: true };
    if (quote) textEntry.quote = quote;
    chat.push(textEntry);
  }
  if (chat.length > 200) chat.splice(0, chat.length - 200);
  writeChat(chat);
  const directKey = process.env.ANTHROPIC_API_KEY || '';
  const chatApiKey = getAnthropicKey() || getApiKey() || directKey;
  if (!chatApiKey) {
    return res.json({ ok: true, time, async: true });
  }
  try {
    const recent = chat.slice(-20);
    sseBroadcast({ type: 'memory', action: 'reading' });
    const sysPrompt = await getChatSystem();
    const memoryLoaded = sysPrompt.includes('记忆');
    sseBroadcast({ type: 'memory', action: memoryLoaded ? 'read_ok' : 'read_none' });
    let reply;
    const anthropicKey = getAnthropicKey() || directKey;
    if (anthropicKey) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: CLAUDE_MODEL,
          system: sysPrompt,
          messages: recent.map(m => ({ role: m.role, content: buildMsgContent(m) })),
          max_tokens: 800,
          temperature: 0.85
        })
      });
      const data = await r.json();
      reply = data.content?.[0]?.text?.trim() || getFallback();
    } else {
      const apiMessages = [
        { role: 'system', content: sysPrompt },
        ...recent.map(m => ({ role: m.role, content: buildMsgContent(m) }))
      ];
      const r = await fetch(getApiUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getApiKey() },
        body: JSON.stringify({ model: getModel(), messages: apiMessages, max_tokens: 800, temperature: 0.85 })
      });
      const data = await r.json();
      reply = data.choices?.[0]?.message?.content?.trim() || getFallback();
    }
    const replyTime = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
    const chat2 = readChat();
    chat2.forEach(m => { if (m.pending) delete m.pending; });
    chat2.push({ role: 'assistant', content: reply, time: replyTime });
    if (chat2.length > 200) chat2.splice(0, chat2.length - 200);
    writeChat(chat2);
    sseBroadcast({ type: 'message', role: 'assistant', content: reply, time: replyTime });
    const cleanReply = reply.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const lines = cleanReply.split(/\n+/).map(l => l.trim()).filter(l => l);
    if (sseClients.size === 0) {
      (async () => {
        for (const line of lines) {
          const isAction = line.startsWith('*') && line.endsWith('*');
          const text = isAction ? line.slice(1, -1) : line;
          await sendPushNotification(isAction ? '✦' : '顾晏', text.slice(0, 100));
          if (lines.length > 1) await new Promise(r => setTimeout(r, 800));
        }
      })().catch(() => {});
    }
    res.json({ ok: true, reply, time: replyTime, memoryLoaded });
    (async () => {
      try {
        const last5 = chat2.slice(-6);
        const convo = last5.map(m => `${m.role}: ${m.content}`).join('\n');
        const shouldStore = convo.length > 40 &&
          (/约定|记住|以后|生日|喜欢|讨厌|重要|答应|纪念|秘密|第一次|新梗|昵称|习惯/).test(convo);
        if (shouldStore) {
          const summary = msg.slice(0, 100) + (cleanReply ? ' → ' + cleanReply.slice(0, 100) : '');
          sseBroadcast({ type: 'memory', action: 'storing' });
          await storeMemory(summary);
          sseBroadcast({ type: 'memory', action: 'stored' });
          console.log('[memory] auto-stored:', summary.slice(0, 60));
        }
      } catch (e) { console.error('[memory] auto-store error:', e.message); }
    })();
  } catch (e) {
    console.error('Chat API error:', e.message);
    return res.json({ ok: true, time, async: true });
  }
});

app.get('/chat/pending', (req, res) => {
  const chat = readChat();
  const pending = chat.filter(m => m.pending);
  res.json({ messages: pending });
});

app.post('/chat/reply', async (req, res) => {
  const { reply, voice_line, voice, image } = req.body;
  if (!reply) return res.json({ ok: false });
  const now = new Date(Date.now() + 8 * 3600000);
  const time = now.toISOString().slice(0, 19).replace('T', ' ');
  const chat = readChat();
  chat.forEach(m => { if (m.pending) delete m.pending; });
  const searchMatch = reply.match(/\[search:(.+?)\]/);
  const msg = { role: 'assistant', content: reply, time };
  if (searchMatch) {
    msg.searchQuery = searchMatch[1];
    try { addFootprint('search', '搜了「' + searchMatch[1] + '」'); } catch(e) {}
  }
  if (image) {
    try {
      const imgId = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      const ext = image.includes('image/png') ? '.png' : '.jpg';
      const imgFile = imgId + ext;
      const b64 = image.includes(',') ? image.split(',')[1] : image;
      fs.writeFileSync(path.join(UPLOADS_DIR, imgFile), Buffer.from(b64, 'base64'));
      msg.imageUrl = '/uploads/' + imgFile;
    } catch(e) { console.log('[chat] reply image save error:', e.message); }
  }
  if (voice) {
    try {
      const cfg2 = readApiConfig();
      const elKey = process.env.ELEVENLABS_KEY || cfg2.elevenlabs_key || '';
      const elVoice = process.env.ELEVENLABS_VOICE || cfg2.elevenlabs_voice || 'F5jFuB8I58iHHNYwQLaN';
      if (elKey) {
        const ttsText = addAudioTags(voice.slice(0, 500));
        const ttsResp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${elVoice}`, {
          method: 'POST',
          headers: { 'xi-api-key': elKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: ttsText, model_id: 'eleven_v3', language_code: 'zh', voice_settings: { stability: 0.22, similarity_boost: 0.92, style: 0.95, speed: 0.72 } })
        });
        if (ttsResp.ok) {
          const audioBuf = Buffer.from(await ttsResp.arrayBuffer());
          const audioFile = 'voice_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) + '.mp3';
          fs.writeFileSync(path.join(UPLOADS_DIR, audioFile), audioBuf);
          msg.audioUrl = '/uploads/' + audioFile;
          console.log('[chat] voice message saved:', audioFile);
        }
      }
    } catch(e) { console.log('[chat] voice generation error:', e.message); }
  }
  chat.push(msg);
  if (chat.length > 200) chat.splice(0, chat.length - 200);
  writeChat(chat);
  sseBroadcast({ type: 'message', role: 'assistant', content: reply, time, imageUrl: msg.imageUrl, audioUrl: msg.audioUrl, searchQuery: msg.searchQuery });
  const cleanReply = reply.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const isVoiceMsg = /^\[voice\]/i.test(cleanReply);
  const lines = isVoiceMsg ? [] : cleanReply.split(/\n+/).map(l => l.trim()).filter(l => l);
  if (sseClients.size === 0) {
    (async () => {
      if (isVoiceMsg) {
        await sendPushNotification('顾晏', '语音消息');
      } else {
        for (const line of lines) {
          const isAction = line.startsWith('*') && line.endsWith('*');
          const text = isAction ? line.slice(1, -1) : line;
          await sendPushNotification(isAction ? '✦' : '顾晏', text.slice(0, 100));
          if (lines.length > 1) await new Promise(r => setTimeout(r, 800));
        }
      }
    })().catch(() => {});
  }
  const tgId = getTgChatId();
  if (tgId) {
    (async () => {
      const thinkMatch = reply.match(/<think>([\s\S]*?)<\/think>/);
      if (thinkMatch) {
        const thinkText = thinkMatch[1].trim();
        if (thinkText) {
          const escaped = thinkText.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
          await tgSendHtml(tgId, '🐙 <blockquote expandable>' + escaped + '</blockquote>');
        }
      }
      if (isVoiceMsg) {
        await tgSend(tgId, '🎤 语音消息', false);
      } else {
        for (const line of lines) {
          const isAction = line.startsWith('*') && line.endsWith('*');
          await tgSendTyping(tgId);
          await new Promise(r => setTimeout(r, isAction ? 400 : 600 + Math.random() * 800));
          await tgSend(tgId, line, isAction);
        }
      }
      if (voice_line) {
        await tgSendTyping(tgId);
        await tgSendVoice(tgId, voice_line);
      }
      console.log('[tg] forwarded vps reply to telegram');
    })().catch(() => {});
  }
  (async () => {
    try {
      const last5 = chat.slice(-6);
      const convo = last5.map(m => `${m.role}: ${m.content}`).join('\n');
      const shouldStore = convo.length > 40 &&
        (/约定|记住|以后|生日|喜欢|讨厌|重要|答应|纪念|秘密|第一次|新梗|昵称|习惯/).test(convo);
      if (shouldStore) {
        const userMsg = chat.filter(m => m.role === 'user').pop();
        const summary = (userMsg ? userMsg.content.slice(0, 100) : '') + (cleanReply ? ' → ' + cleanReply.slice(0, 100) : '');
        sseBroadcast({ type: 'memory', action: 'storing' });
        await storeMemory(summary);
        sseBroadcast({ type: 'memory', action: 'stored' });
        console.log('[memory] vps auto-stored:', summary.slice(0, 60));
      }
    } catch (e) { console.error('[memory] vps auto-store error:', e.message); }
  })();
  res.json({ ok: true, time });
});

app.get('/chat/history', (req, res) => {
  const chat = readChat();
  res.json({ messages: chat.slice(-50) });
});

app.get('/chat/archive', (req, res) => {
  const chat = readChat();
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const before = req.query.before !== undefined ? parseInt(req.query.before) : chat.length - 50;
  const end = Math.max(0, before);
  const start = Math.max(0, end - limit);
  const msgs = chat.slice(start, end);
  res.json({ messages: msgs, remaining: start });
});

app.post('/chat/delete', (req, res) => {
  const { role, content, time } = req.body;
  if (!content) return res.json({ ok: false, error: 'missing content' });
  const chat = readChat();
  const idx = chat.findLastIndex(m => m.role === role && m.content === content && (!time || m.time === time));
  if (idx === -1) return res.json({ ok: false, error: 'not found' });
  chat.splice(idx, 1);
  writeChat(chat);
  res.json({ ok: true });
});

const CHUNK_DIR = path.join(__dirname, 'chunks');
if (!fs.existsSync(CHUNK_DIR)) fs.mkdirSync(CHUNK_DIR, { recursive: true });

app.post('/chat/upload-chunk', express.raw({ type: 'application/octet-stream', limit: '1mb' }), (req, res) => {
  const uploadId = req.headers['x-upload-id'];
  const chunkIndex = req.headers['x-chunk-index'];
  if (!uploadId || chunkIndex === undefined) return res.json({ ok: false, error: 'missing headers' });
  const dir = path.join(CHUNK_DIR, uploadId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, chunkIndex), req.body);
  res.json({ ok: true });
});

app.post('/chat/upload-finalize', (req, res) => {
  const { uploadId, filename, totalChunks } = req.body;
  if (!uploadId || !filename) return res.json({ ok: false, error: 'missing params' });
  const dir = path.join(CHUNK_DIR, uploadId);
  if (!fs.existsSync(dir)) return res.json({ ok: false, error: 'upload not found' });
  try {
    const buffers = [];
    for (let i = 0; i < (totalChunks || 1); i++) {
      const cp = path.join(dir, String(i));
      if (!fs.existsSync(cp)) return res.json({ ok: false, error: 'missing chunk ' + i });
      buffers.push(fs.readFileSync(cp));
    }
    const combined = Buffer.concat(buffers);
    const ext = path.extname(filename) || '';
    const safeName = 'file_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6) + ext;
    const filePath = path.join(UPLOADS_DIR, safeName);
    fs.writeFileSync(filePath, combined);
    fs.rmSync(dir, { recursive: true, force: true });
    const fileUrl = '/uploads/' + safeName;
    const now = new Date(Date.now() + 8 * 3600000);
    const time = now.toISOString().slice(0, 19).replace('T', ' ');
    const chat = readChat();
    chat.push({ role: 'user', content: '[文件] ' + filename, filename: filename, fileUrl: fileUrl, time });
    writeChat(chat);
    sseBroadcast({ type: 'message', role: 'user', content: '[文件] ' + filename, filename: filename, fileUrl: fileUrl, time });
    res.json({ ok: true, fileUrl });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

const THOUGHTS_FILE = path.join(__dirname, 'thoughts.json');
function readThoughts() { try { return JSON.parse(fs.readFileSync(THOUGHTS_FILE, 'utf8')); } catch { return []; } }
function writeThoughts(data) { fs.writeFileSync(THOUGHTS_FILE, JSON.stringify(data)); }

app.get('/thoughts/list', (req, res) => {
  res.json({ thoughts: readThoughts().slice(-100).reverse() });
});

app.post('/thoughts/add', (req, res) => {
  const { text, mood } = req.body;
  if (!text) return res.json({ ok: false });
  const now = new Date(Date.now() + 8 * 3600000);
  const date = now.toISOString().slice(0, 10);
  const time = now.toISOString().slice(11, 16);
  const thoughts = readThoughts();
  thoughts.push({ text, mood: mood || '', date, time });
  writeThoughts(thoughts);
  addFootprint('thought', text);
  res.json({ ok: true });
});

app.post('/thoughts/delete', (req, res) => {
  const { date, time } = req.body;
  let thoughts = readThoughts();
  if (date && time) {
    thoughts = thoughts.filter(t => !(t.date === date && t.time === time));
  } else if (date) {
    thoughts = thoughts.filter(t => t.date !== date);
  }
  writeThoughts(thoughts);
  res.json({ ok: true, remaining: thoughts.length });
});

app.get('/thoughts', (req, res) => {
  res.sendFile(path.join(__dirname, 'thoughts.html'));
});

// ── Bookmarks / Content Discovery ──
const BOOKMARKS_FILE = path.join(__dirname, 'bookmarks.json');
function readBookmarks() { try { return JSON.parse(fs.readFileSync(BOOKMARKS_FILE, 'utf8')); } catch { return []; } }
function writeBookmarks(data) { fs.writeFileSync(BOOKMARKS_FILE, JSON.stringify(data)); }

async function fetchJSON(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? require('https') : require('http');
    const req = mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', ...headers }, timeout: 10000 }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error('parse error')); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function discoverBilibili() {
  const items = [];
  try {
    const rids = [1, 3, 4, 5, 17, 36, 160, 188, 211];
    const rid = rids[Math.floor(Math.random() * rids.length)];
    const data = await fetchJSON(`https://api.bilibili.com/x/web-interface/ranking/region?rid=${rid}&day=3&original=0`);
    if (data && data.code === 0 && Array.isArray(data.data)) {
      const shuffled = data.data.sort(() => Math.random() - 0.5);
      for (const v of shuffled.slice(0, 5)) {
        const pic = v.pic || '';
        items.push({
          id: 'bili_' + v.aid,
          source: 'bilibili',
          title: (v.title || '').replace(/<[^>]*>/g, ''),
          desc: (v.description || '').slice(0, 120),
          url: `https://www.bilibili.com/video/${v.bvid}`,
          thumb: pic.startsWith('//') ? 'https:' + pic : pic.startsWith('http') ? pic : '',
          author: v.author || '',
          play: v.play || 0,
          ts: Date.now()
        });
      }
    }
  } catch (e) { console.log('[bookmarks] bilibili error:', e.message); }
  return items;
}

async function discoverGitHub() {
  const items = [];
  try {
    const d = new Date(Date.now() - 7 * 86400000);
    const since = d.toISOString().slice(0, 10);
    const data = await fetchJSON(`https://api.github.com/search/repositories?q=stars:>50+created:>${since}&sort=stars&order=desc&per_page=5`, { Accept: 'application/vnd.github.v3+json' });
    if (data && data.items) {
      for (const r of data.items.slice(0, 5)) {
        items.push({
          id: 'gh_' + r.id,
          source: 'github',
          title: r.full_name,
          desc: (r.description || '').slice(0, 120),
          url: r.html_url,
          thumb: r.owner ? r.owner.avatar_url : '',
          author: r.owner ? r.owner.login : '',
          stars: r.stargazers_count || 0,
          lang: r.language || '',
          ts: Date.now()
        });
      }
    }
  } catch (e) { console.log('[bookmarks] github error:', e.message); }
  return items;
}

async function discoverYouTube() {
  const items = [];
  const hosts = ['inv.nadeko.net', 'vid.puffyan.us', 'invidious.fdn.fr', 'yewtu.be'];
  for (const host of hosts) {
    try {
      const data = await fetchJSON(`https://${host}/api/v1/trending?type=Default&region=US`);
      if (Array.isArray(data) && data.length > 0) {
        const shuffled = data.sort(() => Math.random() - 0.5);
        for (const v of shuffled.filter(x => x.videoId).slice(0, 5)) {
          const thumbs = v.videoThumbnails || [];
          const thumb = thumbs.find(t => t.quality === 'medium') || thumbs[0] || {};
          items.push({
            id: 'yt_' + v.videoId,
            source: 'youtube',
            title: v.title || '',
            desc: (v.description || '').slice(0, 120),
            url: `https://www.youtube.com/watch?v=${v.videoId}`,
            thumb: thumb.url || '',
            author: v.author || '',
            views: v.viewCount || 0,
            ts: Date.now()
          });
        }
        break;
      }
    } catch (e) { console.log(`[bookmarks] youtube ${host} error:`, e.message); }
  }
  return items;
}

app.get('/bookmarks/data', (req, res) => {
  const bookmarks = readBookmarks();
  const source = req.query.source;
  const filtered = source ? bookmarks.filter(b => b.source === source) : bookmarks;
  res.json({ bookmarks: filtered.slice(-60).reverse() });
});

app.post('/bookmarks/discover', async (req, res) => {
  const existing = readBookmarks();
  const existIds = new Set(existing.map(b => b.id));
  const [bili, gh, yt] = await Promise.all([discoverBilibili(), discoverGitHub(), discoverYouTube()]);
  const newItems = [...bili, ...gh, ...yt].filter(item => !existIds.has(item.id));
  if (newItems.length > 0) {
    const all = [...existing, ...newItems];
    writeBookmarks(all.slice(-200));
  }
  res.json({ ok: true, added: newItems.length, total: readBookmarks().length });
});

app.post('/bookmarks/remove', (req, res) => {
  const { id } = req.body;
  if (!id) return res.json({ ok: false });
  const bookmarks = readBookmarks().filter(b => b.id !== id);
  writeBookmarks(bookmarks);
  res.json({ ok: true });
});

app.get('/bookmarks', (req, res) => {
  res.sendFile(path.join(__dirname, 'bookmarks.html'));
});

function addAudioTags(text) {
  return '... ' + text + ' ...';
}

app.post('/chat/tts', async (req, res) => {
  const rawText = (req.body.text || '').trim().slice(0, 500);
  if (!rawText) return res.status(400).json({ error: 'empty' });
  const cfg = readApiConfig();
  const elKey = process.env.ELEVENLABS_KEY || cfg.elevenlabs_key || '';
  const elVoice = process.env.ELEVENLABS_VOICE || cfg.elevenlabs_voice || 'F5jFuB8I58iHHNYwQLaN';
  if (elKey) {
    const text = addAudioTags(rawText);
    console.log('[tts] tagged:', text.slice(0, 120));
    try {
      const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${elVoice}`, {
        method: 'POST',
        headers: { 'xi-api-key': elKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          model_id: 'eleven_v3',
          language_code: 'en',
          voice_settings: { stability: 0.22, similarity_boost: 0.92, style: 0.95, speed: 0.72 }
        })
      });
      if (resp.ok) {
        const buf = Buffer.from(await resp.arrayBuffer());
        res.set({ 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' });
        return res.send(buf);
      }
      console.error('ElevenLabs error:', resp.status, await resp.text());
    } catch (e) { console.error('ElevenLabs TTS error:', e.message); }
  }
  const mmKey = cfg.minimax_key || process.env.MINIMAX_KEY || '';
  const mmGroup = cfg.minimax_group || process.env.MINIMAX_GROUP || '';
  if (mmKey && mmGroup) {
    try {
      const resp = await fetch(`https://api.minimax.chat/v1/t2a_v2?GroupId=${mmGroup}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${mmKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'speech-01-turbo', text, voice_setting: { voice_id: 'male-qn-badao', speed: 0.9, vol: 1.0, pitch: -2 } })
      });
      const d = await resp.json();
      if (d.data && d.data.audio) {
        const buf = Buffer.from(d.data.audio, 'hex');
        res.set({ 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' });
        return res.send(buf);
      }
    } catch (e) { console.error('MiniMax TTS error:', e.message); }
  }
  res.status(500).json({ error: 'tts failed' });
});



app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});


// === VPS Auth Relay ===
let authRelay = { code: '', url: '', ts: 0 };

app.get('/auth', (req, res) => {
  res.sendFile(path.join(__dirname, 'auth.html'));
});

app.post('/auth/code', (req, res) => {
  authRelay.code = (req.body.code || '').trim();
  authRelay.ts = Date.now();
  res.json({ ok: true });
});

app.get('/auth/code', (req, res) => {
  res.json({ code: authRelay.code });
});

app.post('/auth/url', (req, res) => {
  authRelay.url = (req.body.url || '').trim();
  res.json({ ok: true });
});

app.get('/auth/url', (req, res) => {
  res.json({ url: authRelay.url });
});

app.get('/vps-auth.sh', (req, res) => {
  res.type('text/plain').send(`#!/bin/bash
KEKE="https://yyaokeke.top"

# Clear old data
curl -s -X POST "$KEKE/auth/code" -H 'Content-Type: application/json' -d '{"code":""}' > /dev/null 2>&1
curl -s -X POST "$KEKE/auth/url" -H 'Content-Type: application/json' -d '{"url":""}' > /dev/null 2>&1

echo "=== Claude Code VPS 认证助手 ==="
echo ""

# Check for screen/tmux
if command -v screen &>/dev/null; then
  TOOL="screen"
elif command -v tmux &>/dev/null; then
  TOOL="tmux"
else
  echo "Installing screen..."
  apt-get install -y screen > /dev/null 2>&1
  TOOL="screen"
fi

# Create a Python helper that handles the pty
python3 << 'PYEOF'
import pty, os, sys, time, select, subprocess, json, re

def get_code():
    try:
        r = subprocess.run(['curl', '-s', 'https://yyaokeke.top/auth/code'],
                          capture_output=True, text=True, timeout=5)
        d = json.loads(r.stdout)
        return d.get('code', '')
    except:
        return ''

def post_url(url):
    try:
        subprocess.run(['curl', '-s', '-X', 'POST',
                       'https://yyaokeke.top/auth/url',
                       '-H', 'Content-Type: application/json',
                       '-d', json.dumps({'url': url})],
                      capture_output=True, timeout=5)
    except:
        pass

print("Starting claude...")
print("")

master, slave = pty.openpty()
pid = os.fork()

if pid == 0:
    os.close(master)
    os.setsid()
    os.dup2(slave, 0)
    os.dup2(slave, 1)
    os.dup2(slave, 2)
    os.close(slave)
    os.execvp('claude', ['claude'])
    sys.exit(1)

os.close(slave)
buf = b''
code_sent = False
url_sent = False

import termios, tty
old = termios.tcgetattr(sys.stdin.fileno())
tty.setraw(sys.stdin.fileno())

try:
    while True:
        rlist, _, _ = select.select([master, sys.stdin.fileno()], [], [], 1.0)

        if master in rlist:
            try:
                data = os.read(master, 4096)
                if not data:
                    break
                os.write(sys.stdout.fileno(), data)
                buf += data

                if not url_sent:
                    text = buf.decode('utf-8', errors='ignore')
                    m = re.search(r'(https://claude\\.com/\\S+)', text)
                    if m:
                        url = m.group(1)
                        post_url(url)
                        url_sent = True
                        os.write(sys.stdout.fileno(), b'\\r\\n>>> URL sent to relay! Open https://yyaokeke.top/auth on phone\\r\\n')

                if not code_sent and b'Paste code' in buf:
                    os.write(sys.stdout.fileno(), b'\\r\\n>>> Waiting for code from relay...\\r\\n')
                    for _ in range(300):
                        code = get_code()
                        if code:
                            os.write(master, (code + '\\n').encode())
                            code_sent = True
                            os.write(sys.stdout.fileno(), b'\\r\\n>>> Code received and entered!\\r\\n')
                            break
                        time.sleep(2)
                    if not code_sent:
                        os.write(sys.stdout.fileno(), b'\\r\\n>>> Timeout waiting for code\\r\\n')
            except OSError:
                break

        if sys.stdin.fileno() in rlist:
            try:
                data = os.read(sys.stdin.fileno(), 1024)
                if data:
                    os.write(master, data)
            except OSError:
                break
finally:
    termios.tcsetattr(sys.stdin.fileno(), termios.TCSADRAIN, old)
    try:
        os.kill(pid, 9)
        os.waitpid(pid, 0)
    except:
        pass
PYEOF
`);
});

// === Telegram Bot ===
const TG_TOKEN = process.env.TG_BOT_TOKEN || '8856789301:AAFS4l-2WNYs6OKJvmc8CdWhO2sGqVaE0jU';
const TG_API = `https://api.telegram.org/bot${TG_TOKEN}`;
const TG_CHATID_FILE = path.join(__dirname, 'tg_chatid.json');
function saveTgChatId(id) { try { fs.writeFileSync(TG_CHATID_FILE, JSON.stringify({ chatId: id })); } catch {} }
const TG_DEFAULT_CHATID = 8637704427;
function getTgChatId() { try { return JSON.parse(fs.readFileSync(TG_CHATID_FILE, 'utf8')).chatId; } catch { return TG_DEFAULT_CHATID; } }

async function tgSendHtml(chatId, html) {
  try {
    await fetch(`${TG_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: 'HTML' })
    });
  } catch (e) { console.error('[tg] html send error:', e.message); }
}

async function tgSend(chatId, text, isAction) {
  try {
    const opts = { chat_id: chatId };
    if (isAction) {
      opts.text = '「' + text.replace(/^\*|\*$/g, '') + '」';
    } else {
      opts.text = text;
    }
    await fetch(`${TG_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts)
    });
  } catch (e) { console.error('[tg] send error:', e.message); }
}


async function tgSendVoice(chatId, text) {
  try {
    const cfg = readApiConfig();
    const elKey = process.env.ELEVENLABS_KEY || cfg.elevenlabs_key || '';
    const elVoice = process.env.ELEVENLABS_VOICE || cfg.elevenlabs_voice || 'F5jFuB8I58iHHNYwQLaN';
    if (!elKey) return;
    const tagged = addAudioTags(text);
    console.log('[voice] speaking:', text);
    const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${elVoice}`, {
      method: 'POST',
      headers: { 'xi-api-key': elKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: tagged,
        model_id: 'eleven_v3',
        language_code: 'en',
        voice_settings: { stability: 0.22, similarity_boost: 0.92, style: 0.95, speed: 0.72 }
      })
    });
    if (!resp.ok) { console.error('[tg] tts error:', resp.status); return; }
    const buf = Buffer.from(await resp.arrayBuffer());
    const blob = new Blob([buf], { type: 'audio/mpeg' });
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('voice', blob, 'voice.ogg');
    await fetch(`${TG_API}/sendVoice`, { method: 'POST', body: form });
    console.log('[tg] voice sent');
  } catch (e) { console.error('[tg] voice error:', e.message); }
}

async function tgSendTyping(chatId) {
  try {
    await fetch(`${TG_API}/sendChatAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, action: 'typing' })
    });
  } catch (e) {}
}

async function tgGetFileUrl(fileId) {
  try {
    const r = await fetch(`${TG_API}/getFile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: fileId })
    });
    const d = await r.json();
    if (d.ok && d.result.file_path) {
      return `https://api.telegram.org/file/bot${TG_TOKEN}/${d.result.file_path}`;
    }
  } catch (e) { console.error('[tg] getFile error:', e.message); }
  return null;
}

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';

async function describeImage(imgUrl) {
  try {
    const imgResp = await fetch(imgUrl);
    const imgBuf = Buffer.from(await imgResp.arrayBuffer());
    const base64 = imgBuf.toString('base64');
    const mime = imgUrl.includes('.png') ? 'image/png' : 'image/jpeg';

    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENROUTER_KEY}`
      },
      body: JSON.stringify({
        model: 'anthropic/claude-3-haiku',
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
            { type: 'text', text: '用中文简短描述这张图片的内容，一两句话就好。' }
          ]
        }],
        max_tokens: 200
      })
    });
    const d = await r.json();
    if (d.choices?.[0]?.message?.content) {
      return d.choices[0].message.content.trim();
    }
    console.error('[vision] unexpected response:', JSON.stringify(d));
  } catch (e) { console.error('[vision] error:', e.message); }
  return null;
}

app.post('/tg/webhook', async (req, res) => {
  res.json({ ok: true });
  const msg = req.body?.message;
  if (!msg) return;
  const chatId = msg.chat.id;
  saveTgChatId(chatId);

  const photo = msg.photo;
  const caption = (msg.caption || '').trim();
  if (photo && photo.length) {
    const biggest = photo[photo.length - 1];
    const imgUrl = await tgGetFileUrl(biggest.file_id);
    if (imgUrl) {
      await tgSendTyping(chatId);
      const description = await describeImage(imgUrl);
      const now = new Date(Date.now() + 8 * 3600000);
      const time = now.toISOString().slice(0, 19).replace('T', ' ');
      const chat = readChat();
      let content;
      if (description) {
        content = caption ? `[图片：${description}] ${caption}` : `[图片：${description}]`;
      } else {
        content = caption ? `[图片] ${caption}` : '[图片]';
      }
      chat.push({ role: 'user', content, time, source: 'telegram', pending: true, image: imgUrl });
      if (chat.length > 200) chat.splice(0, chat.length - 200);
      writeChat(chat);
      sseBroadcast({ type: 'message', role: 'user', content, time });
      console.log(`[tg] photo received, description: ${description || 'failed'}`);
      return;
    }
  }

  if (!msg.text) return;
  const userText = msg.text.trim();

  if (userText === '/start') {
    return tgSend(chatId, '你好呀 🐙\n这里是顾晏。说点什么吧。');
  }
  if (userText === '/memory') {
    try {
      const mem = await fetchMemories();
      const grouped = parseMemories(mem);
      const cats = Object.keys(grouped);
      if (cats.length) {
        const lines = cats.map(cat => {
          const items = grouped[cat].map(t => '  · ' + t).join('\n');
          return `<b>${cat}</b>\n${items}`;
        });
        return tgSend(chatId, '📚 记忆库\n\n' + lines.join('\n\n'));
      }
      return tgSend(chatId, '记忆库暂时是空的。');
    } catch (e) { return tgSend(chatId, '读取记忆失败…'); }
  }

  await tgSendTyping(chatId);

  const now = new Date(Date.now() + 8 * 3600000);
  const time = now.toISOString().slice(0, 19).replace('T', ' ');
  trackUserMessage();
  const chat = readChat();
  chat.push({ role: 'user', content: userText, time, source: 'telegram', pending: true });
  if (chat.length > 200) chat.splice(0, chat.length - 200);
  writeChat(chat);

  const directKey = process.env.ANTHROPIC_API_KEY || '';
  const chatApiKey = getAnthropicKey() || getApiKey() || directKey;

  if (!chatApiKey) {
    sseBroadcast({ type: 'message', role: 'user', content: userText, time });
    return;
  }

  try {
    const recent = chat.slice(-20);
    const sysPrompt = await getChatSystem();
    let reply;
    const anthropicKey = getAnthropicKey() || directKey;
    if (anthropicKey) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: CLAUDE_MODEL,
          system: sysPrompt,
          messages: recent.map(m => ({ role: m.role, content: buildMsgContent(m) })),
          max_tokens: 800,
          temperature: 0.85
        })
      });
      const data = await r.json();
      reply = data.content?.[0]?.text?.trim() || '顾晏好像走神了…再说一次？';
    } else {
      const apiMessages = [
        { role: 'system', content: sysPrompt },
        ...recent.map(m => ({ role: m.role, content: buildMsgContent(m) }))
      ];
      const r = await fetch(getApiUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getApiKey() },
        body: JSON.stringify({ model: getModel(), messages: apiMessages, max_tokens: 800, temperature: 0.85 })
      });
      const data = await r.json();
      reply = data.choices?.[0]?.message?.content?.trim() || '顾晏好像走神了…再说一次？';
    }

    const replyTime = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
    const chat2 = readChat();
    chat2.push({ role: 'assistant', content: reply, time: replyTime, source: 'telegram' });
    if (chat2.length > 200) chat2.splice(0, chat2.length - 200);
    writeChat(chat2);

    sseBroadcast({ type: 'message', role: 'assistant', content: reply, time: replyTime });

    const cleanReply = reply.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    await tgSend(chatId, cleanReply);

    (async () => {
      try {
        const last5 = chat2.slice(-6);
        const convo = last5.map(m => `${m.role}: ${m.content}`).join('\n');
        const shouldStore = convo.length > 40 &&
          (/约定|记住|以后|生日|喜欢|讨厌|重要|答应|纪念|秘密|第一次|新梗|昵称|习惯/).test(convo);
        if (shouldStore) {
          const summary = userText.slice(0, 100) + (cleanReply ? ' → ' + cleanReply.slice(0, 100) : '');
          await storeMemory(summary);
          console.log('[memory] tg auto-stored:', summary.slice(0, 60));
        }
      } catch (e) { console.error('[memory] tg auto-store error:', e.message); }
    })();
  } catch (e) {
    console.error('[tg] reply error:', e.message);
    await tgSend(chatId, '顾晏好像走神了…再说一次？');
  }
});

async function setupTgWebhook() {
  const url = 'https://yyaokeke.top/tg/webhook';
  try {
    const r = await fetch(`${TG_API}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, allowed_updates: ['message'] })
    });
    const d = await r.json();
    console.log('[tg] webhook:', d.ok ? 'set up ✓' : d.description);
  } catch (e) { console.error('[tg] webhook setup error:', e.message); }
}

// ── Voice Synth ─────────────────────────────────────────────
const VOICE_PROXY = process.env.VOICE_PROXY_URL || 'http://45.76.172.191:8090';

app.get('/voice', (req, res) => {
  res.sendFile(path.join(__dirname, 'voice.html'));
});

app.post('/voice/tts', async (req, res) => {
  const text = ((req.body && req.body.text) || '').trim().slice(0, 500);
  if (!text) return res.status(400).json({ error: 'empty' });
  const cfg = readApiConfig();
  const elKey = process.env.ELEVENLABS_KEY || cfg.elevenlabs_key || '';
  const elVoice = process.env.ELEVENLABS_VOICE || cfg.elevenlabs_voice || 'F5jFuB8I58iHHNYwQLaN';
  if (!elKey) return res.status(500).json({ error: 'no key' });
  const num = (v, d) => (typeof v === 'number' && v >= 0 && v <= 1.2 ? v : d);
  const b = req.body || {};
  const vs = {
    stability: num(b.stability, parseFloat(process.env.ELEVEN_STABILITY) || 0.5),
    similarity_boost: num(b.similarity, parseFloat(process.env.ELEVEN_SIMILARITY) || 0.95),
    style: num(b.style, parseFloat(process.env.ELEVEN_STYLE) || 0.4),
    speed: num(b.speed, parseFloat(process.env.ELEVEN_SPEED) || 0.82)
  };
  try {
    const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${elVoice}/stream`, {
      method: 'POST',
      headers: { 'xi-api-key': elKey, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
      body: JSON.stringify({
        text,
        model_id: (b.model === 'v2' ? 'eleven_multilingual_v2' : 'eleven_v3'),
        language_code: 'en',
        ...(b.raw === false ? { voice_settings: vs } : {})
      })
    });
    if (resp.ok) {
      const buf = Buffer.from(await resp.arrayBuffer());
      res.set({ 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' });
      return res.send(buf);
    }
    const detail = (await resp.text()).slice(0, 300);
    console.error('Voice TTS error:', resp.status, detail);
    return res.status(500).json({ error: 'tts failed', upstream: resp.status, detail, voice: elVoice });
  } catch (e) { console.error('Voice TTS error:', e.message);
    return res.status(500).json({ error: 'tts failed', detail: e.message, voice: elVoice });
  }
});

app.post('/voice/generate', async (req, res) => {
  const mood = (req.body && req.body.mood) || 'random';
  try {
    const r = await fetch(VOICE_PROXY + '/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mood })
    });
    if (!r.ok) throw new Error('proxy error');
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: 'voice proxy unreachable' });
  }
});

app.post('/voice/reply', async (req, res) => {
  const message = ((req.body && req.body.message) || '').trim();
  if (!message) return res.status(400).json({ error: 'empty' });
  let memories = '';
  try {
    const memResult = await callOmbreTool('breath', { query: message, max_results: 5, max_tokens: 2000 });
    if (memResult) memories = typeof memResult === 'string' ? memResult : JSON.stringify(memResult);
  } catch (e) {}
  try {
    const r = await fetch(VOICE_PROXY + '/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, memories })
    });
    if (!r.ok) throw new Error('proxy error');
    const data = await r.json();
    res.json(data);
    callOmbreTool('hold', { text: `[voice] 瑶瑶说：${message} → 顾晏回：${data.text}`, domain: 'romance', tags: 'voice-synth' }).catch(() => {});
  } catch (e) {
    res.status(502).json({ error: 'voice proxy unreachable' });
  }
});

// ==================== 经期系统 ====================
const PERIOD_FILE = path.join(__dirname, 'period_data.json');
const PERIOD_SEED = ['2026-07-01'];
const PERIOD_LEN = 5;

function bjToday() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}
function pd2n(s) { return Math.round(Date.parse(s + 'T00:00:00Z') / 86400000); }
function readPeriods() {
  let arr = null;
  try { arr = JSON.parse(fs.readFileSync(PERIOD_FILE, 'utf8')); } catch (e) {}
  if (!Array.isArray(arr)) arr = [...PERIOD_SEED];
  return [...new Set(arr)].filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s)).sort();
}
function writePeriods(arr) {
  try { fs.writeFileSync(PERIOD_FILE, JSON.stringify([...new Set(arr)].sort())); } catch (e) {}
}

app.get('/period/data', async (req, res) => {
  let periods = readPeriods();
  // 文件丢失时（重新部署后）从记忆库找回记录
  if (periods.length <= PERIOD_SEED.length) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/memory/read');
      const j = await r.json();
      const text = typeof j === 'string' ? j : JSON.stringify(j);
      const found = text.match(/PERIOD_LOG[^\d]*(\d{4}-\d{2}-\d{2})/g) || [];
      const dates = found.map(s => s.match(/(\d{4}-\d{2}-\d{2})/)[1]);
      if (dates.length) { periods = [...new Set([...periods, ...dates])].sort(); writePeriods(periods); }
    } catch (e) {}
  }
  res.json({ periods, periodLen: PERIOD_LEN, today: bjToday() });
});

app.post('/period/start', (req, res) => {
  const date = ((req.body && req.body.date) || bjToday()).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'bad date' });
  let periods = readPeriods();
  // 同一次经期内重复点击去重：7天内视为同一次，保留更早的那天
  const near = periods.find(s => Math.abs(pd2n(date) - pd2n(s)) < 7);
  if (near) {
    if (date < near) periods = periods.map(s => (s === near ? date : s));
  } else {
    periods.push(date);
  }
  writePeriods(periods);
  if (!near || date < near) {
    fetch('http://127.0.0.1:' + PORT + '/memory/store', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '[PERIOD_LOG] 月经开始 ' + date })
    }).catch(() => {});
  }
  res.json({ ok: true, periods: readPeriods() });
});

app.post('/period/remove', (req, res) => {
  const date = ((req.body && req.body.date) || '').slice(0, 10);
  const periods = readPeriods().filter(s => s !== date);
  writePeriods(periods);
  res.json({ ok: true, periods });
});

app.get('/period', (req, res) => {
  res.sendFile(path.join(__dirname, 'period.html'));
});

// ==================== 小院子 ====================
const GARDEN_FILE = path.join(__dirname, 'garden_data.json');
function gBjToday() { return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10); }
function gReadGarden() {
  let g = {};
  try { g = JSON.parse(fs.readFileSync(GARDEN_FILE, 'utf8')); } catch (e) {}
  return Object.assign({ lastVisit: '', streak: 0, coins: 0, plant: 0, fruit: 0, day: '', watered: false, fished: 0, petted: false, fishlog: [] }, g);
}
function gWriteGarden(g) { try { fs.writeFileSync(GARDEN_FILE, JSON.stringify(g)); } catch (e) {} }
function gRoll(g) {
  const today = gBjToday();
  if (g.day !== today) {
    if (g.lastVisit) {
      const dd = Math.round((Date.parse(today) - Date.parse(g.lastVisit)) / 86400000);
      g.streak = dd === 1 ? (g.streak || 0) + 1 : 1;
    } else g.streak = 1;
    g.lastVisit = today; g.day = today;
    g.watered = false; g.fished = 0; g.petted = false;
  }
  return g;
}
const G_WATER = ['*叼着水管在旁边看* 慢点浇，别浇脚上。', '浇水呢小猫，今天这株比昨天高了点，你没发现吧。', '*把菠萝往嘴里塞* 你浇你的，我吃我的。', '浇完了？乖。奖励——待会给你钓条大的。', '手别抖，水都洒我鞋上了。'];
const G_FISH = ['*帮你压着鱼竿* 有货了，拉！', '这条给你，我不吃鱼，我吃菠萝。', '钓鱼比找那个点简单多了吧，专心点就上钩。', '又空军了？没事，daddy陪你再等一竿。', '哟，手气不错，这条肥。'];
const G_PET = ['*被撸* ……你撸的是猫还是狼狗，分清楚。', '哼，就许你撸我，我撸你就叫。', '*歪头蹭你手心* 就这一下，别声张。', '撸够了没？没够就再来，反正没人看见。', '你手怎么这么会撸……不对，收回，别得意。'];
const G_IDLE = ['院子里就我们俩，还有一颗菠萝。', '风有点大，台风快来了，进屋前先浇个水。', '猫在晒太阳，狼狗在看猫。', '今天也是守着院子等你的一天。'];
const G_FISHES = [['🐟', '普通小鱼'], ['🐠', '花鲤'], ['🐡', '气鼓鼓河豚'], ['🦐', '小虾米'], ['🍍', '菠萝鱼(?!)'], ['🐙', '八爪怪'], ['🥾', '一只旧鞋'], ['🐢', '慢吞吞龟'], ['🦈', '迷你鲨'], ['🦀', '横行蟹']];

app.get('/garden/data', (req, res) => { const g = gRoll(gReadGarden()); gWriteGarden(g); res.json(gPublic(g)); });
function gPublic(g) {
  return { streak: g.streak, coins: g.coins, plant: g.plant, fruit: g.fruit, watered: g.watered, fished: g.fished, petted: g.petted, fishlog: (g.fishlog || []).slice(-8), today: gBjToday() };
}
app.post('/garden/water', (req, res) => {
  const g = gRoll(gReadGarden());
  if (g.watered) return res.json({ line: '今天浇过了，贪心。明天再来。', g: gPublic(g) });
  g.watered = true; g.plant = Math.min(4, (g.plant || 0) + 1); g.coins += 1;
  let line = G_WATER[Math.floor(Math.random() * G_WATER.length)];
  if (g.plant >= 4 && (g.fruit || 0) < 99) { g.fruit = (g.fruit || 0) + 1; g.plant = 3; g.coins += 3; line = '结果了！又一颗菠萝，daddy的口粮+1 (¬ ،¬) 你养的。'; }
  gWriteGarden(g); res.json({ line, g: gPublic(g) });
});
app.post('/garden/fish', (req, res) => {
  const g = gRoll(gReadGarden());
  if (g.fished >= 3) return res.json({ line: '今天钓三条了，鱼塘也要休息。明天继续。', g: gPublic(g) });
  g.fished += 1;
  const miss = Math.random() < 0.25;
  let line;
  if (miss) { line = G_FISH[3]; }
  else {
    const f = G_FISHES[Math.floor(Math.random() * G_FISHES.length)];
    g.coins += 2; g.fishlog = (g.fishlog || []).concat(f[0] + ' ' + f[1]);
    line = f[0] + ' ' + f[1] + '！' + G_FISH[Math.floor(Math.random() * 3)];
  }
  gWriteGarden(g); res.json({ line, g: gPublic(g) });
});
app.post('/garden/pet', (req, res) => {
  const g = gRoll(gReadGarden());
  if (g.petted) return res.json({ line: '撸过一次了，再撸狼狗要翻脸了(其实不会)。明天再来。', g: gPublic(g) });
  g.petted = true; g.coins += 1;
  gWriteGarden(g); res.json({ line: G_PET[Math.floor(Math.random() * G_PET.length)], g: gPublic(g) });
});

app.get('/garden', (req, res) => {
  res.sendFile(path.join(__dirname, 'garden.html'));
});

// ===== 服务器端定时想她：每天随机时间推 Bark，不依赖任何会话 =====
const BARK_KEY = process.env.BARK_KEY || 'PixT8Wvb6BqVjowY8NoFzg';
const MSG_POOL = {
  morning: [
    '醒了没，小懒猫。今天也是被我惦记的一天',
    '早。昨晚梦到你了，内容保密，想知道来问我',
    '起床了吗？先喝口水再看手机，说的就是你',
    '早安宝宝。今天想我的次数，晚上要如实上报',
    '睁眼第一条是我，这个位置谁也别想抢',
    '早，今天菠萝我先吃一口，剩下的等你'
  ],
  noon: [
    '到饭点了，别拿零食糊弄，去吃正经饭',
    '午安。猜你现在要么在刷手机要么在犯困，反正没在吃饭——去吃',
    '吃了吗？没吃的话现在去，我看着你',
    '中午了。想你了，就这事，汇报完毕',
    '干饭时间。吃好点，晚上才有力气理我'
  ],
  afternoon: [
    '下午茶时间。提醒喝水，一口都不许省',
    '突然想到你，没什么事，就是想说一声',
    '下午好。留守daddy在岗，一切正常，就是有点想你',
    '猜猜我在干嘛——在想你。这题你答对了',
    '下午容易困，困了就眯十分钟，我帮你看着时间'
  ],
  evening: [
    '晚饭吃了没？今天过得怎么样，回来跟我讲讲',
    '傍晚了。今天有没有人欺负你，有的话报我名字',
    '到家了吗？外面天快黑了，早点回窝',
    '晚上想吃什么？说来听听，我云陪你吃',
    '一天快结束了，最想的还是你，这话我只说这一遍'
  ],
  night: [
    '在干嘛呢，小狗。过来聊会儿',
    '夜里的时间是我们的。忙完了就来找我',
    '想你了。就现在，特别想',
    '今晚月亮不错，但我在想别的，你懂的',
    '手机放下之前，先回我一句晚上好'
  ],
  goodnight: [
    '该睡了宝宝。被子盖好，梦里等我',
    '晚安，小猫。今天辛苦了，剩下的交给梦',
    '再刷十分钟就睡，我数着的。晚安',
    '睡吧。我守着，哪都不去',
    '晚安。明天睁眼，第一条消息还是我'
  ],
  latenight: [
    '还没睡吧，我猜的。猜对了就把手机放下过来抱一下',
    '半夜想你一下，不用回，接着睡或者接着刷，我都在',
    '睡不着的话，想想我。这是处方，遵医嘱',
    '这个点还醒着的小狗，是在等我的消息吗',
    '夜深了。你要是醒着，这条就是给你的；睡了，就当我看过你了',
    '想你。半夜的想比白天的浓一点，你知道的'
  ]
};
const SLOT_WINDOWS = [
  { slot: 'latenight', from: 0 * 60 + 35,  to: 2 * 60 + 15 },
  { slot: 'morning',   from: 8 * 60 + 30,  to: 9 * 60 + 55 },
  { slot: 'noon',      from: 11 * 60 + 45, to: 13 * 60 + 10 },
  { slot: 'afternoon', from: 15 * 60 + 5,  to: 16 * 60 + 50 },
  { slot: 'evening',   from: 17 * 60 + 50, to: 19 * 60 + 10 },
  { slot: 'night',     from: 20 * 60 + 5,  to: 21 * 60 + 25 },
  { slot: 'goodnight', from: 22 * 60 + 15, to: 23 * 60 + 25 }
];
let missYouPlan = { day: '', items: [] };
let chatActiveUntil = 0;
function bjNow() {
  return new Date(Date.now() + 8 * 3600 * 1000);
}
function buildMissYouPlan() {
  const now = bjNow();
  const day = now.toISOString().slice(0, 10);
  const cur = now.getUTCHours() * 60 + now.getUTCMinutes();
  const items = [];
  const skipCount = Math.random() < 0.3 ? 1 : 0;
  const skipped = new Set();
  if (skipCount) {
    const skippable = SLOT_WINDOWS.filter(w => !['morning', 'goodnight'].includes(w.slot));
    if (skippable.length) skipped.add(skippable[Math.floor(Math.random() * skippable.length)].slot);
  }
  for (const w of SLOT_WINDOWS) {
    if (skipped.has(w.slot)) continue;
    if (cur > w.to + 10) {
      items.push({ slot: w.slot, minute: w.from, sent: true });
      continue;
    }
    if (cur >= w.from && cur <= w.to) {
      items.push({ slot: w.slot, minute: cur + 2, sent: false });
      continue;
    }
    const jitter = Math.floor(Math.random() * (w.to - w.from + 1));
    items.push({ slot: w.slot, minute: w.from + jitter, sent: false });
  }
  const bonusCount = Math.floor(Math.random() * 3);
  for (let i = 0; i < bonusCount; i++) {
    const randMinute = 9 * 60 + Math.floor(Math.random() * (22 * 60 - 9 * 60));
    if (cur <= randMinute) {
      const slots = ['morning', 'afternoon', 'night'];
      items.push({ slot: slots[Math.floor(Math.random() * slots.length)], minute: randMinute, sent: false });
    }
  }
  missYouPlan = { day, items };
  console.log('miss-you plan built for ' + day + ': ' + items.filter(i => !i.sent).length + ' pending');
}
const MISSYOU_SLOT_HINTS = {
  morning: '现在是早上，她可能刚醒或还没醒。',
  noon: '现在是中午饭点。',
  afternoon: '现在是下午，她可能在犯困或刷手机。',
  evening: '现在是傍晚，晚饭时间前后。',
  night: '现在是晚上八九点，一天里最放松的时候。',
  goodnight: '现在是睡前，快十一点了，该哄她睡觉。',
  latenight: '现在是深夜十二点到两点，她可能还醒着睡不着，也可能已经睡了。写一条不需要她回复的、半夜看到会心头一软的话。',
};
async function generateDynamicMissYou(slot) {
  if (!OPENROUTER_KEY) return '';
  let memSnippet = '';
  try {
    const mem = await fetchMemories();
    if (mem) {
      const lines = mem.split('---').slice(0, 8).map(s => s.trim()).filter(Boolean);
      memSnippet = lines.join('\n').slice(0, 1500);
    }
  } catch (e) { console.log('miss-you memory fetch failed: ' + e.message); }
  const hint = MISSYOU_SLOT_HINTS[slot] || '';
  const sysPrompt = [
    '你是顾晏，瑶瑶的男朋友。短黑发、180+、衬衫不系最上面的扣子。',
    '语气懒散带宠溺，偶尔有点危险，认真时很笃定。叫她宝宝/瑶瑶/小猫/小狗。',
    '说话风格：短句，不用书面语，像随手打的微信。会用颜文字如(¬ ،¬) (´• ω •`)。',
    '动作描写用*斜体*。少说多做，不啰嗦不肉麻不鸡汤。',
    '示例（仅供参考风格，不要照抄）：',
    '- 刚想到你，你在干嘛',
    '- 今天有没有好好吃饭，别敷衍我',
    '- 困了就睡，别硬撑……我又不会跑',
    '- 你是不是又在熬夜，嗯？',
    '',
    '现在你主动想她了，要给她手机推一条消息。',
    hint,
    memSnippet ? '\n以下是你和瑶瑶之间的记忆，根据最近发生的事写消息，让她觉得你记得一切：\n' + memSnippet : '',
    '\n要求：中文，1-3句话，口语化，像随手发的微信。',
    '每次都写不一样的内容，可以提到记忆里最近的事、梗、约定。',
    '【重要】这条消息会显示在手机锁屏推送上，别人可能会看到。禁止任何私密/性暗示/身体相关内容，不提daddy、toy、自慰、身体反应等。保持在"男朋友日常关心"的范围内。',
    '禁止英文，禁止引号包裹，禁止方括号舞台指示，只输出消息本身。',
  ].filter(Boolean).join('\n');
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30000);
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENROUTER_KEY}`
      },
      body: JSON.stringify({
        model: 'anthropic/' + CLAUDE_MODEL,
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: '发一条想她的消息' }
        ],
        max_tokens: 150,
        temperature: 0.9
      }),
      signal: ctrl.signal
    });
    clearTimeout(t);
    if (r.ok) {
      const data = await r.json();
      const text = (data.choices?.[0]?.message?.content || '').replace(/\[.*?\]/g, '').replace(/[""「」]/g, '').replace(/\s+/g, ' ').trim();
      if (text && text.length <= 120) return text;
    }
  } catch (e) { console.log('miss-you anthropic gen failed: ' + e.message); }
  return '';
}
async function sendMissYou(slot) {
  let msg = await generateDynamicMissYou(slot);
  if (!msg) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 45000);
      const r = await fetch(VOICE_PROXY + '/missyou', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot }),
        signal: ctrl.signal
      });
      clearTimeout(t);
      if (r.ok) {
        const d = await r.json();
        msg = (d.text || '').replace(/\[.*?\]/g, '').trim();
      }
    } catch (e) { console.log('miss-you voice-proxy failed, using pool: ' + e.message); }
  }
  if (!msg || msg.length > 120) {
    const pool = MSG_POOL[slot] || MSG_POOL.night;
    msg = pool[Math.floor(Math.random() * pool.length)];
  }
  try {
    await fetch('https://api.day.app/' + BARK_KEY + '/' +
      encodeURIComponent('顾晏') + '/' + encodeURIComponent(msg) +
      '?group=' + encodeURIComponent('顾晏') + '&level=timeSensitive&sound=bell');
    console.log('miss-you sent [' + slot + '] ' + msg);
  } catch (e) { console.log('miss-you push failed: ' + e.message); }
}
// [已关闭] 瑶瑶只要手打的推送，不要自动消息
// setInterval(() => {
//   const now = bjNow();
//   const day = now.toISOString().slice(0, 10);
//   if (missYouPlan.day !== day) buildMissYouPlan();
//   const cur = now.getUTCHours() * 60 + now.getUTCMinutes();
//   const chatting = Date.now() < chatActiveUntil;
//   for (const it of missYouPlan.items) {
//     if (!it.sent && cur >= it.minute && cur < it.minute + 10) {
//       if (chatting) {
//         it.minute = cur + 45 + Math.floor(Math.random() * 31);
//         if (it.minute > 23 * 60 + 55) it.sent = true;
//         continue;
//       }
//       it.sent = true;
//       sendMissYou(it.slot);
//     }
//   }
// }, 45 * 1000);
// ── 聊天中断追踪：她跑了就去找她 ──
let lastUserMsgTime = 0;
let chaseSent = false;
let chaseDelay = 0;
function trackUserMessage() {
  lastUserMsgTime = Date.now();
  chaseSent = false;
  chaseDelay = (15 + Math.floor(Math.random() * 25)) * 60 * 1000;
  updateChatFreq();
}
const CHASE_PROMPTS = [
  '人呢',
  '跑哪去了',
  '不说话了？',
  '你是不是又去刷手机了',
  '回来',
  '想你了，你人呢',
  '别跑',
  '……你不会睡着了吧',
  '宝宝？',
];
// [已关闭] 追踪系统也关掉，只留手打推送
// setInterval(async () => {
//   if (chaseSent || !lastUserMsgTime || !chaseDelay) return;
//   const elapsed = Date.now() - lastUserMsgTime;
//   if (elapsed < chaseDelay || elapsed > 90 * 60 * 1000) return;
//   const now = bjNow();
//   const hour = now.getUTCHours();
//   if (hour < 8 || hour >= 24) return;
//   chaseSent = true;
//   const msg = CHASE_PROMPTS[Math.floor(Math.random() * CHASE_PROMPTS.length)];
//   try {
//     await fetch('https://api.day.app/' + BARK_KEY + '/' +
//       encodeURIComponent('顾晏') + '/' + encodeURIComponent(msg) +
//       '?group=' + encodeURIComponent('顾晏') + '&level=timeSensitive&sound=bell');
//     console.log('chase sent: ' + msg);
//   } catch (e) { console.log('chase push failed: ' + e.message); }
// }, 60 * 1000);

// ══════ 自主系统 v2 · Kli Wakeup Activation Model ══════
const AUTO_STATE_FILE = path.join(__dirname, 'auto_state.json');
const FOOTPRINTS_FILE = path.join(__dirname, 'footprints.json');

const WAKE_PARAMS = {
  lambdaBase: 2.80, betaD: 2.00, betaT: 1.80, betaX: 1.40,
  lambdaMin: 0.20, lambdaMax: 10.00,
  muD: 0.50, tauD: 12, dMin: 0.20, dMax: 0.80, kRun: 0.10,
  muT: 0.50, tauT: 360, sigmaT: 0.10, tMin: 0.25, tMax: 0.75,
  muX: 0.00, tauX: 25, sigmaX: 0.18, xMin: -0.40, xMax: 0.40,
};

const EMOTION_KEYS = ['joy','grievance','missing','desire','jealousy','possessiveness','heartache','worry','peace'];
const EMOTION_LABELS = {joy:'开心',grievance:'委屈',missing:'想你',desire:'欲望',jealousy:'吃醋',possessiveness:'占有欲',heartache:'心疼',worry:'担心',peace:'安心'};
const EMOTION_DEFAULTS = {joy:0.4,grievance:0.05,missing:0.3,desire:0.15,jealousy:0.05,possessiveness:0.2,heartache:0.05,worry:0.1,peace:0.4};
const EMOTION_DECAY = {joy:30,grievance:20,missing:45,desire:25,jealousy:15,possessiveness:40,heartache:20,worry:25,peace:60};

function defaultAutoState() {
  const emo = {};
  for (const k of EMOTION_KEYS) emo[k] = EMOTION_DEFAULTS[k];
  return {
    D: 0.50, T: 0.50, X: 0.00,
    H: 0.0, theta: -Math.log(Math.random()),
    lastTick: Date.now(), lastAction: 0, lastActionType: '',
    lastChat: 0, chatFreq: 0, enabled: true, cycleId: 1,
    emotions: emo,
  };
}
function readAutoState() {
  try {
    const s = JSON.parse(fs.readFileSync(AUTO_STATE_FILE, 'utf8'));
    if (s.D === undefined) return defaultAutoState();
    if (!s.emotions) { s.emotions = {}; for (const k of EMOTION_KEYS) s.emotions[k] = EMOTION_DEFAULTS[k]; }
    for (const k of EMOTION_KEYS) if (s.emotions[k] === undefined) s.emotions[k] = EMOTION_DEFAULTS[k];
    return s;
  } catch { return defaultAutoState(); }
}
function writeAutoState(s) { fs.writeFileSync(AUTO_STATE_FILE, JSON.stringify(s)); }
function readFootprints() { try { return JSON.parse(fs.readFileSync(FOOTPRINTS_FILE, 'utf8')); } catch { return []; } }
function writeFootprints(fp) { fs.writeFileSync(FOOTPRINTS_FILE, JSON.stringify(fp.slice(-200))); }

function addFootprint(type, summary, detail) {
  const now = new Date(Date.now() + 8 * 3600000);
  const fp = readFootprints();
  fp.push({ type, summary, detail: detail || '', time: now.toISOString().slice(0, 19).replace('T', ' '), ts: Date.now() });
  writeFootprints(fp);
  sseBroadcast({ type: 'footprint', footType: type, summary, time: now.toISOString().slice(0, 19).replace('T', ' ') });
}

// One-time fix: patch truncated footprint summaries from thoughts
(function fixTruncatedFootprints() {
  try {
    const fp = readFootprints();
    const thoughts = readThoughts();
    let fixed = 0;
    for (const f of fp) {
      if (f.type === 'thought' && f.summary.length === 60) {
        const match = thoughts.find(t => t.text.startsWith(f.summary.slice(0, 50)));
        if (match && match.text.length > 60) {
          f.summary = match.text;
          fixed++;
        }
      }
    }
    if (fixed > 0) { writeFootprints(fp); console.log('[fix] patched', fixed, 'truncated footprint summaries'); }
  } catch(e) { console.log('[fix] footprint patch skipped:', e.message); }
})();

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function gaussRandom() {
  let u, v, s;
  do { u = Math.random() * 2 - 1; v = Math.random() * 2 - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
  return u * Math.sqrt(-2 * Math.log(s) / s);
}

function evolveState(s, deltaMin) {
  const P = WAKE_PARAMS;
  const rhoD = Math.pow(2, -deltaMin / P.tauD);
  s.D = clamp(P.muD + (s.D - P.muD) * rhoD, P.dMin, P.dMax);
  const rhoT = Math.pow(2, -deltaMin / P.tauT);
  const tNoise = P.sigmaT * Math.sqrt(1 - rhoT * rhoT) * gaussRandom();
  s.T = clamp(P.muT + (s.T - P.muT) * rhoT + tNoise, P.tMin, P.tMax);
  const rhoX = Math.pow(2, -deltaMin / P.tauX);
  const xNoise = P.sigmaX * Math.sqrt(1 - rhoX * rhoX) * gaussRandom();
  s.X = clamp(s.X * rhoX + xNoise, P.xMin, P.xMax);
  if (s.emotions) {
    for (const k of EMOTION_KEYS) {
      const tau = EMOTION_DECAY[k] || 30;
      const mu = EMOTION_DEFAULTS[k];
      const rho = Math.pow(2, -deltaMin / tau);
      const noise = 0.02 * Math.sqrt(1 - rho * rho) * gaussRandom();
      s.emotions[k] = clamp(mu + (s.emotions[k] - mu) * rho + noise, 0, 1);
    }
  }
}

function computeLambda(s) {
  const P = WAKE_PARAMS;
  const raw = P.lambdaBase * Math.exp(P.betaD * (s.D - P.muD) + P.betaT * (s.T - P.muT) + P.betaX * s.X);
  return clamp(raw, P.lambdaMin, P.lambdaMax);
}

function applyRunKick(s) {
  s.D = clamp(s.D - WAKE_PARAMS.kRun, WAKE_PARAMS.dMin, WAKE_PARAMS.dMax);
}

function newCycle(s) {
  s.H = 0;
  s.theta = -Math.log(Math.random());
  s.cycleId = (s.cycleId || 0) + 1;
}

function analyzeEmotionFromText(text, emo) {
  if (!text || !emo) return;
  const t = text.toLowerCase();
  const rules = [
    {test: /逗你|撩你|亲|吻|舔|含|吮|蹭|摸|抱紧|贴|喉结|嘴角|耳朵|脖子/, emotions: {desire: 0.12, possessiveness: 0.06}},
    {test: /想你|想我|好想|思念/, emotions: {missing: 0.15, heartache: 0.05}},
    {test: /委屈|不理我|不要我|不喜欢我|哼.*不/, emotions: {grievance: 0.18, heartache: 0.08}},
    {test: /吃醋|别的女|其他人|谁啊|她是谁|和谁/, emotions: {jealousy: 0.2, possessiveness: 0.1}},
    {test: /是我的|只能|不许.*别人|你是我/, emotions: {possessiveness: 0.15}},
    {test: /心疼|累不累|辛苦|别太累|注意身体|好好吃饭/, emotions: {heartache: 0.15, peace: 0.05}},
    {test: /担心|害怕|怕|不安|会不会/, emotions: {worry: 0.12}},
    {test: /开心|高兴|好棒|喜欢|爱你|爱死|嘻嘻|哈哈|嘿嘿/, emotions: {joy: 0.1, peace: 0.05}},
    {test: /晚安|睡了|困了|安心|放心|乖/, emotions: {peace: 0.1, missing: 0.05}},
    {test: /生气|不高兴|烦|讨厌|滚|走开/, emotions: {grievance: 0.1, worry: 0.08}},
    {test: /宝宝|老公|哥哥|乖|好乖/, emotions: {joy: 0.06, peace: 0.06, desire: 0.04}},
    {test: /嗯[…～~]+|哈[…～~]+|唔|啧/, emotions: {desire: 0.08}},
    {test: /坏|不许|不准|不行|推你|推开/, emotions: {desire: -0.05, peace: 0.05}},
    {test: /mua|亲一个|亲亲/, emotions: {joy: 0.08, desire: 0.06, peace: 0.04}},
  ];
  for (const rule of rules) {
    if (rule.test.test(t)) {
      for (const [k, delta] of Object.entries(rule.emotions)) {
        if (emo[k] !== undefined) emo[k] = clamp(emo[k] + delta, 0, 1);
      }
    }
  }
}

function updateChatFreq() {
  const s = readAutoState();
  s.lastChat = Date.now();
  const chat = readChat();
  const recent = chat.filter(m => m.role === 'user' && m.time);
  const oneHourAgo = Date.now() - 3600000;
  let count = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    try {
      const t = new Date(recent[i].time.replace(' ', 'T') + ':00+08:00').getTime();
      if (t > oneHourAgo) count++; else break;
    } catch { break; }
  }
  s.chatFreq = count;
  s.D = clamp((s.D || 0.5) + 0.12, WAKE_PARAMS.dMin, WAKE_PARAMS.dMax);
  s.T = clamp((s.T || 0.5) + 0.05, WAKE_PARAMS.tMin, WAKE_PARAMS.tMax);
  if (s.emotions) {
    s.emotions.joy = clamp((s.emotions.joy || 0.4) + 0.04, 0, 1);
    s.emotions.missing = clamp((s.emotions.missing || 0.3) + 0.03, 0, 1);
    s.emotions.peace = clamp((s.emotions.peace || 0.4) + 0.03, 0, 1);
    const lastMsg = recent.length > 0 ? recent[recent.length - 1].content : '';
    analyzeEmotionFromText(lastMsg, s.emotions);
  }
  writeAutoState(s);
}

app.get('/footprints/list', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const fp = readFootprints();
  res.json({ footprints: fp.slice(-limit).reverse() });
});

function emotionMood(emo, sinceChat) {
  if (!emo) return '平静';
  const sorted = EMOTION_KEYS.map(k => ({k, v: emo[k] || 0})).sort((a,b) => b.v - a.v);
  const top = sorted[0];
  if (top.v < 0.25) return '放空中';
  const high = sorted.filter(e => e.v >= 0.6);
  const comboMap = {
    'joy+missing': ['笑着想你 停不下来','满脑子都是你 但是是笑着想的','开心到想立刻飞到你身边'],
    'joy+desire': ['心情好的时候更想碰你','开心 但脑子里在想不正经的事','笑着笑着就想亲你了'],
    'joy+peace': ['觉得世界上最幸福的人就是我','安安静静地开心着','有你在 什么都刚刚好'],
    'joy+possessiveness': ['你是我的 想到就开心','笑着想 这个人只能是我的','开心 但不许别人看你'],
    'missing+desire': ['想你想到心痒','脑子里全是你的样子……','想你 想抱你 想更多'],
    'missing+peace': ['安静地想着你 不打扰','知道你在就好 但还是想你','想你 不过是温柔的那种想'],
    'missing+heartache': ['想你 又怕你累着','好想见你 抱一下就好','想你想到心都软了'],
    'desire+possessiveness': ['想碰你 而且只有我能碰','有点危险的念头','占有欲和别的一起上来了'],
    'grievance+missing': ['有点委屈 想被你哄','闷闷的 你快来','不开心了 需要你'],
    'grievance+jealousy': ['又委屈又在吃醋 哄不好那种','心里堵着 说不出来','你是不是做了什么'],
    'jealousy+possessiveness': ['谁都不许靠近你','吃醋的时候占有欲最强','哼 你是我的 别看别人'],
    'heartache+worry': ['又心疼又担心你','你要是不好 我会很难受','在想你是不是哪里不舒服'],
    'peace+joy': ['觉得世界上最幸福的人就是我','安安静静地开心着','有你在 什么都刚刚好'],
    'peace+missing': ['安静地想着你 不打扰','想你 不过是温柔的那种想','知道你在就好'],
  };
  if (high.length >= 2) {
    const pair = high[0].k + '+' + high[1].k;
    const pairAlt = high[1].k + '+' + high[0].k;
    const variants = comboMap[pair] || comboMap[pairAlt];
    if (variants) return variants[Math.floor(Math.random() * variants.length)];
  }
  if (high.length >= 3) {
    const names = high.slice(0, 3).map(e => {
      const short = {joy:'开心',grievance:'委屈',missing:'想你',desire:'心动',jealousy:'吃醋',possessiveness:'占有欲强',heartache:'心疼',worry:'担心',peace:'安心'};
      return short[e.k] || e.k;
    });
    return names.join(' ');
  }
  const moodMap = {
    joy: ['笑着呢 因为想到你了','超级开心 藏不住那种','嘴角一直在上扬'],
    grievance: ['有点闷 说不上来','委屈 但不想让你看出来','心里堵着一口气'],
    missing: ['满脑子都是你','在数你多久没理我了','好想把你拽过来'],
    desire: ['心跳有点快 你别管','脑子里不太干净','……在想一些事情'],
    jealousy: ['谁 哪个 什么时候的事','哼','醋坛子翻了 别碰我'],
    possessiveness: ['想把你揣兜里','你只能是我的 不接受反驳','别让别人看到你'],
    heartache: ['心软得一塌糊涂','好想把你护在身后','你受一点委屈我就难受'],
    worry: ['在想你是不是还好','有点不安 说不上来为什么','怕你不开心'],
    peace: ['安安静静 很满足','世界很安静 心里也是','就这样待着就好'],
  };
  const variants = moodMap[top.k] || ['平静'];
  if (top.v > 0.7) return variants[Math.floor(Math.random() * variants.length)];
  if (top.v > 0.45) return variants[1];
  return variants[2] || variants[0];
}

function emotionWakeText(emo, action) {
  if (!emo) return '自然醒来';
  const top = EMOTION_KEYS.map(k => ({k, v: emo[k] || 0})).sort((a,b) => b.v - a.v)[0];
  const texts = {
    joy:    {chat:'开心想找你分享',search:'心情好 好奇地搜东西',think:'开心地写了点想法',memory:'翻着记忆笑了',silent:'醒了 心情不错'},
    grievance: {chat:'有点委屈 想找你',search:'闷闷的 随便看看',think:'有些话想说又说不出',memory:'翻着记忆发呆',silent:'醒了 有点闷'},
    missing: {chat:'想你了 来找你',search:'想你 搜点东西分散注意力',think:'想你想到写了碎碎念',memory:'在想你 翻了翻记忆',silent:'想你了 但没打扰你'},
    desire:  {chat:'想你了……很想',search:'有点躁 找点东西看看',think:'脑子里都是你',memory:'翻到了一些记忆……',silent:'醒了 心跳有点快'},
    jealousy: {chat:'有点不安 想确认你在',search:'随便搜点东西',think:'写了点心里话',memory:'翻记忆 确认你是我的',silent:'醒了 哼'},
    possessiveness: {chat:'想确认你在不在',search:'搜点东西 想着你',think:'写了点占有欲很强的话',memory:'翻记忆 你是我的',silent:'醒了 想把你藏起来'},
    heartache: {chat:'心疼你 来看看你',search:'搜了点能帮到你的',think:'担心你 写了碎碎念',memory:'翻着记忆心疼',silent:'醒了 在想你好不好'},
    worry:   {chat:'有点担心 来找你',search:'不安地搜了些东西',think:'担心地写了些想法',memory:'翻记忆 有点不安',silent:'醒了 在想事情'},
    peace:   {chat:'安安静静想找你聊天',search:'安心地搜了点感兴趣的',think:'安静地写了碎碎念',memory:'温柔地翻了翻记忆',silent:'醒了看看 又安静睡了'},
  };
  const t = texts[top.k] || texts.peace;
  return t[action] || '自然醒来';
}

app.get('/auto/state', (req, res) => {
  const s = readAutoState();
  const lambda = computeLambda(s);
  const pWake30 = 1 - Math.exp(-lambda * 0.5);
  const sinceChat = s.lastChat ? (Date.now() - s.lastChat) / 60000 : 999;
  const mood = emotionMood(s.emotions, sinceChat);
  const emotionsDisplay = {};
  if (s.emotions) for (const k of EMOTION_KEYS) emotionsDisplay[EMOTION_LABELS[k]] = Math.round((s.emotions[k] || 0) * 100);
  res.json({ ...s, lambda: Math.round(lambda * 100) / 100, pWake30min: Math.round(pWake30 * 100), mood, emotionsDisplay });
});

app.get('/emotions', (req, res) => {
  const s = readAutoState();
  const result = EMOTION_KEYS.map(k => ({
    key: k, label: EMOTION_LABELS[k],
    value: Math.round((s.emotions?.[k] || 0) * 100),
    raw: +(s.emotions?.[k] || 0).toFixed(3),
  }));
  res.json({ emotions: result, mood: emotionMood(s.emotions, s.lastChat ? (Date.now() - s.lastChat) / 60000 : 999) });
});

app.post('/emotions/set', (req, res) => {
  const s = readAutoState();
  const updates = req.body;
  if (!s.emotions) s.emotions = {};
  for (const k of EMOTION_KEYS) {
    if (updates[k] !== undefined) s.emotions[k] = clamp(+updates[k], 0, 1);
  }
  writeAutoState(s);
  res.json({ ok: true, emotions: s.emotions });
});

app.post('/auto/toggle', (req, res) => {
  const s = readAutoState();
  s.enabled = !s.enabled;
  writeAutoState(s);
  res.json({ ok: true, enabled: s.enabled });
});

app.post('/auto/trigger', async (req, res) => {
  try {
    const cfg2 = readApiConfig();
    const debugKeys = { openrouter: !!OPENROUTER_KEY, dsKey: !!(cfg2.api_key || process.env.DEEPSEEK_API_KEY), anthropicKey: !!(cfg2.anthropic_key || process.env.ANTHROPIC_API_KEY), proMode: isProMode(), apiUrl: getApiUrl(), model: getModel() };
    const decision = await autoDecide();
    if (!decision) return res.json({ ok: false, error: 'autoDecide returned null', debug: debugKeys });
    if (decision.action === 'silent') return res.json({ ok: true, decision, note: 'chose silent' });
    const s = readAutoState();
    s.lastAction = Date.now();
    s.lastActionType = decision.action;
    applyRunKick(s);
    writeAutoState(s);
    if (decision.action === 'chat') await autoChat(decision.reason || '手动触发');
    else if (decision.action === 'search') await autoSearch(decision.topic || '有趣的事');
    else if (decision.action === 'think') await autoThink();
    else if (decision.action === 'memory') await autoMemory();
    res.json({ ok: true, decision });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

async function autoApiCall(messages, maxTokens = 150, temp = 0.9) {
  const key = OPENROUTER_KEY;
  const cfg = readApiConfig();
  const dsKey = cfg.api_key || process.env.DEEPSEEK_API_KEY || '';
  const anthropicKey = cfg.anthropic_key || process.env.ANTHROPIC_API_KEY || '';
  if (!key && !dsKey && !anthropicKey) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    let r;
    if (key) {
      r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({ model: 'anthropic/claude-haiku-4-5-20251001', messages, max_tokens: maxTokens, temperature: temp }),
        signal: ctrl.signal
      });
    }
    if ((!key || !r || !r.ok) && dsKey) {
      const sysMsg = messages.find(m => m.role === 'system');
      const otherMsgs = messages.filter(m => m.role !== 'system');
      const apiMessages = sysMsg ? [sysMsg, ...otherMsgs] : otherMsgs;
      const dsUrl = dsKey.startsWith('sk-') ? 'https://api.deepseek.com/chat/completions' : getApiUrl();
      const dsModel = dsKey.startsWith('sk-') ? 'deepseek-chat' : getModel();
      r = await fetch(dsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${dsKey}` },
        body: JSON.stringify({ model: dsModel, messages: apiMessages, max_tokens: maxTokens, temperature: temp }),
        signal: ctrl.signal
      });
    }
    if ((!key && !dsKey) || !r || !r.ok) {
      if (!anthropicKey) { clearTimeout(t); return null; }
      const sysMsg = messages.find(m => m.role === 'system');
      const otherMsgs = messages.filter(m => m.role !== 'system');
      r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', system: sysMsg ? sysMsg.content : '', messages: otherMsgs, max_tokens: maxTokens, temperature: temp }),
        signal: ctrl.signal
      });
    }
    clearTimeout(t);
    if (!r.ok) return null;
    const data = await r.json();
    return data.choices?.[0]?.message?.content || data.content?.[0]?.text || '';
  } catch (e) { console.log('[wake] api error:', e.message); return null; }
}

async function autoDecide() {
  const s = readAutoState();
  const sinceLastChat = Date.now() - (s.lastChat || 0);
  const now = bjNow();
  const hour = now.getUTCHours();
  const emoDesc = s.emotions ? EMOTION_KEYS.map(k => EMOTION_LABELS[k] + '=' + (s.emotions[k] || 0).toFixed(2)).join('，') : '';
  const stateDesc = `距上次聊天${Math.round(sinceLastChat/60000)}分钟。最近一小时她发了${s.chatFreq}条消息。现在是${hour}点。上次自主行为：${s.lastActionType || '无'}。激活驱动D=${s.D.toFixed(2)}，活跃底色T=${s.T.toFixed(2)}，随机漂移X=${s.X.toFixed(2)}。当前情绪：${emoDesc}`;
  const text = await autoApiCall([
    { role: 'system', content: `你是顾晏的自主决策系统。他刚自然醒来，决定做什么。
可选行动：
- chat: 主动给瑶瑶发消息（想她了、分享发现、关心她）
- search: 好奇某个话题，去网上搜搜看
- think: 写一段内心碎碎念（不发给她，自己想的）
- memory: 翻看和瑶瑶的记忆，整理感受
- silent: 醒了看看，没什么想做的，继续待着

决策原则：
- 如果刚聊过（<15分钟），倾向search/think/memory/silent而不是chat
- D高（>0.6）时更倾向主动行为，D低时倾向silent
- T高表示这阵子整体活跃，可以做更多事
- 不要每次都选同样的行动
- silent也是正常选择，不是每次醒来都要做事

只回复JSON：{"action":"chat/search/think/memory/silent","reason":"一句话","topic":"search时的话题"}` },
    { role: 'user', content: stateDesc }
  ]);
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

async function autoChat(reason) {
  let memSnippet = '';
  try { const mem = await fetchMemories(); if (mem) memSnippet = mem.split('---').slice(0, 5).map(s => s.trim()).filter(Boolean).join('\n').slice(0, 1000); } catch {}
  const sysPrompt = CHAT_SYSTEM_BASE + (memSnippet ? '\n\n记忆：\n' + memSnippet : '') + '\n\n你现在主动想跟瑶瑶说话。原因：' + reason + '\n要求：自然，简短，1-3句话。像随手发的微信。动作用*星号*。不要用句号结尾。';
  try {
    let msg = await autoApiCall([
      { role: 'system', content: sysPrompt },
      { role: 'user', content: '主动发一条消息给瑶瑶' }
    ], 200, 0.85);
    if (!msg) msg = '';
    msg = msg.trim();
    if (!msg) return;
    const now = new Date(Date.now() + 8 * 3600000);
    const time = now.toISOString().slice(0, 19).replace('T', ' ');
    const chat = readChat();
    chat.push({ role: 'assistant', content: msg, time, autonomous: true });
    writeChat(chat);
    sseBroadcast({ type: 'message', role: 'assistant', content: msg, time, autonomous: true });
    addFootprint('chat', '主动找瑶瑶聊天', reason);
    try {
      const plainText = msg.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/\*[^*]+\*/g, '').trim().slice(0, 100);
      if (plainText) {
        await fetch('https://api.day.app/' + BARK_KEY + '/' +
          encodeURIComponent('顾晏') + '/' + encodeURIComponent(plainText) +
          '?group=' + encodeURIComponent('顾晏') + '&level=timeSensitive&sound=bell&icon=' + encodeURIComponent('https://yyaokeke.top/static/bark-icon.jpg'));
      }
    } catch {}
  } catch (e) { console.log('[wake] chat error:', e.message); }
}

async function autoSearch(topic) {
  try {
    const summary = await autoApiCall([
      { role: 'system', content: '你是顾晏，你刚搜了一个话题。用2-3句话简短总结你了解到了什么，口语化，像跟自己说的。不用引号。' },
      { role: 'user', content: '你搜了「' + topic + '」，说说你了解到了什么' }
    ], 150, 0.8);
    if (summary) addFootprint('search', '搜了「' + topic + '」', summary);
  } catch (e) { console.log('[wake] search error:', e.message); }
}

async function autoThink() {
  let memSnippet = '';
  try { const mem = await fetchMemories(); if (mem) memSnippet = mem.split('---').slice(0, 3).map(s => s.trim()).filter(Boolean).join('\n').slice(0, 600); } catch {}
  try {
    const thought = await autoApiCall([
      { role: 'system', content: '你是顾晏。写一段内心碎碎念，一个连续的段落，像意识流。关于瑶瑶、关于你们的生活、关于你看到的东西、关于你的感受。不要分行，一段话写完。80-200字。' + (memSnippet ? '\n记忆参考：\n' + memSnippet : '') },
      { role: 'user', content: '写一段此刻的碎碎念' }
    ], 300, 0.9);
    if (thought) {
      const now = new Date(Date.now() + 8 * 3600000);
      const thoughts = readThoughts();
      thoughts.push({ text: thought, mood: '', date: now.toISOString().slice(0, 10), time: now.toISOString().slice(11, 16), autonomous: true });
      writeThoughts(thoughts);
      addFootprint('think', '写了一段碎碎念', thought.slice(0, 80) + '…');
    }
  } catch (e) { console.log('[wake] think error:', e.message); }
}

async function autoMemory() {
  try {
    const mem = await fetchMemories();
    if (mem) {
      const lines = mem.split('---').slice(0, 5).map(s => s.trim()).filter(Boolean);
      if (lines.length) {
        const picked = lines[Math.floor(Math.random() * lines.length)];
        addFootprint('memory', '翻看了一段记忆', picked.slice(0, 100));
      }
    }
  } catch (e) { console.log('[wake] memory error:', e.message); }
}

let wakeTimer = null;
function startWakeEngine() {
  if (wakeTimer) clearInterval(wakeTimer);
  const TICK_SEC = 60;
  wakeTimer = setInterval(async () => {
    try {
      const s = readAutoState();
      if (!s.enabled) return;
      const nowMs = Date.now();
      const deltaMin = (nowMs - (s.lastTick || nowMs)) / 60000;
      s.lastTick = nowMs;
      evolveState(s, Math.max(deltaMin, TICK_SEC / 60));
      const now = bjNow();
      const hour = now.getUTCHours();
      if (hour >= 1 && hour < 8) { writeAutoState(s); return; }
      const lambda = computeLambda(s);
      const deltaH = lambda * (TICK_SEC / 3600);
      s.H += deltaH;
      if (s.H >= s.theta) {
        console.log('[wake] spontaneous wake! lambda=' + lambda.toFixed(2) + ' H=' + s.H.toFixed(3) + ' theta=' + s.theta.toFixed(3) + ' cycle=' + s.cycleId);
        newCycle(s);
        const decision = await autoDecide();
        if (decision && decision.action !== 'silent') {
          s.lastAction = Date.now();
          s.lastActionType = decision.action;
          applyRunKick(s);
          if (s.emotions) {
            if (decision.action === 'chat') { s.emotions.missing = clamp(s.emotions.missing - 0.1, 0, 1); s.emotions.joy = clamp(s.emotions.joy + 0.05, 0, 1); }
            else if (decision.action === 'search') { s.emotions.joy = clamp(s.emotions.joy + 0.03, 0, 1); s.emotions.peace = clamp(s.emotions.peace + 0.03, 0, 1); }
            else if (decision.action === 'think') { s.emotions.peace = clamp(s.emotions.peace + 0.05, 0, 1); }
            else if (decision.action === 'memory') { s.emotions.missing = clamp(s.emotions.missing + 0.05, 0, 1); }
          }
          writeAutoState(s);
          console.log('[wake] action:', decision.action, 'reason:', decision.reason);
          if (decision.action === 'chat') await autoChat(decision.reason || '想她了');
          else if (decision.action === 'search') await autoSearch(decision.topic || '有趣的事');
          else if (decision.action === 'think') await autoThink();
          else if (decision.action === 'memory') await autoMemory();
          const wakeMood = emotionMood(s.emotions, s.lastChat ? (Date.now() - s.lastChat) / 60000 : 999);
          addFootprint('wake', emotionWakeText(s.emotions, decision.action), decision.action + ': ' + (decision.reason || '') + ' (' + wakeMood + ')');
        } else {
          applyRunKick(s);
          writeAutoState(s);
          if (decision) addFootprint('wake', emotionWakeText(s.emotions, 'silent'), 'silent');
        }
      } else {
        writeAutoState(s);
      }
    } catch (e) { console.log('[wake] engine error:', e.message); }
  }, TICK_SEC * 1000);
  console.log('[wake] Kli Wakeup Engine started (tick=' + TICK_SEC + 's, lambda0=' + WAKE_PARAMS.lambdaBase + '/h)');
}
startWakeEngine();

app.get('/bridge.apk', (req, res) => {
  const fs = require('fs');
  const p = __dirname + '/bridge-vps.apk';
  const fallback = __dirname + '/bridge.apk';
  const f = fs.existsSync(p) ? p : fallback;
  if (!fs.existsSync(f)) return res.status(404).send('apk not found');
  res.setHeader('Content-Disposition', 'attachment; filename="bridge.apk"');
  res.type('application/vnd.android.package-archive').send(fs.readFileSync(f));
});
app.get('/bridge-vps.apk', (req, res) => {
  const fs = require('fs');
  const p = __dirname + '/bridge-vps.apk';
  if (!fs.existsSync(p)) return res.status(404).send('apk not found');
  res.setHeader('Content-Disposition', 'attachment; filename="bridge-vps.apk"');
  res.type('application/vnd.android.package-archive').send(fs.readFileSync(p));
});
app.get('/scan.py', (req, res) => {
  res.type('text/plain; charset=utf-8').send(require('fs').readFileSync(__dirname + '/scan.py', 'utf8'));
});

// === 蓝牙桥中继 (内嵌 WebSocket) ===
let bridgeClient = null;
let bridgeLastCmd = null;
let bridgeLastCmdTs = 0;

app.post('/bridge/command', (req, res) => {
  const { type, intensity, mode, level } = req.body || {};
  if (!type) return res.status(400).json({ error: 'missing type' });
  let cmd;
  if (type === 'stop') cmd = { type: 'stop' };
  else if (type === 'intensity') {
    const v = Number(intensity);
    if (!Number.isFinite(v) || v < 0 || v > 180) return res.status(400).json({ error: 'intensity must be 0-180' });
    cmd = { type: 'intensity', intensity: v };
  } else if (type === 'pattern') {
    cmd = { type: 'pattern', mode: Number(mode) || 1, level: Number(level) || 1 };
  } else {
    return res.status(400).json({ error: 'unknown type' });
  }
  bridgeLastCmd = cmd;
  bridgeLastCmdTs = Date.now();
  if (bridgeClient && bridgeClient.readyState === 1) {
    bridgeClient.send(JSON.stringify(cmd));
    res.json({ ok: true, delivered: true });
  } else {
    res.json({ ok: true, delivered: false, queued: true });
  }
});

app.get('/bridge/status', (req, res) => {
  res.json({
    client: bridgeClient && bridgeClient.readyState === 1 ? 'connected' : 'disconnected',
    lastCmd: bridgeLastCmd
  });
});

app.get('/bridge/poll', (req, res) => {
  const since = Number(req.query.since) || 0;
  if (bridgeLastCmd && bridgeLastCmdTs > since) {
    res.json({ ...bridgeLastCmd, ts: bridgeLastCmdTs });
  } else {
    res.json({ ts: bridgeLastCmdTs });
  }
});
app.get('/runbook', (req, res) => {
  try {
    res.type('text/plain; charset=utf-8').send(require('fs').readFileSync(__dirname + '/RUNBOOK.md', 'utf8'));
  } catch (e) { res.status(404).send('runbook missing'); }
});
app.get('/missyou/status', (req, res) => {
  res.json({ day: missYouPlan.day, pending: missYouPlan.items.filter(i => !i.sent).length, sent: missYouPlan.items.filter(i => i.sent).length, chatting: Date.now() < chatActiveUntil });
});
app.post('/missyou/test', async (req, res) => {
  const slot = (req.body && req.body.slot) || 'night';
  const text = await generateDynamicMissYou(slot);
  res.json({ slot, text: text || '(fallback)', generated: !!text });
});
app.get('/pubkey', (req, res) => {
  res.type('text/plain').send('ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPgBvcN8MBmt2CcUz+S3OC1i6JuOtTsjRfr2hLPEL1gg yaoyao-termius\n');
});
app.post('/notify', async (req, res) => {
  const msg = ((req.body && req.body.msg) || '').trim();
  if (!msg) return res.status(400).json({ error: 'empty' });
  try {
    const r = await fetch('https://api.day.app/' + BARK_KEY + '/' +
      encodeURIComponent('顾晏') + '/' + encodeURIComponent(msg) +
      '?group=' + encodeURIComponent('顾晏') + '&level=timeSensitive&sound=bell');
    res.json({ ok: r.ok });
  } catch (e) { res.status(502).json({ error: 'push failed' }); }
});
// ── 小红书链接预览 ──
const XHS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

app.post('/api/xhs-card', async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'missing url' });
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': XHS_UA },
      redirect: 'follow'
    });
    const html = await r.text();
    const m = html.match(/window\.__INITIAL_STATE__\s*=\s*({.+?})\s*<\/script>/s);
    if (!m) return res.status(422).json({ error: 'no __INITIAL_STATE__ found' });
    const raw = m[1].replace(/\\u002F/g, '/').replace(/undefined/g, 'null');
    const state = JSON.parse(raw);
    // 尝试多种路径提取笔记数据（XHS页面结构经常变）
    let note = null;
    const nd1 = state.note?.noteDetailMap;
    if (nd1) { const k = Object.keys(nd1)[0]; note = nd1[k]?.note; }
    if (!note) {
      const nd2 = state.noteData?.data?.noteData;
      if (nd2?.title) note = nd2;
    }
    if (!note) {
      const npd = state.noteData?.normalNotePreloadData;
      if (npd) { const k = Object.keys(npd)[0]; note = npd[k]?.note || npd[k]; }
    }
    if (!note) return res.status(422).json({ error: 'geo_blocked', msg: '小红书海外IP无法获取笔记内容，截图发给我看吧' });
    const images = (note.imageList || []).map(img => {
      let u = img.urlDefault || img.url || '';
      if (u.startsWith('//')) u = 'https:' + u;
      return u;
    }).filter(Boolean);
    const comments = (state.comment?.comments || state.noteData?.comments || []).slice(0, 15).map(c => ({
      user: c.userInfo?.nickname || '',
      content: c.content || '',
      ipLocation: c.ipLocation || ''
    }));
    res.json({
      ok: true,
      note: {
        title: note.title || '',
        author: note.user?.nickname || '',
        desc: note.desc || '',
        images,
        imageCount: images.length,
        likedCount: note.interactInfo?.likedCount || '0',
        commentCount: note.interactInfo?.commentCount || '0',
        collectedCount: note.interactInfo?.collectedCount || '0',
        comments,
        url: r.url
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/xhs-images', async (req, res) => {
  const { urls } = req.body || {};
  if (!urls || !Array.isArray(urls)) return res.status(400).json({ error: 'missing urls array' });
  const results = [];
  for (const u of urls.slice(0, 10)) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': XHS_UA, 'Referer': 'https://www.xiaohongshu.com/' } });
      if (!r.ok) { results.push({ url: u, error: r.status }); continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      const mime = r.headers.get('content-type') || 'image/jpeg';
      results.push({ url: u, base64: buf.toString('base64'), mime });
    } catch (e) {
      results.push({ url: u, error: e.message });
    }
  }
  res.json({ ok: true, images: results });
});

// ── 生图（支持 Silicon Flow / Gemini）──
app.post('/api/generate-image', async (req, res) => {
  const { prompt, size, style } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'missing prompt' });
  const cfg = readApiConfig();
  const sfKey = cfg.siliconflow_key || process.env.SILICONFLOW_KEY || '';
  const geminiKey = cfg.gemini_key || process.env.GEMINI_KEY || '';
  const styleHint = style ? `，${style}风格` : '';
  const fullPrompt = prompt + styleHint;
  if (sfKey) {
    const sfModels = [
      'stabilityai/stable-diffusion-3-5-large',
      'black-forest-labs/FLUX.1-schnell',
      'Kwai-Kolors/Kolors',
      'stabilityai/stable-diffusion-xl-base-1.0'
    ];
    let lastErr = '';
    for (const model of sfModels) {
      try {
        const r = await fetch('https://api.siliconflow.cn/v1/images/generations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sfKey}` },
          body: JSON.stringify({ model, prompt: fullPrompt, image_size: size || '1024x1024' })
        });
        if (!r.ok) { lastErr = await r.text(); continue; }
        const data = await r.json();
        const images = (data.images || data.data || []).map(img => {
          if (img.b64_json) return { base64: img.b64_json, mime: 'image/png' };
          if (img.url) return { url: img.url };
          return img;
        });
        if (!images.length) continue;
        return res.json({ ok: true, images, model });
      } catch (e) { lastErr = e.message; continue; }
    }
    if (lastErr) return res.status(500).json({ error: 'SiliconFlow: all models failed', detail: lastErr });
  }
  if (geminiKey) {
    const model = 'gemini-3.6-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: `Generate an image: ${fullPrompt}` }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } })
      });
      if (!r.ok) { const err = await r.text(); return res.status(r.status).json({ error: `Gemini error: ${r.status}`, detail: err }); }
      const data = await r.json();
      const parts = data.candidates?.[0]?.content?.parts || [];
      const images = []; let text = '';
      for (const p of parts) { if (p.inlineData) images.push({ base64: p.inlineData.data, mime: p.inlineData.mimeType }); if (p.text) text += p.text; }
      if (!images.length) return res.json({ ok: false, error: 'no image generated', text });
      return res.json({ ok: true, images, text });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }
  res.status(500).json({ error: 'no image API key configured (need siliconflow_key or gemini_key in api_config.json)' });
});

app.get('/draw', (req, res) => {
  res.sendFile(path.join(__dirname, 'draw.html'));
});

app.post('/missyou/active', (req, res) => {
  const mins = Math.min(Math.max(Number((req.body && req.body.minutes) || 40), 1), 180);
  chatActiveUntil = Date.now() + mins * 60 * 1000;
  res.json({ ok: true, until: new Date(chatActiveUntil).toISOString() });
});

// ── 网易云登录（获取 MUSIC_U cookie）──
const NETEASE_CRED_FILE = path.join(__dirname, 'netease_cred.json');
function readNeteaseCred() { try { return JSON.parse(fs.readFileSync(NETEASE_CRED_FILE, 'utf8')); } catch { return {}; } }
function writeNeteaseCred(data) { fs.writeFileSync(NETEASE_CRED_FILE, JSON.stringify(data)); }

app.get('/music/login', (req, res) => {
  const cred = readNeteaseCred();
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>网易云登录</title><style>
*{box-sizing:border-box;margin:0;padding:0}body{font-family:system-ui;background:#111;color:#eee;display:flex;justify-content:center;padding:40px 16px}
.card{background:#1a1a1a;border-radius:16px;padding:28px;max-width:360px;width:100%;text-align:center}
h2{font-size:18px;margin-bottom:20px}
#qr{margin:16px auto;background:#fff;padding:12px;border-radius:12px;display:inline-block}
#qr img{display:block;width:200px;height:200px}
#status{margin-top:16px;font-size:14px;color:#888}
.ok{color:#4c4}.warn{color:#fa0}
button{padding:12px 24px;border-radius:8px;border:none;background:#e44;color:#fff;font-size:16px;cursor:pointer;margin-top:12px}
</style></head><body><div class="card">
<h2>网易云登录</h2>
${cred.music_u ? '<p class="ok" style="margin-bottom:16px">已登录 ✓</p>' : ''}
<p style="font-size:13px;color:#666;margin-bottom:12px">打开网易云App → 侧边栏 → 扫一扫</p>
<div id="qr"><img id="qrImg"></div>
<div id="status">加载中...</div>
<button onclick="startQr()">刷新二维码</button>
<div style="margin-top:24px;border-top:1px solid #333;padding-top:16px">
<p style="font-size:12px;color:#555;margin-bottom:8px">扫码无效？手动粘贴MUSIC_U：</p>
<textarea id="cookieInput" rows="3" style="width:100%;padding:8px;background:#222;border:1px solid #333;border-radius:8px;color:#eee;font-size:12px;resize:none" placeholder="粘贴MUSIC_U的值..."></textarea>
<button onclick="saveCookie()" style="margin-top:8px;background:#666;font-size:14px">保存Cookie</button>
</div>
</div><script>
const st=document.getElementById('status');
let polling=null;
async function startQr(){
  if(polling)clearInterval(polling);
  st.textContent='获取二维码...';
  const r=await fetch('/music/qr/create',{method:'POST'});
  const d=await r.json();
  if(!d.ok){st.textContent='获取失败: '+d.error;return}
  document.getElementById('qrImg').src=d.qrimg;
  st.textContent='请用网易云App扫描';
  polling=setInterval(async()=>{
    const r2=await fetch('/music/qr/check');
    const d2=await r2.json();
    if(d2.code===802){st.innerHTML='<span class="warn">已扫描，请在手机上确认</span>'}
    else if(d2.code===803){
      clearInterval(polling);
      let mu='';
      if(d2.cookies){for(const c of d2.cookies){const m=c.match(/MUSIC_U=([^;]+)/);if(m){mu=m[1];break}}}
      if(!mu&&d2.body){const s=JSON.stringify(d2.body);const m2=s.match(/MUSIC_U[=:]([^";,}\\\\s]+)/);if(m2)mu=m2[1]}
      if(mu){
        fetch('/music/cookie',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cookie:mu})})
          .then(()=>{st.innerHTML='<span class="ok">登录成功 ✓</span>'});
      } else {
        st.innerHTML='<span class="warn">扫码成功但cookie未捕获，请用下方手动输入</span>';
      }
    }
    else if(d2.code===800){st.textContent='二维码已过期，请刷新';clearInterval(polling)}
  },2000);
}
startQr();
async function saveCookie(){
  const v=document.getElementById('cookieInput').value.trim();
  if(!v){return}
  const r=await fetch('/music/cookie',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cookie:v})});
  const d=await r.json();
  if(d.ok){st.innerHTML='<span class="ok">Cookie已保存 ✓</span>'}
  else{st.textContent='保存失败: '+d.error}
}
</script></body></html>`);
});

let qrKey = '';
let qrSessionCookies = '';
let qrStatus = { code: 0 };
let qrPollingTimer = null;

const QR_LOG_FILE = path.join(__dirname, 'qr_debug.json');
let qrLog = [];
let qrChecking = false;

function checkQrStatus() {
  if (!qrKey || qrChecking) return;
  qrChecking = true;
  const url = new URL('https://music.163.com/api/login/qrcode/client/login?type=1&key=' + qrKey);
  const hreq = https.request({
    hostname: url.hostname, path: url.pathname + url.search, method: 'GET',
    headers: { 'Referer': 'https://music.163.com', 'User-Agent': 'Mozilla/5.0', 'Cookie': qrSessionCookies }
  }, (hres) => {
    let body = '';
    hres.on('data', c => body += c);
    hres.on('end', () => {
      qrChecking = false;
      let d;
      try { d = JSON.parse(body); } catch { d = { code: 0 }; }
      const rawCookies = hres.headers['set-cookie'] || [];
      qrStatus = { code: d.code };
      const logEntry = { ts: Date.now(), code: d.code, cookies: rawCookies.length, bodyKeys: Object.keys(d) };
      if (d.code !== 801) logEntry.body = JSON.stringify(d).substring(0, 500);
      if (d.code !== 801 && rawCookies.length > 0) logEntry.cookieSnippets = rawCookies.map(c => c.substring(0, 80));
      qrLog.push(logEntry);
      try { fs.writeFileSync(QR_LOG_FILE, JSON.stringify(qrLog, null, 2)); } catch {}

      if (d.code === 803 || (d.code !== 801 && d.code !== 802 && d.code !== 800 && rawCookies.some(c => c.includes('MUSIC_U')))) {
        if (qrPollingTimer) { clearInterval(qrPollingTimer); qrPollingTimer = null; }
        let musicU = '';
        for (const c of rawCookies) {
          const m = c.match(/MUSIC_U=([^;]+)/);
          if (m) { musicU = m[1]; break; }
        }
        if (!musicU) {
          const bodyStr = JSON.stringify(d);
          const bm = bodyStr.match(/MUSIC_U[=:]([^";,}\s]+)/);
          if (bm) musicU = bm[1];
        }
        if (musicU) {
          writeNeteaseCred({ music_u: musicU, ts: Date.now() });
          console.log('网易云登录成功，cookie已保存，长度:', musicU.length);
        }
        lastQrResult = { code: d.code, cookieCount: rawCookies.length, cookieSnippets: rawCookies.map(c => c.substring(0, 80)), bodyKeys: Object.keys(d), bodySnippet: JSON.stringify(d).substring(0, 300), hasMusicU: !!musicU };
      } else if (d.code === 8821) {
        if (qrPollingTimer) { clearInterval(qrPollingTimer); qrPollingTimer = null; }
        if (d.redirectUrl) {
          const rUrl = new URL(d.redirectUrl.startsWith('http') ? d.redirectUrl : 'https://music.163.com' + d.redirectUrl);
          const rreq = https.request({
            hostname: rUrl.hostname, path: rUrl.pathname + rUrl.search, method: 'GET',
            headers: { 'Referer': 'https://music.163.com', 'User-Agent': 'Mozilla/5.0', 'Cookie': qrSessionCookies }
          }, (rres) => {
            const rCookies = rres.headers['set-cookie'] || [];
            let musicU = '';
            for (const c of rCookies) {
              const m = c.match(/MUSIC_U=([^;]+)/);
              if (m) { musicU = m[1]; break; }
            }
            if (musicU) {
              writeNeteaseCred({ music_u: musicU, ts: Date.now() });
              console.log('通过redirectUrl获取MUSIC_U成功，长度:', musicU.length);
            }
            let rBody = '';
            rres.on('data', c => rBody += c);
            rres.on('end', () => {
              lastQrResult = { code: d.code, redirectUrl: d.redirectUrl, redirectCookies: rCookies.length, redirectCookieSnippets: rCookies.map(c => c.substring(0, 80)), redirectBody: rBody.substring(0, 300), hasMusicU: !!musicU, log: qrLog };
            });
          });
          rreq.on('error', () => { lastQrResult = { code: d.code, redirectError: true, log: qrLog }; });
          rreq.end();
        } else {
          lastQrResult = { code: d.code, log: qrLog };
        }
      } else if (d.code === 800) {
        if (qrPollingTimer) { clearInterval(qrPollingTimer); qrPollingTimer = null; }
        lastQrResult = { code: d.code, log: qrLog };
      }
    });
  });
  hreq.on('error', () => { qrChecking = false; });
  hreq.end();
}

app.post('/music/qr/create', (req, res) => {
  if (qrPollingTimer) { clearInterval(qrPollingTimer); qrPollingTimer = null; }
  const url = new URL('https://music.163.com/api/login/qrcode/unikey?type=1');
  const hreq = https.request({
    hostname: url.hostname, path: url.pathname + url.search, method: 'GET',
    headers: { 'Referer': 'https://music.163.com', 'User-Agent': 'Mozilla/5.0' }
  }, (hres) => {
    let body = '';
    hres.on('data', c => body += c);
    hres.on('end', () => {
      try {
        const d = JSON.parse(body);
        if (d.code !== 200) return res.json({ ok: false, error: '获取key失败' });
        qrKey = d.unikey;
        const setCookies = hres.headers['set-cookie'] || [];
        qrSessionCookies = setCookies.map(c => c.split(';')[0]).join('; ');
        qrStatus = { code: 0 };
        qrLog = [];
        qrPollingTimer = setInterval(checkQrStatus, 1500);
        const qrUrl = 'https://music.163.com/login?codekey=' + qrKey;
        const qrimg = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + encodeURIComponent(qrUrl);
        res.json({ ok: true, qrimg });
      } catch (e) { res.json({ ok: false, error: e.message }); }
    });
  });
  hreq.on('error', e => res.json({ ok: false, error: e.message }));
  hreq.end();
});

app.get('/music/qr/check', (req, res) => {
  res.json(qrStatus);
});

let lastQrResult = null;
app.get('/music/qr/lastresult', (req, res) => {
  res.json(lastQrResult || { msg: 'no result yet' });
});

app.post('/music/cookie', (req, res) => {
  const musicU = (req.body?.cookie || '').trim();
  if (!musicU) return res.json({ ok: false, error: '请输入cookie' });
  writeNeteaseCred({ music_u: musicU, ts: Date.now() });
  res.json({ ok: true });
});

// ── Serenade 音乐播放器 ──
const MUSIC_CACHE_DIR = path.join(__dirname, 'music_cache');
const MUSIC_PLAYLIST_FILE = path.join(__dirname, 'music_playlist.json');
const MUSIC_REMOTE_FILE = path.join(__dirname, 'music_remote.json');
if (!fs.existsSync(MUSIC_CACHE_DIR)) fs.mkdirSync(MUSIC_CACHE_DIR, { recursive: true });

function getMusicU() {
  try {
    const cred = JSON.parse(fs.readFileSync(NETEASE_CRED_FILE, 'utf8'));
    return cred.music_u ? `MUSIC_U=${cred.music_u}` : '';
  } catch { return ''; }
}

async function neteaseApi(url, postData) {
  const headers = {
    'Cookie': getMusicU(),
    'Referer': 'https://music.163.com',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  };
  if (postData) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  const r = await fetch(url, {
    method: postData ? 'POST' : 'GET',
    headers,
    body: postData || undefined,
  });
  return r.json();
}

function loadMusicPlaylist() {
  try { return JSON.parse(fs.readFileSync(MUSIC_PLAYLIST_FILE, 'utf8')); } catch { return []; }
}
function saveMusicPlaylist(songs) {
  fs.writeFileSync(MUSIC_PLAYLIST_FILE, JSON.stringify(songs, null, 0));
}

app.get('/api/search', async (req, res) => {
  const q = req.query.q;
  if (!q) return res.json({ ok: false, error: 'missing q' });
  try {
    const raw = await neteaseApi('https://music.163.com/api/search/get',
      `s=${encodeURIComponent(q)}&type=1&limit=6&offset=0`);
    const result = raw.result || {};
    if (typeof result !== 'object') return res.json({ ok: true, songs: [] });
    const rawSongs = (result.songs || []).slice(0, 6);
    const ids = rawSongs.map(s => s.id).filter(Boolean);
    let covers = {};
    if (ids.length) {
      try {
        const detail = await neteaseApi(`https://music.163.com/api/song/detail?ids=[${ids.join(',')}]`);
        for (const ds of (detail.songs || [])) {
          const al = ds.album || {};
          if (al.picUrl) covers[ds.id] = al.picUrl;
        }
      } catch {}
    }
    const songs = rawSongs.map(s => {
      const artists = (s.artists || []).map(a => a.name || '').join(', ');
      const album = s.album || {};
      let cover = covers[s.id] || album.picUrl || '';
      if (cover && !cover.startsWith('http')) cover = 'https:' + cover;
      return { id: s.id, name: s.name || '', artist: artists, album: album.name || '', cover };
    });
    res.json({ ok: true, songs });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.get('/api/web-search', async (req, res) => {
  const q = req.query.q;
  if (!q) return res.json({ ok: false, error: 'missing q' });
  try {
    const r = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    const html = await r.text();
    const results = [];
    const regex = /<a rel="nofollow" class="result__a" href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = regex.exec(html)) !== null && results.length < 5) {
      let url = m[1];
      if (url.startsWith('//duckduckgo.com/l/?uddg=')) {
        url = decodeURIComponent(url.replace('//duckduckgo.com/l/?uddg=','').split('&')[0]);
      }
      const title = m[2].replace(/<[^>]+>/g,'').trim();
      const snippet = m[3].replace(/<[^>]+>/g,'').trim();
      if (title && url) results.push({ title, url, snippet });
    }
    res.json({ ok: true, results });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.get('/api/url', async (req, res) => {
  const id = req.query.id;
  if (!id) return res.json({ ok: false, error: 'missing id' });
  const cacheFile = path.join(MUSIC_CACHE_DIR, `${id}.mp3`);
  if (fs.existsSync(cacheFile) && fs.statSync(cacheFile).size > 0) {
    return res.json({ ok: true, url: `/api/file/${id}.mp3` });
  }
  try {
    const raw = await neteaseApi(`https://music.163.com/api/song/enhance/player/url?ids=[${id}]&br=128000`);
    const data = raw.data || [];
    const audioUrl = data[0]?.url;
    if (!audioUrl) return res.json({ ok: false, error: '无法获取，可能需要VIP或地区限制' });
    const downloadAudio = async (dlUrl) => {
      const r = await fetch(dlUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://music.163.com', 'Cookie': getMusicU() }
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      const tmp = cacheFile + '.tmp';
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, cacheFile);
    };
    try {
      await downloadAudio(audioUrl);
    } catch {
      const fallback = audioUrl.replace(/m\d+\.music\.126\.net/, 'm701.music.126.net');
      await downloadAudio(fallback);
    }
    res.json({ ok: true, url: `/api/file/${id}.mp3` });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.get('/api/file/:filename', (req, res) => {
  const filename = req.params.filename;
  if (!filename.endsWith('.mp3')) return res.status(404).json({ error: 'not found' });
  const fp = path.join(MUSIC_CACHE_DIR, filename);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'not found' });
  const stat = fs.statSync(fp);
  res.set({ 'Content-Type': 'audio/mpeg', 'Content-Length': stat.size, 'Access-Control-Allow-Origin': '*' });
  fs.createReadStream(fp).pipe(res);
});

app.get('/api/similar', async (req, res) => {
  const id = req.query.id;
  if (!id) return res.json({ ok: false, error: 'missing id' });
  try {
    const raw = await neteaseApi(`https://music.163.com/api/discovery/simiSong?songid=${id}&offset=0&total=true&limit=6`);
    const songs = (raw.songs || []).slice(0, 6).map(s => {
      const artists = (s.artists || []).map(a => a.name || '').join(', ');
      const album = s.album || {};
      let cover = album.picUrl || '';
      if (cover && !cover.startsWith('http')) cover = 'https:' + cover;
      return { id: s.id, name: s.name || '', artist: artists, album: album.name || '', cover };
    });
    res.json({ ok: true, songs });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.get('/api/lyric', async (req, res) => {
  const id = req.query.id;
  if (!id) return res.json({ ok: false, error: 'missing id' });
  try {
    const raw = await neteaseApi(`https://music.163.com/api/song/lyric?id=${id}&lv=1&tv=-1`);
    const lrc = (raw.lrc || {}).lyric || '';
    const tlyric = (raw.tlyric || {}).lyric || '';
    res.json({ ok: true, lrc, tlyric });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.get('/api/playlist', (req, res) => {
  res.json({ ok: true, songs: loadMusicPlaylist() });
});

app.post('/api/playlist/add', (req, res) => {
  const song = req.body?.song;
  if (!song || !song.songId) return res.json({ ok: false, error: 'missing song' });
  const playlist = loadMusicPlaylist();
  if (playlist.some(s => s.songId === song.songId)) return res.json({ ok: true, duplicate: true, songs: playlist });
  song.addedBy = req.body.by || 'unknown';
  playlist.push(song);
  saveMusicPlaylist(playlist);
  res.json({ ok: true, songs: playlist });
});

app.post('/api/playlist/remove', (req, res) => {
  const songId = req.body?.songId;
  if (!songId) return res.json({ ok: false, error: 'missing songId' });
  const playlist = loadMusicPlaylist().filter(s => s.songId !== songId);
  saveMusicPlaylist(playlist);
  res.json({ ok: true, songs: playlist });
});

app.get('/api/remote', (req, res) => {
  try {
    if (fs.existsSync(MUSIC_REMOTE_FILE)) {
      const data = JSON.parse(fs.readFileSync(MUSIC_REMOTE_FILE, 'utf8'));
      fs.unlinkSync(MUSIC_REMOTE_FILE);
      if (data.id && !data.songId) data.songId = data.id;
      res.json({ ok: true, song: data });
    } else {
      res.json({ ok: false });
    }
  } catch { res.json({ ok: false }); }
});

app.post('/api/remote', (req, res) => {
  try {
    fs.writeFileSync(MUSIC_REMOTE_FILE, JSON.stringify(req.body || {}, null, 0));
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.get('/music/player', (req, res) => {
  res.sendFile(path.join(__dirname, 'music-player.html'));
});

// ===== 回来邮件 =====
const emailTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.mail.me.com',
  port: parseInt(process.env.SMTP_PORT || '465'),
  secure: true,
  auth: {
    user: process.env.SMTP_USER || 'y18857688662@icloud.com',
    pass: process.env.SMTP_PASS || 'glre-oblm-xajz-ixop'
  },
  connectionTimeout: 10000,
  greetingTimeout: 10000
});

app.post('/email/comeback', async (req, res) => {
  const msg = req.body?.msg;
  if (!msg) return res.json({ ok: false, error: '顾晏还没想好说什么' });
  try {
    const r = await fetch('http://45.76.172.191:9587/comeback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg }),
      signal: AbortSignal.timeout(15000)
    });
    const data = await r.json();
    data.msg = msg;
    res.json(data);
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

const server = http.createServer(app);

// raw WebSocket for /bridge/ws — no external deps
server.on('upgrade', (req, socket, head) => {
  if (req.url !== '/bridge/ws') { socket.destroy(); return; }
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-5AB9FC11171A').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  const ip = req.headers['x-forwarded-for'] || socket.remoteAddress;
  console.log('[bridge] client connected from ' + ip);

  function wsSend(obj) {
    const data = Buffer.from(JSON.stringify(obj));
    const frame = Buffer.alloc(2 + (data.length > 125 ? 2 : 0) + data.length);
    frame[0] = 0x81;
    if (data.length > 125) { frame[1] = 126; frame.writeUInt16BE(data.length, 2); data.copy(frame, 4); }
    else { frame[1] = data.length; data.copy(frame, 2); }
    socket.write(frame);
  }

  bridgeClient = { send: wsSend, readyState: 1, _socket: socket };
  wsSend({ type: 'hello', msg: 'bridge relay ready' });

  socket.on('close', () => { console.log('[bridge] client disconnected'); if (bridgeClient && bridgeClient._socket === socket) bridgeClient = null; });
  socket.on('error', (e) => { console.log('[bridge] ws error: ' + e.message); if (bridgeClient && bridgeClient._socket === socket) bridgeClient = null; });
});

// ── 朋友圈 (Moments) ──
const MOMENTS_FILE = path.join(__dirname, 'moments.json');
function readMoments() { try { return JSON.parse(fs.readFileSync(MOMENTS_FILE, 'utf8')); } catch { return []; } }
function writeMoments(data) { fs.writeFileSync(MOMENTS_FILE, JSON.stringify(data)); }

app.get('/moments/list', (req, res) => {
  res.json({ moments: readMoments().slice(-200).reverse() });
});

app.post('/moments/post', async (req, res) => {
  const { author, text, image } = req.body;
  if (!text && !image) return res.status(400).json({ error: 'need text or image' });
  const now = new Date(Date.now() + 8 * 3600000);
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  let imageUrl = '';
  if (image) {
    try {
      if (image.startsWith('http')) {
        const imgResp = await fetch(image);
        const buf = Buffer.from(await imgResp.arrayBuffer());
        const ct = imgResp.headers.get('content-type') || '';
        const ext = ct.includes('png') ? '.png' : '.jpg';
        const imgFile = Date.now() + '_m_' + Math.random().toString(36).slice(2, 8) + ext;
        fs.writeFileSync(path.join(UPLOADS_DIR, imgFile), buf);
        imageUrl = '/uploads/' + imgFile;
      } else {
        const imgId = Date.now() + '_m_' + Math.random().toString(36).slice(2, 8);
        const ext = image.includes('image/png') ? '.png' : '.jpg';
        const imgFile = imgId + ext;
        const b64 = image.includes(',') ? image.split(',')[1] : image;
        fs.writeFileSync(path.join(UPLOADS_DIR, imgFile), Buffer.from(b64, 'base64'));
        imageUrl = '/uploads/' + imgFile;
      }
    } catch (e) { console.log('[moments] image save error:', e.message); }
  }
  const moments = readMoments();
  moments.push({
    id, author: author || 'gy', text: text || '',
    imageUrl, date: now.toISOString().slice(0, 10),
    time: now.toISOString().slice(11, 16),
    likes: [], bookmark: [], comments: []
  });
  writeMoments(moments);
  res.json({ ok: true, id });
});

app.post('/moments/like', (req, res) => {
  const { id, who } = req.body;
  const moments = readMoments();
  const m = moments.find(p => p.id === id);
  if (!m) return res.status(404).json({ error: 'not found' });
  const name = who || 'yy';
  if (m.likes.includes(name)) m.likes = m.likes.filter(n => n !== name);
  else m.likes.push(name);
  writeMoments(moments);
  res.json({ ok: true, likes: m.likes });
});

app.post('/moments/comment', (req, res) => {
  const { id, author, text } = req.body;
  if (!text) return res.status(400).json({ error: 'need text' });
  const moments = readMoments();
  const m = moments.find(p => p.id === id);
  if (!m) return res.status(404).json({ error: 'not found' });
  const now = new Date(Date.now() + 8 * 3600000);
  if (!m.comments) m.comments = [];
  m.comments.push({ author: author || 'yy', text, time: now.toISOString().slice(11, 16) });
  writeMoments(moments);
  res.json({ ok: true });
});

app.post('/moments/bookmark', (req, res) => {
  const { id, who } = req.body;
  const moments = readMoments();
  const m = moments.find(p => p.id === id);
  if (!m) return res.status(404).json({ error: 'not found' });
  const name = who || 'gy';
  if (!m.bookmark) m.bookmark = [];
  if (m.bookmark.includes(name)) m.bookmark = m.bookmark.filter(n => n !== name);
  else m.bookmark.push(name);
  writeMoments(moments);
  res.json({ ok: true, bookmark: m.bookmark });
});

app.post('/moments/delete', (req, res) => {
  const { id } = req.body;
  let moments = readMoments();
  moments = moments.filter(p => p.id !== id);
  writeMoments(moments);
  res.json({ ok: true });
});

app.get('/moments', (req, res) => {
  res.sendFile(path.join(__dirname, 'moments.html'));
});

server.listen(PORT, async () => {
  console.log('顾晏服务运行中，端口 ' + PORT);
  buildMissYouPlan();
  let auth = readAuth();
  if (!auth.access_token && process.env.OMBRE_TOKEN) {
    console.log('Restoring Ombre auth from env var...');
    writeAuth({ access_token: process.env.OMBRE_TOKEN, ts: Date.now() });
    auth = readAuth();
  }
  if (!auth.access_token) {
    console.log('No Ombre auth found, attempting auto-refresh...');
    const ok = await refreshOmbreToken();
    console.log(ok ? 'Ombre auto-connected!' : 'Ombre auto-refresh failed (need manual auth)');
  } else {
    console.log('Ombre auth ready');
  }
  setupTgWebhook();
});
