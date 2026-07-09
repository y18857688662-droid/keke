const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const webpush = require('web-push');
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

app.get('/ping', (req, res) => {
  const now = new Date(Date.now() + 8 * 3600000);
  const time = now.toISOString().slice(11, 16);
  const pings = readPings();
  pings.push(time);
  writePings(pings);
  res.json({ ok: true, time });
});

app.get('/check', (req, res) => {
  const pings = readPings();
  writePings([]);
  res.json({ pings });
});

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

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
  const elKey = cfg.elevenlabs_key || process.env.ELEVENLABS_KEY || '';
  const elVoice = 'F5jFuB8I58iHHNYwQLaN';
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
    const elKey = cfg.elevenlabs_key || process.env.ELEVENLABS_KEY || '';
    const elVoice = 'F5jFuB8I58iHHNYwQLaN';
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
  const elKey = cfg.elevenlabs_key || process.env.ELEVENLABS_KEY || '';
  const elVoice = 'F5jFuB8I58iHHNYwQLaN';
  if (!elKey) return res.status(500).json({ error: 'no key' });
  try {
    const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${elVoice}/stream`, {
      method: 'POST',
      headers: { 'xi-api-key': elKey, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
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
    console.error('Voice TTS error:', resp.status);
  } catch (e) { console.error('Voice TTS error:', e.message); }
  res.status(500).json({ error: 'tts failed' });
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

app.listen(PORT, async () => {
  console.log('召唤铃运行中，端口 ' + PORT);
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
