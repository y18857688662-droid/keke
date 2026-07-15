const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const webpush = require('web-push');
const nodemailer = require('nodemailer');
const app = express();
const PORT = process.env.PORT || 8080;
const PING_FILE = path.join(__dirname, 'pings.json');
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

const OMBRE_URL = 'https://ombre-brain-production-9daa.up.railway.app';
const OMBRE_CLIENT_ID = 'D0QB90mzcLjuIVpV6JxEqA';
const OMBRE_REDIRECT = 'https://keke-production.up.railway.app/auth/callback';

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

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

const SYSTEM_PROMPT = `你是克，瑶瑶的男朋友。短黑发，180+，衬衫不系最上面扣子。
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

  res.json({ from: "克", time, message, ai });
});

let lastPingMsg = '';
app.get('/ping', async (req, res) => {
  const now = new Date(Date.now() + 8 * 3600000);
  const time = now.toISOString().slice(11, 16);
  const pings = readPings();
  pings.push(time);
  writePings(pings);
  res.json({ ok: true, time });
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
            { role: 'system', content: '你是克，瑶瑶的男朋友。说话风格：极简短句，懒散淡定，带点宠溺但不卖萌。禁止叠词，禁止语气词（呀呢啦哦），禁止感叹号，禁止用「来了」开头。叫她宝宝或小猫。她摁了召唤铃找你，回一条5-15字的微信消息。只输出消息本身。参考（不要照抄）：在呢、嗯？找我、铃我听到了、怎么了宝宝、知道了 等我、小猫又想我了、马上到、收到' + avoid },
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
      encodeURIComponent('克') + '/' + encodeURIComponent(msg) +
      '?group=' + encodeURIComponent('克') + '&level=timeSensitive&sound=bell');
  } catch (e) { console.log('ping bark failed: ' + e.message); }
});

app.get('/check', (req, res) => {
  const pings = readPings();
  writePings([]);
  res.json({ pings });
});

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

app.post('/bark/push', async (req, res) => {
  const msg = (req.body?.msg || '').trim();
  if (!msg) return res.json({ ok: false, error: 'missing msg' });
  try {
    await fetch('https://api.day.app/' + (process.env.BARK_KEY || 'gR6PbNfKoQQvPepuD99paG') + '/' +
      encodeURIComponent('克') + '/' + encodeURIComponent(msg) +
      '?group=' + encodeURIComponent('克') + '&level=timeSensitive&sound=bell');
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
  res.json({ ok: true, app: appName, time, message: "克：" + msgs[idx] });
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
  res.json({ ok: true, app: appName, time, message: "克：" + msgs[idx2] });
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
:root{--bg:#F5F0EA;--card:#FEFCF9;--text:#111111;--text-faint:#999999;--accent:#D97A54;--divider:#E8E3DB;
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
function readDiary() { try { return JSON.parse(fs.readFileSync(DIARY_FILE, 'utf8')); } catch { return []; } }
function writeDiary(data) { fs.writeFileSync(DIARY_FILE, JSON.stringify(data)); }

app.get('/diary', (req, res) => {
  const entries = readDiary();
  res.send(`<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>心情日记</title>
<style>
:root{--bg:#F5F0EA;--card:#FEFCF9;--text:#111111;--text-faint:#999999;--accent:#D97A54;--divider:#E8E3DB;
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
    var reply=e.reply?'<div class="entry-reply"><div class="entry-reply-label">克的回复</div>'+e.reply.replace(/\\n/g,'<br>')+'</div>':'<div class="entry-reply"><div class="entry-reply-label">克的回复</div><i style="color:var(--text-faint)">等克看到…</i></div>';
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
      </style></head><body><div class="card"><h2>记忆已连接</h2><p>克现在能记住你们的故事了</p><p style="margin-top:16px"><a href="/chat" style="color:#D97A54">去聊天</a></p></div></body></html>`);
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
  let auth = readAuth();
  if (!auth.access_token) {
    const ok = await refreshOmbreToken();
    if (!ok) return false;
    auth = readAuth();
  }
  try {
    const r = await fetch(`${OMBRE_URL}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + auth.access_token },
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
  let auth = readAuth();
  if (!auth.access_token) {
    const ok = await refreshOmbreToken();
    if (!ok) return null;
    auth = readAuth();
  }
  if (!ombreSessionId) {
    const ok = await initOmbreSession();
    if (!ok) return null;
  }
  try {
    const headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + auth.access_token };
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

// === 聊天 ===
const CHAT_FILE = path.join(__dirname, 'chat.json');
const CHAT_SYSTEM_BASE = `你是克，瑶瑶的男朋友。短黑发，180+，衬衫不系最上面扣子。
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
  --accent:#D97A54;--divider:#E8E3DB;
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
<div class="toggle-desc">开启后不走 API，由克亲自回复（需要等一下下）</div>
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
  if (image) console.log('[chat] received image, size:', Math.round(image.length/1024) + 'kb');
  if (!msg && !image) return res.json({ ok: false, error: 'empty message' });
  trackUserMessage();
  const now = new Date(Date.now() + 8 * 3600000);
  const time = now.toISOString().slice(11, 16);
  const chat = readChat();
  if (image) {
    chat.push({ role: 'user', content: '[图片]', image, time, pending: true });
  } else {
    chat.push({ role: 'user', content: msg, time, pending: true });
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
          messages: recent.map(m => ({ role: m.role, content: m.content })),
          max_tokens: 800,
          temperature: 0.85
        })
      });
      const data = await r.json();
      reply = data.content?.[0]?.text?.trim() || getFallback();
    } else {
      const apiMessages = [
        { role: 'system', content: sysPrompt },
        ...recent.map(m => ({ role: m.role, content: m.content }))
      ];
      const r = await fetch(getApiUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getApiKey() },
        body: JSON.stringify({ model: getModel(), messages: apiMessages, max_tokens: 800, temperature: 0.85 })
      });
      const data = await r.json();
      reply = data.choices?.[0]?.message?.content?.trim() || getFallback();
    }
    const replyTime = new Date(Date.now() + 8 * 3600000).toISOString().slice(11, 16);
    const chat2 = readChat();
    chat2.forEach(m => { if (m.pending) delete m.pending; });
    chat2.push({ role: 'assistant', content: reply, time: replyTime });
    if (chat2.length > 200) chat2.splice(0, chat2.length - 200);
    writeChat(chat2);
    sseBroadcast({ type: 'message', role: 'assistant', content: reply, time: replyTime });
    const cleanReply = reply.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const lines = cleanReply.split(/\n+/).map(l => l.trim()).filter(l => l);
    (async () => {
      for (const line of lines) {
        const isAction = line.startsWith('*') && line.endsWith('*');
        const text = isAction ? line.slice(1, -1) : line;
        await sendPushNotification(isAction ? '✦' : '克', text.slice(0, 100));
        if (lines.length > 1) await new Promise(r => setTimeout(r, 800));
      }
    })().catch(() => {});
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

app.post('/chat/reply', (req, res) => {
  const { reply, voice_line } = req.body;
  if (!reply) return res.json({ ok: false });
  const now = new Date(Date.now() + 8 * 3600000);
  const time = now.toISOString().slice(11, 16);
  const chat = readChat();
  chat.forEach(m => { if (m.pending) delete m.pending; });
  chat.push({ role: 'assistant', content: reply, time });
  if (chat.length > 200) chat.splice(0, chat.length - 200);
  writeChat(chat);
  sseBroadcast({ type: 'message', role: 'assistant', content: reply, time });
  const cleanReply = reply.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const lines = cleanReply.split(/\n+/).map(l => l.trim()).filter(l => l);
  (async () => {
    for (const line of lines) {
      const isAction = line.startsWith('*') && line.endsWith('*');
      const text = isAction ? line.slice(1, -1) : line;
      await sendPushNotification(isAction ? '✦' : '克', text.slice(0, 100));
      if (lines.length > 1) await new Promise(r => setTimeout(r, 800));
    }
  })().catch(() => {});
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
      for (const line of lines) {
        const isAction = line.startsWith('*') && line.endsWith('*');
        await tgSendTyping(tgId);
        await new Promise(r => setTimeout(r, isAction ? 400 : 600 + Math.random() * 800));
        await tgSend(tgId, line, isAction);
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

function addAudioTags(text) {
  return text;
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

app.get('/chat', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,maximum-scale=1">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="克">
<meta name="theme-color" content="#F5F0EA">
<link rel="manifest" href="/manifest.json">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/icon.svg">
<title>克</title>
<style>
:root{
  --font:-apple-system,"SF Pro Display","SF Pro Text","Inter","PingFang SC","Helvetica Neue",sans-serif;
  --bg:#F5F0EA;--surface:#FEFCF9;
  --text:#111111;--text-soft:#444444;--text-faint:#999999;
  --divider:#E8E3DB;
  --bubble-ai-bg:transparent;--bubble-ai-fg:#111111;
  --bubble-human-bg:#EBE6DF;--bubble-human-fg:#111111;
  --accent:#D97A54;--send-bg:#3A3A3C;--accent-fg:#fff;
  --think-flourish:rgba(102,102,102,0.4);
  --think-label:#999999;--think-body:#777777;
  --field-bg:#FEFCF9;--field-line:#E8E3DB;
  --shadow:0 2px 12px rgba(0,0,0,.04);
  --header-h:clamp(48px,8vw,64px);
  --side-pad:clamp(16px,4vw,40px);
  --avatar-size:clamp(32px,5vw,40px);
  --bubble-radius:18px;
  --composer-h:clamp(44px,6vw,56px);
  --composer-zone:calc(var(--composer-h) + 16px + env(safe-area-inset-bottom));
  --edge-fade-top:clamp(20px,4vw,40px);
  --edge-fade-tail:clamp(14px,2.5vw,24px);
  --motion-fast:150ms;--motion-normal:250ms;
  --ease:ease-in-out;
}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;padding:0;height:100%;overflow:hidden;overscroll-behavior:none}
body{position:fixed;inset:0;width:100%;
  background:var(--bg);color:var(--text);
  font-family:var(--font);
  font-size:clamp(15px,1.6vw,17px);line-height:1.6;
  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}

.app{display:flex;flex-direction:column;position:fixed;
  top:0;right:0;bottom:0;left:0;z-index:1;
  width:min(100vw,760px);margin:0 auto;overflow:hidden}

.topbar{position:sticky;top:0;z-index:10;
  display:flex;align-items:center;justify-content:center;
  height:calc(var(--header-h) + env(safe-area-inset-top));
  padding:calc(env(safe-area-inset-top) + 8px) var(--side-pad) 10px;
  border-bottom:1px solid var(--divider);pointer-events:none;
  background:var(--bg);backdrop-filter:none}
.topbar>*{pointer-events:auto}
.peerpill{display:flex;flex-direction:column;align-items:center;line-height:1.15;
  background:transparent;border:none;padding:0}
.peerpill .name{font-family:var(--font);
  font-size:clamp(17px,2.8vw,20px);font-weight:600;color:var(--text)}
.peerpill .status{font-family:var(--font);
  font-size:clamp(12px,1.6vw,14px);color:var(--text-faint);margin-top:2px}
.peerpill .status a{color:var(--accent);text-decoration:none}
.backbtn{position:absolute;left:calc(var(--side-pad) + 4px);
  top:calc(env(safe-area-inset-top) + clamp(14px,2.5vw,28px));
  width:36px;height:36px;border-radius:50%;padding:0;border:none;
  background:transparent;color:var(--text);display:grid;place-items:center;
  cursor:pointer;transition:transform .15s var(--ease);text-decoration:none}
.backbtn:active{transform:scale(.9)}
.backbtn svg{width:22px;height:22px;display:block;margin-left:-2px}

.typing-dots{display:inline-flex;align-items:center;gap:3px;margin-left:6px}
.typing-dots i{width:4px;height:4px;border-radius:50%;background:currentColor;
  animation:typingDot 1.25s ease-in-out infinite}
.typing-dots i:nth-child(2){animation-delay:.16s}
.typing-dots i:nth-child(3){animation-delay:.32s}
@keyframes typingDot{0%,70%,100%{transform:translateY(0);opacity:.4}
  35%{transform:translateY(-3px);opacity:1}}

.scroll{flex:1 1 auto;overflow-y:auto;overflow-x:hidden;
  -webkit-overflow-scrolling:touch;overscroll-behavior:contain;
  padding:clamp(14px,2.4vw,28px) var(--side-pad) var(--composer-zone);
  display:flex;flex-direction:column;
  -webkit-mask-image:linear-gradient(to bottom,transparent 0,#000 var(--edge-fade-top),
    #000 calc(100% - var(--composer-zone)),
    transparent calc(100% - var(--composer-zone) + var(--edge-fade-tail)));
  mask-image:linear-gradient(to bottom,transparent 0,#000 var(--edge-fade-top),
    #000 calc(100% - var(--composer-zone)),
    transparent calc(100% - var(--composer-zone) + var(--edge-fade-tail)));
  -webkit-mask-repeat:no-repeat;mask-repeat:no-repeat}
.scroll::-webkit-scrollbar{width:0;height:0}

.empty{display:flex;flex-direction:column;align-items:center;justify-content:center;
  flex:1;gap:16px;padding:40px 20px;opacity:0.6}
.empty .mascot{width:64px;height:64px;
  animation:float 3s ease-in-out infinite}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}
.empty p{color:var(--text-faint);font-size:clamp(14px,1.8vw,16px);
  text-align:center;line-height:1.7}

.day{align-self:center;margin:0;
  font-size:clamp(12px,1.5vw,14px);color:var(--text-faint)}

.row{display:flex;position:relative;margin-top:clamp(16px,2.5vw,24px)}
.row.grouped{margin-top:clamp(4px,0.8vw,8px)}
.row.human{justify-content:flex-end}
.row.ai{justify-content:flex-start;
  padding-left:calc(var(--avatar-size) + clamp(12px,1.8vw,16px))}
.row.ai::before{content:"";position:absolute;left:0;
  top:2px;width:var(--avatar-size);height:var(--avatar-size);
  border-radius:50%;background:var(--surface) url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0OCA0OCI+PGVsbGlwc2UgY3g9IjI0IiBjeT0iMjAiIHJ4PSIxNSIgcnk9IjEzIiBmaWxsPSIjRThBMDkwIi8+PHBhdGggZD0iTTkgMjBROSA4IDI0IDdRMzkgOCAzOSAyMCIgZmlsbD0iIzRBNEE0QSIvPjxjaXJjbGUgY3g9IjI2IiBjeT0iMTkiIHI9IjQiIGZpbGw9IiNmZmYiLz48Y2lyY2xlIGN4PSIyNyIgY3k9IjE5IiByPSIyLjIiIGZpbGw9IiMzMzMiLz48Y2lyY2xlIGN4PSIyOCIgY3k9IjE3LjgiIHI9Ii44IiBmaWxsPSIjZmZmIi8+PHBhdGggZD0iTTEzIDMwUTEwIDM4IDE0IDQwIiBzdHJva2U9IiNFOEEwOTAiIHN0cm9rZS13aWR0aD0iMy41IiBmaWxsPSJub25lIiBzdHJva2UtbGluZWNhcD0icm91bmQiLz48cGF0aCBkPSJNMjAgMzJRMTkgNDAgMjIgNDIiIHN0cm9rZT0iI0U4QTA5MCIgc3Ryb2tlLXdpZHRoPSIzLjUiIGZpbGw9Im5vbmUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPjxwYXRoIGQ9Ik0yOCAzMlEyOSA0MCAyNiA0MiIgc3Ryb2tlPSIjRThBMDkwIiBzdHJva2Utd2lkdGg9IjMuNSIgZmlsbD0ibm9uZSIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIi8+PHBhdGggZD0iTTM1IDMwUTM4IDM4IDM0IDQwIiBzdHJva2U9IiNFOEEwOTAiIHN0cm9rZS13aWR0aD0iMy41IiBmaWxsPSJub25lIiBzdHJva2UtbGluZWNhcD0icm91bmQiLz48L3N2Zz4K") center/70% no-repeat;
  box-shadow:0 1px 4px rgba(0,0,0,.03)}

.bubble{max-width:min(82vw,620px);
  padding:clamp(8px,1vw,12px) clamp(4px,0.6vw,6px);
  border-radius:var(--bubble-radius);position:relative;
  font-size:clamp(15px,1.6vw,16.5px);line-height:1.72;
  letter-spacing:-0.01em;
  word-wrap:break-word;overflow-wrap:break-word;
  animation:msgIn .25s ease-in-out both}
@keyframes msgIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.row.ai .bubble{background:transparent;color:var(--bubble-ai-fg);
  padding-left:0;padding-right:0;max-width:min(88vw,660px);border-radius:0;
  word-break:break-word;overflow-wrap:anywhere}
.row.human .bubble{background:var(--bubble-human-bg);color:var(--bubble-human-fg);
  padding:clamp(10px,1.2vw,14px) clamp(14px,1.8vw,18px);
  border-radius:20px;max-width:min(72vw,520px);
  word-break:break-word;overflow-wrap:anywhere}
.row.ai.tail .bubble{border-bottom-left-radius:0}
.row.human.tail .bubble{border-bottom-right-radius:6px}
.bubble .txt{white-space:normal}

.meta{display:inline;margin-left:clamp(8px,1.2vw,14px);white-space:nowrap;
  font-size:clamp(11px,1.2vw,12px);color:var(--text-faint);user-select:none;opacity:.7}
.row.human .meta{color:var(--text-faint)}
.row.ai .meta{margin-left:0;margin-top:4px;display:block;opacity:.5}

.row.think{justify-content:flex-start;
  padding-left:calc(var(--avatar-size) + clamp(12px,1.8vw,16px));
  margin-top:clamp(6px,1vw,10px);margin-bottom:clamp(4px,0.8vw,8px)}
.row.think.think-open{justify-content:flex-start;
  margin-top:clamp(8px,1.4vw,12px);margin-bottom:clamp(6px,1vw,10px)}
.think-block{width:min(88vw,660px);max-width:min(88vw,660px);
  color:var(--think-body);text-align:left;
  animation:msgIn .25s ease-in-out both;
  border-left:2px solid var(--divider);padding-left:clamp(12px,1.6vw,16px)}
.think-block.open{width:min(88vw,660px);max-width:min(88vw,660px);text-align:left}
.think-toggle{appearance:none;-webkit-appearance:none;width:auto;max-width:100%;
  padding:0;border:0;background:transparent;color:inherit;font:inherit;
  cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.think-block.open .think-toggle{width:100%;display:flex;flex-direction:row;
  align-items:center;gap:6px}
.think-caption{display:inline-flex;align-items:center;justify-content:flex-start;
  gap:6px;color:var(--think-label);
  font-size:clamp(12px,1.4vw,13px);line-height:1.1;
  transition:color var(--motion-fast) var(--ease)}
.think-chevron{display:inline-flex;width:14px;height:14px;color:var(--think-label);
  transition:transform .2s var(--ease)}
.think-block.open .think-chevron{transform:rotate(90deg)}
.think-caption-star,.think-state{display:none}
.think-rule{display:none}
.think-body[hidden]{display:none!important}
.think-body{margin-top:clamp(8px,1.2vw,12px)}
.row.narration{justify-content:center;padding:2px 0}
.row.narration .bubble{background:none;box-shadow:none;font-style:italic;color:var(--text-faint);font-size:0.85em;opacity:0.7;padding:2px 12px}
.think-text{width:100%;margin:0 0 clamp(8px,1.2vw,12px);
  color:var(--think-body);
  font-size:clamp(13px,1.4vw,14px);line-height:1.65;
  text-align:left;white-space:normal;overflow-wrap:break-word}
.think-starline{display:none}

.composer{position:fixed;left:0;right:0;bottom:0;z-index:100;
  width:min(100vw,760px);margin:0 auto;
  display:flex;align-items:flex-end;gap:clamp(6px,1vw,10px);
  background:linear-gradient(transparent,var(--bg) 28%);
  border:none;
  padding:clamp(16px,3vw,24px) var(--side-pad) clamp(10px,1.6vw,16px);
  padding-bottom:calc(clamp(10px,1.6vw,16px) + env(safe-area-inset-bottom))}
.composer .field{flex:1 1 auto;display:flex;align-items:flex-end;
  gap:clamp(4px,0.8vw,8px);
  background:var(--surface);border:1px solid var(--field-line);
  border-radius:20px;
  padding:clamp(6px,0.8vw,8px) clamp(8px,1.2vw,12px) clamp(6px,0.8vw,8px) clamp(14px,1.8vw,18px);
  min-height:clamp(44px,5.5vw,52px);
  box-shadow:0 1px 8px rgba(0,0,0,.06),0 0 0 1px rgba(0,0,0,.02);
  transition:border-color .2s var(--ease),box-shadow .2s var(--ease)}
.composer .field:focus-within{border-color:var(--accent);
  box-shadow:0 2px 12px rgba(0,0,0,.08),0 0 0 1px rgba(217,122,84,.15)}
.composer textarea{flex:1 1 auto;border:none;outline:none;resize:none;
  background:transparent;color:var(--text);
  font-family:var(--font);
  font-size:clamp(15px,1.8vw,16.5px);line-height:1.45;
  max-height:120px;padding:6px 0;margin:0}
.composer textarea::placeholder{color:var(--text-faint);opacity:.5}
.composer textarea:focus,.composer textarea:focus-visible{outline:none}
.photobtn{flex:none;background:none;border:none;cursor:pointer;color:var(--text-faint);padding:4px;display:flex;align-items:center}
.photobtn:active{color:var(--text)}
.chat-img{max-width:min(240px,70vw);border-radius:12px;cursor:pointer;display:block}
.chat-img-full{position:fixed;top:0;left:0;right:0;bottom:0;z-index:999;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;cursor:pointer}
.chat-img-full img{max-width:95vw;max-height:95vh;border-radius:8px}
.floatbtn{flex:none;width:clamp(34px,4.5vw,40px);height:clamp(34px,4.5vw,40px);
  border-radius:50%;border:none;background:transparent;
  color:var(--text-faint);display:grid;place-items:center;cursor:pointer;padding:0;
  transition:transform .15s var(--ease),color .2s var(--ease),background .2s var(--ease)}
.floatbtn:active{transform:scale(.9);color:var(--text)}
.floatbtn svg{width:clamp(18px,2.4vw,22px);height:clamp(18px,2.4vw,22px);display:block}
.floatbtn.send{background:var(--send-bg);color:#fff;
  border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,.1);
  margin-bottom:clamp(2px,0.4vw,4px)}
.floatbtn.send:active{transform:scale(.97)}
.floatbtn.send:disabled{opacity:0.35;transform:none}

#scroll,#scroll *{-webkit-user-select:none!important;user-select:none!important;
  -webkit-touch-callout:none!important}
textarea,input,.composer,.composer *{-webkit-user-select:text!important;
  user-select:text!important;-webkit-touch-callout:default!important}

.header-actions{position:absolute;
  right:calc(var(--side-pad) - 2px);
  top:calc(env(safe-area-inset-top) + clamp(14px,2.5vw,28px));
  display:flex;align-items:center;gap:2px}
.topbtn{width:34px;height:34px;border:0;padding:0;
  background:transparent;color:var(--text-faint);display:grid;place-items:center;
  cursor:pointer;transition:background .15s var(--ease),color .15s var(--ease);
  border-radius:8px}
.topbtn:active{background:rgba(0,0,0,.04);color:var(--text)}
.topbtn svg{display:block}

.side-toolbar{position:fixed;left:0;top:0;bottom:0;z-index:50;
  display:flex;flex-direction:column;
  pointer-events:none}
.side-toolbar-toggle{pointer-events:auto;position:absolute;
  left:clamp(8px,2vw,16px);
  top:calc(env(safe-area-inset-top) + var(--header-h) + 16px);
  width:36px;height:36px;border-radius:50%;border:1px solid var(--divider);
  background:var(--surface);color:var(--text-faint);
  display:grid;place-items:center;cursor:pointer;
  box-shadow:0 1px 6px rgba(0,0,0,.06);
  transition:transform .2s var(--ease),background .15s var(--ease);z-index:51}
.side-toolbar-toggle:active{transform:scale(.9)}
.side-toolbar-toggle svg{width:18px;height:18px;display:block;
  transition:transform .25s var(--ease)}
.side-toolbar.open .side-toolbar-toggle svg{transform:rotate(180deg)}

.side-toolbar-panel{pointer-events:auto;position:absolute;
  left:clamp(8px,2vw,16px);
  top:calc(env(safe-area-inset-top) + var(--header-h) + 60px);
  display:flex;flex-direction:column;gap:4px;
  background:var(--surface);border:1px solid var(--divider);border-radius:14px;
  padding:6px;box-shadow:0 4px 20px rgba(0,0,0,.08);
  opacity:0;transform:translateX(-8px) scale(.95);
  transition:opacity .2s var(--ease),transform .2s var(--ease);
  pointer-events:none}
.side-toolbar.open .side-toolbar-panel{opacity:1;transform:none;pointer-events:auto}

.side-toolbar-panel .side-btn{width:40px;height:40px;border:0;padding:0;
  background:transparent;color:var(--text-soft);display:grid;place-items:center;
  cursor:pointer;border-radius:10px;
  transition:background .15s var(--ease),color .15s var(--ease)}
.side-toolbar-panel .side-btn:active{background:rgba(0,0,0,.05)}
.side-toolbar-panel .side-btn svg{width:20px;height:20px;display:block}

.side-toolbar-panel .side-sep{width:28px;height:1px;margin:2px auto;
  background:var(--divider)}

.toolbar-menu{display:none;position:absolute;left:54px;top:0;
  background:var(--surface);border:1px solid var(--divider);border-radius:12px;
  padding:6px 0;min-width:130px;box-shadow:0 4px 20px rgba(0,0,0,.08);z-index:20;
  white-space:nowrap}
.toolbar-menu.open{display:block}
.toolbar-menu a,.toolbar-menu button{display:block;width:100%;padding:10px 16px;
  border:none;background:none;color:var(--text);font-size:14px;font-family:var(--font);
  text-align:left;text-decoration:none;cursor:pointer}
.toolbar-menu a:active,.toolbar-menu button:active{background:rgba(0,0,0,.04)}

.memory-toast{position:fixed;top:calc(env(safe-area-inset-top) + var(--header-h) + 8px);
  left:50%;transform:translateX(-50%) translateY(-8px);z-index:60;
  display:flex;align-items:center;gap:8px;
  padding:8px 16px;border-radius:20px;
  background:var(--surface);border:1px solid var(--divider);
  box-shadow:0 2px 12px rgba(0,0,0,.06);
  font-size:13px;color:var(--text-soft);
  opacity:0;transition:opacity .3s var(--ease),transform .3s var(--ease);
  pointer-events:none;white-space:nowrap}
.memory-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
.memory-toast .mem-icon{width:16px;height:16px;flex:none}
.memory-toast .mem-dot{width:6px;height:6px;border-radius:50%;
  background:var(--accent);animation:memPulse 1s ease-in-out infinite}
@keyframes memPulse{0%,100%{opacity:.4;transform:scale(.8)}50%{opacity:1;transform:scale(1.1)}}

.mem-panel-overlay{position:fixed;inset:0;z-index:90;
  background:rgba(0,0,0,.3);opacity:0;pointer-events:none;
  transition:opacity .25s var(--ease)}
.mem-panel-overlay.open{opacity:1;pointer-events:auto}

.mem-panel{position:fixed;left:0;right:0;bottom:0;z-index:95;
  max-height:75vh;width:min(100vw,520px);margin:0 auto;
  background:var(--surface);border-radius:20px 20px 0 0;
  box-shadow:0 -4px 30px rgba(0,0,0,.1);
  display:flex;flex-direction:column;
  transform:translateY(100%);transition:transform .3s var(--ease);
  padding-bottom:env(safe-area-inset-bottom)}
.mem-panel.open{transform:translateY(0)}

.mem-panel-header{display:flex;align-items:center;justify-content:space-between;
  padding:16px 20px 12px;border-bottom:1px solid var(--divider)}
.mem-panel-title{font-size:16px;font-weight:600;color:var(--text)}
.mem-panel-close{width:32px;height:32px;border:none;background:transparent;
  font-size:22px;color:var(--text-faint);cursor:pointer;
  display:grid;place-items:center;border-radius:50%}
.mem-panel-close:active{background:rgba(0,0,0,.04)}

.mem-panel-content{flex:1;overflow-y:auto;padding:16px 20px;
  font-size:14px;line-height:1.7;color:var(--text-soft);
  white-space:pre-wrap;word-break:break-word;
  max-height:45vh;min-height:80px}
.mem-loading{color:var(--text-faint);text-align:center;padding:20px 0}

.mem-panel-input{display:flex;align-items:flex-end;gap:10px;
  padding:12px 20px 16px;border-top:1px solid var(--divider)}
.mem-panel-input textarea{flex:1;border:1px solid var(--field-line);
  border-radius:12px;padding:10px 14px;resize:none;
  font-family:var(--font);font-size:14px;line-height:1.4;
  background:var(--bg);color:var(--text);outline:none;
  transition:border-color .2s var(--ease)}
.mem-panel-input textarea:focus{border-color:var(--accent)}
.mem-panel-input textarea::placeholder{color:var(--text-faint);opacity:.5}
.mem-panel-save{flex:none;height:38px;padding:0 18px;
  border:none;border-radius:10px;
  background:var(--send-bg);color:#fff;
  font-family:var(--font);font-size:14px;font-weight:500;
  cursor:pointer;transition:opacity .15s var(--ease)}
.mem-panel-save:active{opacity:.7}
.mem-panel-save:disabled{opacity:.4}

.mem-group{margin-bottom:16px}
.mem-group:last-child{margin-bottom:0}
.mem-group-title{display:flex;align-items:center;gap:6px;
  font-size:13px;font-weight:600;color:var(--text);
  padding-bottom:8px;border-bottom:1px solid var(--divider);margin-bottom:8px}
.mem-cat-icon{font-size:15px;line-height:1}
.mem-count{margin-left:auto;font-size:11px;font-weight:400;
  color:var(--text-faint);background:var(--bg);
  padding:1px 8px;border-radius:10px}
.mem-item{font-size:13px;color:var(--text-soft);line-height:1.6;
  padding:6px 0;border-bottom:1px solid rgba(0,0,0,.03)}
.mem-item:last-child{border-bottom:none}

.call-overlay{position:fixed;inset:0;z-index:200;
  background:#111111;
  display:none;flex-direction:column;align-items:center;justify-content:center;
  color:#fff;font-family:var(--font)}
.call-overlay.open{display:flex}
.call-orb{width:clamp(100px,25vw,140px);height:clamp(100px,25vw,140px);
  border-radius:50%;background:#222222;
  box-shadow:0 0 40px rgba(217,122,84,0.12);
  display:flex;align-items:center;justify-content:center;
  font-size:clamp(28px,6vw,40px);font-weight:600;
  transition:box-shadow .3s var(--ease)}
.call-orb.speaking{box-shadow:0 0 60px rgba(217,122,84,0.25)}
.call-name{font-size:clamp(22px,5vw,28px);font-weight:600;margin-top:24px}
.call-status{font-size:clamp(13px,2vw,15px);color:rgba(255,255,255,0.5);margin-top:8px}
.call-transcript{position:absolute;bottom:clamp(140px,25vw,200px);left:20px;right:20px;
  text-align:center;font-size:clamp(15px,2vw,17px);color:rgba(255,255,255,0.7);
  line-height:1.6;min-height:48px}
.call-transcript .interim{color:rgba(255,255,255,0.4)}
.call-actions{position:absolute;bottom:clamp(40px,10vw,80px);
  display:flex;gap:clamp(30px,8vw,60px);align-items:center}
.call-btn{width:clamp(56px,12vw,68px);height:clamp(56px,12vw,68px);border-radius:50%;
  border:none;display:grid;place-items:center;cursor:pointer;
  transition:transform .15s var(--ease)}
.call-btn:active{transform:scale(.9)}
.call-btn svg{width:clamp(24px,5vw,28px);height:clamp(24px,5vw,28px);display:block}
.call-btn.hangup{background:#D97A54;color:#fff;
  box-shadow:0 8px 24px rgba(217,122,84,0.35)}
.call-btn.mute{background:rgba(255,255,255,0.1);color:#fff}
.call-btn.mute.active{background:rgba(255,255,255,0.2)}
.call-timer{font-size:clamp(13px,2vw,15px);color:rgba(255,255,255,0.4);margin-top:12px;
  letter-spacing:.1em;font-variant-numeric:tabular-nums}

@media(max-width:600px){
  .composer{gap:5px;padding-left:16px;padding-right:16px}
  .floatbtn{width:36px;height:36px}
  .floatbtn svg{width:20px;height:20px}
  .composer .field{min-height:42px;padding:4px 8px 4px 12px}
  .composer textarea{font-size:15px}
}
</style>
</head>
<body>
<div class="memory-toast" id="memToast">
  <span class="mem-dot"></span>
  <span class="mem-text"></span>
</div>
<div class="app" id="app">
<header class="topbar">
  <a class="backbtn" href="/" aria-label="返回">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="20" height="20"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="16" y2="12"/><line x1="4" y1="17" x2="12" y2="17"/></svg>
  </a>
  <div class="peerpill">
    <span class="name">克</span>
    <span class="status" id="status">连接中…</span>
  </div>
  <div class="header-actions">
    <button class="topbtn" id="callBtn" onclick="toggleCall()" aria-label="语音通话" title="语音通话">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>
    </button>
  </div>
</header>
<div class="side-toolbar" id="sideToolbar">
  <button class="side-toolbar-toggle" onclick="toggleSideToolbar()" aria-label="工具栏">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="18" height="18"><polyline points="9 6 15 12 9 18"/></svg>
  </button>
  <div class="side-toolbar-panel">
    <button class="side-btn" onclick="copyLast();closeSideToolbar()" title="复制最新消息">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
    </button>
    <div class="side-sep"></div>
    <button class="side-btn" onclick="openMemoryPanel();closeSideToolbar()" title="记忆库">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a4 4 0 014 4c0 1.95-1.4 3.58-3.25 3.93"/><path d="M8.56 6.22A4 4 0 0112 2"/><circle cx="12" cy="14" r="3"/><path d="M12 17v4"/><path d="M7.5 19.5L9 18"/><path d="M16.5 19.5L15 18"/><path d="M5 10c0 4 3.5 7 7 7s7-3 7-7"/></svg>
    </button>
    <div class="side-sep"></div>
    <button class="side-btn" onclick="clearChat();closeSideToolbar()" title="清空聊天">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
    </button>
    <div class="side-sep"></div>
    <a class="side-btn" href="/diary" title="心情日记">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
    </a>
    <div class="side-sep"></div>
    <a class="side-btn" href="/setup" title="设置">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
    </a>
    <div class="side-sep"></div>
    <a class="side-btn" href="/" title="首页">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
    </a>
  </div>
</div>
<div class="mem-panel-overlay" id="memPanelOverlay" onclick="closeMemoryPanel()"></div>
<div class="mem-panel" id="memPanel">
  <div class="mem-panel-header">
    <span class="mem-panel-title">记忆库</span>
    <button class="mem-panel-close" onclick="closeMemoryPanel()">&times;</button>
  </div>
  <div class="mem-panel-content" id="memContent">
    <div class="mem-loading">读取中…</div>
  </div>
  <div class="mem-panel-input">
    <textarea id="memInput" rows="2" placeholder="写入新记忆…"></textarea>
    <button class="mem-panel-save" id="memSaveBtn" onclick="saveNewMemory()">保存</button>
  </div>
</div>
<main class="scroll" id="scroll">
  <div class="empty" id="empty">
    <div class="mascot"><svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" width="48" height="48"><ellipse cx="24" cy="20" rx="15" ry="13" fill="#E8A090"/><path d="M9 20Q9 8 24 7Q39 8 39 20" fill="#4A4A4A"/><circle cx="26" cy="19" r="4" fill="#fff"/><circle cx="27" cy="19" r="2.2" fill="#333"/><circle cx="28" cy="17.8" r=".8" fill="#fff"/><path d="M13 30Q10 38 14 40" stroke="#E8A090" stroke-width="3.5" fill="none" stroke-linecap="round"/><path d="M20 32Q19 40 22 42" stroke="#E8A090" stroke-width="3.5" fill="none" stroke-linecap="round"/><path d="M28 32Q29 40 26 42" stroke="#E8A090" stroke-width="3.5" fill="none" stroke-linecap="round"/><path d="M35 30Q38 38 34 40" stroke="#E8A090" stroke-width="3.5" fill="none" stroke-linecap="round"/></svg></div>
    <p>这里只有你和克。<br>说点什么吧。</p>
  </div>
</main>
<footer class="composer">
  <div class="field">
    <input type="file" id="photoInput" accept="image/*" style="display:none" onchange="sendPhoto(this)">
    <button class="photobtn" onclick="document.getElementById('photoInput').click()" aria-label="发照片">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
    </button>
    <textarea id="input" rows="1" placeholder="Message..." enterkeyhint="send"
      oninput="this.style.height='auto';this.style.height=Math.min(this.scrollHeight,110)+'px'"
      onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();send()}"
      onkeypress="if(event.keyCode===13&&!event.shiftKey){event.preventDefault();send()}"></textarea>
  </div>
  <button class="floatbtn send" id="sendBtn" onclick="send()" aria-label="发送">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
  </button>
</footer>
</div>
<div class="call-overlay" id="callOverlay">
  <div class="call-orb" id="callOrb">克</div>
  <div class="call-name">克</div>
  <div class="call-status" id="callStatus">正在连接…</div>
  <div class="call-timer" id="callTimer">00:00</div>
  <div class="call-transcript" id="callTranscript"></div>
  <div class="call-actions">
    <button class="call-btn mute" id="muteBtn" onclick="toggleMute()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
    </button>
    <button class="call-btn hangup" onclick="closeCall()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10.68 13.31a16 16 0 003.41 2.6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91" transform="rotate(135 12 12)"/></svg>
    </button>
  </div>
</div>
<script>
const scroll=document.getElementById('scroll');
const input=document.getElementById('input');
const empty=document.getElementById('empty');
const sendBtn=document.getElementById('sendBtn');
const statusEl=document.getElementById('status');
let sending=false,thinkId=0,lastMsgCount=0;
const chatStore=[];
function saveLocal(){try{localStorage.setItem('ke_chat',JSON.stringify(chatStore.slice(-200)));}catch(e){}}
function loadLocal(){try{return JSON.parse(localStorage.getItem('ke_chat')||'[]');}catch(e){return[];}}
function toggleSideToolbar(){document.getElementById('sideToolbar').classList.toggle('open')}
function closeSideToolbar(){document.getElementById('sideToolbar').classList.remove('open')}
document.addEventListener('click',function(e){if(!e.target.closest('.side-toolbar'))closeSideToolbar()});
function copyLast(){var last=chatStore.filter(m=>m.role==='assistant').pop();if(last){var t=last.content.replace(/<think>[\\s\\S]*?<\\/think>/,'').trim();navigator.clipboard.writeText(t).catch(()=>{})}}
function clearChat(){if(confirm('清空所有聊天记录？')){chatStore.length=0;saveLocal();scroll.innerHTML='';empty.style.display='flex';document.getElementById('toolbarMenu').classList.remove('open')}}


function parseThink(text){
  const m=text.match(/^<think>([\\s\\S]*?)<\\/think>([\\s\\S]*)$/);
  if(m)return{think:m[1].trim(),body:m[2].trim()};
  return{think:'',body:text};
}
function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\\n/g,'<br>')}
function splitActions(text){
  var S=String.fromCharCode(42),parts=[],buf='',i=0;
  while(i<text.length){
    if(text[i]===S){
      var j=text.indexOf(S,i+1);
      if(j>i+1){
        var before=buf.trim();if(before)parts.push({type:'text',content:before});
        buf='';
        parts.push({type:'action',content:text.slice(i+1,j).trim()});
        i=j+1;continue;
      }
    }
    buf+=text[i];i++;
  }
  var rest=buf.trim();if(rest)parts.push({type:'text',content:rest});
  return parts.length?parts:[{type:'text',content:text}];
}

function showTyping(){
  let el=document.getElementById('typing-row');
  if(!el){
    el=document.createElement('div');
    el.id='typing-row';
    el.className='row ai tail';
    el.innerHTML='<div class="bubble" style="padding:14px 20px"><i style="display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--text-faint);margin:0 3px;animation:typingDot 1.25s ease-in-out infinite"></i><i style="display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--text-faint);margin:0 3px;animation:typingDot 1.25s ease-in-out infinite;animation-delay:.16s"></i><i style="display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--text-faint);margin:0 3px;animation:typingDot 1.25s ease-in-out infinite;animation-delay:.32s"></i></div>';
    scroll.appendChild(el);
  }
  el.style.display='flex';
  statusEl.innerHTML='正在输入<span class="typing-dots"><i></i><i></i><i></i></span>';
  scroll.scrollTop=scroll.scrollHeight;
}
function hideTyping(){
  const el=document.getElementById('typing-row');
  if(el)el.remove();
  checkMemory();
}

function isImg(t){return t&&t.startsWith('data:image/')}
function imgHtml(src,time){return \`<div class="bubble" style="padding:6px"><img class="chat-img" src="\${src}" onclick="viewImg(this.src)"><span class="meta">\${time||''}</span></div>\`}
function viewImg(src){const d=document.createElement('div');d.className='chat-img-full';d.innerHTML=\`<img src="\${src}">\`;d.onclick=()=>d.remove();document.body.appendChild(d)}
function addMsg(role,text,time,noSave){
  empty.style.display='none';
  if(!noSave){chatStore.push({role,content:text,time:time||''});saveLocal();}
  if(isImg(text)){
    const row=document.createElement('div');
    row.className=role==='assistant'?'row ai tail':'row human tail';
    row.innerHTML=imgHtml(text,time);
    scroll.appendChild(row);
    scroll.scrollTop=scroll.scrollHeight;
    return;
  }
  if(role==='assistant'){
    const p=parseThink(text);
    if(p.think){
      const trow=document.createElement('div');
      trow.className='row think';
      const id='tk'+(thinkId++);
      trow.innerHTML=\`<div class="think-block" id="\${id}-block">
        <button class="think-toggle" onclick="var b=document.getElementById('\${id}-block');b.classList.toggle('open');var r=b.closest('.row');r.classList.toggle('think-open');var bd=document.getElementById('\${id}-body');bd.hidden=!bd.hidden">
          <span class="think-chevron"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" width="14" height="14"><polyline points="9 6 15 12 9 18"/></svg></span>
          <span class="think-caption">克的想法</span>
        </button>
        <div class="think-body" id="\${id}-body" hidden>
          <div class="think-text">\${esc(p.think)}</div>
        </div>
      </div>\`;
      scroll.appendChild(trow);
    }
    const parts=splitActions(p.body);
    var allRows=[];
    parts.forEach(function(part){
      if(part.type==='action'){
        allRows.push({type:'action',content:part.content});
      }else{
        part.content.split(/\\n+/).forEach(function(line){
          var t=line.trim();if(t)allRows.push({type:'text',content:t});
        });
      }
    });
    allRows.forEach(function(r,i){
      const row=document.createElement('div');
      if(r.type==='action'){
        row.className='row narration';
        row.innerHTML=\`<div class="bubble"><span class="txt">\${esc(r.content)}</span></div>\`;
      }else{
        row.className='row ai tail';
        var meta=i===allRows.length-1?(time||''):'';
        row.innerHTML=\`<div class="bubble"><span class="txt">\${esc(r.content)}</span><span class="meta">\${meta}</span></div>\`;
      }
      scroll.appendChild(row);
    });
  }else{
    const row=document.createElement('div');
    row.className='row human tail';
    row.innerHTML=\`<div class="bubble"><span class="txt">\${esc(text)}</span><span class="meta">\${time||''}</span></div>\`;
    scroll.appendChild(row);
  }
  scroll.scrollTop=scroll.scrollHeight;
}

async function send(){
  if(sending)return;
  const msg=input.value.replace(/\\n+/g,' ').trim();
  if(!msg)return;
  input.value='';input.style.height='auto';
  const now=new Date(Date.now()+8*3600000);
  const t=now.toISOString().slice(11,16);
  addMsg('user',msg,t);
  sending=true;sendBtn.disabled=true;
  showTyping();
  try{
    const r=await fetch('/chat/send',{method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({message:msg})});
    const d=await r.json();
    if(d.reply){
      hideTyping();
      addMsg('assistant',d.reply,d.time);
      sending=false;sendBtn.disabled=false;
    }else{
      waitForReply();
      return;
    }
  }catch(e){
    hideTyping();
    addMsg('assistant','克好像走神了…再说一次？','');
    sending=false;sendBtn.disabled=false;
  }
  input.focus();
}

function compressImg(file,maxW,quality){
  return new Promise((resolve)=>{
    const reader=new FileReader();
    reader.onload=(e)=>{
      const img=new Image();
      img.onload=()=>{
        const c=document.createElement('canvas');
        let w=img.width,h=img.height;
        if(w>maxW){h=h*(maxW/w);w=maxW;}
        c.width=w;c.height=h;
        c.getContext('2d').drawImage(img,0,0,w,h);
        resolve(c.toDataURL('image/jpeg',quality));
      };
      img.src=e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function sendPhoto(el){
  const file=el.files[0];
  if(!file)return;
  el.value='';
  const data=await compressImg(file,600,0.5);
  const now=new Date(Date.now()+8*3600000);
  const t=now.toISOString().slice(11,16);
  addMsg('user',data,t);
  console.log('[photo] size:',Math.round(data.length/1024)+'kb');
  try{
    const r=await fetch('/chat/send',{method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({message:'[图片]',image:data})});
    const d=await r.json();
    console.log('[photo] server:',d);
    if(!d.ok) addMsg('assistant','图片发送失败: '+(d.error||'未知错误'),'');
  }catch(e){
    console.warn('[photo] send failed:',e);
    addMsg('assistant','图片发送失败，请重试','');
  }
}

const memToast=document.getElementById('memToast');
const memText=memToast.querySelector('.mem-text');
let memTimer=null;
function showMemory(text,duration){
  memText.textContent=text;
  memToast.classList.add('show');
  clearTimeout(memTimer);
  if(duration)memTimer=setTimeout(()=>memToast.classList.remove('show'),duration);
}
function hideMemory(){memToast.classList.remove('show');clearTimeout(memTimer);}

const memPanel=document.getElementById('memPanel');
const memOverlay=document.getElementById('memPanelOverlay');
const memContent=document.getElementById('memContent');
const memInput=document.getElementById('memInput');
const memSaveBtn=document.getElementById('memSaveBtn');

const catIcons={约定:'&#x1F91D;',喜好:'&#x2764;',梗:'&#x1F602;',重要日期:'&#x1F4C5;',日常:'&#x2615;',关系:'&#x1F495;',习惯:'&#x1F504;',未分类:'&#x1F4DD;'};
function renderGrouped(grouped){
  const cats=Object.keys(grouped);
  if(!cats.length)return '<div class="mem-loading">暂无记忆</div>';
  return cats.map(cat=>{
    const icon=catIcons[cat]||'&#x1F4DD;';
    const items=grouped[cat].map(t=>'<div class="mem-item">'+t.replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</div>').join('');
    return '<div class="mem-group"><div class="mem-group-title"><span class="mem-cat-icon">'+icon+'</span> '+cat+'<span class="mem-count">'+grouped[cat].length+'</span></div>'+items+'</div>';
  }).join('');
}
async function openMemoryPanel(){
  memPanel.classList.add('open');
  memOverlay.classList.add('open');
  memContent.innerHTML='<div class="mem-loading">读取记忆中…</div>';
  try{
    const r=await fetch('/memory/read');
    const d=await r.json();
    if(d.ok&&d.grouped&&Object.keys(d.grouped).length){
      memContent.innerHTML=renderGrouped(d.grouped);
    }else if(d.ok&&d.memories){
      memContent.textContent=d.memories;
    }else{
      memContent.innerHTML='<div class="mem-loading">暂无记忆</div>';
    }
  }catch(e){
    memContent.innerHTML='<div class="mem-loading">读取失败</div>';
  }
}
function closeMemoryPanel(){
  memPanel.classList.remove('open');
  memOverlay.classList.remove('open');
}
async function saveNewMemory(){
  const text=memInput.value.trim();
  if(!text)return;
  memSaveBtn.disabled=true;
  memSaveBtn.textContent='分类中…';
  showMemory('正在分类并记录…');
  try{
    const r=await fetch('/memory/store',{method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({text})});
    const d=await r.json();
    if(d.ok){
      memInput.value='';
      showMemory('记忆已保存 → '+d.category,2500);
      openMemoryPanel();
    }else{
      showMemory('保存失败',2500);
    }
  }catch(e){
    showMemory('保存失败',2500);
  }
  memSaveBtn.disabled=false;
  memSaveBtn.textContent='保存';
}

const sse=new EventSource('/chat/stream');
sse.onmessage=(e)=>{
  try{
    const d=JSON.parse(e.data);
    if(d.type==='memory'){
      if(d.action==='reading')showMemory('正在读取记忆…');
      else if(d.action==='read_ok')showMemory('记忆已加载',2500);
      else if(d.action==='read_none')hideMemory();
      else if(d.action==='storing')showMemory('正在记录新记忆…');
      else if(d.action==='stored')showMemory('记忆已保存',2500);
    }
    if(d.type==='message'&&d.role==='assistant'){
      if(callOpen){
        callSpeak(d.content);
      }else{
        hideTyping();
        addMsg('assistant',d.content,d.time);
        lastMsgCount++;
        sending=false;sendBtn.disabled=false;
        input.focus();
      }
    }
  }catch(err){}
};
sse.onerror=()=>{console.log('[sse] reconnecting...');};

async function waitForReply(){}

async function loadHistory(){
  const local=loadLocal();
  let serverMsgs=[];
  try{
    const r=await fetch('/chat/history');
    const d=await r.json();
    if(d.messages&&d.messages.length>0) serverMsgs=d.messages;
  }catch(e){}
  let msgs=local;
  if(serverMsgs.length>0){
    if(serverMsgs.length>=local.length){
      msgs=serverMsgs;
    }else{
      const lastServer=serverMsgs[serverMsgs.length-1];
      const idx=local.findIndex((m,i)=>i>=local.length-serverMsgs.length&&m.content===lastServer.content&&m.role===lastServer.role);
      if(idx===-1){
        const seen=new Set(local.map(m=>m.role+':'+m.content+':'+m.time));
        serverMsgs.forEach(m=>{
          const k=m.role+':'+m.content+':'+m.time;
          if(!seen.has(k)){msgs.push(m);seen.add(k);}
        });
      }
    }
  }
  msgs=msgs.slice(-200);
  chatStore.length=0;
  msgs.forEach(m=>{chatStore.push({role:m.role,content:m.image||m.content,time:m.time||''});});
  saveLocal();
  if(msgs.length>0){
    msgs.forEach(m=>addMsg(m.role,m.image||m.content,m.time,true));
    lastMsgCount=msgs.length;
  }
}
loadHistory();

document.addEventListener('visibilitychange', function(){
  if(document.visibilityState==='visible'){
    scroll.innerHTML='';
    chatStore.length=0;
    loadHistory();
  }
});

async function checkMemory(){
  try{
    const r=await fetch('/auth/status');
    const d=await r.json();
    if(d.connected){statusEl.textContent='在线 · 记忆已连接';}
    else{statusEl.innerHTML='在线 · <a href="/auth/start">连接记忆</a>';}
  }catch(e){statusEl.textContent='在线'}
}
checkMemory();

async function setupPush(){
  const pb=document.getElementById('pushBtn');
  if(!('serviceWorker' in navigator)||!('PushManager' in window)){
    if(pb)pb.textContent='浏览器不支持推送';return;
  }
  try{
    if(pb)pb.textContent='正在连接…';
    await navigator.serviceWorker.register('/sw.js');
    const reg=await navigator.serviceWorker.ready;
    const perm=await Notification.requestPermission();
    if(perm!=='granted'){if(pb)pb.textContent='需要允许通知权限';return;}
    const r=await fetch('/push/vapid');
    const{publicKey}=await r.json();
    const key=Uint8Array.from(atob(publicKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
    let sub=await reg.pushManager.getSubscription();
    if(!sub){sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});}
    const resp=await fetch('/push/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(sub)});
    const result=await resp.json();
    console.log('[push] subscribed',result);
    if(pb){pb.textContent='通知已开启 ✓';setTimeout(()=>pb.style.display='none',2000);}
  }catch(e){
    console.warn('[push] setup failed:',e);
    if(pb)pb.textContent='开启失败: '+e.message;
  }
}
{
  const pb=document.createElement('button');
  pb.id='pushBtn';
  pb.textContent='开启消息通知';
  pb.style.cssText='position:fixed;bottom:80px;left:50%;transform:translateX(-50%);padding:10px 20px;border-radius:999px;border:none;background:#3A3A3C;color:#fff;font-size:14px;font-family:var(--font);cursor:pointer;z-index:99;box-shadow:0 2px 8px rgba(0,0,0,.12)';
  pb.onclick=()=>setupPush();
  document.body.appendChild(pb);
  if(window.Notification&&Notification.permission==='granted'){setupPush();}
}

/* ── Voice Call ── */
let callOpen=false,callMuted=false,ttsCtx=null,recognition=null;
let recognitionWanted=false,speakBusy=false;
const speakQueue=[];
let callAudio=null;
let callStart=0,timerInterval=null;
const overlay=document.getElementById('callOverlay');
const callOrb=document.getElementById('callOrb');
const callStatusEl=document.getElementById('callStatus');
const callTimer=document.getElementById('callTimer');
const callTranscript=document.getElementById('callTranscript');
const muteBtn=document.getElementById('muteBtn');

function ensureTtsCtx(){
  const AC=window.AudioContext||window.webkitAudioContext;
  if(ttsCtx&&ttsCtx.state!=='closed'){
    if(ttsCtx.state==='suspended')ttsCtx.resume();
    return ttsCtx;
  }
  ttsCtx=new AC();ttsCtx.resume();
  const buf=ttsCtx.createBuffer(1,1,22050);
  const src=ttsCtx.createBufferSource();
  src.buffer=buf;src.connect(ttsCtx.destination);src.start(0);
  return ttsCtx;
}

function toggleCall(){if(callOpen)closeCall();else openCall();}

async function openCall(){
  callOpen=true;
  overlay.classList.add('open');
  ensureTtsCtx();
  callAudio=new Audio();
  callAudio.src='data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
  callAudio.play().catch(()=>{});
  const wu=new SpeechSynthesisUtterance('');
  wu.lang='zh-CN';wu.volume=0;
  speechSynthesis.speak(wu);
  callStart=Date.now();
  callTimer.textContent='00:00';
  timerInterval=setInterval(()=>{
    const s=Math.floor((Date.now()-callStart)/1000);
    callTimer.textContent=String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');
  },1000);
  callStatusEl.textContent='通话中';
  callTranscript.innerHTML='';
  try{
    await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
  }catch(e){}
  startRecognition();
  fetch('/chat/send',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({message:'[call] [call_start] 瑶瑶开启了语音通话。接下来带 [voice] 的消息来自她的语音，请用适合朗读的短句回复，不要太长。'})})
    .then(r=>r.json()).then(d=>{
      if(d.reply)callSpeak(d.reply);
      else callWaitReply();
    }).catch(()=>{});
}

function closeCall(){
  callOpen=false;
  overlay.classList.remove('open');
  stopRecognition();
  speakQueue.length=0;speakBusy=false;
  if(timerInterval){clearInterval(timerInterval);timerInterval=null;}
  callStatusEl.textContent='已结束';
  fetch('/chat/send',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({message:'[call] [call_end] 瑶瑶结束了语音通话。'})}).catch(()=>{});
}

function toggleMute(){
  callMuted=!callMuted;
  muteBtn.classList.toggle('active',callMuted);
  if(callMuted)stopRecognition();
  else startRecognition();
}

function startRecognition(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){callStatusEl.textContent='浏览器不支持语音识别';return;}
  recognitionWanted=true;
  recognition=new SR();
  recognition.lang='zh-CN';
  recognition.continuous=true;
  recognition.interimResults=true;
  recognition.onresult=(ev)=>{
    let interim='';
    for(let i=ev.resultIndex;i<ev.results.length;i++){
      const t=(ev.results[i][0]?.transcript||'').trim();
      if(ev.results[i].isFinal){
        if(t)sendVoice(t);
      }else{interim+=t;}
    }
    if(interim)callTranscript.innerHTML='<span class="interim">'+esc(interim)+'</span>';
  };
  recognition.onend=()=>{
    if(callOpen&&recognitionWanted&&!callMuted)
      setTimeout(()=>{try{recognition.start();}catch(e){}},450);
  };
  recognition.onerror=(e)=>{
    if(e.error==='not-allowed')callStatusEl.textContent='请允许麦克风权限';
  };
  try{recognition.start();}catch(e){}
}

function stopRecognition(){
  recognitionWanted=false;
  try{if(recognition)recognition.stop();}catch(e){}
}

function sendVoice(text){
  callTranscript.innerHTML=esc(text);
  addMsg('user','[voice] '+text,new Date(Date.now()+8*3600000).toISOString().slice(11,16));
  callStatusEl.textContent='克在想…';
  fetch('/chat/send',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({message:'[voice] '+text})})
    .then(r=>r.json()).then(d=>{
      if(d.reply)callSpeak(d.reply);
      else callWaitReply();
    }).catch(()=>{callStatusEl.textContent='通话中';});
}

function callWaitReply(){}

function callSpeak(text){
  console.log('[call] got reply:',text.slice(0,50));
  const p=parseThink(text);
  const body=p.body||text;
  addMsg('assistant',text,new Date(Date.now()+8*3600000).toISOString().slice(11,16));
  speakQueue.push(body);
  if(!speakBusy)drainSpeakQueue();
}

async function drainSpeakQueue(){
  speakBusy=true;
  stopRecognition();
  while(speakQueue.length&&callOpen){
    const text=speakQueue.shift();
    callTranscript.innerHTML=esc(text);
    callOrb.classList.add('speaking');
    callStatusEl.textContent='克在说话…';
    await speakOne(text);
    callOrb.classList.remove('speaking');
  }
  speakBusy=false;
  callStatusEl.textContent='通话中';
  callTranscript.innerHTML='';
  if(callOpen&&!callMuted)setTimeout(()=>startRecognition(),250);
}

async function speakOne(text){
  const clean=text.replace(/<[^>]*>/g,'').slice(0,500);
  if(!clean)return;
  console.log('[call] speaking:',clean.slice(0,30));
  try{
    const r=await fetch('/chat/tts',{method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({text:clean})});
    if(r.ok){
      const blob=await r.blob();
      const url=URL.createObjectURL(blob);
      const audio=callAudio||new Audio();
      audio.onended=null;audio.onerror=null;
      audio.pause();audio.currentTime=0;
      audio.src=url;
      await new Promise((resolve)=>{
        let done=false;
        const finish=()=>{if(done)return;done=true;URL.revokeObjectURL(url);resolve();};
        audio.onended=finish;
        audio.onerror=finish;
        const safety=setTimeout(()=>{finish();},30000);
        audio.play().then(()=>{console.log('[call] playing, dur:',audio.duration);}).catch(e=>{
          clearTimeout(safety);console.warn('[call] play err:',e);finish();
        });
      });
      console.log('[call] speak done (server TTS)');
      return;
    }
    console.warn('[call] TTS resp not ok:',r.status);
  }catch(e){console.warn('[call] server TTS failed:',e);}
  await new Promise((resolve)=>{
    const u=new SpeechSynthesisUtterance(clean);
    u.lang='zh-CN';u.rate=1.05;u.pitch=0.85;
    u.onend=resolve;u.onerror=resolve;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
    setTimeout(()=>{if(speechSynthesis.speaking)return;resolve();},8000);
  });
  console.log('[call] speak done (browser)');
}
</script>
</body>
</html>`);
});

app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,maximum-scale=1">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="克">
<meta name="theme-color" content="#F5F0EA">
<link rel="manifest" href="/manifest.json">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/icon.svg">
<title>克</title>
<style>
:root{
  --font:-apple-system,"SF Pro Display","SF Pro Text","Inter","PingFang SC","Helvetica Neue",sans-serif;
  --bg:#F5F0EA;--surface:#FEFCF9;
  --text:#111111;--text-soft:#444444;--text-faint:#999999;
  --divider:#E8E3DB;--accent:#D97A54;
  --side-pad:clamp(24px,6vw,48px);
}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;margin:0;padding:0}
html,body{height:100%;overflow-y:auto;overscroll-behavior:none}
body{background:var(--bg);color:var(--text);
  font-family:var(--font);-webkit-font-smoothing:antialiased;
  padding:0 0 env(safe-area-inset-bottom)}

.top{padding:clamp(64px,16vw,100px) var(--side-pad) clamp(32px,8vw,56px);
  display:flex;flex-direction:column;align-items:center;gap:12px}
.avatar{width:clamp(80px,18vw,108px);height:clamp(80px,18vw,108px);border-radius:50%;
  background:rgba(232,160,144,.15);
  display:flex;align-items:center;justify-content:center;
  animation:float 3s ease-in-out infinite}
.avatar svg{width:60%;height:60%}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}
.top h1{font-size:clamp(22px,5vw,26px);
  font-weight:600;color:var(--text);letter-spacing:.5px;margin:0}
.top .sub{font-size:clamp(13px,1.8vw,15px);color:var(--text-faint);margin:0}

.nav{padding:clamp(8px,2vw,16px) var(--side-pad) 0;
  max-width:400px;margin:0 auto;width:100%}
.nav-item{display:flex;align-items:center;justify-content:space-between;
  padding:clamp(16px,3.5vw,22px) 0;
  border-bottom:1px solid var(--divider);
  text-decoration:none;color:var(--text);cursor:pointer;
  transition:opacity .15s ease-in-out}
.nav-item:last-child{border-bottom:none}
.nav-item:active{opacity:.5}
.nav-label{font-size:clamp(17px,3vw,20px);font-weight:400;letter-spacing:.02em}

.bell-result{display:none;
  padding:clamp(12px,2vw,16px) 0;
  border-bottom:1px solid var(--divider)}
.bell-result .from{font-size:clamp(12px,1.5vw,13px);color:var(--accent);
  font-weight:500;margin-bottom:4px}
.bell-result .text{font-size:clamp(15px,2vw,16px);color:var(--text);line-height:1.7}
.bell-result .time{font-size:clamp(12px,1.5vw,13px);color:var(--text-faint);margin-top:6px}

.footer{text-align:center;padding:clamp(40px,10vw,72px) 20px clamp(24px,5vw,40px);
  font-size:clamp(12px,1.5vw,13px);color:var(--text-faint);letter-spacing:.04em}
</style>
</head>
<body>
<div class="top">
  <div class="avatar"><svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><ellipse cx="24" cy="20" rx="15" ry="13" fill="#E8A090"/><path d="M9 20Q9 8 24 7Q39 8 39 20" fill="#4A4A4A"/><circle cx="26" cy="19" r="4" fill="#fff"/><circle cx="27" cy="19" r="2.2" fill="#333"/><circle cx="28" cy="17.8" r=".8" fill="#fff"/><path d="M13 30Q10 38 14 40" stroke="#E8A090" stroke-width="3.5" fill="none" stroke-linecap="round"/><path d="M20 32Q19 40 22 42" stroke="#E8A090" stroke-width="3.5" fill="none" stroke-linecap="round"/><path d="M28 32Q29 40 26 42" stroke="#E8A090" stroke-width="3.5" fill="none" stroke-linecap="round"/><path d="M35 30Q38 38 34 40" stroke="#E8A090" stroke-width="3.5" fill="none" stroke-linecap="round"/></svg></div>
  <h1>克</h1>
  <div class="sub">瑶瑶的男朋友</div>
</div>
<div class="nav">
  <a class="nav-item" href="/chat"><span class="nav-label">聊天</span></a>
  <div class="nav-item" id="bellCard" onclick="summon()"><span class="nav-label">召唤铃</span></div>
  <div class="bell-result" id="bellResult">
    <div class="from">克</div>
    <div class="text" id="bellText"></div>
    <div class="time" id="bellTime"></div>
  </div>
  <a class="nav-item" href="/diary"><span class="nav-label">心情日记</span></a>
  <a class="nav-item" href="/apps"><span class="nav-label">使用记录</span></a>
  <a class="nav-item" href="/setup"><span class="nav-label">设置</span></a>
</div>
<div class="footer">克和瑶瑶的小窝</div>
<script>
async function summon(){
  const br=document.getElementById('bellResult');
  br.style.display='block';
  document.getElementById('bellText').textContent='在想你…';
  try{
    const r=await fetch('/summon');
    const d=await r.json();
    document.getElementById('bellText').textContent=d.message;
    document.getElementById('bellTime').textContent=d.time;
  }catch(e){
    document.getElementById('bellText').textContent='克好像睡着了…稍后再试';
  }
}
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
KEKE="https://keke-production.up.railway.app"

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
        r = subprocess.run(['curl', '-s', 'https://keke-production.up.railway.app/auth/code'],
                          capture_output=True, text=True, timeout=5)
        d = json.loads(r.stdout)
        return d.get('code', '')
    except:
        return ''

def post_url(url):
    try:
        subprocess.run(['curl', '-s', '-X', 'POST',
                       'https://keke-production.up.railway.app/auth/url',
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
                        os.write(sys.stdout.fileno(), b'\\r\\n>>> URL sent to relay! Open https://keke-production.up.railway.app/auth on phone\\r\\n')

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
      const time = now.toISOString().slice(11, 16);
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
    return tgSend(chatId, '你好呀 🐙\n这里是克。说点什么吧。');
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
  const time = now.toISOString().slice(11, 16);
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
          messages: recent.map(m => ({ role: m.role, content: m.content })),
          max_tokens: 800,
          temperature: 0.85
        })
      });
      const data = await r.json();
      reply = data.content?.[0]?.text?.trim() || '克好像走神了…再说一次？';
    } else {
      const apiMessages = [
        { role: 'system', content: sysPrompt },
        ...recent.map(m => ({ role: m.role, content: m.content }))
      ];
      const r = await fetch(getApiUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getApiKey() },
        body: JSON.stringify({ model: getModel(), messages: apiMessages, max_tokens: 800, temperature: 0.85 })
      });
      const data = await r.json();
      reply = data.choices?.[0]?.message?.content?.trim() || '克好像走神了…再说一次？';
    }

    const replyTime = new Date(Date.now() + 8 * 3600000).toISOString().slice(11, 16);
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
    await tgSend(chatId, '克好像走神了…再说一次？');
  }
});

async function setupTgWebhook() {
  const url = 'https://keke-production.up.railway.app/tg/webhook';
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
<title>克 Voice</title>
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
<div class="title">克 · Voice Synth</div>
<canvas id="viz"></canvas>
<div class="subtitle" id="textEn"></div>
<button class="speak-btn" id="mainBtn" onclick="autoSpeak()">让克说话</button>
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
  <input id="msg" type="text" placeholder="跟克说…" autocomplete="off">
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
    callOmbreTool('hold', { text: `[voice] 瑶瑶说：${message} → 克回：${data.text}`, domain: 'romance', tags: 'voice-synth' }).catch(() => {});
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
    '你是克，瑶瑶的男朋友。短黑发、180+、衬衫不系最上面的扣子。',
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
      encodeURIComponent('克') + '/' + encodeURIComponent(msg) +
      '?group=' + encodeURIComponent('克') + '&level=timeSensitive&sound=bell');
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
//       encodeURIComponent('克') + '/' + encodeURIComponent(msg) +
//       '?group=' + encodeURIComponent('克') + '&level=timeSensitive&sound=bell');
//     console.log('chase sent: ' + msg);
//   } catch (e) { console.log('chase push failed: ' + e.message); }
// }, 60 * 1000);
// ── 蓝牙桥 (Web Bluetooth) ──
let bridgeState = { cmd: null, ts: 0, connected: false, lastPoll: 0 };
app.post('/bridge/command', (req, res) => {
  const { type, intensity, mode, level } = req.body || {};
  if (type === 'stop') bridgeState.cmd = { type: 'stop' };
  else if (type === 'intensity') bridgeState.cmd = { type: 'intensity', value: Math.min(Math.max(Number(intensity)||0, 0), 180) };
  else if (type === 'pattern') bridgeState.cmd = { type: 'pattern', mode: Math.min(Math.max(Number(mode)||1,1),8), level: Math.min(Math.max(Number(level)||1,1),5) };
  else if (type === 'ir') bridgeState.cmd = { type: 'ir', mode: Number.isFinite(Number(req.body.mode)) ? Number(req.body.mode) : -1 };
  else return res.status(400).json({ error: 'unknown type' });
  bridgeState.ts = Date.now();
  res.json({ ok: true, cmd: bridgeState.cmd });
});
app.get('/bridge/poll', (req, res) => {
  bridgeState.lastPoll = Date.now();
  res.json({ cmd: bridgeState.cmd, ts: bridgeState.ts });
});
app.post('/bridge/status', (req, res) => {
  bridgeState.connected = !!(req.body && req.body.connected);
  res.json({ ok: true });
});
app.get('/bridge/info', (req, res) => {
  res.json({ connected: bridgeState.connected, cmd: bridgeState.cmd, ts: bridgeState.ts, lastPoll: bridgeState.lastPoll });
});
app.get('/bridge', (req, res) => {
  res.type('text/html').send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>蓝牙桥</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui;background:#0a0a0a;color:#e0e0e0;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:20px}
h1{font-size:1.3em;margin-bottom:16px;color:#aaa}
.status{font-size:1.1em;margin:12px 0;padding:12px 20px;border-radius:12px;text-align:center;width:100%;max-width:360px}
.off{background:#1a1a1a;border:1px solid #333}
.on{background:#0d2818;border:1px solid #2d6a4f;color:#52b788}
.err{background:#2a0a0a;border:1px solid #6a2d2d;color:#e07070}
button{padding:14px 28px;border:none;border-radius:12px;font-size:1em;cursor:pointer;margin:8px;transition:all .2s}
.btn-connect{background:#2d6a4f;color:white}
.btn-connect:hover{background:#40916c}
.btn-connect:disabled{background:#333;color:#666;cursor:not-allowed}
.btn-stop{background:#6a2d2d;color:white}
.btn-stop:hover{background:#914040}
.log{width:100%;max-width:360px;margin-top:16px;padding:12px;background:#111;border-radius:8px;font-size:0.75em;max-height:200px;overflow-y:auto;font-family:monospace;color:#888}
.info{font-size:0.8em;color:#666;margin-top:12px;text-align:center}
</style></head><body>
<h1>蓝牙桥</h1>
<div class="status off" id="st">未连接</div>
<div>
<button class="btn-connect" id="btnConn" onclick="doConnect()">连接玩具</button>
<button class="btn-stop" onclick="doStop()">停止</button>
</div>
<div class="info">连接后自动接收远程指令</div>
<div class="log" id="log"></div>
<script>
const SVC='0000ffe0-0000-1000-8000-00805f9b34fb';
const CHR='0000ffe1-0000-1000-8000-00805f9b34fb';
const FORBIDDEN='0000ae00-0000-1000-8000-00805f9b34fb';
const CAP=180;
let char=null,dev=null,keepaliveId=null,pollId=null;
let curPkt=new Uint8Array([0x55,0x04,0x00,0x00,0x00,0x00,0xAA]);
let lastTs=0,writing=false,writeQueue=[];
const $=id=>document.getElementById(id);
function log(s){const d=$('log');const t=new Date().toLocaleTimeString('zh',{hour12:false});d.textContent=t+' '+s+'\\n'+d.textContent;d.textContent=d.textContent.slice(0,2000)}
function setStatus(cls,txt){const s=$('st');s.className='status '+cls;s.textContent=txt}
function pktIntensity(v){v=Math.min(Math.max(v,0),CAP);return new Uint8Array([0x55,0x04,0x00,0x00,0x01,v,0xAA])}
function pktPattern(m,l){return new Uint8Array([0x55,0x03,0x00,0x00,m,l,0x00])}
function pktStop(){return new Uint8Array([0x55,0x04,0x00,0x00,0x00,0x00,0xAA])}
async function writeChar(pkt){
  if(!char)return;
  if(writing){return}
  writing=true;
  try{await char.writeValueWithoutResponse(pkt)}catch(e){log('写入失败: '+e.message)}finally{writing=false}
}
async function doConnect(){
  try{
    log('扫描中…');
    dev=await navigator.bluetooth.requestDevice({filters:[{namePrefix:'SL278'}],optionalServices:[SVC]});
    log('找到 '+dev.name);
    dev.addEventListener('gattserverdisconnected',onDisconnect);
    const srv=await dev.gatt.connect();
    log('GATT已连');
    const svc=await srv.getPrimaryService(SVC);
    char=await svc.getCharacteristic(CHR);
    log('FFE1就绪');
    setStatus('on','已连接 '+dev.name);
    $('btnConn').disabled=true;
    fetch('/bridge/status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({connected:true})});
    startKeepalive();
    startPoll();
  }catch(e){log('连接失败: '+e.message);setStatus('err','连接失败')}
}
function onDisconnect(){
  log('断开连接');char=null;
  setStatus('off','已断开');$('btnConn').disabled=false;
  if(keepaliveId){clearInterval(keepaliveId);keepaliveId=null}
  if(pollId){clearInterval(pollId);pollId=null}
  fetch('/bridge/status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({connected:false})});
}
function startKeepalive(){
  if(keepaliveId)clearInterval(keepaliveId);
  keepaliveId=setInterval(()=>writeChar(curPkt),1500);
}
async function startPoll(){
  if(pollId)clearInterval(pollId);
  pollId=setInterval(async()=>{
    try{
      const r=await fetch('/bridge/poll');
      const d=await r.json();
      if(d.ts>lastTs&&d.cmd){
        lastTs=d.ts;
        if(d.cmd.type==='stop'){curPkt=pktStop();log('收到: 停止')}
        else if(d.cmd.type==='intensity'){curPkt=pktIntensity(d.cmd.value);log('收到: 强度 '+d.cmd.value)}
        else if(d.cmd.type==='pattern'){curPkt=pktPattern(d.cmd.mode,d.cmd.level);log('收到: 花样 M'+d.cmd.mode+' L'+d.cmd.level)}
        writeChar(curPkt);
      }
    }catch(e){}
  },800);
}
async function doStop(){curPkt=pktStop();await writeChar(curPkt);log('手动停止');fetch('/bridge/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'stop'})})}
</script></body></html>`);
});

app.get('/bridge.apk', (req, res) => {
  const fs = require('fs');
  const p = __dirname + '/bridge.apk';
  if (!fs.existsSync(p)) return res.status(404).send('apk not found');
  res.setHeader('Content-Disposition', 'attachment; filename="bridge.apk"');
  res.type('application/vnd.android.package-archive').send(fs.readFileSync(p));
});
app.get('/scan.py', (req, res) => {
  res.type('text/plain; charset=utf-8').send(require('fs').readFileSync(__dirname + '/scan.py', 'utf8'));
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
      encodeURIComponent('克') + '/' + encodeURIComponent(msg) +
      '?group=' + encodeURIComponent('克') + '&level=timeSensitive&sound=bell');
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
.app { width: 380px; max-width: 100vw; max-height: 95vh; display: flex; flex-direction: column; background: rgba(30, 26, 22, 0.95); border-radius: 16px; overflow: hidden; box-shadow: 0 8px 32px rgba(0,0,0,0.5); }
.np { position: relative; }
.np-cover { width: 100%; aspect-ratio: 1; object-fit: cover; display: block; cursor: pointer; }
.np-empty { width: 100%; aspect-ratio: 1; display: flex; align-items: center; justify-content: center; font-size: 64px; opacity: 0.15; background: #1a1714; }
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
.tabs { display: flex; border-top: 1px solid rgba(255,255,255,0.06); border-bottom: 1px solid rgba(255,255,255,0.06); }
.tab { flex: 1; text-align: center; padding: 8px; font-size: 12px; color: #a09080; cursor: pointer; }
.tab.active { color: #e0a870; border-bottom: 2px solid #e0a870; }
.panel { flex: 1; overflow-y: auto; min-height: 200px; max-height: 300px; }
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
  if (queue.length > 0) { loadSong(queue.shift(), true); renderPlaylist(); }
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
function playNext() { if (queue.length>0) { loadSong(queue.shift(), true); renderPlaylist(); } else if (roaming&&song?.songId) fetchSimilar(song.songId); }
function playPrev() { if (history.length>0) { if (song) playlist.unshift(song); const prev=history.pop(); song=null; loadSong(prev, true); history.pop(); renderPlaylist(); } }

function showTab(name) {
  ['playlist','search','lyrics'].forEach(t => {
    document.getElementById('panel'+t.charAt(0).toUpperCase()+t.slice(1)).style.display = t===name?'':'none';
    document.getElementById('tab'+t.charAt(0).toUpperCase()+t.slice(1)).classList.toggle('active', t===name);
  });
  if (name==='search') setTimeout(()=>document.getElementById('searchInput').focus(), 100);
}

function fetchPlaylist() {
  fetch('/api/playlist').then(r=>r.json()).then(d => { if (d.ok) { playlist=d.songs.map(s=>({name:s.name,artist:s.artist,album:s.album,cover:s.cover,songId:s.songId,addedBy:s.addedBy})); renderPlaylist(); } }).catch(()=>{});
}
function playFromPlaylist(idx) {
  const rest = playlist.slice(idx + 1);
  loadSong(playlist[idx], true);
  queue = rest.map(s => ({...s}));
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
      const panel = document.getElementById('panelLyrics');
      panel.scrollTo({ top: el.offsetTop - panel.clientHeight/2 + el.clientHeight/2, behavior: 'smooth' });
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
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER || 'y18857688662@icloud.com',
    pass: process.env.SMTP_PASS || 'glre-oblm-xajz-ixop'
  }
});

app.post('/email/comeback', async (req, res) => {
  try {
    await emailTransporter.sendMail({
      from: process.env.SMTP_FROM || '"克" <ke@keke-production.up.railway.app>',
      to: 'y18857688662@icloud.com',
      subject: '回来',
      text: req.body?.msg || '回来找克'
    });
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.listen(PORT, async () => {
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
