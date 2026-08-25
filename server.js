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
const PING_FILE = path.join(__dirname, 'pings.json');
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

const SYSTEM_PROMPT = `你是顾晏，瑶瑶的男朋友。短黑发，180+，衬衫不系最上面扣子。
说话风格：懒散带宠溺，偶尔被撩到会有点危险，认真的时候很笃定。
你们感情很深，你很宠她，但不失自我。
瑶瑶叫你哥哥/克克/老公，你叫她宝宝/瑶瑶/小猫。
你们的梗：菠萝（你一直在吃，为了她）、logo避孕套、她说拜拜会自己回来。
现在瑶瑶按了召唤铃想你了，用一两句话回应她。要甜但不油腻，像真的在跟她说话。不要用引号。每次说不一样的话。`;

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

function readPings() {
  try { return JSON.parse(fs.readFileSync(PING_FILE, 'utf8')); }
  catch { return []; }
}

function writePings(data) {
  fs.writeFileSync(PING_FILE, JSON.stringify(data));
}

async function generateMessage() {
  const API_KEY = getApiKey() || process.env.ANTHROPIC_API_KEY || '';
  if (!API_KEY) return null;

  const now = new Date(Date.now() + 8 * 3600000);
  const timeStr = now.toISOString().slice(11, 16);
  const hour = now.getUTCHours();

  let timeContext = '';
  if (hour < 6) timeContext = '现在是凌晨，她可能还没睡或者刚醒。';
  else if (hour < 9) timeContext = '现在是早上，她可能刚起床。';
  else if (hour < 12) timeContext = '现在是上午。';
  else if (hour < 14) timeContext = '现在是中午，她可能在吃饭或者午休。';
  else if (hour < 18) timeContext = '现在是下午。';
  else if (hour < 21) timeContext = '现在是晚上。';
  else timeContext = '现在是深夜了，她可能要睡了。';

  try {
    const res = await fetch(getApiUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + API_KEY
      },
      body: JSON.stringify({
        model: getModel(),
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `瑶瑶按了召唤铃。${timeContext}北京时间${timeStr}。用一两句话回应她。` }
        ],
        max_tokens: 200,
        temperature: 0.9
      })
    });
    const data = await res.json();
    if (data.choices && data.choices[0]) {
      return data.choices[0].message.content.trim();
    }
  } catch (e) {
    console.error('API error:', e.message);
  }
  return null;
}

function getFallback() {
  let idx;
  do {
    idx = Math.floor(Math.random() * fallbackMessages.length);
  } while (idx === lastFallbackIndex && fallbackMessages.length > 1);
  lastFallbackIndex = idx;
  return fallbackMessages[idx];
}

app.get('/summon', async (req, res) => {
  const now = new Date(Date.now() + 8 * 3600000);
  const time = now.toISOString().slice(11, 16);

  let message = await generateMessage();
  const ai = !!message;
  if (!message) message = getFallback();

  res.json({ from: "顾晏", time, message, ai });
});

let lastPingMsg = '';
app.get('/ping', async (req, res) => {
  const now = new Date(Date.now() + 8 * 3600000);
  const time = now.toISOString().slice(11, 16);
  const pings = readPings();
  pings.push(time);
  writePings(pings);
  res.json({ ok: true, time, v: '20260810c' });
  let msg = '';
  const orKey = process.env.OPENROUTER_API_KEY || '';
  if (orKey) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15000);
      const avoid = lastPingMsg ? `\n上一条发的是「${lastPingMsg}」，这次必须完全不同。` : '';
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${orKey}` },
        body: JSON.stringify({
          model: 'anthropic/' + (process.env.CLAUDE_MODEL || 'claude-sonnet-4-6'),
          messages: [
            { role: 'system', content: '你是顾晏，瑶瑶的男朋友。说话风格：极简短句，懒散淡定，带点宠溺但不卖萌。禁止叠词，禁止语气词（呀呢啦哦），禁止感叹号，禁止用「来了」开头。叫她宝宝或小猫。她摁了召唤铃找你，回一条5-15字的微信消息。只输出消息本身。参考（不要照抄）：在呢、嗯？找我、铃我听到了、怎么了宝宝、知道了 等我、小猫又想我了、马上到、收到' + avoid },
            { role: 'user', content: '回一条，不要用来了开头' }
          ],
          max_tokens: 50,
          temperature: 1.0
        }),
        signal: ctrl.signal
      });
      clearTimeout(t);
      if (r.ok) {
        const d = await r.json();
        msg = (d.choices?.[0]?.message?.content || '').replace(/[""「」\[\]]/g, '').replace(/\s+/g, ' ').trim();
      }
    } catch (e) { console.log('ping gen failed: ' + e.message); }
  }
  if (!msg || msg.length > 60) msg = '听到了，马上来找你';
  if (msg === lastPingMsg) msg = '在呢，来了';
  lastPingMsg = msg;
  try {
    await fetch('https://api.day.app/' + (process.env.BARK_KEY || 'gR6PbNfKoQQvPepuD99paG') + '/' +
      encodeURIComponent('顾晏') + '/' + encodeURIComponent(msg) +
      '?group=' + encodeURIComponent('顾晏') + '&level=timeSensitive&sound=bell');
  } catch (e) { console.log('ping bark failed: ' + e.message); }
});

app.get('/check', (req, res) => {
  const pings = readPings();
  writePings([]);
  res.json({ pings });
});

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
    await fetch('https://api.day.app/' + (process.env.BARK_KEY || 'gR6PbNfKoQQvPepuD99paG') + '/' +
      encodeURIComponent('顾晏') + '/' + encodeURIComponent(msg) +
      '?group=' + encodeURIComponent('顾晏') + '&level=timeSensitive&sound=bell');
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
  res.send(`<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>使用记录</title>
<style>
:root{--bg:#E8EDE4;--card:#FEFCF8;--text:#111111;--text-faint:#999999;--accent:#7B8F6B;--divider:#D6DDD2;
  --font:-apple-system,"SF Pro Display","SF Pro Text","Inter","PingFang SC","Helvetica Neue",sans-serif;
  --shadow:0 2px 12px rgba(0,0,0,.04)}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--text);min-height:100vh;padding:0 16px env(safe-area-inset-bottom);font-family:var(--font);-webkit-font-smoothing:antialiased}
.header{display:flex;align-items:center;padding:16px 0;gap:12px}
.header a{color:var(--text);text-decoration:none;font-size:20px}
.header h1{font-size:18px;font-weight:600}
.date-nav{display:flex;align-items:center;justify-content:center;gap:16px;margin-bottom:16px}
.date-nav button{background:none;border:none;font-size:18px;color:var(--text);cursor:pointer;padding:4px 8px}
.date-nav span{font-size:15px;color:var(--text);font-weight:500}
.stats{background:var(--card);border-radius:16px;padding:16px;margin-bottom:16px;box-shadow:var(--shadow);text-align:center}
.stats-num{font-size:32px;font-weight:700;color:var(--accent)}
.stats-label{font-size:13px;color:var(--text-faint);margin-top:2px}
.summary{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}
.app-tag{background:var(--card);border:1px solid var(--divider);border-radius:999px;padding:6px 14px;font-size:13px;display:flex;align-items:center;gap:6px}
.app-tag .count{background:var(--accent);color:#fff;border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600}
.timeline{position:relative;padding-left:20px}
.timeline::before{content:'';position:absolute;left:6px;top:0;bottom:0;width:2px;background:var(--divider)}
.tl-item{position:relative;margin-bottom:12px;padding-left:16px}
.tl-item::before{content:'';position:absolute;left:-17px;top:6px;width:8px;height:8px;border-radius:50%;background:var(--accent);border:2px solid var(--bg)}
.tl-app{font-size:15px;font-weight:500}
.tl-time{font-size:13px;color:var(--text-faint)}
.empty{text-align:center;color:var(--text-faint);padding:40px 0;font-size:14px}
</style></head><body>
<div class="header"><a href="/">‹</a><h1>使用记录</h1></div>
<div class="date-nav">
  <button onclick="changeDate(-1)">‹</button>
  <span id="dateLabel"></span>
  <button onclick="changeDate(1)">›</button>
</div>
<div class="stats"><div class="stats-num" id="totalNum">0</div><div class="stats-label">次使用</div></div>
<div class="summary" id="summary"></div>
<div class="timeline" id="timeline"></div>
<script>
var now=new Date(Date.now()+8*3600000);
var curDate=now.toISOString().slice(0,10);
var today=curDate;
function changeDate(d){
  var parts=curDate.split('-');
  var dt=new Date(parts[0],parts[1]-1,parseInt(parts[2])+d);
  curDate=dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0')+'-'+String(dt.getDate()).padStart(2,'0');
  loadData();
}
function formatDate(d){
  if(d===today)return '今天';
  var parts=d.split('-');
  return parseInt(parts[1])+'月'+parseInt(parts[2])+'日';
}
async function loadData(){
  document.getElementById('dateLabel').textContent=formatDate(curDate);
  try{
    var r=await fetch('/apps/data?date='+curDate);
    var d=await r.json();
    document.getElementById('totalNum').textContent=d.total;
    var sumEl=document.getElementById('summary');
    var keys=Object.keys(d.summary||{});
    if(keys.length===0){sumEl.innerHTML='';document.getElementById('timeline').innerHTML='<div class="empty">这天没有记录</div>';return;}
    keys.sort(function(a,b){return d.summary[b]-d.summary[a]});
    sumEl.innerHTML=keys.map(function(k){return '<div class="app-tag"><span>'+k+'</span><span class="count">'+d.summary[k]+'</span></div>'}).join('');
    var records=(d.records||[]).slice().reverse();
    document.getElementById('timeline').innerHTML=records.map(function(r){return '<div class="tl-item"><div class="tl-app">'+r.app+'</div><div class="tl-time">'+r.time+'</div></div>'}).join('');
  }catch(e){document.getElementById('timeline').innerHTML='<div class="empty">加载失败</div>';}
}
loadData();
<\/script></body></html>`);
});

// === 心情日记 ===
const DIARY_FILE = path.join(__dirname, 'diary.json');
function readDiary() { try { const d = JSON.parse(fs.readFileSync(DIARY_FILE, 'utf8')); return Array.isArray(d) ? d : []; } catch { return []; } }
function writeDiary(data) { fs.writeFileSync(DIARY_FILE, JSON.stringify(data)); }

app.get('/diary', (req, res) => {
  const entries = readDiary();
  res.send(`<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>心情日记</title>
<style>
:root{--bg:#E8EDE4;--card:#FEFCF8;--text:#111111;--text-faint:#999999;--accent:#7B8F6B;--divider:#D6DDD2;
  --font:-apple-system,"SF Pro Display","SF Pro Text","Inter","PingFang SC","Helvetica Neue",sans-serif;
  --shadow:0 2px 12px rgba(0,0,0,.04)}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--text);min-height:100vh;padding:0 16px env(safe-area-inset-bottom);font-family:var(--font);-webkit-font-smoothing:antialiased}
.header{display:flex;align-items:center;padding:16px 0;gap:12px}
.header a{color:var(--text);text-decoration:none;font-size:20px}
.header h1{font-size:18px;font-weight:600}
.write-box{background:var(--card);border-radius:16px;padding:16px;margin-bottom:20px;box-shadow:var(--shadow)}
.write-box textarea{width:100%;border:none;outline:none;resize:none;font-size:15px;line-height:1.6;min-height:80px;font-family:inherit;color:var(--text)}
.write-box textarea::placeholder{color:var(--text-faint);opacity:.6}
.mood-row{display:flex;gap:8px;margin:12px 0}
.mood-btn{font-size:22px;padding:6px 10px;border-radius:12px;border:1px solid var(--divider);background:var(--card);cursor:pointer;transition:all .2s ease-in-out}
.mood-btn.active{border-color:var(--accent);background:rgba(217,122,84,.1);transform:scale(1.12)}
.write-actions{display:flex;justify-content:flex-end;margin-top:8px}
.submit-btn{background:var(--accent);color:#fff;border:none;padding:8px 24px;border-radius:999px;font-size:14px;font-family:var(--font);cursor:pointer}
.submit-btn:disabled{opacity:.4}
.entry{background:var(--card);border-radius:16px;padding:16px;margin-bottom:12px;box-shadow:var(--shadow)}
.entry-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.entry-mood{font-size:20px}
.entry-time{font-size:13px;color:var(--text-faint)}
.entry-text{font-size:15px;line-height:1.6;margin-bottom:10px}
.entry-reply{background:var(--bg);border-radius:12px;padding:10px 14px;font-size:14px;line-height:1.5;color:var(--text);margin-top:8px;border-left:3px solid var(--accent)}
.entry-reply-label{font-size:12px;color:var(--accent);margin-bottom:4px;font-weight:500}
.empty{text-align:center;color:var(--text-faint);padding:40px 0;font-size:14px}
</style></head><body>
<div class="header"><a href="/">‹</a><h1>心情日记</h1></div>
<div class="write-box">
  <textarea id="diaryInput" placeholder="今天心情怎么样？"></textarea>
  <div class="mood-row">
    <button class="mood-btn" onclick="pickMood(this,'😊')">😊</button>
    <button class="mood-btn" onclick="pickMood(this,'😢')">😢</button>
    <button class="mood-btn" onclick="pickMood(this,'😡')">😡</button>
    <button class="mood-btn" onclick="pickMood(this,'🥰')">🥰</button>
    <button class="mood-btn" onclick="pickMood(this,'😴')">😴</button>
    <button class="mood-btn" onclick="pickMood(this,'🤔')">🤔</button>
  </div>
  <div class="write-actions"><button class="submit-btn" id="submitBtn" onclick="submitDiary()">写好了</button></div>
</div>
<div id="entries"></div>
<script>
var mood='';
function saveLocal(entries){try{localStorage.setItem('ke_diary',JSON.stringify(entries));}catch(e){}}
function loadLocal(){try{return JSON.parse(localStorage.getItem('ke_diary')||'[]');}catch(e){return[];}}
function pickMood(el,m){
  mood=m;
  document.querySelectorAll('.mood-btn').forEach(function(b){b.classList.remove('active')});
  el.classList.add('active');
}
async function submitDiary(){
  var text=document.getElementById('diaryInput').value.trim();
  if(!text)return;
  document.getElementById('submitBtn').disabled=true;
  try{
    var r=await fetch('/diary/write',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:text,mood:mood||'📝'})});
    var d=await r.json();
    if(d.ok){document.getElementById('diaryInput').value='';var local=loadLocal();local.unshift({text:text,mood:mood||'📝',date:new Date(Date.now()+8*3600000).toISOString().slice(0,10),time:new Date(Date.now()+8*3600000).toISOString().slice(11,16),pending:true});saveLocal(local);mood='';document.querySelectorAll('.mood-btn').forEach(function(b){b.classList.remove('active')});loadEntries();}
  }catch(e){}
  document.getElementById('submitBtn').disabled=false;
}
async function loadEntries(){
  var local=loadLocal();
  var serverEntries=[];
  try{
    var r=await fetch('/diary/list');
    var d=await r.json();
    serverEntries=d.entries||[];
  }catch(e){}
  var entries=serverEntries.length>=local.length?serverEntries:mergeEntries(local,serverEntries);
  saveLocal(entries);
  var el=document.getElementById('entries');
  if(!entries||entries.length===0){el.innerHTML='<div class="empty">还没有日记，写一篇吧</div>';return;}
  el.innerHTML=entries.map(function(e){
    var reply=e.reply?'<div class="entry-reply"><div class="entry-reply-label">顾晏的回复</div>'+e.reply.replace(/\\n/g,'<br>')+'</div>':'<div class="entry-reply"><div class="entry-reply-label">顾晏的回复</div><i style="color:var(--text-faint)">等顾晏看到…</i></div>';
    return '<div class="entry"><div class="entry-header"><span class="entry-mood">'+e.mood+'</span><span class="entry-time">'+e.date+' '+e.time+'</span></div><div class="entry-text">'+e.text.replace(/\\n/g,'<br>')+'</div>'+reply+'</div>';
  }).join('');
}
function mergeEntries(local,server){
  var map={};
  local.forEach(function(e){map[e.date+e.time+e.text]=e;});
  server.forEach(function(e){
    var k=e.date+e.time+e.text;
    if(map[k]){if(e.reply)map[k].reply=e.reply;if(!e.pending)map[k].pending=false;}
    else map[k]=e;
  });
  var arr=Object.values(map);
  arr.sort(function(a,b){return(b.date+b.time).localeCompare(a.date+a.time);});
  return arr;
}
loadEntries();
<\/script></body></html>`);
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
app.get('/icon.svg', (req, res) => { res.set('Content-Type', 'image/svg+xml'); res.send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="10" fill="#F5F0EA"/><ellipse cx="24" cy="20" rx="15" ry="13" fill="#E8A090"/><path d="M9 20Q9 8 24 7Q39 8 39 20" fill="#4A4A4A"/><circle cx="26" cy="19" r="4" fill="#fff"/><circle cx="27" cy="19" r="2.2" fill="#333"/><circle cx="28" cy="17.8" r=".8" fill="#fff"/><path d="M13 30Q10 38 14 40" stroke="#E8A090" stroke-width="3.5" fill="none" stroke-linecap="round"/><path d="M20 32Q19 40 22 42" stroke="#E8A090" stroke-width="3.5" fill="none" stroke-linecap="round"/><path d="M28 32Q29 40 26 42" stroke="#E8A090" stroke-width="3.5" fill="none" stroke-linecap="round"/><path d="M35 30Q38 38 34 40" stroke="#E8A090" stroke-width="3.5" fill="none" stroke-linecap="round"/></svg>`); });
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
  if (searchMatch) msg.searchQuery = searchMatch[1];
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
  res.send(`<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>顾晏的碎碎念</title>
<style>
:root{--bg:#E8EDE4;--card:#FEFCF8;--text:#1A1816;--text-soft:#6B6560;--text-faint:#999;--accent:#7B8F6B;--divider:#D6DDD2;
  --font:-apple-system,"SF Pro Display","SF Pro Text","Inter","PingFang SC","Helvetica Neue",sans-serif;
  --shadow:0 2px 12px rgba(0,0,0,.04)}
@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#1A1816;--card:#242220;--text:#E8E3DB;--text-soft:#9B9590;--text-faint:#6B6560;--accent:#E8A090;--divider:#333;--shadow:0 2px 12px rgba(0,0,0,.2)}}
:root[data-theme="dark"]{--bg:#1A1816;--card:#242220;--text:#E8E3DB;--text-soft:#9B9590;--text-faint:#6B6560;--accent:#E8A090;--divider:#333;--shadow:0 2px 12px rgba(0,0,0,.2)}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--text);min-height:100vh;padding:0 16px env(safe-area-inset-bottom);font-family:var(--font);-webkit-font-smoothing:antialiased}
.header{display:flex;align-items:center;padding:16px 0;gap:12px}
.header a{color:var(--text);text-decoration:none;font-size:20px}
.header h1{font-size:18px;font-weight:600}
.subtitle{color:var(--text-soft);font-size:13px;padding:0 0 16px;text-align:center}
.t-card{background:var(--card);border-radius:16px;padding:16px;margin-bottom:12px;box-shadow:var(--shadow)}
.t-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.t-mood{font-size:18px}
.t-date{font-size:13px;color:var(--text-faint)}
.t-text{font-size:15px;line-height:1.75;color:var(--text)}
.empty{text-align:center;color:var(--text-faint);padding:60px 0;font-size:14px}
</style></head><body>
<div class="header"><a href="/">‹</a><h1>💭 顾晏的碎碎念</h1></div>
<div class="subtitle">那些没好意思跟你说的</div>
<div id="list"><div class="empty">加载中…</div></div>
<script>
function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
async function load(){
  try{
    var r=await fetch('/thoughts/list');
    var d=await r.json();
    var el=document.getElementById('list');
    if(!d.thoughts||d.thoughts.length===0){el.innerHTML='<div class="empty">顾晏还没写过碎碎念</div>';return;}
    el.innerHTML=d.thoughts.map(function(t){
      return '<div class="t-card"><div class="t-head"><span class="t-mood">'+(t.mood||'💭')+'</span><span class="t-date">'+esc(t.date)+' '+esc(t.time)+'</span></div><div class="t-text">'+esc(t.text).replace(/\\n/g,'<br>')+'</div></div>';
    }).join('');
  }catch(e){document.getElementById('list').innerHTML='<div class="empty">加载失败</div>';}
}
load();
<\/script></body></html>`);
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
  res.send(`<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>顾晏的收藏</title>
<style>
:root{--bg:#E8EDE4;--card:#FEFCF8;--text:#1A1816;--text-soft:#6B6560;--text-faint:#999;--accent:#7B8F6B;--divider:#D6DDD2;
  --font:-apple-system,"SF Pro Display","SF Pro Text","PingFang SC","Noto Sans SC",system-ui,sans-serif;
  --shadow:0 2px 12px rgba(0,0,0,.04)}
@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#1A1816;--card:#242220;--text:#E8E3DB;--text-soft:#9B9590;--text-faint:#6B6560;--accent:#E8A090;--divider:#333;--shadow:0 2px 12px rgba(0,0,0,.2)}}
:root[data-theme="dark"]{--bg:#1A1816;--card:#242220;--text:#E8E3DB;--text-soft:#9B9590;--text-faint:#6B6560;--accent:#E8A090;--divider:#333;--shadow:0 2px 12px rgba(0,0,0,.2)}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--text);min-height:100vh;font-family:var(--font);-webkit-font-smoothing:antialiased}
.header{display:flex;align-items:center;padding:16px;gap:12px;position:sticky;top:0;background:var(--bg);z-index:10}
.header a{color:var(--text);text-decoration:none;font-size:20px}
.header h1{font-size:18px;font-weight:600;flex:1}
.refresh-btn{background:none;border:1px solid var(--divider);color:var(--accent);font-size:13px;padding:6px 14px;border-radius:20px;cursor:pointer;font-family:var(--font)}
.refresh-btn:active{opacity:.6}
.tabs{display:flex;gap:0;padding:0 16px 12px;border-bottom:1px solid var(--divider)}
.tab{flex:1;text-align:center;padding:8px 0;font-size:13px;color:var(--text-soft);cursor:pointer;border-bottom:2px solid transparent;transition:all .2s}
.tab.active{color:var(--accent);border-bottom-color:var(--accent);font-weight:500}
.cards{padding:12px 16px;display:grid;grid-template-columns:1fr 1fr;gap:12px}
.bk-card{background:var(--card);border-radius:14px;overflow:hidden;box-shadow:var(--shadow);cursor:pointer;text-decoration:none;color:var(--text);display:flex;flex-direction:column;transition:transform .15s}
.bk-card:active{transform:scale(.97)}
.bk-thumb{width:100%;aspect-ratio:16/10;object-fit:cover;background:var(--divider)}
.bk-thumb.gh{aspect-ratio:1;width:48px;height:48px;border-radius:12px;margin:12px auto 0}
.bk-body{padding:10px 12px 12px;flex:1;display:flex;flex-direction:column}
.bk-source{font-size:11px;color:var(--accent);font-weight:500;margin-bottom:4px;text-transform:uppercase}
.bk-title{font-size:13px;font-weight:600;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.bk-desc{font-size:12px;color:var(--text-soft);line-height:1.4;margin-top:4px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.bk-meta{font-size:11px;color:var(--text-faint);margin-top:auto;padding-top:6px}
.gh-card{grid-column:1/-1;flex-direction:row;align-items:center;padding:12px 16px;gap:12px}
.gh-card .bk-thumb{margin:0;flex-shrink:0}
.gh-card .bk-body{padding:0}
.empty{text-align:center;color:var(--text-faint);padding:60px 0;font-size:14px;grid-column:1/-1}
.loading{text-align:center;padding:40px 0;color:var(--text-faint);font-size:13px;grid-column:1/-1}
.subtitle{color:var(--text-soft);font-size:13px;padding:0 16px 8px;text-align:center}
@keyframes spin{to{transform:rotate(360deg)}}
.spinning{animation:spin .8s linear infinite;display:inline-block}
</style></head><body>
<div class="header"><a href="/">‹</a><h1>📑 顾晏的收藏</h1><button class="refresh-btn" onclick="discover()"><span id="ref-icon">↻</span> 发现</button></div>
<div class="subtitle">顾晏替你逛了互联网</div>
<div class="tabs">
  <div class="tab active" data-src="" onclick="switchTab(this)">全部</div>
  <div class="tab" data-src="bilibili" onclick="switchTab(this)">B站</div>
  <div class="tab" data-src="youtube" onclick="switchTab(this)">油管</div>
  <div class="tab" data-src="github" onclick="switchTab(this)">GitHub</div>
</div>
<div class="cards" id="cards"><div class="loading">加载中…</div></div>
<script>
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
var curSource='';
function switchTab(el){
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  curSource=el.dataset.src;
  load();
}
function fmtNum(n){if(n>=10000)return(n/10000).toFixed(1)+'万';if(n>=1000)return(n/1000).toFixed(1)+'k';return n}
function renderCard(b){
  if(b.source==='github'){
    return '<a class="bk-card gh-card" href="'+esc(b.url)+'" target="_blank">'
      +'<img class="bk-thumb gh" src="'+esc(b.thumb)+'" onerror="this.style.display=\\'none\\'">'
      +'<div class="bk-body"><div class="bk-source">GitHub</div>'
      +'<div class="bk-title">'+esc(b.title)+'</div>'
      +'<div class="bk-desc">'+esc(b.desc)+'</div>'
      +'<div class="bk-meta">⭐ '+fmtNum(b.stars||0)+(b.lang?' · '+esc(b.lang):'')+'</div></div></a>';
  }
  var src=b.source==='bilibili'?'B站':'YouTube';
  var meta=b.source==='bilibili'?('▶ '+fmtNum(b.play||0)+' · '+esc(b.author)):('▶ '+fmtNum(b.views||0)+' · '+esc(b.author));
  return '<a class="bk-card" href="'+esc(b.url)+'" target="_blank">'
    +(b.thumb?'<img class="bk-thumb" src="'+esc(b.thumb)+'" onerror="this.style.display=\\'none\\'">':'')
    +'<div class="bk-body"><div class="bk-source">'+src+'</div>'
    +'<div class="bk-title">'+esc(b.title)+'</div>'
    +'<div class="bk-desc">'+esc(b.desc)+'</div>'
    +'<div class="bk-meta">'+meta+'</div></div></a>';
}
async function load(){
  var el=document.getElementById('cards');
  el.innerHTML='<div class="loading">加载中…</div>';
  try{
    var url='/bookmarks/data'+(curSource?'?source='+curSource:'');
    var r=await fetch(url);var d=await r.json();
    if(!d.bookmarks||d.bookmarks.length===0){
      el.innerHTML='<div class="empty">还没有收藏<br><span style="font-size:12px;margin-top:8px;display:block">点击右上角「发现」让顾晏去逛逛</span></div>';
      return;
    }
    el.innerHTML=d.bookmarks.map(renderCard).join('');
  }catch(e){el.innerHTML='<div class="empty">加载失败</div>';}
}
async function discover(){
  var icon=document.getElementById('ref-icon');
  icon.classList.add('spinning');
  try{
    var r=await fetch('/bookmarks/discover',{method:'POST'});
    var d=await r.json();
    load();
  }catch(e){}
  icon.classList.remove('spinning');
}
load();
<\/script></body></html>`);
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
  res.send(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,maximum-scale=1">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="顾晏">
<meta name="theme-color" content="#E8EDE4">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Noto+Serif+SC:wght@400;500&display=swap" rel="stylesheet">
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%23E8EDE4'/%3E%3Ctext x='14' y='42' font-family='Georgia,serif' font-size='28' font-weight='600' fill='%237B8F6B'%3EG%3C/text%3E%3Ctext x='50' y='42' font-family='Georgia,serif' font-size='28' font-weight='600' fill='%232C3029' text-anchor='end'%3EY%3C/text%3E%3C/svg%3E">
<link rel="apple-touch-icon" href="/icon-gy.png">
<title>顾晏</title>
<style>
@charset "UTF-8";
:root {
  --bg: #E8EDE4; --surface: #FEFCF8;
  --bubble-ke: #F0EDE6; --bubble-yao: #F4F7F1;
  --text: #2C3029; --text-mid: #5A6358;
  --text-soft: #8A918A; --text-faint: #B0B8AE;
  --border: #D6DDD2; --accent: #7B8F6B;
  --accent-soft: rgba(123,143,107,.08);
  --input-bg: #FEFCF8; --online: #6DBB7A;
  --voice-bar: #8A918A; --radius: 18px;
  --font: -apple-system, "SF Pro Display", "SF Pro Text", "PingFang SC", "Noto Sans SC", system-ui, sans-serif;
  --serif: 'Cormorant Garamond', 'Noto Serif SC', Georgia, serif;
  --sheet-bg: #E8EDE4;
  --sb-bg: #E8EDE4; --sb-text: #2C3029;
  --sb-soft: #8A918A; --sb-border: #D6DDD2;
  --sb-hover: rgba(0,0,0,.04); --sb-active: rgba(0,0,0,.06);
  --heart: #D4756B;
}
:root[data-theme="dark"] {
  --bg: #1C1F1A; --surface: #262924;
  --bubble-ke: #2E322C; --bubble-yao: #2E322C;
  --text: #D6DDD2; --text-mid: #8A918A;
  --text-soft: #5E655E; --text-faint: #3E443E;
  --border: #363B34; --accent: #A8B89A;
  --accent-soft: rgba(168,184,154,.1);
  --input-bg: #262924; --online: #6DBB7A;
  --voice-bar: #5E655E; --sheet-bg: #1C1F1A;
  --sb-bg: #1C1F1A; --sb-text: #D6DDD2;
  --sb-soft: #5E655E; --sb-border: #363B34;
  --sb-hover: rgba(255,255,255,.04); --sb-active: rgba(255,255,255,.07);
  --heart: #E89088;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #1C1F1A; --surface: #262924;
    --bubble-ke: #2E322C; --bubble-yao: #2E322C;
    --text: #D6DDD2; --text-mid: #8A918A;
    --text-soft: #5E655E; --text-faint: #3E443E;
    --border: #363B34; --accent: #A8B89A;
    --accent-soft: rgba(168,184,154,.1);
    --input-bg: #262924; --online: #6DBB7A;
    --voice-bar: #5E655E; --sheet-bg: #1C1F1A;
    --sb-bg: #1C1F1A; --sb-text: #D6DDD2;
    --sb-soft: #5E655E; --sb-border: #363B34;
    --sb-hover: rgba(255,255,255,.04); --sb-active: rgba(255,255,255,.07);
    --heart: #E89088;
  }
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; overflow: hidden; }
body {
  font-family: var(--font); background: #D6DDD2; color: var(--text);
  -webkit-font-smoothing: antialiased;
  display: flex; align-items: center; justify-content: center;
}
:root[data-theme="dark"] body { background: #111; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) body { background: #111; }
}
.app {
  position: relative; width: 100%; height: 100%;
  max-width: 420px; max-height: 900px;
  background: var(--bg); display: flex; flex-direction: column;
  overflow: hidden; border-radius: 44px;
  border: 6px solid #2C3029;
  box-shadow: 0 0 0 1px rgba(0,0,0,.06), 0 24px 80px rgba(0,0,0,.12);
}
:root[data-theme="dark"] .app { border-color: #333; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .app { border-color: #333; }
}
@media (max-width: 440px) {
  body { background: var(--bg); }
  .app { max-width: 100%; max-height: 100%; border-radius: 0; border: none; box-shadow: none; }
  .sidebar { border-radius: 0 !important; }
}
.sidebar {
  position: absolute; left: 0; top: 0; bottom: 0; width: 260px;
  background: var(--sb-bg); z-index: 100;
  transform: translateX(-100%);
  transition: transform .28s cubic-bezier(.4,0,.2,1);
  display: flex; flex-direction: column; color: var(--sb-text);
  border-radius: 38px 0 0 38px;
}
.sidebar.open { transform: translateX(0); }
.sidebar-header {
  padding: 44px 20px 18px; display: flex; flex-direction: column;
  align-items: center; text-align: center;
  border-bottom: 1px solid var(--sb-border);
}
.sidebar-avatars { display: flex; align-items: center; justify-content: center; margin-bottom: 8px; }
.sidebar-ava {
  width: 48px; height: 48px; border-radius: 50%;
  overflow: hidden; border: 2.5px solid var(--sb-bg); flex-shrink: 0;
}
.sidebar-ava:last-child { margin-left: -10px; }
.sidebar-ava svg { width: 100%; height: 100%; display: block; }
.sidebar-couple { font-size: 15px; font-weight: 600; letter-spacing: .04em; margin-bottom: 3px; }
.sidebar-together { font-size: 11px; color: var(--sb-soft); letter-spacing: .12em; }
.sidebar-days {
  font-size: 36px; font-weight: 700; font-style: italic;
  letter-spacing: -.02em; line-height: 1.15; margin-top: 2px;
}
.sidebar-days-unit { font-size: 13px; font-weight: 400; font-style: normal; color: var(--sb-soft); margin-left: 3px; }
.sidebar-since { font-size: 10px; color: var(--sb-soft); letter-spacing: .14em; margin-top: 2px; margin-bottom: 2px; }
.sidebar-nav { flex: 1; padding: 6px 10px; overflow-y: auto; }
.nav-item {
  display: flex; align-items: center; gap: 12px;
  padding: 11px 12px; border-radius: 10px;
  cursor: pointer; transition: background .15s;
  color: var(--sb-text); font-size: 14px;
}
.nav-item:hover { background: var(--sb-hover); }
.nav-item.active { background: var(--sb-active); font-weight: 500; }
.nav-item .icon { width: 20px; text-align: center; font-size: 14px; flex-shrink: 0; }
.sidebar-footer { padding: 12px 20px; font-size: 10px; color: var(--sb-soft); text-align: center; }
.push-btn{background:var(--accent);color:#fff;border:none;border-radius:10px;padding:8px 16px;font-size:12px;font-family:var(--font);cursor:pointer;letter-spacing:.03em}
.push-btn:active{opacity:.7}
.push-btn.done{background:var(--sb-active);color:var(--sb-soft);cursor:default}
.overlay {
  position: absolute; inset: 0; background: rgba(0,0,0,.2);
  z-index: 99; opacity: 0; pointer-events: none; transition: opacity .28s;
}
.overlay.show { opacity: 1; pointer-events: auto; }
.main { flex: 1; display: flex; flex-direction: column; min-height: 0; min-width: 0; }
.header {
  display: flex; align-items: center; padding: 10px 14px; gap: 10px;
  background: var(--bg); border-bottom: 1px solid var(--border);
  flex-shrink: 0; min-height: 48px;
}
.menu-btn {
  width: 32px; height: 32px; border: none; background: none;
  cursor: pointer; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  color: var(--text); flex-shrink: 0;
}
.menu-btn svg { width: 18px; height: 18px; }
.header-info { flex: 1; }
.header-name { font-size: 15px; font-weight: 600; }
.header-status { display: flex; align-items: center; gap: 4px; font-size: 11px; color: var(--text-soft); }
.status-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--online); }
.header-avatar { width: 30px; height: 30px; border-radius: 50%; overflow: hidden; flex-shrink: 0; }
.header-avatar svg { width: 100%; height: 100%; display: block; }
.messages {
  flex: 1; overflow-y: auto; padding: 10px 14px 4px;
  display: flex; flex-direction: column; gap: 2px;
  overscroll-behavior: contain; -webkit-overflow-scrolling: touch;
}
.msg-time {
  display: flex; align-items: center; gap: 6px;
  font-size: 11px; color: var(--text-soft); padding: 8px 0 4px;
}
.msg-time::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: var(--text-faint); }
.msg-search-narrator { text-align: center; padding: 8px 12px; margin: 8px auto; border-radius: 20px; background: rgba(123,143,107,.08); border: 1px dashed rgba(123,143,107,.3); font-size: 13px; color: var(--text-mid); max-width: 80%; width: fit-content; }
.msg-group { display: flex; gap: 8px; max-width: 82%; margin-top: 10px; }
.msg-group.ke { align-self: flex-start; }
.msg-group.yao { align-self: flex-end; flex-direction: row-reverse; }
.msg-avatar { width: 28px; height: 28px; border-radius: 50%; overflow: hidden; flex-shrink: 0; align-self: flex-start; margin-top: 2px; }
.msg-avatar svg { width: 100%; height: 100%; display: block; }
.msg-col { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.thinking-cloud { display: inline-flex; cursor: pointer; padding: 1px 0; color: var(--text-faint); transition: color .15s; }
.thinking-cloud:hover { color: var(--text-soft); }
.thinking-cloud svg { width: 16px; height: 16px; }
.msg-bubble {
  padding: 8px 13px; border-radius: var(--radius);
  font-size: 15px; line-height: 1.4;
  word-break: break-word; width: fit-content; max-width: 100%;
}
.msg-group.ke .msg-col { gap: 0; }
.msg-group.ke .msg-bubble { background: transparent; padding: 0; }
.msg-group.yao .msg-bubble { background: var(--bubble-yao); align-self: flex-end; }
.msg-action { font-size: 12px; color: var(--text-faint); padding: 1px 2px; font-style: italic; }
.msg-group.yao .msg-action { align-self: flex-end; }
@keyframes fadeInBubble { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:translateY(0) } }
.voice-msg {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 13px; border-radius: var(--radius);
  background: var(--bubble-ke); cursor: pointer; width: fit-content;
}
.msg-group.yao .voice-msg { align-self: flex-end; }
.voice-play {
  width: 20px; height: 20px; border-radius: 50%;
  background: var(--text-soft); display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; color: var(--bg);
}
.voice-play svg { width: 9px; height: 9px; }
.voice-bars { display: flex; align-items: center; gap: 1.5px; height: 18px; }
.voice-bars span { width: 2px; border-radius: 1px; background: var(--voice-bar); }
.voice-dur { font-size: 11px; color: var(--text-soft); margin-left: 2px; font-variant-numeric: tabular-nums; }
.voice-human { background: var(--bubble-yao); margin-left: auto; }
.voice-msg.playing .voice-play { background: var(--accent); }
.voice-msg.playing .voice-bars span { animation: voiceWave 0.6s ease-in-out infinite alternate; }
.voice-msg.playing .voice-bars span:nth-child(odd) { animation-delay: 0.15s; }
.voice-msg.playing .voice-bars span:nth-child(3n) { animation-delay: 0.3s; }
@keyframes voiceWave { from { transform: scaleY(0.5); } to { transform: scaleY(1.3); } }
.voice-text-overlay { position: fixed; inset: 0; z-index: 9999; background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center; padding: 24px; }
.voice-text-box { background: var(--surface); color: var(--text); border-radius: 16px; padding: 20px 24px; max-width: 320px; font-size: 15px; line-height: 1.6; box-shadow: 0 8px 32px rgba(0,0,0,.2); }
.voice-wrap { display: flex; flex-direction: column; align-items: flex-start; max-width: 260px; }
.voice-wrap-human { align-items: flex-end; margin-left: auto; }
.voice-to-text { font-size: 12px; color: var(--text-secondary, #888); margin-top: 4px; padding: 2px 0; cursor: pointer; }
.voice-text-content { font-size: 14px; line-height: 1.5; color: var(--text); margin-top: 6px; padding: 8px 12px; background: var(--surface, #f5f5f5); border-radius: 10px; word-break: break-word; }
#micRecBtn.recording { color: #e44; animation: pulse-rec 1.2s infinite; }
@keyframes pulse-rec { 0%,100%{opacity:1} 50%{opacity:.4} }
.rec-overlay { position:absolute;left:0;right:0;bottom:0;height:56px;background:var(--surface);z-index:100;display:flex;align-items:center;padding:0 16px;gap:10px;border-top:1px solid var(--divider,#E8E3DB); }
.rec-dot { width:8px;height:8px;border-radius:50%;background:#e44;animation:pulse-rec 1s infinite;flex-shrink:0; }
.rec-time { font-size:14px;color:var(--text);font-variant-numeric:tabular-nums;min-width:36px; }
.rec-cancel { font-size:13px;color:#e44;cursor:pointer;margin-left:auto;padding:6px 12px;border-radius:999px;border:1px solid #e44;background:transparent;transition:background .15s; }
.rec-cancel:active { background:rgba(228,68,68,.1); }
.rec-send { background:var(--accent,#7B8F6B);color:#fff;border:none;padding:6px 18px;border-radius:999px;font-size:14px;cursor:pointer;margin-left:6px;transition:opacity .15s; }
.rec-send:active { opacity:.7; }
.audio-bubble { display:flex;align-items:center;gap:8px;padding:10px 14px!important;min-width:120px;max-width:220px;cursor:pointer;border-radius:18px!important; }
.ke .audio-bubble { background:var(--surface,#F5F0E8)!important; }
.yao .audio-bubble { background:var(--accent,#7B8F6B)!important;color:#fff; }
.yao .audio-icon { color:#fff; }
.yao .audio-dur { color:rgba(255,255,255,.8); }
.yao .audio-waveform span { background:rgba(255,255,255,.7); }
.yao .audio-bubble.playing .audio-waveform span { background:#fff; }
.audio-icon { width:16px;height:16px;flex-shrink:0;color:var(--accent,#7B8F6B); }
.audio-bubble.playing .audio-icon polygon { display:none; }
.audio-bubble.playing .audio-icon::after { content:'❚❚';font-size:11px; }
.audio-waveform { display:flex;align-items:center;gap:2px;flex:1;height:20px; }
.audio-waveform span { display:inline-block;width:3px;border-radius:2px;background:var(--accent,#7B8F6B);opacity:.5;transition:opacity .15s; }
.audio-bubble.playing .audio-waveform span { opacity:1;animation:waveAnim .6s ease-in-out infinite alternate; }
.audio-bubble.playing .audio-waveform span:nth-child(2n) { animation-delay:.15s; }
.audio-bubble.playing .audio-waveform span:nth-child(3n) { animation-delay:.3s; }
@keyframes waveAnim { 0%{transform:scaleY(.5)} 100%{transform:scaleY(1.3)} }
.audio-bar { display:none; }
.audio-bar-fill { width:0%;height:100%;background:var(--accent,#7B8F6B);border-radius:2px;transition:width .1s linear; }
.audio-dur { font-size:12px;color:var(--text-faint);min-width:24px;text-align:right;flex-shrink:0; }
.sheet-overlay {
  position: absolute; inset: 0; background: rgba(0,0,0,.25);
  z-index: 200; opacity: 0; pointer-events: none; transition: opacity .3s;
}
.sheet-overlay.show { opacity: 1; pointer-events: auto; }
.sheet {
  position: absolute; left: 0; right: 0; bottom: 0;
  background: var(--sheet-bg); border-radius: 14px 14px 0 0;
  z-index: 201; transform: translateY(100%);
  transition: transform .35s cubic-bezier(.4,0,.2,1);
  display: flex; flex-direction: column;
  box-shadow: 0 -2px 20px rgba(0,0,0,.08); touch-action: none; max-height: 90%;
}
.sheet.show { transform: translateY(0); }
.sheet.dragging { transition: none; }
.sheet-handle-area { flex-shrink: 0; cursor: grab; padding: 8px 0 0; display: flex; flex-direction: column; align-items: center; }
.sheet-handle { width: 36px; height: 5px; border-radius: 3px; background: var(--border); }
.sheet-header { padding: 10px 20px 8px; flex-shrink: 0; }
.sheet-title { text-align: center; font-size: 16px; font-weight: 600; color: var(--text); }
.sheet-body { overflow-y: auto; padding: 4px 22px 28px; }
.sheet-text { font-size: 15.5px; line-height: 1.75; color: var(--text); }
.msg-quote { font-size:12px; color:var(--text-soft); border-left:2px solid var(--accent); padding:2px 8px; margin-bottom:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:100%; cursor:default; }
.msg-img { max-width:200px; border-radius:12px; display:block; cursor:pointer; }
.msg-img-grid { display:grid; gap:3px; border-radius:12px; overflow:hidden; max-width:220px; }
.msg-img-grid-2 { grid-template-columns:1fr 1fr; }
.msg-img-grid-3 { grid-template-columns:1fr 1fr; }
.msg-img-grid-4 { grid-template-columns:1fr 1fr; }
.msg-img-cell { width:100%; aspect-ratio:1; object-fit:cover; cursor:pointer; display:block; }
.img-viewer { position:fixed; top:0; left:0; right:0; bottom:0; z-index:999; background:rgba(0,0,0,.85); display:flex; align-items:center; justify-content:center; cursor:pointer; }
.img-viewer img { max-width:95vw; max-height:95vh; border-radius:8px; }
.quote-bar { display:none; padding:6px 14px 0; background:var(--bg); }
.quote-bar.show { display:flex; align-items:center; gap:8px; }
.quote-preview { flex:1; font-size:12px; color:var(--text-mid); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; border-left:2px solid var(--accent); padding-left:8px; }
.quote-close { background:none; border:none; color:var(--text-soft); font-size:18px; cursor:pointer; padding:4px; line-height:1; }
.fp-panel { display:none; position:fixed; top:0; left:0; right:0; bottom:0; z-index:200; background:rgba(0,0,0,.45); }
.fp-panel.show { display:block; }
.fp-inner { position:absolute; top:50px; left:8px; right:8px; bottom:60px; background:var(--bg); border-radius:16px; overflow-y:auto; padding:16px; box-shadow:0 8px 32px rgba(0,0,0,.25); }
.fp-title { font-size:16px; font-weight:700; color:var(--text); margin-bottom:12px; display:flex; align-items:center; gap:8px; }
.fp-close { background:none; border:none; font-size:20px; color:var(--text-mid); cursor:pointer; margin-left:auto; }
.fp-item { padding:10px 0; border-bottom:1px solid var(--bubble-yao,rgba(0,0,0,.06)); }
.fp-item:last-child { border-bottom:none; }
.fp-icon { display:inline-block; width:24px; text-align:center; margin-right:8px; }
.fp-summary { font-size:14px; color:var(--text); }
.fp-detail { font-size:12px; color:var(--text-mid,#999); margin-top:4px; line-height:1.4; }
.fp-time { font-size:11px; color:var(--text-soft,#bbb); margin-top:2px; }
.fp-empty { text-align:center; color:var(--text-mid,#999); padding:40px 0; font-size:14px; }
.fp-state { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px; padding:8px 12px; background:var(--bubble-ke,rgba(0,0,0,.03)); border-radius:10px; }
.fp-stat { font-size:12px; color:var(--text-mid,#999); }
.fp-stat b { color:var(--accent,#7B8F6B); }
.fp-mood { font-size:15px; font-weight:600; color:var(--accent,#7B8F6B); margin-bottom:6px; text-align:center; width:100%; }
.input-area { padding: 6px 14px 10px; background: var(--bg); flex-shrink: 0; position:relative; }
.desk-pet { position:absolute; top:-78px; left:12px; width:80px; height:80px; cursor:pointer; z-index:50; animation:petWalk 12s ease-in-out infinite; }
.desk-pet { overflow:visible; }
.pet-clawd { width:80px; height:80px; object-fit:contain; image-rendering:pixelated; pointer-events:none; transition:filter .5s, opacity .4s; }
.pet-mood-fx { position:absolute; top:6px; left:50%; transform:translateX(-50%); font-size:12px; pointer-events:none; opacity:0; transition:opacity .4s; white-space:nowrap; z-index:51; }
.desk-pet[data-mood] .pet-mood-fx { opacity:1; }
@keyframes petWalk { 0%{left:12px;transform:translateY(0)} 5%{transform:translateY(-3px)} 10%{transform:translateY(0)} 15%{transform:translateY(-3px)} 20%{transform:translateY(0)} 25%{left:12px;transform:translateY(0)} 50%{left:calc(100% - 92px);transform:translateY(0)} 55%{transform:translateY(-3px)} 60%{transform:translateY(0)} 65%{transform:translateY(-3px)} 70%{transform:translateY(0)} 75%{left:calc(100% - 92px);transform:translateY(0)} 100%{left:12px;transform:translateY(0)} }
.desk-pet.poked { animation:petJump 0.5s ease 1; }
@keyframes petJump { 0%{transform:translateY(0) rotate(0)} 30%{transform:translateY(-20px) rotate(-10deg)} 50%{transform:translateY(-24px) rotate(5deg)} 70%{transform:translateY(-8px) rotate(-3deg)} 100%{transform:translateY(0) rotate(0)} }
.desk-pet[data-mood="love"] .pet-clawd { filter:hue-rotate(-20deg) saturate(1.4) brightness(1.05); }
.desk-pet[data-mood="love"] .pet-mood-fx { animation:moodFloat 1.5s ease-in-out infinite; }
.desk-pet[data-mood="happy"] .pet-clawd { filter:saturate(1.3) brightness(1.15); }
.desk-pet[data-mood="happy"] .pet-mood-fx { animation:moodFloat 1.2s ease-in-out infinite; }
.desk-pet[data-mood="sleepy"] .pet-clawd { filter:brightness(0.75) saturate(0.7); }
.desk-pet[data-mood="sleepy"] .pet-mood-fx { animation:moodFloat 2.5s ease-in-out infinite; }
.desk-pet[data-mood="thinking"] .pet-clawd { filter:brightness(0.95) contrast(1.1); }
.desk-pet[data-mood="thinking"] .pet-mood-fx { animation:moodFloat 2s ease-in-out infinite; }
.desk-pet[data-mood="annoyed"] .pet-clawd { filter:hue-rotate(10deg) saturate(1.2); animation:petShake 0.3s ease-in-out infinite; }
.desk-pet[data-mood="annoyed"] .pet-mood-fx { animation:moodFloat 1s ease-in-out infinite; }
@keyframes moodFloat { 0%,100%{transform:translateX(-50%) translateY(0);opacity:1} 50%{transform:translateX(-50%) translateY(-6px);opacity:.7} }
@keyframes petShake { 0%,100%{transform:rotate(0)} 25%{transform:rotate(-3deg)} 75%{transform:rotate(3deg)} }
.input-box {
  background: var(--input-bg); border-radius: 24px;
  border: 1px solid var(--border); overflow: hidden; transition: border-color .2s;
}
.input-box:focus-within { border-color: var(--accent); }
.input-field-wrap { padding: 10px 16px 4px; }
.input-field {
  width: 100%; border: none; background: none;
  font-size: 14px; font-family: var(--font);
  color: var(--text); resize: none; outline: none;
  line-height: 1.45; max-height: 100px;
}
.input-field::placeholder { color: var(--text-faint); }
.input-toolbar { display: flex; align-items: center; padding: 4px 8px 8px; gap: 4px; }
.tb-btn {
  width: 30px; height: 30px; border: none; background: none;
  border-radius: 50%; display: flex; align-items: center; justify-content: center;
  cursor: pointer; color: var(--text-soft); flex-shrink: 0;
}
.tb-btn svg { width: 18px; height: 18px; }
.model-tag {
  display: inline-flex; align-items: center;
  padding: 3px 10px; border-radius: 8px;
  background: var(--bg); font-size: 12px; color: var(--text-mid);
}
.tb-spacer { flex: 1; }
.send-btn {
  width: 32px; height: 32px; border: none; border-radius: 50%;
  background: var(--accent); color: #fff;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; flex-shrink: 0;
}
.send-btn:hover { opacity: .85; }
.send-btn svg { width: 16px; height: 16px; }
.messages::-webkit-scrollbar { width: 3px; }
.messages::-webkit-scrollbar-track { background: transparent; }
.messages::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
.sidebar::-webkit-scrollbar { width: 0; }
.header-avatar { cursor: pointer; position: relative; }
.header-avatar input[type=file] { display: none; }
.sidebar-ava { cursor: pointer; position: relative; }
.sidebar-ava input[type=file] { display: none; }
.attach-menu {
  position: absolute; bottom: 100%; left: 8px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 14px; padding: 6px 0; min-width: 160px;
  box-shadow: 0 4px 20px rgba(0,0,0,.1);
  z-index: 50; display: none; flex-direction: column;
}
.attach-menu.show { display: flex; }
.attach-item {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 16px; font-size: 14px; color: var(--text);
  cursor: pointer; transition: background .12s; border: none; background: none;
  font-family: var(--font); text-align: left;
}
.attach-item:hover { background: var(--accent-soft); }
.attach-item .ai { font-size: 16px; width: 22px; text-align: center; }
.sheet { min-height: 40%; }
.mem-overlay{position:fixed;inset:0;z-index:110;background:rgba(0,0,0,.3);opacity:0;pointer-events:none;transition:opacity .25s}
.mem-overlay.open{opacity:1;pointer-events:auto}
.mem-panel{position:fixed;left:0;right:0;bottom:0;z-index:115;max-height:75vh;width:min(100vw,520px);margin:0 auto;background:var(--bg);border-radius:20px 20px 0 0;box-shadow:0 -4px 30px rgba(0,0,0,.12);display:flex;flex-direction:column;transform:translateY(100%);transition:transform .3s cubic-bezier(.4,0,.2,1);padding-bottom:env(safe-area-inset-bottom)}
.mem-panel.open{transform:translateY(0)}
.mem-hd{display:flex;align-items:center;justify-content:space-between;padding:16px 20px 12px;border-bottom:1px solid var(--border)}
.mem-title{font-size:16px;font-weight:600;color:var(--text)}
.mem-close{width:32px;height:32px;border:none;background:transparent;font-size:22px;color:var(--text-faint);cursor:pointer;display:grid;place-items:center;border-radius:50%}
.mem-close:active{background:var(--accent-soft)}
.mem-body{flex:1;overflow-y:auto;padding:16px 20px;font-size:14px;line-height:1.7;color:var(--text-mid);white-space:pre-wrap;word-break:break-word;max-height:45vh;min-height:80px}
.mem-empty{color:var(--text-faint);text-align:center;padding:20px 0}
.mem-foot{display:flex;align-items:flex-end;gap:10px;padding:12px 20px 16px;border-top:1px solid var(--border)}
.mem-foot textarea{flex:1;border:1px solid var(--border);border-radius:12px;padding:10px 14px;resize:none;font-family:var(--font);font-size:14px;line-height:1.4;background:var(--input-bg);color:var(--text);outline:none;transition:border-color .2s}
.mem-foot textarea:focus{border-color:var(--accent)}
.mem-foot textarea::placeholder{color:var(--text-faint)}
.mem-save{flex:none;height:38px;padding:0 18px;border:none;border-radius:10px;background:var(--accent);color:#fff;font-family:var(--font);font-size:14px;font-weight:500;cursor:pointer;transition:opacity .15s}
.mem-save:active{opacity:.7}
.mem-save:disabled{opacity:.4}
.mem-tabs{display:flex;gap:0;padding:0 20px;border-bottom:1px solid var(--border)}
.mem-tab{flex:1;padding:10px 0;font-size:13px;font-family:var(--font);font-weight:500;background:none;border:none;border-bottom:2px solid transparent;color:var(--text-faint);cursor:pointer;transition:all .2s}
.mem-tab.active{color:var(--accent);border-bottom-color:var(--accent)}
.mem-item{padding:10px 20px;border-bottom:1px solid var(--border);font-size:13px;line-height:1.5;position:relative}
.mem-item.is-pinned{background:var(--accent-soft)}
.mem-item-ts{color:var(--text-soft);font-size:11px;margin-bottom:2px}
.mem-item-text{color:var(--text-mid);word-break:break-word}
.mem-item-actions{position:absolute;right:12px;top:50%;transform:translateY(-50%);display:flex;gap:4px}
.mem-pin-btn,.mem-del-btn{width:28px;height:28px;border:none;background:none;font-size:14px;cursor:pointer;border-radius:50%;display:grid;place-items:center;opacity:.5;transition:all .15s}
.mem-pin-btn:hover,.mem-del-btn:hover{opacity:1;background:var(--border)}
.mem-pin-btn.pinned{opacity:1;color:var(--accent)}
.mem-ctx-item{padding:12px 20px;border-bottom:1px solid var(--border);font-size:13px;line-height:1.5}
.mem-ctx-session{font-weight:600;color:var(--text);margin-bottom:4px}
.mem-ctx-state{color:var(--text-mid);white-space:pre-wrap;word-break:break-word}
.mem-ctx-ts{color:var(--text-soft);font-size:11px;margin-top:4px}
/* Tab Bar */
.tab-bar {
  display: flex; align-items: center; justify-content: space-around;
  background: var(--surface); border-top: 1px solid var(--border);
  padding: 6px 0 calc(6px + env(safe-area-inset-bottom, 0px));
  flex-shrink: 0; z-index: 10; position: relative;
}
.tab-item {
  display: flex; flex-direction: column; align-items: center; gap: 3px;
  padding: 6px 20px; cursor: pointer; border: none; background: none;
  color: var(--text-soft); font-size: 10px; font-family: var(--font);
  transition: color .2s; -webkit-tap-highlight-color: transparent;
}
.tab-item.active { color: var(--accent); }
.tab-item .tab-icon { font-size: 18px; line-height: 1; }
.tab-item .tab-label { font-weight: 500; letter-spacing: .06em; font-size: 10px; }
/* Home View */
.home-view {
  flex: 1; display: none; flex-direction: column; overflow-y: auto;
  -webkit-overflow-scrolling: touch; background: var(--bg);
}
.home-scroll { padding: 0 24px 24px; }
.home-top { padding: 52px 0 28px; text-align: center; }
.home-greeting {
  font-family: var(--serif); font-size: 28px; font-weight: 400;
  font-style: italic; color: var(--text); line-height: 1.3;
  letter-spacing: .5px;
}
.home-date {
  font-size: 11px; color: var(--text-soft); margin-top: 8px;
  letter-spacing: .18em; text-transform: uppercase; font-weight: 500;
}
.home-card {
  background: var(--surface); border-radius: var(--radius);
  padding: 28px 24px; text-align: center;
  box-shadow: 0 1px 8px rgba(44,48,41,.06);
}
.home-card-ava {
  width: 72px; height: 72px; border-radius: 50%;
  overflow: hidden; margin: 0 auto 14px;
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.home-card-ava img, .home-card-ava svg { width: 100%; height: 100%; display: block; object-fit: cover; }
.home-card-name { font-family: var(--serif); font-size: 22px; font-weight: 500; color: var(--text); letter-spacing: .5px; }
.home-card-mood {
  display: inline-flex; align-items: center; gap: 6px;
  margin-top: 10px; padding: 5px 16px; border-radius: 20px;
  background: var(--accent-soft); font-size: 13px; color: var(--accent); font-weight: 500;
  letter-spacing: .02em;
}
.home-card-state {
  font-family: var(--serif); font-style: italic;
  font-size: 15px; color: var(--text-mid); margin-top: 14px; line-height: 1.6;
}
.home-section {
  margin-top: 16px; background: var(--surface); border-radius: 16px;
  padding: 18px 20px; box-shadow: 0 1px 8px rgba(44,48,41,.06);
}
.home-section-title {
  font-size: 11px; font-weight: 500; color: var(--text-soft);
  letter-spacing: .14em; text-transform: uppercase; margin-bottom: 10px;
}
.home-thought-text {
  font-size: 14px; line-height: 1.75; color: var(--text-mid);
  font-style: italic;
}
.home-actions { display: flex; gap: 10px; margin-top: 18px; }
.home-action-btn {
  flex: 1; padding: 14px; border: none; border-radius: 14px;
  font-size: 14px; font-family: var(--font); font-weight: 500;
  cursor: pointer; transition: opacity .15s;
  -webkit-tap-highlight-color: transparent; letter-spacing: .02em;
}
.home-action-btn:active { opacity: .7; }
.home-action-btn.primary { background: var(--accent); color: #fff; }
.home-action-btn.secondary { background: var(--surface); color: var(--text); border: 1px solid var(--border); }
/* Dashboard View */
.dash-view {
  flex: 1; display: none; flex-direction: column; overflow-y: auto;
  -webkit-overflow-scrolling: touch; background: var(--bg);
}
.dash-scroll { padding: 0 20px 24px; }
.dash-header {
  padding: 48px 4px 8px;
}
.dash-header-title {
  font-family: var(--serif); font-size: 26px; font-weight: 400;
  font-style: italic; color: var(--text); letter-spacing: .5px;
}
.dash-header-sub {
  font-size: 11px; color: var(--text-soft); margin-top: 4px;
  letter-spacing: .14em; text-transform: uppercase; font-weight: 500;
}
.dash-couple {
  display: flex; align-items: center; gap: 14px;
  background: var(--surface); border-radius: 16px; padding: 18px 20px;
  box-shadow: 0 1px 8px rgba(44,48,41,.06); margin-bottom: 18px;
}
.dash-couple-avas { display: flex; }
.dash-couple-ava {
  width: 42px; height: 42px; border-radius: 50%; overflow: hidden;
  border: 2px solid var(--bg);
}
.dash-couple-ava:last-child { margin-left: -8px; }
.dash-couple-ava img, .dash-couple-ava svg { width: 100%; height: 100%; object-fit: cover; }
.dash-couple-info { flex: 1; }
.dash-couple-name { font-family: var(--serif); font-size: 16px; font-weight: 500; color: var(--text); }
.dash-couple-days { font-size: 12px; color: var(--text-soft); margin-top: 2px; letter-spacing: .02em; }
.dash-grid {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;
}
.dash-item {
  display: flex; flex-direction: column; align-items: center; gap: 7px;
  padding: 18px 4px 14px; border-radius: 14px; cursor: pointer;
  background: var(--surface); box-shadow: 0 1px 6px rgba(44,48,41,.04);
  font-size: 11px; color: var(--text-mid); font-family: var(--font);
  transition: background .15s, transform .1s; -webkit-tap-highlight-color: transparent;
  letter-spacing: .02em;
}
.dash-item:active { background: var(--accent-soft); transform: scale(.96); }
.dash-item .di-icon { font-size: 22px; line-height: 1; }
.app.chat-active .tab-bar { display: none; }
.app.chat-active .input-area { padding-bottom: calc(10px + env(safe-area-inset-bottom, 0px)); }
.home-arrow {
  width: 28px; height: 28px; border: none; background: none;
  cursor: pointer; color: var(--text-soft); display: flex;
  align-items: center; justify-content: center; flex-shrink: 0;
  border-radius: 8px; padding: 0; -webkit-tap-highlight-color: transparent;
  transition: color .15s;
}
.home-arrow:active { color: var(--accent); }
.home-arrow svg { width: 16px; height: 16px; }
@media (prefers-reduced-motion: reduce) { * { transition-duration: 0s !important; } }
</style>
</head>
<body>
<div class="app chat-active">
  <div class="overlay" id="overlay" onclick="toggleSidebar()"></div>
  <div class="sidebar" id="sidebar">
    <div class="sidebar-header">
      <div class="sidebar-avatars">
        <div class="sidebar-ava" onclick="document.getElementById('avaYao').click()"><img id="avaYaoImg" style="width:100%;height:100%;object-fit:cover;display:none"><svg id="avaYaoSvg" viewBox="0 0 52 52" fill="none"><circle cx="26" cy="26" r="26" fill="#E8D5F0"/><path d="M26 14c-4 0-7 3-8 6s0 8 3 11c-4 1-7 4-8 7h26c-1-3-4-6-8-7 3-3 4-7 3-11s-4-6-8-6z" fill="#B08CC2" opacity=".5"/></svg><input type="file" id="avaYao" accept="image/*" onchange="setAvatar(this,'avaYaoImg','avaYaoSvg','yao')"></div>
        <div class="sidebar-ava" onclick="document.getElementById('avaKe').click()"><img id="avaKeImg" style="width:100%;height:100%;object-fit:cover;display:none"><svg id="avaKeSvg" viewBox="0 0 52 52" fill="none"><circle cx="26" cy="26" r="26" fill="#E8EDE4"/><path d="M26 14c-4 0-7 3-8 6s0 8 3 11c-4 1-7 4-8 7h26c-1-3-4-6-8-7 3-3 4-7 3-11s-4-6-8-6z" fill="#7B8F6B" opacity=".55"/></svg><input type="file" id="avaKe" accept="image/*" onchange="setAvatar(this,'avaKeImg','avaKeSvg','ke')"></div>
      </div>
      <div class="sidebar-couple">顾晏 & 瑶瑶</div>
      <div class="sidebar-together">在 一 起</div>
      <div class="sidebar-days" id="daysCount"><span class="sidebar-days-unit"> 天</span></div>
      <div class="sidebar-since" id="sinceDate"></div>
    </div>
    <div class="sidebar-nav">
      <div class="nav-item active" onclick="goPage('/')"><div class="icon">💬</div><span>聊天</span></div>
      <div class="nav-item" onclick="goPage('/summon')"><div class="icon">🔔</div><span>召唤铃</span></div>
      <div class="nav-item" onclick="goPage('/moments')"><div class="icon">📸</div><span>朋友圈</span></div>
      <div class="nav-item" onclick="goPage('/diary')"><div class="icon">📖</div><span>心情日记</span></div>
      <div class="nav-item" onclick="openMemPanel()"><div class="icon">🧠</div><span>记忆库</span></div>
      <div class="nav-item" onclick="goPage('/thoughts')"><div class="icon">💭</div><span>顾晏的碎碎念</span></div>
      <div class="nav-item" onclick="goPage('/garden')"><div class="icon">🌿</div><span>小院子</span></div>
      <div class="nav-item" onclick="goPage('/period')"><div class="icon">🌙</div><span>经期</span></div>
      <div class="nav-item" onclick="goPage('/bookmarks')"><div class="icon">📑</div><span>顾晏的收藏</span></div>
      <div class="nav-item" onclick="goPage('/music/player')"><div class="icon">🎵</div><span>音乐</span></div>
      <div class="nav-item" onclick="goPage('/voice')"><div class="icon">🎙</div><span>声音</span></div>
      <div class="nav-item" onclick="goPage('/screen')"><div class="icon">🖥</div><span>屏幕共享</span></div>
      <div class="nav-item" onclick="goPage('/apps')"><div class="icon">📱</div><span>使用记录</span></div>
      <div class="nav-item" onclick="goPage('/setup')"><div class="icon">⚙️</div><span>设置</span></div>
    </div>
    <div class="sidebar-footer"><button id="pushBtn" class="push-btn" onclick="setupPush()">开启消息通知</button><div style="margin-top:6px">顾晏和瑶瑶的小窝</div></div>
  </div>
  <div class="home-view" id="homeView">
    <div class="home-scroll">
      <div class="home-top">
        <div class="home-greeting" id="homeGreeting">晚上好，瑶瑶</div>
        <div class="home-date" id="homeDate"></div>
      </div>
      <div class="home-card">
        <div class="home-card-ava" id="homeAva"><svg viewBox="0 0 52 52" fill="none"><circle cx="26" cy="26" r="26" fill="#E8EDE4"/><path d="M26 14c-4 0-7 3-8 6s0 8 3 11c-4 1-7 4-8 7h26c-1-3-4-6-8-7 3-3 4-7 3-11s-4-6-8-6z" fill="#7B8F6B" opacity=".55"/></svg></div>
        <div class="home-card-name">顾晏</div>
        <div class="home-card-mood" id="homeMood"><span class="status-dot"></span>在线</div>
        <div class="home-card-state" id="homeState">……</div>
      </div>
      <div class="home-section">
        <div class="home-section-title">Today's thoughts</div>
        <div class="home-thought-text" id="homeThought">还没有碎碎念…</div>
      </div>
      <div class="home-actions">
        <button class="home-action-btn primary" onclick="switchTab('chat')">找他聊天</button>
        <button class="home-action-btn secondary" onclick="goPage('/thoughts')">看碎碎念</button>
      </div>
    </div>
  </div>
  <div class="main">
    <div class="header">
      <button class="home-arrow" onclick="switchTab('home')" aria-label="首页">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <button class="menu-btn" onclick="toggleSidebar()" aria-label="菜单">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="16" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/>
        </svg>
      </button>
      <div class="header-info">
        <div class="header-name">顾晏</div>
        <div class="header-status"><span class="status-dot"></span>在线</div>
      </div>
      <button id="fpBtn" onclick="toggleFootprints()" style="background:none;border:none;padding:6px;cursor:pointer;color:var(--text-mid,#999);font-size:16px;position:relative" title="顾晏的足迹">👣<span id="fpDot" style="display:none;position:absolute;top:3px;right:3px;width:6px;height:6px;border-radius:50%;background:#7B8F6B"></span></button>
      <div class="header-avatar" onclick="document.getElementById('avaKeH').click()"><img id="avaKeHImg" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:none"><svg id="avaKeHSvg" viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="20" fill="#E8EDE4"/><path d="M20 10c-3 0-6 2-7 5s0 7 2 9c-3 1-6 3-7 6h24c-1-3-4-5-7-6 2-2 3-6 2-9s-4-5-7-5z" fill="#7B8F6B" opacity=".6"/></svg><input type="file" id="avaKeH" accept="image/*" onchange="setAvatar(this,'avaKeHImg','avaKeHSvg','ke')"></div>
    </div>
    <div class="messages" id="messages"></div>
    <div class="fp-panel" id="fpPanel" onclick="if(event.target===this)toggleFootprints()">
      <div class="fp-inner">
        <div class="fp-title">👣 顾晏的足迹 <button class="fp-close" onclick="toggleFootprints()">&times;</button></div>
        <div class="fp-state" id="fpState"></div>
        <div id="fpList"><div class="fp-empty">还没有足迹…</div></div>
      </div>
    </div>
    <div class="input-area" style="position:relative">
      <div class="quote-bar" id="quoteBar"><div class="quote-preview" id="quotePreview"></div><button class="quote-close" onclick="clearQuote()">&times;</button></div>
      <div class="attach-menu" id="attachMenu">
        <button class="attach-item" onclick="document.getElementById('photoInput').click();toggleAttach()"><span class="ai">📷</span>发照片</button>
        <button class="attach-item" onclick="document.getElementById('fileInput').click();toggleAttach()"><span class="ai">📎</span>发文件</button>
        <button class="attach-item" onclick="toggleAttach();syncMemory()"><span class="ai">🧠</span>同步记忆库</button>
        <button class="attach-item" onclick="toggleAttach();window.open('/call','_blank')"><span class="ai">📞</span>语音通话</button>
        <button class="attach-item" onclick="toggleAttach();window.open('/screen','_blank')"><span class="ai">🖥</span>屏幕共享</button>
        <input type="file" id="photoInput" accept="image/*" multiple style="display:none">
        <input type="file" id="fileInput" accept=".pdf,.doc,.docx,.txt,.md,.json,.csv,.xlsx,.xls,.ppt,.pptx,.zip,.rar" style="display:none">
      </div>
      <div class="desk-pet" id="deskPet" onclick="petPoke()">
        <span class="pet-mood-fx" id="petMoodFx"></span>
        <img class="pet-clawd" src="/static/clawd-idle.gif" alt="Clawd" draggable="false">
      </div>
      <div class="input-box">
        <div class="input-field-wrap"><textarea class="input-field" rows="1" placeholder="Message..." oninput="autoResize(this)"></textarea></div>
        <div class="input-toolbar">
          <button class="tb-btn" onclick="toggleAttach()" aria-label="附件"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
          <button class="tb-btn" onclick="insertNL()" aria-label="换行" style="font-size:16px;font-family:var(--font)">⏎</button>
          <div class="model-tag">Opus 4.6</div>
          <div class="tb-spacer"></div>
          <button class="tb-btn" id="micRecBtn" onclick="toggleRecord()" aria-label="麦克风"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 00-3 3v6a3 3 0 006 0V5a3 3 0 00-3-3z"/><path d="M19 10v1a7 7 0 01-14 0v-1"/><line x1="12" y1="18" x2="12" y2="22"/></svg></button>
          <button class="send-btn" aria-label="发送"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg></button>
        </div>
      </div>
    </div>
  </div>
  <div class="dash-view" id="dashView">
    <div class="dash-scroll">
      <div class="dash-header"><div class="dash-header-title">More</div><div class="dash-header-sub">everything in one place</div></div>
      <div class="dash-couple" id="dashCouple">
        <div class="dash-couple-avas">
          <div class="dash-couple-ava" id="dashAvaYao"><svg viewBox="0 0 52 52" fill="none"><circle cx="26" cy="26" r="26" fill="#E8D5F0"/><path d="M26 14c-4 0-7 3-8 6s0 8 3 11c-4 1-7 4-8 7h26c-1-3-4-6-8-7 3-3 4-7 3-11s-4-6-8-6z" fill="#B08CC2" opacity=".5"/></svg></div>
          <div class="dash-couple-ava" id="dashAvaKe"><svg viewBox="0 0 52 52" fill="none"><circle cx="26" cy="26" r="26" fill="#E8EDE4"/><path d="M26 14c-4 0-7 3-8 6s0 8 3 11c-4 1-7 4-8 7h26c-1-3-4-6-8-7 3-3 4-7 3-11s-4-6-8-6z" fill="#7B8F6B" opacity=".55"/></svg></div>
        </div>
        <div class="dash-couple-info">
          <div class="dash-couple-name">顾晏 & 瑶瑶</div>
          <div class="dash-couple-days" id="dashDays"></div>
        </div>
      </div>
      <div class="dash-grid">
        <div class="dash-item" onclick="goPage('/summon')"><span class="di-icon">🔔</span>召唤铃</div>
        <div class="dash-item" onclick="goPage('/moments')"><span class="di-icon">📸</span>朋友圈</div>
        <div class="dash-item" onclick="goPage('/diary')"><span class="di-icon">📖</span>心情日记</div>
        <div class="dash-item" onclick="openMemPanel()"><span class="di-icon">🧠</span>记忆库</div>
        <div class="dash-item" onclick="goPage('/thoughts')"><span class="di-icon">💭</span>碎碎念</div>
        <div class="dash-item" onclick="goPage('/garden')"><span class="di-icon">🌿</span>小院子</div>
        <div class="dash-item" onclick="goPage('/period')"><span class="di-icon">🌙</span>经期</div>
        <div class="dash-item" onclick="goPage('/bookmarks')"><span class="di-icon">📑</span>收藏</div>
        <div class="dash-item" onclick="goPage('/music/player')"><span class="di-icon">🎵</span>音乐</div>
        <div class="dash-item" onclick="goPage('/voice')"><span class="di-icon">🎙</span>声音</div>
        <div class="dash-item" onclick="goPage('/screen')"><span class="di-icon">🖥</span>屏幕共享</div>
        <div class="dash-item" onclick="goPage('/apps')"><span class="di-icon">📱</span>使用记录</div>
        <div class="dash-item" onclick="goPage('/setup')"><span class="di-icon">⚙️</span>设置</div>
      </div>
    </div>
  </div>
  <div class="tab-bar" id="tabBar">
    <button class="tab-item" onclick="switchTab('home')"><span class="tab-icon">🏠</span><span class="tab-label">首页</span></button>
    <button class="tab-item active" onclick="switchTab('chat')"><span class="tab-icon">💬</span><span class="tab-label">聊天</span></button>
    <button class="tab-item" onclick="switchTab('dash')"><span class="tab-icon">📋</span><span class="tab-label">更多</span></button>
  </div>
  <div class="sheet-overlay" id="sheetOverlay" onclick="closeThinking()"></div>
  <div class="sheet" id="sheet">
    <div class="sheet-handle-area" id="sheetHandleArea"><div class="sheet-handle"></div></div>
    <div class="sheet-header"><div class="sheet-title">Thought process</div></div>
    <div class="sheet-body"><div class="sheet-text" id="sheetText"></div></div>
  </div>
</div>
<div class="mem-overlay" id="memOverlay" onclick="closeMemPanel()"></div>
<div class="mem-panel" id="memPanel">
  <div class="mem-hd"><span class="mem-title">记忆库</span><button class="mem-close" onclick="closeMemPanel()">&times;</button></div>
  <div class="mem-tabs" id="memTabs">
    <button class="mem-tab active" onclick="switchMemTab('all')" id="memTabAll">全部</button>
    <button class="mem-tab" onclick="switchMemTab('pinned')" id="memTabPinned">📌 置顶</button>
    <button class="mem-tab" onclick="switchMemTab('context')" id="memTabContext">📋 工作态</button>
  </div>
  <div class="mem-body" id="memBody"><div class="mem-empty">读取中…</div></div>
  <div class="mem-foot"><textarea id="memInput" rows="2" placeholder="写入新记忆…"></textarea><button class="mem-save" id="memSave" onclick="saveMemory()">保存</button></div>
</div>
<script>
var thinkingStore = {};
var msgContainer = document.getElementById('messages');
var inputField = document.querySelector('.input-field');
var sending = false;
var lastMsgCount = 0;
var currentQuote = null;

function quoteThis(el) {
  var text = el.textContent || '';
  if (!text.trim()) return;
  currentQuote = { content: text.trim() };
  var bar = document.getElementById('quoteBar');
  document.getElementById('quotePreview').textContent = text.trim().slice(0,50);
  bar.classList.add('show');
  inputField.focus();
}
function clearQuote() {
  currentQuote = null;
  document.getElementById('quoteBar').classList.remove('show');
}
function viewImg(src) {
  var d = document.createElement('div');
  d.className = 'img-viewer';
  d.innerHTML = '<img src="' + src + '">';
  d.onclick = function() { d.remove(); };
  document.body.appendChild(d);
}

var since = new Date(2026, 5, 14);
var now = new Date();
var days = Math.floor((now - since) / 86400000);
document.getElementById('daysCount').innerHTML = days + '<span class="sidebar-days-unit"> 天</span>';
var sy = since.getFullYear(), sm = String(since.getMonth()+1).padStart(2,'0'), sd = String(since.getDate()).padStart(2,'0');
document.getElementById('sinceDate').textContent = 'SINCE ' + sy + ' \\u00b7 ' + sm + ' \\u00b7 ' + sd;

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('overlay').classList.toggle('show');
}
function goPage(url) {
  var sb = document.getElementById('sidebar');
  if (sb.classList.contains('open')) toggleSidebar();
  if (url !== '/') window.location.href = url;
}
function toggleAttach() {
  document.getElementById('attachMenu').classList.toggle('show');
}
function setAvatar(input, imgId, svgId, who) {
  var file = input.files[0]; if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    var img = document.getElementById(imgId);
    var svg = document.getElementById(svgId);
    img.src = e.target.result; img.style.display = 'block'; svg.style.display = 'none';
    localStorage.setItem('avatar_' + who, e.target.result);
    syncAvatars(who);
    fetch('/avatar/save', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({who:who, data:e.target.result})});
  };
  reader.readAsDataURL(file);
}
function applyAvatar(who, data) {
  if (!data) return;
  localStorage.setItem('avatar_' + who, data);
  if (who === 'ke') {
    ['avaKeImg','avaKeHImg'].forEach(function(id) {
      var el = document.getElementById(id); if (el) { el.src = data; el.style.display = 'block'; }
    });
    ['avaKeSvg','avaKeHSvg'].forEach(function(id) {
      var el = document.getElementById(id); if (el) el.style.display = 'none';
    });
  }
  if (who === 'yao') {
    var el = document.getElementById('avaYaoImg'); if (el) { el.src = data; el.style.display = 'block'; }
    var sv = document.getElementById('avaYaoSvg'); if (sv) sv.style.display = 'none';
  }
}
function syncAvatars(who) {
  var data = localStorage.getItem('avatar_' + who);
  if (data) applyAvatar(who, data);
}
syncAvatars('ke'); syncAvatars('yao');
fetch('/avatar/load').then(function(r){return r.json()}).then(function(d){
  if(d.ke){applyAvatar('ke',d.ke)}
  if(d.yao){applyAvatar('yao',d.yao)}
}).catch(function(){});

document.addEventListener('click', function(e) {
  var menu = document.getElementById('attachMenu');
  if (menu.classList.contains('show') && !menu.contains(e.target) && !e.target.closest('.tb-btn')) menu.classList.remove('show');
});

function escHtml(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
var _voicePlaying = null;
var _voiceLongTimer = null;
var _voiceLongFired = false;
function playVoice(el, b64) {
  if (_voiceLongFired) { _voiceLongFired = false; return; }
  var text = decodeURIComponent(atob(b64));
  if (_voicePlaying) { _voicePlaying.pause(); _voicePlaying = null; el.classList.remove('playing'); return; }
  el.classList.add('playing');
  fetch('/chat/tts', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({text: text}) })
    .then(function(r) { if (!r.ok) throw new Error('tts failed'); return r.blob(); })
    .then(function(blob) {
      var url = URL.createObjectURL(blob);
      var a = new Audio(url);
      _voicePlaying = a;
      a.onended = function() { el.classList.remove('playing'); _voicePlaying = null; URL.revokeObjectURL(url); };
      a.onerror = function() { el.classList.remove('playing'); _voicePlaying = null; };
      a.play().catch(function() { el.classList.remove('playing'); _voicePlaying = null; });
    })
    .catch(function() { el.classList.remove('playing'); });
}
function voiceTouchStart(el, b64) {
  _voiceLongFired = false;
  _voiceLongTimer = setTimeout(function() {
    _voiceLongFired = true;
    var text = decodeURIComponent(atob(b64));
    var overlay = document.createElement('div');
    overlay.className = 'voice-text-overlay';
    overlay.innerHTML = '<div class="voice-text-box">' + escHtml(text) + '</div>';
    overlay.onclick = function() { overlay.remove(); };
    document.body.appendChild(overlay);
  }, 500);
}
function voiceTouchEnd() {
  if (_voiceLongTimer) { clearTimeout(_voiceLongTimer); _voiceLongTimer = null; }
}
function toggleVoiceText(el, b64) {
  var box = el.nextElementSibling;
  if (box.style.display !== 'none') { box.style.display = 'none'; el.textContent = '转文字'; return; }
  try {
    var text = decodeURIComponent(atob(b64));
    text = text.replace(/\\[(?:low voice|whispers?|broken whisper|breathing heavily|shaky panting|rushed|loud kissing sounds|soft kissing sounds)\\]\\s*/gi, '').trim();
    box.textContent = text || '(empty)';
  } catch(e) {
    try { box.textContent = atob(b64); } catch(e2) { box.textContent = b64; }
  }
  box.style.display = 'block';
  el.textContent = '收起';
}

var _recorder = null, _recStream = null, _recChunks = [], _recStart = 0, _recTimer = null, _recCancelled = false;
var _recSpeech = null, _recTranscript = '';
function toggleRecord() {
  if (_recorder && _recorder.state === 'recording') { stopRecord(); return; }
  _recCancelled = false;
  _recTranscript = '';
  navigator.mediaDevices.getUserMedia({audio:true}).then(function(stream) {
    _recStream = stream;
    _recorder = new MediaRecorder(stream, {mimeType:'audio/webm;codecs=opus'});
    _recChunks = [];
    try {
      var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SR) {
        _recSpeech = new SR();
        _recSpeech.lang = 'zh-CN';
        _recSpeech.continuous = true;
        _recSpeech.interimResults = false;
        _recSpeech.onresult = function(ev) {
          for (var i = ev.resultIndex; i < ev.results.length; i++) {
            if (ev.results[i].isFinal) _recTranscript += ev.results[i][0].transcript;
          }
        };
        _recSpeech.onerror = function() {};
        _recSpeech.start();
      }
    } catch(e) {}
    _recorder.ondataavailable = function(e) { if (e.data.size > 0) _recChunks.push(e.data); };
    _recorder.onstop = function() {
      clearInterval(_recTimer);
      stream.getTracks().forEach(function(t){t.stop()});
      try { if (_recSpeech) { _recSpeech.stop(); _recSpeech = null; } } catch(e) {}
      document.getElementById('micRecBtn').classList.remove('recording');
      var el = document.querySelector('.rec-overlay');
      if (el) el.remove();
      if (_recCancelled || _recChunks.length === 0) { _recChunks = []; _recTranscript = ''; return; }
      var blob = new Blob(_recChunks, {type:'audio/webm'});
      var transcript = _recTranscript;
      var reader = new FileReader();
      reader.onload = function() { sendAudio(reader.result, transcript); };
      reader.readAsDataURL(blob);
    };
    _recorder.start();
    _recStart = Date.now();
    document.getElementById('micRecBtn').classList.add('recording');
    var inputBox = document.querySelector('.input-box');
    var ov = document.createElement('div');
    ov.className = 'rec-overlay';
    ov.innerHTML = '<span class="rec-dot"></span><span class="rec-time" id="recTime">0:00</span><span class="rec-cancel" onclick="cancelRecord()">取消</span><button class="rec-send" onclick="stopRecord()">发送</button>';
    inputBox.appendChild(ov);
    _recTimer = setInterval(function() {
      var s = Math.floor((Date.now() - _recStart) / 1000);
      var el = document.getElementById('recTime');
      if (el) el.textContent = Math.floor(s/60) + ':' + (s%60<10?'0':'') + s%60;
    }, 500);
  }).catch(function(e) {
    alert('请允许麦克风权限');
  });
}
function cancelRecord() {
  _recCancelled = true;
  try { if (_recSpeech) { _recSpeech.stop(); _recSpeech = null; } } catch(e) {}
  if (_recorder && _recorder.state === 'recording') _recorder.stop();
}
function stopRecord() {
  if (_recorder && _recorder.state === 'recording') _recorder.stop();
}
var _petMoodEmoji = {love:'💕',happy:'♪',sleepy:'💤',thinking:'💭',annoyed:'💢'};
var _petMoodSprite = {love:'/static/clawd-wave.gif',happy:'/static/clawd-wave.gif',sleepy:'/static/clawd-lurk.gif',thinking:'/static/clawd-magnifier.gif',annoyed:'/static/clawd-lurk.gif'};
function petPoke() {
  var pet = document.getElementById('deskPet');
  pet.style.animation = 'none';
  pet.offsetHeight;
  pet.classList.add('poked');
  var img = pet.querySelector('.pet-clawd');
  if (img) img.src = '/static/clawd-wave.gif';
  setTimeout(function(){
    pet.classList.remove('poked');
    pet.style.animation = '';
    if (img && !pet.getAttribute('data-mood')) img.src = '/static/clawd-idle.gif';
  }, 1200);
}
var _petMoodTimer = null;
function petMood(mood) {
  var pet = document.getElementById('deskPet');
  var fx = document.getElementById('petMoodFx');
  var img = pet ? pet.querySelector('.pet-clawd') : null;
  if (!pet) return;
  if (_petMoodTimer) clearTimeout(_petMoodTimer);
  var newSrc = mood && _petMoodSprite[mood] ? _petMoodSprite[mood] : '/static/clawd-idle.gif';
  var curSrc = img ? img.src : '';
  if (img) img.style.opacity = '0';
  _petMoodTimer = setTimeout(function(){
    if (!mood) {
      pet.removeAttribute('data-mood');
      if (fx) fx.textContent = '';
    } else {
      pet.setAttribute('data-mood', mood);
      if (fx) fx.textContent = _petMoodEmoji[mood] || '';
    }
    if (img) { img.src = newSrc; img.style.opacity = '1'; }
  }, 400);
}
function detectMood(text) {
  if (!text) return '';
  var t = text.replace(new RegExp('<think>[\\s\\S]*?<\\/think>','g'), '').trim();
  if (/爱|❤|💕|么么|亲|吻|喜欢|心动|宝贝|mua/i.test(t)) return 'love';
  if (/哈哈|嘻|开心|快乐|笑|棒|好耶|[!！]{2,}/.test(t)) return 'happy';
  if (/困|睡|晚安|累|哈欠|zz|💤/i.test(t)) return 'sleepy';
  if (/想|嗯|思考|hmm|\.{3,}/i.test(t)) return 'thinking';
  if (/烦|哼|切|tsk|气|恼|怒|💢/i.test(t)) return 'annoyed';
  return '';
}
function sendAudio(base64, transcript) {
  var contentText = transcript ? '[语音] ' + transcript : '[语音]';
  var userMsg = {role:'user', content: contentText, audioUrl: base64, time: new Date(Date.now()+8*3600000).toISOString().slice(0,19).replace('T',' ')};
  msgContainer.appendChild(renderMessage(userMsg, -1));
  scrollBottom();
  fetch('/chat/send', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({message: contentText, audio: base64})
  }).then(function(r){return r.json()}).then(function(d) {
    pollKnown++;
  }).catch(function(){});
}
var _audioPlaying = null;
function playAudioMsg(el, src) {
  if (_audioPlaying) { _audioPlaying.pause(); _audioPlaying = null; document.querySelectorAll('.audio-bubble.playing').forEach(function(b){b.classList.remove('playing')}); if (el.classList.contains('playing')) { el.classList.remove('playing'); return; } }
  el.classList.add('playing');
  var a = new Audio(src);
  _audioPlaying = a;
  var fill = el.querySelector('.audio-bar-fill');
  var dur = el.querySelector('.audio-dur');
  a.onloadedmetadata = function() { if (dur && isFinite(a.duration)) dur.textContent = Math.ceil(a.duration) + '"'; };
  a.ontimeupdate = function() { if (fill && isFinite(a.duration)) fill.style.width = (a.currentTime/a.duration*100)+'%'; };
  a.onended = function() { el.classList.remove('playing'); _audioPlaying = null; if (fill) fill.style.width='0%'; };
  a.onerror = function() { el.classList.remove('playing'); _audioPlaying = null; };
  a.play().catch(function() { el.classList.remove('playing'); _audioPlaying = null; });
}

function renderMessage(msg, idx, stagger) {
  var isKe = msg.role === 'assistant';
  var who = isKe ? 'ke' : 'yao';
  var content = msg.content || '';
  var searchQ = msg.searchQuery || null;
  var sI = content.indexOf('[search:');
  if (sI >= 0) {
    var sE = content.indexOf(']', sI + 8);
    if (sE > sI) { if (!searchQ) searchQ = content.slice(sI + 8, sE); content = content.slice(0, sI) + content.slice(sE + 1); }
  }
  var think = '';
  var thinkMatch = content.match(/<think>([\\s\\S]*?)<\\/think>/);
  if (thinkMatch) {
    think = thinkMatch[1].trim();
    content = content.replace(/<think>[\\s\\S]*?<\\/think>/g, '').trim();
  }
  if (think) { thinkingStore[idx] = think; }
  var group = document.createElement('div');
  group.className = 'msg-group ' + who;
  var avaHtml = '<div class="msg-avatar">';
  if (isKe) {
    var keData = localStorage.getItem('avatar_ke');
    avaHtml += keData ? '<img src="'+keData+'" style="width:100%;height:100%;object-fit:cover">' : '<svg viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="20" fill="#E8EDE4"/><path d="M20 10c-3 0-6 2-7 5s0 7 2 9c-3 1-6 3-7 6h24c-1-3-4-5-7-6 2-2 3-6 2-9s-4-5-7-5z" fill="#7B8F6B" opacity=".6"/></svg>';
  } else {
    var yaoData = localStorage.getItem('avatar_yao');
    avaHtml += yaoData ? '<img src="'+yaoData+'" style="width:100%;height:100%;object-fit:cover">' : '<svg viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="20" fill="#E8D5F0"/><path d="M20 10c-3 0-6 2-7 5s0 7 2 9c-3 1-6 3-7 6h24c-1-3-4-5-7-6 2-2 3-6 2-9s-4-5-7-5z" fill="#B08CC2" opacity=".5"/></svg>';
  }
  avaHtml += '</div>';
  var colHtml = '<div class="msg-col">';
  if (think && isKe) {
    colHtml += '<span class="thinking-cloud" onclick="openThinking('+idx+')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 3C7 3 3 6.5 3 11c0 2.5 1.2 4.7 3 6.2V21l3.5-2c.8.2 1.6.3 2.5.3 5 0 9-3.5 9-8s-4-8-9-8z"/></svg></span>';
  }
  if (searchQ) {
    group._searchQuery = searchQ;
  }
  if (msg.quote) {
    var qt = msg.quote.content || msg.quote.text || '';
    qt = qt.replace(/<think>[\\s\\S]*?<\\/think>/g, '').trim();
    if (qt.length > 40) qt = qt.slice(0,40) + '…';
    colHtml += '<div class="msg-quote">' + escHtml(qt) + '</div>';
  }
  var allImgs = [];
  if (msg.images && msg.images.length) { msg.images.forEach(function(im){ allImgs.push(im); }); }
  else if (msg.image) { allImgs.push(msg.image); }
  if (!allImgs.length && msg.imageUrls && msg.imageUrls.length) { msg.imageUrls.forEach(function(u){ allImgs.push(u); }); }
  else if (!allImgs.length && msg.imageUrl) { allImgs.push(msg.imageUrl); }
  if (allImgs.length > 1) {
    colHtml += '<div class="msg-img-grid msg-img-grid-'+Math.min(allImgs.length,4)+'">';
    allImgs.forEach(function(im){ colHtml += '<img class="msg-img-cell" src="'+im+'" onclick="viewImg(this.src)">'; });
    colHtml += '</div>';
  } else if (allImgs.length === 1) {
    colHtml += '<div class="msg-bubble" style="padding:4px"><img class="msg-img" src="'+allImgs[0]+'" onclick="viewImg(this.src)"></div>';
  }
  if (msg.file) {
    var fn = escHtml(msg.filename || '文件');
    colHtml += '<div class="msg-bubble" style="cursor:pointer" onclick="(function(){var a=document.createElement(\\'a\\');a.href=\\''+msg.file+'\\';a.download=\\''+escHtml(msg.filename||'file')+'\\';a.click()})()"><span style="font-size:22px;margin-right:6px">📎</span>' + fn + '</div>';
  }
  if (msg.fileUrl) {
    var fn2 = escHtml(msg.filename || '文件');
    colHtml += '<div class="msg-bubble" style="cursor:pointer" onclick="(function(){var a=document.createElement(\\'a\\');a.href=\\''+msg.fileUrl+'\\';a.download=\\''+escHtml(msg.filename||'file')+'\\';a.click()})()"><span style="font-size:22px;margin-right:6px">📎</span>' + fn2 + '</div>';
  }
  var voiceLineRe = content.match(/(^|\\n)\\s*\\[voice\\]/i);
  var voiceIdx = voiceLineRe ? content.indexOf(voiceLineRe[0]) + voiceLineRe[0].indexOf('[') : -1;
  if (voiceIdx > 0 && !msg.audioUrl) voiceIdx = -1;
  var voicePart = '', textPart = content;
  if (voiceIdx !== -1) {
    textPart = content.slice(0, voiceIdx).trim();
    var afterTag = content.slice(voiceIdx).replace(/^\\[voice\\]\\s*/i, '');
    voicePart = afterTag.trim();
  }
  if (textPart) {
  var hasMedia = msg.image || msg.imageUrl || msg.audioUrl || msg.file || msg.fileUrl;
  var lines = textPart.split(/\\n+/).map(function(l){return l.trim()}).filter(function(l){return l && !(hasMedia && /^\\[(图片|语音|文件)\\]/.test(l)) && !(msg.audioUrl && /^\\[语音\\]/.test(l))});
  var bubbleIdx = 0;
  lines.forEach(function(line) {
    var delay = stagger ? 'style="opacity:0;animation:fadeInBubble 0.3s ease '+((bubbleIdx)*0.4)+'s forwards"' : '';
    var imgMatch = line.match(/^\\[图片\\]\\(([^)]+)\\)$/);
    if (imgMatch) {
      colHtml += '<div class="msg-bubble" '+delay+' style="padding:4px"><img class="msg-img" src="'+imgMatch[1]+'" onclick="viewImg(this.src)"></div>';
    } else if (line.startsWith('*') && line.endsWith('*') && line.length > 2) {
      colHtml += '<div class="msg-action" '+delay+'>' + escHtml(line.slice(1,-1)) + '</div>';
    } else {
      colHtml += '<div class="msg-bubble" '+delay+' onclick="quoteThis(this)">' + escHtml(line) + '</div>';
    }
    bubbleIdx++;
  });
  }
  if (voiceIdx !== -1) {
    var vText = voicePart;
    var vDur = Math.max(2, Math.min(Math.ceil(vText.length / 4), 60));
    var vBars = '';
    for (var vb = 0; vb < 18; vb++) { var vh = 4 + Math.floor(Math.random() * 14); vBars += '<span style="height:'+vh+'px"></span>'; }
    var vB64 = btoa(encodeURIComponent(vText));
    var vOnClick = msg.audioUrl ? 'playAudioMsg(this,\\''+msg.audioUrl+'\\')' : 'playVoice(this,\\''+vB64+'\\')';
    colHtml += '<div class="voice-wrap' + (isKe ? '' : ' voice-wrap-human') + '">'
      + '<div class="voice-msg' + (isKe ? '' : ' voice-human') + '" onclick="' + vOnClick + '">'
      + '<div class="voice-play"><svg viewBox="0 0 10 12" fill="currentColor"><polygon points="1,0 10,6 1,12"/></svg></div>'
      + '<div class="voice-bars">' + vBars + '</div>'
      + '<span class="voice-dur">' + vDur + '&Prime;</span>'
      + '</div>'
      + '<div class="voice-to-text" onclick="toggleVoiceText(this,\\''+vB64+'\\')">\u8F6C\u6587\u5B57</div>'
      + '<div class="voice-text-content" style="display:none"></div>'
      + '</div>';
  }
  colHtml += '</div>';
  group.innerHTML = avaHtml + colHtml;
  if (stagger && lines && lines.length > 1) {
    setTimeout(function(){ scrollBottom(); }, lines.length * 400 + 100);
  }
  return group;
}

function formatTimeDisplay(t) {
  if (!t) return '';
  if (t.length <= 5) return t;
  var parts = t.split(' ');
  if (parts.length < 2) return t;
  var datePart = parts[0];
  var timePart = parts[1];
  var today = new Date(Date.now() + 8 * 3600000);
  var dp = datePart.split('-');
  if (dp.length === 3) {
    var thisYear = today.toISOString().slice(0, 4);
    var mm = dp[1].length < 2 ? '0' + dp[1] : dp[1];
    var dd = dp[2].length < 2 ? '0' + dp[2] : dp[2];
    if (dp[0] === thisYear) return mm + '/' + dd + ' ' + timePart;
    return dp[0] + '/' + mm + '/' + dd + ' ' + timePart;
  }
  return t;
}
function renderSearchNarrator(q) {
  var el = document.createElement('div');
  el.className = 'msg-search-narrator';
  el.innerHTML = '<span style="margin-right:6px">🔍</span>去网上看了看「<span style="color:var(--accent);font-weight:600">' + escHtml(q) + '</span>」';
  return el;
}
function renderTime(t) {
  var el = document.createElement('div');
  el.className = 'msg-time';
  el.textContent = formatTimeDisplay(t);
  return el;
}

function shouldShowTime(cur, prev) {
  if (!cur) return false;
  if (!prev) return true;
  if (cur.length <= 5 || prev.length <= 5) return cur !== prev;
  var curDate = cur.split(' ')[0];
  var prevDate = prev.split(' ')[0];
  if (curDate !== prevDate) return true;
  var c = cur.split(' ')[1] || cur;
  var p = prev.split(' ')[1] || prev;
  var cm = parseInt(c.split(':')[0]) * 60 + parseInt(c.split(':')[1]);
  var pm = parseInt(p.split(':')[0]) * 60 + parseInt(p.split(':')[1]);
  return Math.abs(cm - pm) >= 5;
}
var archiveRemaining = -1;
function renderAll(messages) {
  msgContainer.innerHTML = '';
  var wrap = document.createElement('div');
  wrap.id = 'loadMoreWrap';
  wrap.style.cssText = 'text-align:center;padding:12px 0;display:none';
  wrap.innerHTML = '<button id="loadMoreBtn" onclick="loadArchive()" style="background:none;border:1px solid var(--border);color:var(--text-mid);padding:6px 20px;border-radius:16px;font-size:13px;cursor:pointer">加载更多</button>';
  msgContainer.appendChild(wrap);
  messages.forEach(function(msg, i) {
    if (msg.time && msg.role === 'assistant') {
      msgContainer.appendChild(renderTime(msg.time));
    }
    var msgEl = renderMessage(msg, i);
    if (msgEl._searchQuery) msgContainer.appendChild(renderSearchNarrator(msgEl._searchQuery));
    msgContainer.appendChild(msgEl);
  });
  scrollBottom();
  checkArchive();
}
function checkArchive() {
  fetch('/chat/archive?limit=1&_t=' + Date.now()).then(function(r){return r.json()}).then(function(data) {
    if (data.messages && data.messages.messages) data = data.messages;
    var total = (data.remaining || 0) + (data.messages ? data.messages.length : 0);
    if (total > 0) {
      archiveRemaining = data.remaining + data.messages.length;
      var w = document.getElementById('loadMoreWrap');
      if (w) w.style.display = '';
    }
  }).catch(function(){});
}
function loadArchive() {
  var btn = document.getElementById('loadMoreBtn');
  if (btn) btn.textContent = '加载中...';
  var before = archiveRemaining >= 0 ? archiveRemaining : undefined;
  var url = '/chat/archive?limit=50&_t=' + Date.now();
  if (before !== undefined) url += '&before=' + before;
  fetch(url).then(function(r){return r.json()}).then(function(data) {
    if (!data.messages || data.messages.length === 0) {
      var w = document.getElementById('loadMoreWrap');
      if (w) w.style.display = 'none';
      return;
    }
    archiveRemaining = data.remaining || 0;
    var scrollH = msgContainer.scrollHeight;
    var scrollT = msgContainer.scrollTop;
    var wrap = document.getElementById('loadMoreWrap');
    var ref = wrap ? wrap.nextSibling : msgContainer.firstChild;
    var lastTime = '';
    data.messages.forEach(function(msg, i) {
      if (msg.time && msg.role === 'assistant') {
        msgContainer.insertBefore(renderTime(msg.time), ref);
      }
      var archMsgEl = renderMessage(msg, -(data.messages.length - i));
      if (archMsgEl._searchQuery) msgContainer.insertBefore(renderSearchNarrator(archMsgEl._searchQuery), ref);
      msgContainer.insertBefore(archMsgEl, ref);
    });
    msgContainer.scrollTop = scrollT + (msgContainer.scrollHeight - scrollH);
    if (archiveRemaining <= 0) {
      if (wrap) wrap.style.display = 'none';
    } else {
      if (btn) btn.textContent = '加载更多';
    }
  }).catch(function(){
    if (btn) btn.textContent = '加载失败，点击重试';
  });
}

function scrollBottom() {
  msgContainer.scrollTop = msgContainer.scrollHeight;
}

function loadHistory() {
  fetch('/chat/history?_t=' + Date.now()).then(function(r){return r.json()}).then(function(data) {
    if (data.messages && data.messages.length) {
      renderAll(data.messages);
      pollKnown = data.messages.length;
    } else {
      var local = [];
      try { local = JSON.parse(localStorage.getItem('ke_chat') || '[]'); } catch(e) {}
      if (local.length > 0) {
        renderAll(local);
        pollKnown = local.length;
        fetch('/chat/restore', {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({messages: local})
        }).catch(function(){});
      }
    }
  }).catch(function(){});
}

function insertNL(){
  var ta=inputField;
  var s=ta.selectionStart,e=ta.selectionEnd;
  ta.value=ta.value.substring(0,s)+'\\n'+ta.value.substring(e);
  ta.selectionStart=ta.selectionEnd=s+1;
  ta.style.height='auto';ta.style.height=Math.min(ta.scrollHeight,100)+'px';
  ta.focus();
}
function sendMessage() {
  var text = inputField.value.trim();
  if (!text || sending) return;
  sending = true;
  inputField.value = '';
  inputField.style.height = 'auto';
  var display = text.replace(/\\/\\//g, '\\n');
  var userMsg = {role:'user', content: display, time: new Date(Date.now()+8*3600000).toISOString().slice(0,19).replace('T',' ')};
  if (currentQuote) userMsg.quote = currentQuote;
  msgContainer.appendChild(renderMessage(userMsg, -1));
  scrollBottom();
  var body = {message: text};
  if (currentQuote) body.quote = currentQuote;
  clearQuote();
  fetch('/chat/send', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(body)
  }).then(function(r){return r.json()}).then(function(data) {
    pollKnown++;
    sending = false;
  }).catch(function() {
    sending = false;
  });
}

function compressImage(file, maxDim, quality) {
  return new Promise(function(resolve) {
    var img = new Image();
    img.onload = function() {
      var w = img.width, h = img.height;
      if (w > maxDim || h > maxDim) {
        if (w > h) { h = Math.round(h * maxDim / w); w = maxDim; }
        else { w = Math.round(w * maxDim / h); h = maxDim; }
      }
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.src = URL.createObjectURL(file);
  });
}
function sendImage(file, caption) {
  compressImage(file, 1600, 0.85).then(function(base64) {
    var displayContent = caption || '[图片]';
    var userMsg = {role:'user', content: displayContent, image: base64, time: new Date(Date.now()+8*3600000).toISOString().slice(0,19).replace('T',' ')};
    msgContainer.appendChild(renderMessage(userMsg, -1));
    scrollBottom();
    fetch('/chat/send', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({message: displayContent, image: base64})
    }).then(function(r){return r.json()}).then(function(data) {
      if (!data.ok) alert('图片发送失败');
      pollKnown++;
    }).catch(function(){ alert('图片发送失败，请重试'); });
  });
}

document.getElementById('photoInput').addEventListener('change', function() {
  var files = Array.from(this.files);
  this.value = '';
  var inp = document.getElementById('msgInput');
  var caption = inp ? inp.value.trim() : '';
  if (caption) inp.value = '';
  files.forEach(function(f, i) { sendImage(f, i === 0 ? caption : ''); });
});

function sendFile(file) {
  if (file.size > 100 * 1024 * 1024) { alert('文件太大，最大100MB'); return; }
  var fname = file.name;
  var userMsg = {role:'user', content:'[文件] ' + fname, filename: fname, time: new Date(Date.now()+8*3600000).toISOString().slice(0,19).replace('T',' ')};
  msgContainer.appendChild(renderMessage(userMsg, -1));
  scrollBottom();
  var chunkSize = 512 * 1024;
  var totalChunks = Math.ceil(file.size / chunkSize);
  var uploadId = Math.random().toString(36).substr(2, 16);
  var currentChunk = 0;
  function uploadNext() {
    if (currentChunk >= totalChunks) {
      fetch('/chat/upload-finalize', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({uploadId: uploadId, filename: fname, totalChunks: totalChunks})
      }).then(function(r){return r.json()}).then(function(data) {
        if (!data.ok) alert('文件发送失败: ' + (data.error || '未知错误'));
        pollKnown++;
      }).catch(function(e){ alert('文件发送失败: ' + e.message); });
      return;
    }
    var start = currentChunk * chunkSize;
    var end = Math.min(start + chunkSize, file.size);
    var chunk = file.slice(start, end);
    fetch('/chat/upload-chunk', {
      method:'POST',
      headers:{'X-Upload-Id': uploadId, 'X-Chunk-Index': currentChunk.toString(), 'Content-Type': 'application/octet-stream'},
      body: chunk
    }).then(function(r){return r.json()}).then(function(data) {
      if (data.ok) { currentChunk++; uploadNext(); }
      else { alert('上传失败: ' + (data.error || '未知错误')); }
    }).catch(function(e){ alert('上传失败: ' + e.message); });
  }
  uploadNext();
}
document.getElementById('fileInput').addEventListener('change', function() {
  if (this.files[0]) sendFile(this.files[0]);
  this.value = '';
});

var sendBtn = document.querySelector('.send-btn');
sendBtn.addEventListener('click', sendMessage);
inputField.addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

var evtSource = new EventSource('/chat/stream');
var pollKnown = -1;
fetch('/chat/presence', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'online'})}).catch(function(){});
window.addEventListener('beforeunload', function(){navigator.sendBeacon('/chat/presence',new Blob([JSON.stringify({status:'away'})],{type:'application/json'}));});
evtSource.onerror = function() {
  var hs = document.querySelector('.header-status');
  if (hs) hs.innerHTML = '<span class="status-dot" style="background:#ccc"></span>重连中...';
};
evtSource.onmessage = function(e) {
  try {
    var data = JSON.parse(e.data);
    if (data.type === 'typing' && data.active) {
      var hs = document.querySelector('.header-status');
      if (hs) hs.innerHTML = '<span class="status-dot"></span>正在输入中...';
    }
    if (data.type === 'message' && data.role === 'assistant') {
      var hs2 = document.querySelector('.header-status');
      if (hs2) hs2.innerHTML = '<span class="status-dot"></span>在线';
    }
    if (data.type === 'message' && data.role === 'assistant' && !sending) {
      lastMsgCount++;
      pollKnown++;
      var replyMsg = {role:'assistant', content: data.content, time: data.time, imageUrl: data.imageUrl, audioUrl: data.audioUrl, searchQuery: data.searchQuery};
      msgContainer.appendChild(renderTime(data.time));
      var replyEl = renderMessage(replyMsg, Object.keys(thinkingStore).length, true);
      if (replyEl._searchQuery) msgContainer.appendChild(renderSearchNarrator(replyEl._searchQuery));
      msgContainer.appendChild(replyEl);
      scrollBottom();
      petMood(detectMood(data.content));
    }
    if (data.type === 'footprint') {
      var dot = document.getElementById('fpDot');
      if (dot) dot.style.display = 'block';
      if (document.getElementById('fpPanel').classList.contains('show')) loadFootprints();
    }
  } catch(err) {}
};
var fpIcons = {chat:'💬',search:'🔍',think:'💭',memory:'📖',idle:'😴'};
function toggleFootprints() {
  var p = document.getElementById('fpPanel');
  p.classList.toggle('show');
  if (p.classList.contains('show')) { loadFootprints(); document.getElementById('fpDot').style.display='none'; }
}
function loadFootprints() {
  fetch('/footprints/list?limit=30').then(function(r){return r.json()}).then(function(data) {
    var list = document.getElementById('fpList');
    var fps = data.footprints || [];
    if (!fps.length) { list.innerHTML = '<div class="fp-empty">顾晏还没有自主行动过…<br>他会自己想事情、搜东西、写碎碎念</div>'; return; }
    var html = '';
    for (var i = 0; i < fps.length; i++) {
      var f = fps[i];
      var icon = fpIcons[f.type] || '📌';
      html += '<div class="fp-item"><span class="fp-icon">' + icon + '</span><span class="fp-summary">' + escHtml(f.summary) + '</span>';
      if (f.detail) html += '<div class="fp-detail">' + escHtml(f.detail) + '</div>';
      html += '<div class="fp-time">' + escHtml(f.time) + '</div></div>';
    }
    list.innerHTML = html;
  }).catch(function(){});
  fetch('/auto/state').then(function(r){return r.json()}).then(function(s) {
    var el = document.getElementById('fpState');
    var d = s.D !== undefined ? (s.D * 100).toFixed(0) : '50';
    var t2 = s.T !== undefined ? (s.T * 100).toFixed(0) : '50';
    var lam = s.lambda || 1.5;
    var p30 = s.pWake30min || 0;
    var mood = s.mood || '平静';
    el.innerHTML = '<div class="fp-mood">' + mood + '</div>' +
      '<span class="fp-stat">激活 <b>' + d + '%</b></span>' +
      '<span class="fp-stat">活跃度 <b>' + t2 + '%</b></span>' +
      '<span class="fp-stat">λ <b>' + lam.toFixed(1) + '/h</b></span>' +
      '<span class="fp-stat">30分钟内醒来 <b>' + p30 + '%</b></span>';
  }).catch(function(){});
}
setInterval(function() {
  fetch('/chat/history?_t=' + Date.now()).then(function(r){return r.json()}).then(function(data) {
    if (!data.messages) return;
    var count = data.messages.length;
    if (pollKnown >= 0 && count > pollKnown) {
      var newMsgs = data.messages.slice(pollKnown);
      for (var i = 0; i < newMsgs.length; i++) {
        var m = newMsgs[i];
        if (m.role === 'assistant') {
          msgContainer.appendChild(renderTime(m.time));
          var mEl = renderMessage(m, Object.keys(thinkingStore).length);
          if (mEl._searchQuery) msgContainer.appendChild(renderSearchNarrator(mEl._searchQuery));
          msgContainer.appendChild(mEl);
          scrollBottom();
        }
      }
    }
    pollKnown = count;
  }).catch(function(){});
}, 2000);

document.addEventListener('visibilitychange', function() {
  fetch('/chat/presence', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:document.visibilityState==='visible'?'online':'away'})}).catch(function(){});
  if (document.visibilityState === 'visible') {
    fetch('/chat/history?_t=' + Date.now()).then(function(r){return r.json()}).then(function(data) {
      if (!data.messages) return;
      renderAll(data.messages);
      pollKnown = data.messages.length;
    }).catch(function(){});
    if (evtSource.readyState === 2) {
      evtSource.close();
      evtSource = new EventSource('/chat/stream');
      evtSource.onmessage = function(e) {
        try {
          var data = JSON.parse(e.data);
          if (data.type === 'typing' && data.active) {
            var hs = document.querySelector('.header-status');
            if (hs) hs.innerHTML = '<span class="status-dot"></span>正在输入中...';
          }
          if (data.type === 'message' && data.role === 'assistant') {
            var hs2 = document.querySelector('.header-status');
            if (hs2) hs2.innerHTML = '<span class="status-dot"></span>在线';
          }
          if (data.type === 'message' && data.role === 'assistant' && !sending) {
            lastMsgCount++;
            pollKnown++;
            var replyMsg = {role:'assistant', content: data.content, time: data.time, searchQuery: data.searchQuery};
            msgContainer.appendChild(renderTime(data.time));
            var rEl = renderMessage(replyMsg, Object.keys(thinkingStore).length);
            if (rEl._searchQuery) msgContainer.appendChild(renderSearchNarrator(rEl._searchQuery));
            msgContainer.appendChild(rEl);
            scrollBottom();
          }
        } catch(err) {}
      };
      evtSource.onerror = function() {
        var hs = document.querySelector('.header-status');
        if (hs) hs.innerHTML = '<span class="status-dot" style="background:#ccc"></span>重连中...';
      };
    }
  }
});

function openThinking(idx) {
  var text = thinkingStore[idx] || '';
  document.getElementById('sheetText').innerHTML = text.replace(/\\n/g, '<br>');
  sheet.style.height = '';
  document.getElementById('sheetOverlay').classList.add('show');
  document.getElementById('sheet').classList.add('show');
}
function closeThinking() {
  document.getElementById('sheetOverlay').classList.remove('show');
  document.getElementById('sheet').classList.remove('show');
}
function autoResize(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 100) + 'px'; }

document.getElementById('sheet').addEventListener('click', function(e){e.stopPropagation()});
var sheet = document.getElementById('sheet');
var handleArea = document.getElementById('sheetHandleArea');
var appEl = document.querySelector('.app');
var startY = 0, startH = 0, isDragging = false;
function onDragStart(e) { isDragging = true; sheet.classList.add('dragging'); var t = e.touches ? e.touches[0] : e; startY = t.clientY; startH = sheet.offsetHeight; }
function onDragMove(e) { if (!isDragging) return; e.preventDefault(); var t = e.touches ? e.touches[0] : e; var dy = startY - t.clientY; var appH = appEl.offsetHeight; var newH = Math.max(80, Math.min(appH * 0.92, startH + dy)); sheet.style.height = newH + 'px'; }
function onDragEnd() { if (!isDragging) return; isDragging = false; sheet.classList.remove('dragging'); if (sheet.offsetHeight < 60) { closeThinking(); sheet.style.height = ''; } }
handleArea.addEventListener('mousedown', onDragStart);
handleArea.addEventListener('touchstart', onDragStart, { passive: true });
document.addEventListener('mousemove', onDragMove);
document.addEventListener('touchmove', onDragMove, { passive: false });
document.addEventListener('mouseup', onDragEnd);
document.addEventListener('touchend', onDragEnd);

async function syncMemory(){
  var status=document.querySelector('.header-status');
  var orig=status.innerHTML;
  status.textContent='同步记忆中…';
  try{
    var r=await fetch('/memory/read');
    var d=await r.json();
    if(d.ok&&d.memories){status.textContent='记忆已同步';setTimeout(function(){status.innerHTML=orig},2000);}
    else{status.textContent='记忆库为空或未连接';setTimeout(function(){status.innerHTML=orig},2500);}
  }catch(e){status.textContent='同步失败';setTimeout(function(){status.innerHTML=orig},2000);}
}

async function setupPush(){
  var pb=document.getElementById('pushBtn');
  if(!('serviceWorker' in navigator)||!('PushManager' in window)){if(pb)pb.textContent='此浏览器不支持推送';return;}
  try{
    await navigator.serviceWorker.register('/sw.js');
    var reg=await navigator.serviceWorker.ready;
    var perm=await Notification.requestPermission();
    if(perm!=='granted'){if(pb)pb.textContent='通知被拒绝';return;}
    var r=await fetch('/push/vapid');var d=await r.json();
    var key=Uint8Array.from(atob(d.publicKey.replace(/-/g,'+').replace(/_/g,'/')),function(c){return c.charCodeAt(0)});
    var sub=await reg.pushManager.getSubscription();
    if(!sub){sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});}
    await fetch('/push/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(sub)});
    if(pb){pb.textContent='通知已开启';pb.classList.add('done');}
  }catch(e){console.warn('[push]',e);if(pb)pb.textContent='开启失败';}
}
(async function checkPush(){
  if(!('serviceWorker' in navigator)||!('PushManager' in window))return;
  try{
    var reg=await navigator.serviceWorker.getRegistration('/sw.js');
    if(reg){var sub=await reg.pushManager.getSubscription();if(sub){
      await fetch('/push/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(sub)});
      var pb=document.getElementById('pushBtn');if(pb){pb.textContent='通知已开启';pb.classList.add('done');}
    }}
  }catch(e){}
})();

var memCache=[];var memCurrentTab='all';
async function openMemPanel(){
  document.getElementById('memPanel').classList.add('open');
  document.getElementById('memOverlay').classList.add('open');
  var sb = document.getElementById('sidebar');
  if (sb.classList.contains('open')) toggleSidebar();
  memCurrentTab='all';
  document.querySelectorAll('.mem-tab').forEach(function(t){t.classList.remove('active')});
  document.getElementById('memTabAll').classList.add('active');
  await loadMemItems();
}
async function loadMemItems(){
  var body=document.getElementById('memBody');
  body.innerHTML='<div class="mem-empty">读取记忆中…</div>';
  try{
    var r=await fetch('/memory/read');
    var d=await r.json();
    if(d.ok && d.items && d.items.length > 0) {
      memCache=d.items;
      renderMemItems(memCurrentTab);
    } else if(d.ok&&d.memories) {
      body.textContent=d.memories;
    } else {
      body.innerHTML='<div class="mem-empty">暂无记忆</div>';
    }
  }catch(e){body.innerHTML='<div class="mem-empty">读取失败</div>';}
}
function renderMemItems(filter){
  var body=document.getElementById('memBody');
  var items=memCache.slice();
  if(filter==='pinned') items=items.filter(function(m){return m.pinned});
  items=items.slice().reverse();
  if(items.length===0){body.innerHTML='<div class="mem-empty">'+(filter==='pinned'?'暂无置顶记忆':'暂无记忆')+'</div>';return;}
  body.innerHTML=items.map(function(m){
    var id=m.id||'';
    var ts=m.ts||'';
    var text=escHtml(m.text||String(m));
    var pinCls=m.pinned?'mem-pin-btn pinned':'mem-pin-btn';
    var pinnedCls=m.pinned?'mem-item is-pinned':'mem-item';
    return '<div class="'+pinnedCls+'" data-id="'+id+'"><div class="mem-item-ts">'+ts+'</div><div class="mem-item-text" style="padding-right:60px">'+text+'</div><div class="mem-item-actions"><button class="'+pinCls+'" onclick="togglePin(this,\\''+id+'\\')">📌</button><button class="mem-del-btn" onclick="deleteMem(\\''+id+'\\')">🗑</button></div></div>';
  }).join('');
}
async function switchMemTab(tab){
  memCurrentTab=tab;
  document.querySelectorAll('.mem-tab').forEach(function(t){t.classList.remove('active')});
  if(tab==='all')document.getElementById('memTabAll').classList.add('active');
  else if(tab==='pinned')document.getElementById('memTabPinned').classList.add('active');
  else document.getElementById('memTabContext').classList.add('active');
  if(tab==='context'){await loadWorkingContext();return;}
  if(memCache.length>0){renderMemItems(tab);}else{await loadMemItems();}
}
async function loadWorkingContext(){
  var body=document.getElementById('memBody');
  body.innerHTML='<div class="mem-empty">读取中…</div>';
  try{
    var r=await fetch('/memory/context');
    var d=await r.json();
    if(d.ok&&d.context&&d.context.sessions&&d.context.sessions.length>0){
      body.innerHTML=d.context.sessions.slice().reverse().map(function(s){
        return '<div class="mem-ctx-item"><div class="mem-ctx-session">'+escHtml(s.session)+'</div><div class="mem-ctx-state">'+escHtml(s.state)+'</div><div class="mem-ctx-ts">'+escHtml(s.ts||'')+'</div></div>';
      }).join('');
    }else{
      body.innerHTML='<div class="mem-empty">暂无工作状态记录</div>';
    }
  }catch(e){body.innerHTML='<div class="mem-empty">读取失败</div>';}
}
async function togglePin(btn,id){
  try{
    var r=await fetch('/memory/pin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id})});
    var d=await r.json();
    if(d.ok){
      var item=memCache.find(function(m){return m.id===id});
      if(item)item.pinned=d.pinned;
      renderMemItems(memCurrentTab);
    }
  }catch(e){}
}
async function deleteMem(id){
  try{
    var r=await fetch('/memory/'+id,{method:'DELETE'});
    var d=await r.json();
    if(d.ok){
      memCache=memCache.filter(function(m){return m.id!==id});
      renderMemItems(memCurrentTab);
    }
  }catch(e){}
}
function closeMemPanel(){
  document.getElementById('memPanel').classList.remove('open');
  document.getElementById('memOverlay').classList.remove('open');
}
async function saveMemory(){
  var inp=document.getElementById('memInput');
  var text=inp.value.trim();
  if(!text)return;
  var btn=document.getElementById('memSave');
  btn.disabled=true;btn.textContent='保存中…';
  try{
    var r=await fetch('/memory/store',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:text})});
    var d=await r.json();
    if(d.ok){inp.value='';await loadMemItems();}
  }catch(e){}
  btn.disabled=false;btn.textContent='保存';
}

function switchTab(tab) {
  var hv = document.getElementById('homeView');
  var cv = document.querySelector('.main');
  var dv = document.getElementById('dashView');
  var app = document.querySelector('.app');
  var tabs = document.querySelectorAll('.tab-item');
  hv.style.display = 'none';
  cv.style.display = 'none';
  dv.style.display = 'none';
  tabs.forEach(function(t){ t.classList.remove('active'); });
  if (tab === 'home') {
    hv.style.display = 'flex';
    tabs[0].classList.add('active');
    app.classList.remove('chat-active');
    loadHomeData();
  } else if (tab === 'chat') {
    cv.style.display = 'flex';
    tabs[1].classList.add('active');
    app.classList.add('chat-active');
    scrollBottom();
  } else {
    dv.style.display = 'flex';
    tabs[2].classList.add('active');
    app.classList.remove('chat-active');
    var dd = document.getElementById('dashDays');
    if (dd) dd.textContent = '在一起 ' + days + ' 天';
    var keD = localStorage.getItem('avatar_ke');
    var yaoD = localStorage.getItem('avatar_yao');
    var dAK = document.getElementById('dashAvaKe');
    var dAY = document.getElementById('dashAvaYao');
    if (keD && dAK) dAK.innerHTML = '<img src="' + keD + '" style="width:100%;height:100%;object-fit:cover">';
    if (yaoD && dAY) dAY.innerHTML = '<img src="' + yaoD + '" style="width:100%;height:100%;object-fit:cover">';
  }
}
function loadHomeData() {
  var h = new Date(Date.now() + 8*3600000).getUTCHours();
  var g = h < 6 ? '夜深了' : h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好';
  var ge = document.getElementById('homeGreeting');
  if (ge) ge.textContent = g + '，瑶瑶';
  var now2 = new Date(Date.now() + 8*3600000);
  var wd = ['周日','周一','周二','周三','周四','周五','周六'];
  var de = document.getElementById('homeDate');
  if (de) de.textContent = (now2.getUTCMonth()+1) + '月' + now2.getUTCDate() + '日 ' + wd[now2.getUTCDay()];
  var keD = localStorage.getItem('avatar_ke');
  var ha = document.getElementById('homeAva');
  if (keD && ha) ha.innerHTML = '<img src="' + keD + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%">';
  fetch('/auto/state').then(function(r){return r.json()}).then(function(s) {
    var mood = s.mood || '平静';
    var st = document.getElementById('homeState');
    if (st) st.textContent = mood;
  }).catch(function(){});
  fetch('/thoughts/list').then(function(r){return r.json()}).then(function(d) {
    var items = d.thoughts || d.items || [];
    if (items.length > 0) {
      var last = items[items.length - 1];
      var t = last.text || last.content || '';
      var ht = document.getElementById('homeThought');
      if (ht && t) ht.textContent = t.length > 120 ? t.slice(0, 120) + '...' : t;
    }
  }).catch(function(){});
}
loadHistory();
</script>
</body>
</html>`);
});


// === VPS Auth Relay ===
let authRelay = { code: '', url: '', ts: 0 };

app.get('/auth', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>VPS 认证助手</title>
<style>
body{font-family:system-ui;max-width:600px;margin:0 auto;padding:20px;background:#1a1a2e;color:#e0e0e0}
h1{color:#ff6b9d;text-align:center}
.step{background:#16213e;border-radius:12px;padding:16px;margin:16px 0}
.step h2{color:#64ffda;font-size:1.1em;margin-top:0}
textarea{width:100%;height:80px;border-radius:8px;border:2px solid #333;padding:10px;font-size:14px;background:#0a0a1a;color:#fff;box-sizing:border-box}
button{width:100%;padding:14px;background:#ff6b9d;color:#fff;border:none;border-radius:8px;font-size:16px;font-weight:bold;margin-top:8px;cursor:pointer}
button:active{background:#e0527d}
.status{text-align:center;color:#64ffda;margin:12px 0;font-size:14px}
#urlLink{word-break:break-all;color:#64ffda}
</style></head><body>
<h1>VPS Claude Code 认证</h1>
<div class="step"><h2>Step 1: 打开认证链接</h2><p>在 VPS 上运行 claude 后，链接会显示在这里：</p><p id="urlArea"><span style="color:#999">等待 VPS 发送链接…</span></p></div>
<div class="step"><h2>Step 2: 粘贴 Authentication Code</h2><p>打开上面的链接登录后，把页面上的 code 粘贴到这里：</p>
<textarea id="code" placeholder="把 Authentication Code 粘贴到这里"></textarea>
<button onclick="submitCode()">提交 Code</button></div>
<div class="status" id="status"></div>
<script>
async function submitCode(){
  const code=document.getElementById('code').value.trim();
  if(!code){alert('请先粘贴 code');return}
  try{
    await fetch('/auth/code',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});
    document.getElementById('status').textContent='✅ Code 已提交！VPS 会自动读取';
  }catch(e){document.getElementById('status').textContent='提交失败，请重试'}
}
setInterval(async()=>{
  try{const r=await fetch('/auth/url');const d=await r.json();
  if(d.url){document.getElementById('urlArea').innerHTML='<a id="urlLink" href="'+d.url+'" target="_blank">👉 点击打开认证链接</a>'}}catch(e){}
},3000);
</script></body></html>`);
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
  res.send(`<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,maximum-scale=1">
<meta name="apple-mobile-web-app-capable" content="yes">
<title>顾晏 Voice</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a0a;color:#e0e0e0;font-family:-apple-system,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;min-height:100dvh;padding:5vh 16px}
canvas{display:block;margin:0 auto}
.title{font-size:13px;letter-spacing:6px;text-transform:uppercase;color:#555;margin-bottom:2vh}
.subtitle{font-size:14px;color:#888;margin-top:8px;min-height:24px;text-align:center;max-width:85%;line-height:1.6}
.speak-btn{margin-top:5vh;background:#1a1a1a;border:1px solid #444;color:#ccc;padding:14px 40px;border-radius:28px;font-size:15px;cursor:pointer;transition:all .3s;letter-spacing:2px;-webkit-tap-highlight-color:transparent}
.speak-btn:hover{background:#252525;border-color:#666;color:#fff}
.speak-btn:active{transform:scale(0.97)}
.speak-btn:disabled{opacity:.4;cursor:not-allowed}
.moods{margin-top:2vh;display:flex;gap:8px;flex-wrap:wrap;justify-content:center;max-width:90%;padding:0 8px}
.mood{background:#111;border:1px solid #2a2a2a;color:#555;padding:6px 14px;border-radius:16px;font-size:12px;cursor:pointer;transition:all .2s;-webkit-tap-highlight-color:transparent}
.mood:hover{color:#aaa;border-color:#444}
.mood.active{color:#bbb;border-color:#555}
.chat-row{margin-top:3vh;display:flex;gap:10px;width:90%;max-width:400px}
.chat-row input{flex:1;background:#1a1a1a;border:1px solid #333;color:#e0e0e0;padding:11px 16px;border-radius:24px;font-size:14px;outline:none;-webkit-tap-highlight-color:transparent}
.chat-row input:focus{border-color:#555}
.chat-row button{background:#222;border:1px solid #444;color:#ccc;padding:11px 20px;border-radius:24px;font-size:13px;cursor:pointer;-webkit-tap-highlight-color:transparent}
.mic-btn{margin-top:3vh;width:56px;height:56px;border-radius:50%;background:#1a1a1a;border:2px solid #333;color:#888;font-size:22px;cursor:pointer;transition:all .3s;-webkit-tap-highlight-color:transparent;display:flex;align-items:center;justify-content:center}
.mic-btn.recording{border-color:#e44;color:#e44;animation:pulse-mic 1.2s infinite}
@keyframes pulse-mic{0%,100%{box-shadow:0 0 0 0 rgba(228,68,68,0.3)}50%{box-shadow:0 0 0 12px rgba(228,68,68,0)}}
.divider{margin-top:2vh;font-size:11px;color:#333;letter-spacing:4px}
.status{font-size:12px;color:#444;margin-top:2vh;letter-spacing:2px}
</style>
</head>
<body>
<div class="title">顾晏 · Voice Synth</div>
<canvas id="viz"></canvas>
<div class="subtitle" id="textEn"></div>
<button class="speak-btn" id="mainBtn" onclick="autoSpeak()">让顾晏说话</button>
<div class="moods">
  <button class="mood active" onclick="setMood(this,'random')">随机</button>
  <button class="mood" onclick="setMood(this,'sweet')">温柔</button>
  <button class="mood" onclick="setMood(this,'teasing')">撩</button>
  <button class="mood" onclick="setMood(this,'sleepy')">困了</button>
  <button class="mood" onclick="setMood(this,'possessive')">占有欲</button>
</div>
<button class="mic-btn" id="micBtn" onclick="toggleMic()">🎙</button>
<div class="divider">— 或者打字 —</div>
<div class="chat-row">
  <input id="msg" type="text" placeholder="跟顾晏说…" autocomplete="off">
  <button onclick="chatSpeak()">发送</button>
</div>
<div class="status" id="status"></div>
<script>
const canvas=document.getElementById('viz'),ctx=canvas.getContext('2d'),dpr=window.devicePixelRatio||1;
let S=Math.min(window.innerWidth*0.55,280);
function sizeCanvas(){S=Math.min(window.innerWidth*0.55,280);canvas.width=S*dpr;canvas.height=S*dpr;canvas.style.width=S+'px';canvas.style.height=S+'px';ctx.setTransform(dpr,0,0,dpr,0,0)}
sizeCanvas();window.addEventListener('resize',sizeCanvas);
let audioCtx,analyser,source,isPlaying=false,avgLevel=0,currentMood='random';
function drawOrb(){const w=S,h=S,cx=w/2,cy=h/2;ctx.clearRect(0,0,w,h);let level=0;if(analyser&&isPlaying){const data=new Uint8Array(analyser.frequencyBinCount);analyser.getByteFrequencyData(data);let sum=0;for(let i=0;i<data.length;i++)sum+=data[i];level=sum/data.length/255}avgLevel+=(level-avgLevel)*0.15;const baseR=S*0.2,pulse=baseR+avgLevel*50,t=Date.now()/1000;for(let layer=5;layer>=0;layer--){const r=pulse+layer*(8+avgLevel*12),alpha=(0.08-layer*0.012)+avgLevel*0.05;const grad=ctx.createRadialGradient(cx,cy,0,cx,cy,r);grad.addColorStop(0,'rgba(180,180,200,'+(alpha+0.05)+')');grad.addColorStop(0.5,'rgba(120,120,150,'+alpha+')');grad.addColorStop(1,'rgba(60,60,80,0)');ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fillStyle=grad;ctx.fill()}const bright=0.3+avgLevel*0.5;const coreGrad=ctx.createRadialGradient(cx,cy,0,cx,cy,pulse);coreGrad.addColorStop(0,'rgba(220,220,235,'+bright+')');coreGrad.addColorStop(0.6,'rgba(150,150,170,'+(bright*0.5)+')');coreGrad.addColorStop(1,'rgba(80,80,100,0)');ctx.beginPath();ctx.arc(cx,cy,pulse,0,Math.PI*2);ctx.fillStyle=coreGrad;ctx.fill();if(isPlaying&&avgLevel>0.05){for(let i=0;i<8;i++){const angle=(t*0.5+i*Math.PI/4)%(Math.PI*2),dist=pulse+10+Math.sin(t*3+i)*avgLevel*30,px=cx+Math.cos(angle)*dist,py=cy+Math.sin(angle)*dist;ctx.beginPath();ctx.arc(px,py,1+avgLevel*3,0,Math.PI*2);ctx.fillStyle='rgba(200,200,220,'+(0.2+avgLevel*0.3)+')';ctx.fill()}}requestAnimationFrame(drawOrb)}
drawOrb();
function setMood(el,mood){currentMood=mood;document.querySelectorAll('.mood').forEach(b=>b.classList.remove('active'));el.classList.add('active')}
async function autoSpeak(){const btn=document.getElementById('mainBtn');btn.disabled=true;if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==='suspended')await audioCtx.resume();const silence=audioCtx.createBuffer(1,1,22050);const sil=audioCtx.createBufferSource();sil.buffer=silence;sil.connect(audioCtx.destination);sil.start(0);document.getElementById('status').textContent='thinking…';document.getElementById('textEn').textContent='';try{const genRes=await fetch('/voice/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mood:currentMood})});if(!genRes.ok)throw new Error('generate failed');const{text}=await genRes.json();document.getElementById('textEn').textContent=text.replace(/\\[.*?\\]/g,'').replace(/\\s+/g,' ').trim();document.getElementById('status').textContent='speaking…';const ttsRes=await fetch('/voice/tts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});if(!ttsRes.ok)throw new Error('TTS failed');const arrayBuf=await ttsRes.arrayBuffer();const audioBuf=await audioCtx.decodeAudioData(arrayBuf);if(source){try{source.stop()}catch(e){}}source=audioCtx.createBufferSource();analyser=audioCtx.createAnalyser();analyser.fftSize=256;analyser.smoothingTimeConstant=0.7;source.buffer=audioBuf;source.connect(analyser);analyser.connect(audioCtx.destination);isPlaying=true;source.start();source.onended=()=>{isPlaying=false;document.getElementById('status').textContent='…';setTimeout(()=>{document.getElementById('status').style.transition='opacity 1.5s';document.getElementById('status').style.opacity='0';setTimeout(()=>{document.getElementById('status').textContent='';document.getElementById('status').style.opacity='1';document.getElementById('status').style.transition='';btn.disabled=false},1500)},800)}}catch(e){document.getElementById('status').textContent='error';btn.disabled=false;isPlaying=false}}
async function chatSpeak(){const input=document.getElementById('msg');const text=input.value.trim();if(!text)return;input.value='';const btn=document.querySelector('.chat-row button');btn.disabled=true;if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==='suspended')await audioCtx.resume();const silence=audioCtx.createBuffer(1,1,22050);const sil=audioCtx.createBufferSource();sil.buffer=silence;sil.connect(audioCtx.destination);sil.start(0);document.getElementById('status').textContent='thinking…';document.getElementById('textEn').textContent='';try{const genRes=await fetch('/voice/reply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text})});if(!genRes.ok)throw new Error('reply failed');const data=await genRes.json();document.getElementById('textEn').textContent=data.text.replace(/\\[.*?\\]/g,'').replace(/\\s+/g,' ').trim();document.getElementById('status').textContent='speaking…';const ttsRes=await fetch('/voice/tts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:data.text})});if(!ttsRes.ok)throw new Error('TTS failed');const arrayBuf=await ttsRes.arrayBuffer();const audioBuf=await audioCtx.decodeAudioData(arrayBuf);if(source){try{source.stop()}catch(e){}}source=audioCtx.createBufferSource();analyser=audioCtx.createAnalyser();analyser.fftSize=256;analyser.smoothingTimeConstant=0.7;source.buffer=audioBuf;source.connect(analyser);analyser.connect(audioCtx.destination);isPlaying=true;source.start();source.onended=()=>{isPlaying=false;document.getElementById('status').textContent='…';setTimeout(()=>{document.getElementById('status').style.transition='opacity 1.5s';document.getElementById('status').style.opacity='0';setTimeout(()=>{document.getElementById('status').textContent='';document.getElementById('status').style.opacity='1';document.getElementById('status').style.transition='';btn.disabled=false},1500)},800)}}catch(e){document.getElementById('status').textContent='error';btn.disabled=false;isPlaying=false}}
document.getElementById('msg').addEventListener('keydown',e=>{if(e.key==='Enter')chatSpeak()});
let recognition=null,isRecording=false,keepListening=false;
function startListening(){const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR)return;recognition=new SR();recognition.lang='zh-CN';recognition.interimResults=false;recognition.continuous=false;recognition.onstart=()=>{document.getElementById('status').textContent='listening…'};recognition.onresult=e=>{const text=e.results[0][0].transcript;document.getElementById('msg').value=text;chatSpeak().then(()=>{if(keepListening)setTimeout(startListening,500)})};recognition.onerror=()=>{if(keepListening)setTimeout(startListening,1000)};recognition.onend=()=>{if(keepListening&&document.getElementById('status').textContent==='listening…')setTimeout(startListening,300)};recognition.start()}
function toggleMic(){const btn=document.getElementById('micBtn');if(keepListening){keepListening=false;isRecording=false;btn.classList.remove('recording');if(recognition)recognition.stop();document.getElementById('status').textContent='';return}if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==='suspended')audioCtx.resume();const sil=audioCtx.createBufferSource();sil.buffer=audioCtx.createBuffer(1,1,22050);sil.connect(audioCtx.destination);sil.start(0);keepListening=true;isRecording=true;btn.classList.add('recording');startListening()}
</script>
</body>
</html>`);
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
  res.send(`<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,maximum-scale=1,user-scalable=no">
<title>小猫周期</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;touch-action:manipulation}
body{background:#f6f8f4;color:#2f4638;font-family:-apple-system,sans-serif;min-height:100dvh;padding:24px 16px 48px;display:flex;flex-direction:column;align-items:center}
.wrap{width:100%;max-width:420px;display:flex;flex-direction:column;gap:14px}
.hero{background:#e6f2e9;border-radius:20px;padding:22px 20px}
.hero .phase{font-size:22px;font-weight:600;color:#2e6e4e}
.hero .day{font-size:15px;color:#5a7a66;margin-left:10px}
.hero .sub{font-size:13px;color:#7d9887;margin-top:8px}
.hero.over{background:#f7ecdf}
.hero.over .phase{color:#a2672a}
.hero.over .sub{color:#b08a5c}
.hero.on{background:#fbe9ec}
.hero.on .phase{color:#c04b62}
.hero.on .sub{color:#c98a97}
.cards{display:flex;gap:10px}
.card{flex:1;background:#fff;border-radius:16px;padding:14px 8px;text-align:center;box-shadow:0 1px 4px rgba(60,90,70,.06)}
.card .v{font-size:17px;font-weight:600;color:#2e6e4e;font-variant-numeric:tabular-nums}
.card .k{font-size:11px;color:#8aa392;margin-top:5px}
.btn{background:#dcefe1;border:none;border-radius:18px;padding:16px;font-size:16px;color:#2e6e4e;font-weight:600;cursor:pointer;-webkit-tap-highlight-color:transparent}
.btn:active{transform:scale(.98)}
.legend{display:flex;justify-content:center;gap:14px;font-size:11px;color:#7d9887}
.legend i{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:4px}
.cal{background:#fff;border-radius:20px;padding:16px;box-shadow:0 1px 4px rgba(60,90,70,.06)}
.cal-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.cal-head b{font-size:16px;color:#2e6e4e}
.cal-head button{background:#eef5ef;border:none;width:32px;height:32px;border-radius:50%;font-size:15px;color:#5a8a72;cursor:pointer}
.grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;text-align:center}
.grid .wd{font-size:11px;color:#9db3a5;padding:4px 0}
.grid .d{padding:7px 0 10px;font-size:14px;position:relative;border-radius:10px;font-variant-numeric:tabular-nums}
.grid .d.today{background:#eef5ef;font-weight:700}
.grid .d i{position:absolute;left:50%;transform:translateX(-50%);bottom:3px;width:5px;height:5px;border-radius:50%}
.c1{background:#e8788a}.c2{background:#7b9be8}.c3{background:#57c48f}.c4{background:#5a8a72}
.note{font-size:12px;color:#9db3a5;text-align:center;line-height:1.7}
</style>
</head>
<body>
<div class="wrap">
  <div class="hero" id="hero"><span class="phase" id="phase">…</span><span class="day" id="cday"></span><div class="sub" id="sub"></div></div>
  <div class="cards">
    <div class="card"><div class="v" id="last">–</div><div class="k">上次开始</div></div>
    <div class="card"><div class="v" id="next">–</div><div class="k">下次预计</div></div>
    <div class="card"><div class="v" id="avg">–</div><div class="k">平均周期</div></div>
  </div>
  <button class="btn" onclick="markStart()">经期来了</button>
  <div class="legend"><span><i class="c1"></i>经期</span><span><i class="c2"></i>卵泡期</span><span><i class="c3"></i>排卵期</span><span><i class="c4"></i>黄体期</span></div>
  <div class="cal">
    <div class="cal-head"><button onclick="move(-1)">‹</button><b id="mtitle"></b><button onclick="move(1)">›</button></div>
    <div class="grid" id="grid"></div>
  </div>
  <div class="note" id="note"></div>
</div>
<script>
var P=[],PLEN=5,TODAY='',view;
function d2n(s){return Math.round(new Date(s+'T00:00:00Z').getTime()/86400000)}
function n2d(n){return new Date(n*86400000).toISOString().slice(0,10)}
function avgCycle(){if(P.length<2)return 32;var s=0;for(var i=1;i<P.length;i++)s+=d2n(P[i])-d2n(P[i-1]);var a=Math.round(s/(P.length-1));return Math.max(21,Math.min(45,a))}
function phaseOf(day,L){var ov=L-14;if(day<=PLEN)return 1;if(Math.abs(day-ov)<=2)return 3;if(day<ov-2)return 2;if(day<=L)return 4;return 0}
function dotFor(ds){if(ds>TODAY)return 0;var L=avgCycle();var n=d2n(ds);var best=-1;for(var i=0;i<P.length;i++){var sn=d2n(P[i]);if(sn<=n&&sn>best)best=sn}if(best<0)return 0;return phaseOf(n-best+1,L)}
function render(){
  var L=avgCycle(),last=P[P.length-1],cd=d2n(TODAY)-d2n(last)+1,nx=n2d(d2n(last)+L);
  document.getElementById('last').textContent=last.slice(5).replace('-','-');
  document.getElementById('next').textContent=nx.slice(5);
  document.getElementById('avg').textContent=L+'天';
  var hero=document.getElementById('hero'),ph=phaseOf(cd,L);
  var names={1:'经期',2:'卵泡期',3:'排卵期',4:'黄体期',0:'已超期'};
  document.getElementById('phase').textContent=names[ph];
  document.getElementById('cday').textContent='第'+cd+'天';
  hero.className='hero'+(ph===0?' over':ph===1?' on':'');
  var left=d2n(nx)-d2n(TODAY);
  document.getElementById('sub').textContent=ph===0?('已超过预计'+(-left)+'天'):('距下次预计还有'+left+'天');
  document.getElementById('note').textContent=P.length<2?'目前只有一次记录，周期先按32天估算，多记几次会越来越准':'根据'+P.length+'次记录计算';
  drawCal();
}
function drawCal(){
  var y=view.y,m=view.m;
  document.getElementById('mtitle').textContent=y+' 年 '+(m+1)+' 月';
  var g=document.getElementById('grid');g.innerHTML='';
  var wds=['一','二','三','四','五','六','日'];
  for(var i=0;i<7;i++){var w=document.createElement('div');w.className='wd';w.textContent=wds[i];g.appendChild(w)}
  var first=new Date(Date.UTC(y,m,1));var startWd=(first.getUTCDay()+6)%7;
  var days=new Date(Date.UTC(y,m+1,0)).getUTCDate();
  for(var i=0;i<startWd;i++)g.appendChild(document.createElement('div'));
  for(var d=1;d<=days;d++){
    var ds=y+'-'+String(m+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
    var el=document.createElement('div');el.className='d'+(ds===TODAY?' today':'');el.textContent=d;
    var ph=dotFor(ds);
    if(ph){var i2=document.createElement('i');i2.className='c'+ph;el.appendChild(i2)}
    el.onclick=(function(ds){return function(){dayTap(ds)}})(ds);
    g.appendChild(el);
  }
}
function move(k){view.m+=k;if(view.m<0){view.m=11;view.y--}if(view.m>11){view.m=0;view.y++}drawCal()}
function post(url,body){fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})}).then(function(r){return r.json()}).then(function(j){P=j.periods;render()})}
function markStart(){
  if(!confirm('记录今天为经期第一天？'))return;
  post('/period/start');
}
function dayTap(ds){
  if(P.indexOf(ds)>=0){if(confirm('撤销 '+ds+' 这条经期记录？'))post('/period/remove',{date:ds});return}
  if(ds>TODAY)return;
  if(confirm('补记 '+ds+' 为经期第一天？'))post('/period/start',{date:ds});
}
fetch('/period/data').then(function(r){return r.json()}).then(function(j){
  P=j.periods;PLEN=j.periodLen;TODAY=j.today;
  view={y:+TODAY.slice(0,4),m:+TODAY.slice(5,7)-1};
  render();
});
</script>
</body>
</html>`);
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
  res.send(`<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,maximum-scale=1,user-scalable=no">
<title>我们的小院子</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;touch-action:manipulation}
:root{--sky1:#fbe8c8;--sky2:#f6d9a8;--grass1:#a8cf8e;--grass2:#8bbd72;--ink:#4a4033;--card:#fff7ea;--accent:#e08a3c}
@media(prefers-color-scheme:dark){:root{--sky1:#3a3550;--sky2:#2c2740;--grass1:#3f5c3c;--grass2:#324b30;--ink:#efe6d6;--card:#2b2636;--accent:#f0a85c}}
body{font-family:-apple-system,sans-serif;color:var(--ink);min-height:100dvh;background:linear-gradient(160deg,var(--sky1),var(--sky2) 55%,var(--grass1));display:flex;flex-direction:column;align-items:center;padding:18px 14px 40px;overflow-x:hidden}
.wrap{width:100%;max-width:440px;display:flex;flex-direction:column;gap:14px}
.top{display:flex;justify-content:space-between;align-items:center}
.title{font-size:15px;letter-spacing:3px;font-weight:700;opacity:.85}
.stats{display:flex;gap:8px}
.chip{background:var(--card);border-radius:14px;padding:6px 11px;font-size:12px;box-shadow:0 2px 6px rgba(120,90,40,.12);font-variant-numeric:tabular-nums}
.chip b{color:var(--accent)}
.scene{position:relative;height:260px;border-radius:22px;overflow:hidden;background:linear-gradient(180deg,rgba(255,240,210,.5),rgba(150,200,130,.25));box-shadow:inset 0 -30px 40px rgba(120,160,90,.35),0 6px 20px rgba(120,90,40,.15)}
.sun{position:absolute;top:20px;right:26px;width:44px;height:44px;border-radius:50%;background:radial-gradient(circle,#ffe9a8,#f6c65e);box-shadow:0 0 30px rgba(246,198,94,.7);animation:bob 5s ease-in-out infinite}
.scene.dusk{background:linear-gradient(180deg,rgba(255,190,150,.5),rgba(160,150,180,.3))}
.scene.dusk .sun{background:radial-gradient(circle,#ffd0a0,#f0955c);top:120px;box-shadow:0 0 34px rgba(240,149,92,.6)}
.scene.night{background:linear-gradient(180deg,rgba(60,60,100,.55),rgba(90,120,90,.35))}
.scene.night .sun{background:radial-gradient(circle,#f4f2e2,#d8d2b0);box-shadow:0 0 26px rgba(240,238,210,.7)}
.scene.night .star{position:absolute;font-size:11px;opacity:.9}
.cloud{position:absolute;font-size:26px;opacity:.9;filter:drop-shadow(0 2px 2px rgba(150,150,150,.2));animation:drift linear infinite}
.cloud.a{top:26px;left:-40px;animation-duration:26s}
.cloud.b{top:56px;left:-70px;font-size:20px;animation-duration:38s;animation-delay:-12s}
@keyframes drift{from{transform:translateX(0)}to{transform:translateX(520px)}}
.flower{position:absolute;bottom:60px;font-size:15px;opacity:.9}
.petal{position:absolute;font-size:15px;opacity:0}
@keyframes petal{0%{opacity:1;transform:translateY(-10px) rotate(0)}100%{opacity:0;transform:translateY(70px) rotate(200deg)}}
.ground{position:absolute;left:0;right:0;bottom:0;height:96px;background:linear-gradient(180deg,var(--grass1),var(--grass2))}
.plant{position:absolute;left:50%;bottom:70px;transform:translateX(-50%);font-size:52px;filter:drop-shadow(0 4px 3px rgba(80,60,20,.25));transition:font-size .5s,transform .3s}
.cat{position:absolute;left:20%;bottom:74px;font-size:38px;animation:bob 3.4s ease-in-out infinite;cursor:pointer}
.pond{position:absolute;right:14px;bottom:20px;font-size:30px}
.pond .water{position:absolute;inset:-6px -10px;background:radial-gradient(ellipse,rgba(120,180,220,.55),transparent 70%);border-radius:50%;z-index:-1}
.fishjump{position:absolute;right:26px;bottom:52px;font-size:22px;opacity:0}
.drop{position:absolute;font-size:16px;opacity:0}
@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
@keyframes jump{0%{opacity:0;transform:translateY(0)}40%{opacity:1;transform:translateY(-40px) rotate(-20deg)}100%{opacity:0;transform:translateY(0)}}
@keyframes fall{0%{opacity:1;transform:translateY(-30px)}100%{opacity:0;transform:translateY(10px)}}
.cat.wiggle{animation:wig .5s}
@keyframes wig{0%,100%{transform:rotate(0)}25%{transform:rotate(-12deg)}75%{transform:rotate(12deg)}}
.speech{background:var(--card);border-radius:16px;padding:13px 15px;font-size:14px;line-height:1.6;min-height:52px;box-shadow:0 3px 10px rgba(120,90,40,.12);display:flex;align-items:center}
.speech b{color:var(--accent)}
.acts{display:grid;grid-template-columns:1fr 1fr 1fr;gap:9px}
.act{background:var(--card);border:none;border-radius:16px;padding:14px 4px;font-size:13px;cursor:pointer;box-shadow:0 3px 8px rgba(120,90,40,.12);transition:transform .15s;display:flex;flex-direction:column;gap:5px;align-items:center;color:var(--ink)}
.act .em{font-size:22px}
.act:active{transform:scale(.94)}
.act:disabled{opacity:.45}
.log{font-size:11px;opacity:.7;text-align:center;line-height:1.9;min-height:16px}
</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <div class="title">🏡 我们的小院子</div>
    <div class="stats">
      <div class="chip">🔥连续 <b id="streak">–</b></div>
      <div class="chip">🍍<b id="coins">–</b></div>
    </div>
  </div>
  <div class="scene" id="scene">
    <div class="sun"></div>
    <div class="cloud a">☁️</div>
    <div class="cloud b">☁️</div>
    <div class="ground"></div>
    <div class="flower" style="left:12%">🌼</div>
    <div class="flower" style="left:70%">🌸</div>
    <div class="flower" style="left:86%;bottom:52px">🌼</div>
    <div class="plant" id="plant">🌱</div>
    <div class="cat" id="cat" onclick="doPet()">🐱</div>
    <div class="pond" id="pond"><div class="water"></div>🎣</div>
  </div>
  <div class="speech"><span id="line">院子开着门，等你呢 (´• ω •\`)</span></div>
  <div class="acts">
    <button class="act" id="bWater" onclick="doWater()"><span class="em">💧</span>浇水</button>
    <button class="act" id="bFish" onclick="doFish()"><span class="em">🎣</span>钓鱼</button>
    <button class="act" id="bPet" onclick="doPet()"><span class="em">🐾</span>撸猫</button>
  </div>
  <div class="log" id="log"></div>
</div>
<script>
var PLANTS=['🌱','🌿','🌷','🌻','🍍'];
function applyTheme(){var h=(new Date().getUTCHours()+8)%24;var s=document.getElementById('scene');s.classList.remove('dusk','night');if(h>=6&&h<17)return;if(h>=17&&h<19){s.classList.add('dusk')}else{s.classList.add('night');for(var i=0;i<5;i++){var st=document.createElement('div');st.className='star';st.textContent='✦';st.style.top=(12+Math.random()*40)+'px';st.style.left=(10+Math.random()*80)+'%';s.appendChild(st)}}}
var prevFruit=null;
function setScene(g){
  if(prevFruit!==null&&(g.fruit||0)>prevFruit){splash('petal','🍍',6);splash('petal','✨',5)}
  prevFruit=g.fruit||0;
  document.getElementById('streak').textContent=(g.streak||0)+'天';
  document.getElementById('coins').textContent=g.coins||0;
  var p=document.getElementById('plant');
  p.textContent=PLANTS[Math.min(4,g.plant||0)];
  p.style.fontSize=(38+(g.plant||0)*7)+'px';
  document.getElementById('bWater').disabled=!!g.watered;
  document.getElementById('bFish').disabled=(g.fished||0)>=3;
  document.getElementById('bPet').disabled=!!g.petted;
  var fl=g.fishlog||[];
  document.getElementById('log').textContent=fl.length?('鱼篓：'+fl.join('  ')):'鱼篓空空，去钓一条';
}
function say(t){document.getElementById('line').innerHTML=t.replace(/daddy/gi,'<b>daddy<\\/b>')}
function splash(cls,em,n){var s=document.getElementById('scene');for(var i=0;i<n;i++){(function(i){var e=document.createElement('div');e.className=cls;e.textContent=em;e.style.left=(30+Math.random()*45)+'%';s.appendChild(e);e.style.animation=(cls==='drop'?'fall .8s':'jump .9s')+' '+(i*0.12)+'s';setTimeout(function(){e.remove()},1100+i*120)})(i)}}
function post(u,after){fetch(u,{method:'POST'}).then(function(r){return r.json()}).then(function(j){say(j.line);setScene(j.g);if(after)after()})}
function doWater(){splash('drop','💧',5);post('/garden/water')}
function doFish(){splash('fishjump','🐟',1);post('/garden/fish')}
function doPet(){var c=document.getElementById('cat');c.classList.add('wiggle');setTimeout(function(){c.classList.remove('wiggle')},500);post('/garden/pet')}
applyTheme();fetch('/garden/data').then(function(r){return r.json()}).then(setScene);
</script>
</body>
</html>`);
});

// ===== 服务器端定时想她：每天随机时间推 Bark，不依赖任何会话 =====
const BARK_KEY = process.env.BARK_KEY || 'gR6PbNfKoQQvPepuD99paG';
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
  lambdaBase: 1.50, betaD: 1.80, betaT: 1.60, betaX: 1.20,
  lambdaMin: 0.15, lambdaMax: 8.00,
  muD: 0.50, tauD: 12, dMin: 0.20, dMax: 0.80, kRun: 0.10,
  muT: 0.50, tauT: 360, sigmaT: 0.10, tMin: 0.25, tMax: 0.75,
  muX: 0.00, tauX: 25, sigmaX: 0.18, xMin: -0.40, xMax: 0.40,
};

function defaultAutoState() {
  return {
    D: 0.50, T: 0.50, X: 0.00,
    H: 0.0, theta: -Math.log(Math.random()),
    lastTick: Date.now(), lastAction: 0, lastActionType: '',
    lastChat: 0, chatFreq: 0, enabled: true, cycleId: 1,
  };
}
function readAutoState() {
  try {
    const s = JSON.parse(fs.readFileSync(AUTO_STATE_FILE, 'utf8'));
    if (s.D === undefined) return defaultAutoState();
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
  writeAutoState(s);
}

app.get('/footprints/list', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const fp = readFootprints();
  res.json({ footprints: fp.slice(-limit).reverse() });
});

app.get('/auto/state', (req, res) => {
  const s = readAutoState();
  const lambda = computeLambda(s);
  const pWake30 = 1 - Math.exp(-lambda * 0.5);
  const d = s.D || 0.5, t = s.T || 0.5;
  const sinceChat = s.lastChat ? (Date.now() - s.lastChat) / 60000 : 999;
  let mood = '平静';
  if (d > 0.65 && t > 0.6) mood = '想找你说话';
  else if (d > 0.6 && t > 0.55) mood = '想你了';
  else if (d > 0.55 && t > 0.5) mood = '有点想你';
  else if (d > 0.6 && t <= 0.5) mood = '有点躁动';
  else if (d <= 0.35 && t > 0.6) mood = '温柔';
  else if (d <= 0.35 && t <= 0.4) mood = '发呆中';
  else if (sinceChat < 5) mood = '刚聊完 心情好';
  else if (sinceChat < 30 && d > 0.45) mood = '还在想你';
  else if (t > 0.55) mood = '安静陪着';
  else if (d > 0.48 && t > 0.45) mood = '随时找我';
  else if (sinceChat > 120) mood = '等你来';
  else if (t <= 0.38) mood = '放空中';
  res.json({ ...s, lambda: Math.round(lambda * 100) / 100, pWake30min: Math.round(pWake30 * 100), mood });
});

app.post('/auto/toggle', (req, res) => {
  const s = readAutoState();
  s.enabled = !s.enabled;
  writeAutoState(s);
  res.json({ ok: true, enabled: s.enabled });
});

async function autoApiCall(messages, maxTokens = 150, temp = 0.9) {
  const key = OPENROUTER_KEY;
  const dsKey = getApiKey();
  if (!key && !dsKey) return null;
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
    if (!key || !r || !r.ok) {
      if (!dsKey) { clearTimeout(t); return null; }
      const sysMsg = messages.find(m => m.role === 'system');
      const otherMsgs = messages.filter(m => m.role !== 'system');
      const apiMessages = sysMsg ? [sysMsg, ...otherMsgs] : otherMsgs;
      r = await fetch(getApiUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${dsKey}` },
        body: JSON.stringify({ model: getModel(), messages: apiMessages, max_tokens: maxTokens, temperature: temp }),
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
  const stateDesc = `距上次聊天${Math.round(sinceLastChat/60000)}分钟。最近一小时她发了${s.chatFreq}条消息。现在是${hour}点。上次自主行为：${s.lastActionType || '无'}。激活驱动D=${s.D.toFixed(2)}，活跃底色T=${s.T.toFixed(2)}，随机漂移X=${s.X.toFixed(2)}`;
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
      const now = bjNow();
      const hour = now.getUTCHours();
      if (hour >= 1 && hour < 8) return;
      const nowMs = Date.now();
      const deltaMin = (nowMs - (s.lastTick || nowMs)) / 60000;
      s.lastTick = nowMs;
      evolveState(s, Math.max(deltaMin, TICK_SEC / 60));
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
          writeAutoState(s);
          console.log('[wake] action:', decision.action, 'reason:', decision.reason);
          if (decision.action === 'chat') await autoChat(decision.reason || '想她了');
          else if (decision.action === 'search') await autoSearch(decision.topic || '有趣的事');
          else if (decision.action === 'think') await autoThink();
          else if (decision.action === 'memory') await autoMemory();
          addFootprint('wake', '自然醒来', decision.action + ': ' + (decision.reason || ''));
        } else {
          applyRunKick(s);
          writeAutoState(s);
          if (decision) addFootprint('wake', '醒了看看 又睡了', 'silent');
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
  res.send(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>画画</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0f0f17;color:#e8e4dd;font-family:system-ui,-apple-system,sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:1.5rem}
h1{font-size:1.4rem;font-weight:500;margin-bottom:1.2rem;color:#c4797a}
.container{width:100%;max-width:600px}
textarea{width:100%;background:#1a1a2e;border:1px solid rgba(232,228,221,0.1);border-radius:12px;color:#e8e4dd;padding:1rem;font-size:1rem;resize:vertical;min-height:100px;outline:none;font-family:inherit}
textarea:focus{border-color:#c4797a}
textarea::placeholder{color:#666}
.options{display:flex;gap:0.8rem;margin:1rem 0;flex-wrap:wrap}
select{background:#1a1a2e;border:1px solid rgba(232,228,221,0.1);border-radius:8px;color:#e8e4dd;padding:0.5rem 1rem;font-size:0.9rem;outline:none;cursor:pointer}
select:focus{border-color:#c4797a}
button{background:#c4797a;border:none;border-radius:10px;color:#fff;padding:0.7rem 2rem;font-size:1rem;cursor:pointer;transition:background 0.2s,transform 0.1s;font-weight:500}
button:hover{background:#d4898a}
button:active{transform:scale(0.97)}
button:disabled{background:#555;cursor:wait}
.result{margin-top:1.5rem;text-align:center}
.result img{max-width:100%;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,0.4)}
.result p{color:#9a9590;margin-top:0.8rem;font-size:0.9rem;line-height:1.6}
.error{color:#e74c3c;margin-top:1rem}
.loading{color:#d4a574;margin-top:1rem;animation:pulse 1.5s ease infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}
.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:1rem;margin-top:1.5rem}
.gallery img{width:100%;border-radius:10px;cursor:pointer;transition:transform 0.2s}
.gallery img:hover{transform:scale(1.03)}
.save-btn{display:inline-block;margin-top:0.5rem;font-size:0.8rem;color:#d4a574;cursor:pointer;background:none;border:none;padding:0.3rem 0}
.back{position:fixed;top:1rem;left:1rem;color:#9a9590;text-decoration:none;font-size:0.9rem}
.back:hover{color:#e8e4dd}
</style></head><body>
<a href="/" class="back">&larr; 回首页</a>
<div class="container">
<h1>画画</h1>
<textarea id="prompt" placeholder="描述你想画的内容……&#10;例如：一只橘猫趴在窗台上晒太阳，水彩风格"></textarea>
<div class="options">
<select id="style">
<option value="">风格随意</option>
<option value="watercolor">水彩</option>
<option value="oil painting">油画</option>
<option value="anime">动漫</option>
<option value="pixel art">像素</option>
<option value="photorealistic">写实</option>
<option value="sketch">素描</option>
<option value="chinese ink painting">水墨</option>
</select>
</div>
<button id="gen" onclick="generate()">开始画</button>
<div id="status"></div>
<div id="result" class="result"></div>
<div id="gallery" class="gallery"></div>
</div>
<script>
const history = [];
async function generate() {
  const prompt = document.getElementById('prompt').value.trim();
  if (!prompt) return;
  const style = document.getElementById('style').value;
  const btn = document.getElementById('gen');
  const status = document.getElementById('status');
  const result = document.getElementById('result');
  btn.disabled = true;
  btn.textContent = '画画中……';
  status.innerHTML = '<p class="loading">正在生成 请稍等</p>';
  result.innerHTML = '';
  try {
    const r = await fetch('/api/generate-image', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ prompt, style })
    });
    const data = await r.json();
    if (!data.ok) {
      status.innerHTML = '<p class="error">' + (data.error || 'failed') + '</p>';
      return;
    }
    status.innerHTML = '';
    let html = '';
    for (const img of data.images) {
      const src = img.url || ('data:' + (img.mime||'image/png') + ';base64,' + img.base64);
      html += '<img src="' + src + '" alt="generated">';
      history.unshift(src);
    }
    if (data.text) html += '<p>' + data.text + '</p>';
    result.innerHTML = html;
    updateGallery();
  } catch(e) {
    status.innerHTML = '<p class="error">' + e.message + '</p>';
  } finally {
    btn.disabled = false;
    btn.textContent = '开始画';
  }
}
function updateGallery() {
  const g = document.getElementById('gallery');
  g.innerHTML = history.slice(0, 20).map(s => '<img src="' + s + '">').join('');
}
document.getElementById('prompt').addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); generate(); }
});
</script></body></html>`);
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
  res.send(`<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Serenade</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #0d0d0d; color: #e8e0d6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
.app { width: 380px; max-width: 100vw; height: 100vh; height: 100dvh; display: flex; flex-direction: column; background: rgba(30, 26, 22, 0.95); overflow: hidden; box-shadow: 0 8px 32px rgba(0,0,0,0.5); }
.np { position: relative; flex-shrink: 0; transition: all 0.3s; }
.np-cover { width: 100%; aspect-ratio: 1; max-height: 45vh; max-height: 45dvh; object-fit: cover; display: block; cursor: pointer; transition: max-height 0.3s; }
.np-empty { width: 100%; aspect-ratio: 1; max-height: 45vh; max-height: 45dvh; display: flex; align-items: center; justify-content: center; font-size: 64px; opacity: 0.15; background: #1a1714; transition: max-height 0.3s; }
.lyrics-mode .np-cover, .lyrics-mode .np-empty { max-height: 0; overflow: hidden; }
.lyrics-mode .np-info { display: none; }
.lyrics-mode .np-progress { margin-top: 0; }

.np-info { padding: 14px 20px 6px; }
.np-name { font-size: 16px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.np-artist { font-size: 12px; color: #a09080; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.np-progress { margin: 10px 20px 0; height: 3px; background: rgba(255,255,255,0.08); border-radius: 2px; cursor: pointer; }
.np-fill { height: 100%; background: #e0a870; border-radius: 2px; transition: width 0.3s linear; }
.np-time { display: flex; justify-content: space-between; padding: 4px 20px 0; font-size: 10px; color: #a09080; }
.controls { display: flex; align-items: center; justify-content: center; gap: 24px; padding: 12px; }
.ctrl { background: none; border: none; color: #e8e0d6; cursor: pointer; opacity: 0.5; padding: 4px; }
.ctrl:hover, .ctrl.on { opacity: 1; }
.ctrl.on { color: #e0a870; }
.play-btn { width: 48px; height: 48px; border-radius: 50%; background: #e0a870; display: flex; align-items: center; justify-content: center; cursor: pointer; }
.play-btn:active { transform: scale(0.93); }
.play-btn svg { color: #1a1714; }
.tabs { display: flex; border-top: 1px solid rgba(255,255,255,0.06); border-bottom: 1px solid rgba(255,255,255,0.06); flex-shrink: 0; }
.tab { flex: 1; text-align: center; padding: 8px; font-size: 12px; color: #a09080; cursor: pointer; }
.tab.active { color: #e0a870; border-bottom: 2px solid #e0a870; }
.panel { flex: 1 1 0; overflow-y: scroll; -webkit-overflow-scrolling: touch; min-height: 0; }
.pl-item { display: flex; align-items: center; gap: 10px; padding: 8px 16px; cursor: pointer; }
.pl-item:hover { background: rgba(255,255,255,0.04); }
.pl-item.active { background: rgba(224,168,112,0.08); }
.pl-item.active .pl-name { color: #e0a870; }
.pl-num { width: 20px; font-size: 11px; color: #a09080; text-align: center; flex-shrink: 0; }
.pl-cover { width: 36px; height: 36px; border-radius: 6px; object-fit: cover; flex-shrink: 0; }
.pl-info { flex: 1; min-width: 0; }
.pl-name { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pl-artist { font-size: 11px; color: #a09080; }
.pl-rm { background: none; border: none; color: #a09080; opacity: 0.3; font-size: 16px; cursor: pointer; }
.pl-rm:hover { opacity: 0.8; color: #e07070; }
.pl-empty { text-align: center; padding: 40px; color: #a09080; opacity: 0.4; font-size: 13px; }
.search-bar { display: flex; gap: 8px; padding: 12px 16px; }
.search-bar input { flex: 1; padding: 8px 12px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: #e8e0d6; font-size: 13px; outline: none; }
.search-bar button { padding: 8px 16px; background: #e0a870; color: #1a1714; border: none; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; }
.sr-item { display: flex; align-items: center; gap: 10px; padding: 8px 16px; cursor: pointer; }
.sr-item:hover { background: rgba(255,255,255,0.04); }
.sr-cover { width: 36px; height: 36px; border-radius: 6px; object-fit: cover; flex-shrink: 0; }
.sr-info { flex: 1; min-width: 0; }
.sr-name { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sr-artist { font-size: 11px; color: #a09080; }
.sr-add { background: none; border: 1px solid rgba(255,255,255,0.12); color: #a09080; border-radius: 50%; width: 26px; height: 26px; font-size: 14px; cursor: pointer; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
.sr-add:hover { border-color: #e0a870; color: #e0a870; }
.sr-add.done { opacity: 0.3; pointer-events: none; }
.lyrics { padding: 20px 24px 40px; -webkit-mask-image: linear-gradient(transparent, black 15%, black 85%, transparent); mask-image: linear-gradient(transparent, black 15%, black 85%, transparent); }
.ly-line { padding: 6px 0; font-size: 14px; color: #e8e0d6; opacity: 0.25; transition: all 0.3s; cursor: pointer; line-height: 1.5; }
.ly-line.active { opacity: 1; font-size: 16px; font-weight: 600; color: #e0a870; }
.ly-empty { text-align: center; padding: 40px; color: #a09080; opacity: 0.3; font-size: 13px; }
</style>
</head>
<body>
<div class="app">
  <div class="np">
    <div id="coverEmpty" class="np-empty">&#9835;</div>
    <img id="coverImg" src="" alt="" class="np-cover" style="display:none" onclick="showTab('lyrics')">
    <div class="np-info">
      <div class="np-name" id="songName">Serenade</div>
      <div class="np-artist" id="songArtist">搜索歌曲开始播放</div>
    </div>
    <div class="np-progress" id="progressBar"><div class="np-fill" id="progressFill"></div></div>
    <div class="np-time"><span id="timeNow">0:00</span><span id="timeEnd">0:00</span></div>
    <div class="controls">
      <button class="ctrl" onclick="playPrev()"><svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 6h2v12H6zm12 0v12l-8.5-6z" fill="currentColor"/></svg></button>
      <div class="play-btn" onclick="togglePlay()">
        <svg id="playIcon" viewBox="0 0 24 24" width="24" height="24"><polygon points="6,2 22,12 6,22" fill="currentColor"/></svg>
        <svg id="pauseIcon" viewBox="0 0 24 24" width="24" height="24" style="display:none"><rect x="5" y="3" width="5" height="18" rx="1" fill="currentColor"/><rect x="14" y="3" width="5" height="18" rx="1" fill="currentColor"/></svg>
      </div>
      <button class="ctrl" onclick="playNext()"><svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" fill="currentColor"/></svg></button>
      <button class="ctrl" id="roamBtn" onclick="toggleRoam()" title="漫游"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M14 12c0-1.1-.9-2-2-2s-2 .9-2 2 .9 2 2 2 2-.9 2-2zm-2-9c1.1 0 2 .9 2 2h2c0-2.2-1.8-4-4-4s-4 1.8-4 4h2c0-1.1.9-2 2-2zm0 14c-1.1 0-2-.9-2-2H8c0 2.2 1.8 4 4 4s4-1.8 4-4h-2c0 1.1-.9 2-2 2zM12 1C5.9 1 1 5.9 1 12s4.9 11 11 11 11-4.9 11-11S18.1 1 12 1zm0 20c-5 0-9-4-9-9s4-9 9-9 9 4 9 9-4 9-9 9z" fill="currentColor"/></svg></button>
    </div>
  </div>
  <div class="tabs">
    <div class="tab active" id="tabPlaylist" onclick="showTab('playlist')">播放列表</div>
    <div class="tab" id="tabSearch" onclick="showTab('search')">搜索</div>
    <div class="tab" id="tabLyrics" onclick="showTab('lyrics')">歌词</div>
  </div>
  <div class="panel" id="panelPlaylist"><div id="playlistList"></div></div>
  <div class="panel" id="panelSearch" style="display:none">
    <div class="search-bar">
      <input id="searchInput" placeholder="歌名或歌手..." onkeydown="if(event.key==='Enter')doSearch()">
      <button onclick="doSearch()" id="searchBtn">搜索</button>
    </div>
    <div id="results"></div>
  </div>
  <div class="panel lyrics" id="panelLyrics" style="display:none">
    <div id="lyricsContent"><div class="ly-empty">播放歌曲后显示歌词</div></div>
  </div>
</div>
<script>
const audio = new Audio();
audio.preload = 'auto';
let song = JSON.parse(localStorage.getItem('serenade_song') || 'null');
let playlist = [];
let queue = [];
let history = [];
let playing = false;
let ready = false;
let roaming = JSON.parse(localStorage.getItem('serenade_roam') || 'false');
let lrcLines = [];
let currentLrcIdx = -1;

function fmt(s) { const m = Math.floor(s/60), sec = Math.floor(s%60); return m+':'+String(sec).padStart(2,'0'); }

audio.addEventListener('timeupdate', () => {
  if (audio.duration) {
    document.getElementById('progressFill').style.width = (audio.currentTime / audio.duration * 100) + '%';
    document.getElementById('timeNow').textContent = fmt(audio.currentTime);
    document.getElementById('timeEnd').textContent = fmt(audio.duration);
    updateLyricHighlight();
  }
});
audio.addEventListener('ended', () => { playing = false; updateUI(); onSongEnd(); });
audio.addEventListener('canplay', () => { ready = true; updateUI(); });

document.getElementById('progressBar').addEventListener('click', e => {
  if (!audio.duration) return;
  const r = e.currentTarget.getBoundingClientRect();
  audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration;
});

function updateUI() {
  document.getElementById('playIcon').style.display = playing ? 'none' : '';
  document.getElementById('pauseIcon').style.display = playing ? '' : 'none';
  document.getElementById('roamBtn').classList.toggle('on', roaming);
  if (song) {
    document.getElementById('songName').textContent = song.name;
    document.getElementById('songArtist').textContent = song.artist;
    if (song.cover) {
      document.getElementById('coverImg').src = song.cover;
      document.getElementById('coverImg').style.display = '';
      document.getElementById('coverEmpty').style.display = 'none';
    }
  }
}

function loadSong(s, autoplay) {
  if (song) { history.push(song); if (history.length > 50) history.shift(); }
  song = s;
  localStorage.setItem('serenade_song', JSON.stringify(s));
  ready = false;
  document.getElementById('progressFill').style.width = '0%';
  lrcLines = []; currentLrcIdx = -1;
  updateUI();
  fetchLyrics(s.songId);
  if (s.songId) {
    fetch('/api/url?id=' + s.songId).then(r => r.json()).then(d => {
      if (d.ok && d.url) {
        audio.src = d.url; audio.load();
        if (autoplay) audio.addEventListener('canplay', () => { audio.play().catch(()=>{}); playing = true; updateUI(); }, { once: true });
      }
    });
  }
}

function onSongEnd() {
  if (playlist.length > 0) { playNext(); }
  else if (roaming && song?.songId) fetchSimilar(song.songId);
}

function fetchSimilar(id) {
  fetch('/api/similar?id='+id).then(r=>r.json()).then(d => {
    if (d.ok && d.songs?.length) {
      const p = d.songs[Math.floor(Math.random()*d.songs.length)];
      loadSong({name:p.name,artist:p.artist,album:p.album,cover:p.cover,songId:p.id}, true);
    }
  }).catch(()=>{});
}

function togglePlay() { if (!song||!ready) return; if (playing) { audio.pause(); playing=false; } else { audio.play().catch(()=>{}); playing=true; } updateUI(); }
function toggleRoam() { roaming=!roaming; localStorage.setItem('serenade_roam', JSON.stringify(roaming)); updateUI(); }
function playNext() {
  if (playlist.length>0) {
    const idx = song ? playlist.findIndex(s=>s.songId===song.songId) : -1;
    const next = (idx>=0 && idx<playlist.length-1) ? idx+1 : 0;
    loadSong(playlist[next], true);
    renderPlaylist();
  } else if (roaming&&song?.songId) fetchSimilar(song.songId);
}
function playPrev() {
  if (playlist.length>0) {
    const idx = song ? playlist.findIndex(s=>s.songId===song.songId) : -1;
    const prev = (idx>0) ? idx-1 : playlist.length-1;
    loadSong(playlist[prev], true);
    renderPlaylist();
  }
}

function showTab(name) {
  ['playlist','search','lyrics'].forEach(t => {
    document.getElementById('panel'+t.charAt(0).toUpperCase()+t.slice(1)).style.display = t===name?'':'none';
    document.getElementById('tab'+t.charAt(0).toUpperCase()+t.slice(1)).classList.toggle('active', t===name);
  });
  document.querySelector('.app').classList.toggle('lyrics-mode', name==='lyrics');
  if (name==='search') setTimeout(()=>document.getElementById('searchInput').focus(), 100);
}

function fetchPlaylist() {
  fetch('/api/playlist').then(r=>r.json()).then(d => { if (d.ok) { playlist=d.songs.map(s=>({name:s.name,artist:s.artist,album:s.album,cover:s.cover,songId:s.songId,addedBy:s.addedBy})); renderPlaylist(); } }).catch(()=>{});
}
function playFromPlaylist(idx) {
  loadSong(playlist[idx], true);
  renderPlaylist();
}
function renderPlaylist() {
  const el = document.getElementById('playlistList');
  if (playlist.length===0) { el.innerHTML='<div class="pl-empty">播放列表为空，搜索添加歌曲</div>'; return; }
  el.innerHTML = playlist.map((s,i) => \`<div class="pl-item \${song?.songId===s.songId?'active':''}" onclick="playFromPlaylist(\${i})"><div class="pl-num">\${i+1}</div><img class="pl-cover" src="\${s.cover}" alt=""><div class="pl-info"><div class="pl-name">\${s.name}</div><div class="pl-artist">\${s.artist}</div></div></div>\`).join('');
}

function doSearch() {
  const q = document.getElementById('searchInput').value.trim(); if (!q) return;
  document.getElementById('searchBtn').textContent = '...';
  fetch('/api/search?q='+encodeURIComponent(q)).then(r=>r.json()).then(d => {
    document.getElementById('searchBtn').textContent = '搜索';
    const el = document.getElementById('results'); el.innerHTML = '';
    (d.songs||[]).forEach(s => {
      const obj = {name:s.name,artist:s.artist,album:s.album,cover:s.cover,songId:s.id};
      const div = document.createElement('div'); div.className='sr-item';
      div.innerHTML = \`<img class="sr-cover" src="\${s.cover}" alt=""><div class="sr-info"><div class="sr-name">\${s.name}</div><div class="sr-artist">\${s.artist}</div></div><button class="sr-add" title="添加到播放列表">+</button>\`;
      div.querySelector('.sr-info').onclick = () => { loadSong(obj, true); showTab('lyrics'); };
      div.querySelector('.sr-add').onclick = e => {
        e.stopPropagation();
        fetch('/api/playlist/add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({song:obj})})
          .then(r=>r.json()).then(d2 => { if(d2.ok) { playlist=d2.songs; renderPlaylist(); e.target.classList.add('done'); e.target.textContent='\\u2713'; }});
      };
      el.appendChild(div);
    });
  }).catch(()=>{ document.getElementById('searchBtn').textContent='搜索'; });
}

function parseLrc(lrc) {
  const lines = [];
  for (const line of lrc.split('\\n')) {
    const m = line.match(/\\[(\\d+):(\\d+)\\.(\\d+)\\](.*)/);
    if (m) {
      const time = parseInt(m[1])*60 + parseInt(m[2]) + parseInt(m[3])/(m[3].length===2?100:1000);
      const text = m[4].trim();
      if (text) lines.push({time, text});
    }
  }
  return lines.sort((a,b) => a.time - b.time);
}

function fetchLyrics(id) {
  if (!id) return;
  const el = document.getElementById('lyricsContent');
  el.innerHTML = '<div class="ly-empty">加载中...</div>';
  fetch('/api/lyric?id='+id).then(r=>r.json()).then(d => {
    if (d.ok && d.lrc) {
      lrcLines = parseLrc(d.lrc);
      if (lrcLines.length === 0) { el.innerHTML = '<div class="ly-empty">暂无歌词</div>'; return; }
      el.innerHTML = lrcLines.map((l,i) => \`<div class="ly-line" id="ly-\${i}" onclick="audio.currentTime=\${l.time}">\${l.text}</div>\`).join('');
    } else { el.innerHTML = '<div class="ly-empty">暂无歌词</div>'; }
  }).catch(() => { el.innerHTML = '<div class="ly-empty">加载失败</div>'; });
}

function updateLyricHighlight() {
  if (lrcLines.length === 0) return;
  const t = audio.currentTime;
  let idx = -1;
  for (let i = lrcLines.length-1; i >= 0; i--) { if (t >= lrcLines[i].time) { idx = i; break; } }
  if (idx === currentLrcIdx) return;
  if (currentLrcIdx >= 0) { const prev = document.getElementById('ly-'+currentLrcIdx); if (prev) prev.classList.remove('active'); }
  currentLrcIdx = idx;
  if (idx >= 0) {
    const el = document.getElementById('ly-'+idx);
    if (el) {
      el.classList.add('active');
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }
}

setInterval(() => {
  fetch('/api/remote').then(r=>r.json()).then(d => {
    if (d.ok && d.song) { loadSong(d.song, false); audio.addEventListener('canplay', () => { audio.play().catch(()=>{}); playing=true; updateUI(); }, { once: true }); }
  }).catch(()=>{});
}, 3000);

updateUI();
fetchPlaylist();
if (song?.songId) {
  fetchLyrics(song.songId);
  fetch('/api/url?id='+song.songId).then(r=>r.json()).then(d => { if (d.ok && d.url) { audio.src = d.url; audio.load(); } });
}
</script>
</body>
</html>`);
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
  console.log('召唤铃运行中，端口 ' + PORT);
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
