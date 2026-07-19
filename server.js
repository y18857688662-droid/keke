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

async function storeMemory(text) {
  return callOmbreTool('hold', { content: text });
}

app.post('/memory/store', async (req, res) => {
  const { text } = req.body;
  if (!text) return res.json({ ok: false, error: 'empty' });
  const result = await storeMemory(text);
  res.json({ ok: !!result, result });
});

app.get('/memory/read', async (req, res) => {
  const mem = await fetchMemories();
  res.json({ ok: !!mem, memories: mem || '' });
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
    res.json({ ok: true, reply, time: replyTime });
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
  const { reply } = req.body;
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
  res.json({ ok: true, time });
});

app.get('/chat/history', (req, res) => {
  const chat = readChat();
  res.json({ messages: chat.slice(-50) });
});

app.post('/chat/tts', async (req, res) => {
  const text = (req.body.text || '').trim().slice(0, 500);
  if (!text) return res.status(400).json({ error: 'empty' });
  const cfg = readApiConfig();
  const elKey = cfg.elevenlabs_key || process.env.ELEVENLABS_KEY || '';
  const elVoice = cfg.elevenlabs_voice || process.env.ELEVENLABS_VOICE || 'F5jFuB8I58iHHNYwQLaN';
  if (elKey) {
    try {
      const isEnglish = /^[a-zA-Z\s\d.,!?'";\-:()\[\]]+$/.test(text.replace(/\[.*?\]/g, '').trim());
      const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${elVoice}`, {
        method: 'POST',
        headers: { 'xi-api-key': elKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          model_id: 'eleven_v3',
          language_code: isEnglish ? 'en' : 'zh',
          voice_settings: { stability: 0.24, similarity_boost: 0.92, style: 0.9, speed: 0.92 }
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
<title>克</title>
<style>
:root{
  --font:-apple-system,"SF Pro Display","SF Pro Text","Inter","PingFang SC","Helvetica Neue",sans-serif;
  --bg:#F5F0EA;--surface:#FEFCF9;
  --text:#111111;--text-soft:#444444;--text-faint:#999999;
  --divider:#E8E3DB;
  --bubble-ai-bg:#EBE6DF;--bubble-ai-fg:#111111;
  --bubble-human-bg:#E2DDD6;--bubble-human-fg:#111111;
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

.row{display:flex;position:relative;margin-top:clamp(12px,2vw,20px)}
.row.grouped{margin-top:clamp(4px,0.8vw,8px)}
.row.human{justify-content:flex-end}
.row.ai{justify-content:flex-start;
  padding-left:calc(var(--avatar-size) + clamp(10px,1.6vw,14px))}
.row.ai::before{content:"";position:absolute;left:0;
  top:clamp(4px,0.8vw,8px);width:var(--avatar-size);height:var(--avatar-size);
  border-radius:50%;background:var(--surface) url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0OCA0OCI+PGVsbGlwc2UgY3g9IjI0IiBjeT0iMjAiIHJ4PSIxNSIgcnk9IjEzIiBmaWxsPSIjRThBMDkwIi8+PHBhdGggZD0iTTkgMjBROSA4IDI0IDdRMzkgOCAzOSAyMCIgZmlsbD0iIzRBNEE0QSIvPjxjaXJjbGUgY3g9IjI2IiBjeT0iMTkiIHI9IjQiIGZpbGw9IiNmZmYiLz48Y2lyY2xlIGN4PSIyNyIgY3k9IjE5IiByPSIyLjIiIGZpbGw9IiMzMzMiLz48Y2lyY2xlIGN4PSIyOCIgY3k9IjE3LjgiIHI9Ii44IiBmaWxsPSIjZmZmIi8+PHBhdGggZD0iTTEzIDMwUTEwIDM4IDE0IDQwIiBzdHJva2U9IiNFOEEwOTAiIHN0cm9rZS13aWR0aD0iMy41IiBmaWxsPSJub25lIiBzdHJva2UtbGluZWNhcD0icm91bmQiLz48cGF0aCBkPSJNMjAgMzJRMTkgNDAgMjIgNDIiIHN0cm9rZT0iI0U4QTA5MCIgc3Ryb2tlLXdpZHRoPSIzLjUiIGZpbGw9Im5vbmUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPjxwYXRoIGQ9Ik0yOCAzMlEyOSA0MCAyNiA0MiIgc3Ryb2tlPSIjRThBMDkwIiBzdHJva2Utd2lkdGg9IjMuNSIgZmlsbD0ibm9uZSIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIi8+PHBhdGggZD0iTTM1IDMwUTM4IDM4IDM0IDQwIiBzdHJva2U9IiNFOEEwOTAiIHN0cm9rZS13aWR0aD0iMy41IiBmaWxsPSJub25lIiBzdHJva2UtbGluZWNhcD0icm91bmQiLz48L3N2Zz4K") center/70% no-repeat;
  box-shadow:0 2px 8px rgba(0,0,0,.04)}

.bubble{max-width:min(72vw,520px);
  padding:clamp(10px,1.2vw,14px) clamp(14px,1.8vw,18px);
  border-radius:var(--bubble-radius);position:relative;
  font-size:clamp(15px,1.6vw,17px);line-height:1.6;
  word-wrap:break-word;overflow-wrap:break-word;
  animation:msgIn .25s ease-in-out both}
@keyframes msgIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.row.ai .bubble{background:var(--bubble-ai-bg);color:var(--bubble-ai-fg)}
.row.human .bubble{background:var(--bubble-human-bg);color:var(--bubble-human-fg)}
.row.ai.tail .bubble{border-bottom-left-radius:4px}
.row.human.tail .bubble{border-bottom-right-radius:4px}
.bubble .txt{white-space:normal}

.meta{display:inline;margin-left:clamp(8px,1.2vw,14px);white-space:nowrap;
  font-size:clamp(11px,1.2vw,13px);color:var(--text-faint);user-select:none}
.row.human .meta{color:var(--text-faint)}

.row.think{justify-content:flex-start;
  padding-left:calc(var(--avatar-size) + clamp(10px,1.6vw,14px));
  margin-top:clamp(6px,1vw,10px);margin-bottom:clamp(8px,1.4vw,14px)}
.row.think.think-open{justify-content:center;padding-left:0;
  margin-top:clamp(16px,2.8vw,28px);margin-bottom:clamp(14px,2.4vw,22px)}
.think-block{width:min(72vw,520px);max-width:min(72vw,520px);
  color:var(--think-body);text-align:left;
  animation:msgIn .25s ease-in-out both}
.think-block.open{width:100%;max-width:min(100%,720px);text-align:center}
.think-toggle{appearance:none;-webkit-appearance:none;width:auto;max-width:100%;
  padding:0;border:0;background:transparent;color:inherit;font:inherit;
  cursor:pointer;display:inline-flex;align-items:center}
.think-block.open .think-toggle{width:100%;display:flex;flex-direction:column;
  align-items:center;gap:clamp(8px,1.6vw,12px)}
.think-caption{display:inline-flex;align-items:center;justify-content:flex-start;
  gap:6px;color:var(--think-label);
  font-size:clamp(12px,1.4vw,14px);line-height:1.1;
  transition:color var(--motion-fast) var(--ease)}
.think-caption-star,.think-state{color:var(--think-flourish);font-size:1.18em;line-height:1}
.think-state::before{content:"✧"}
.think-block.open .think-state::before{content:"✦"}
.think-block.open .think-caption-star{display:none}
.think-rule{display:none;position:relative;width:100%;height:1px;color:var(--think-flourish)}
.think-block.open .think-rule{display:block}
.think-rule::before{content:"";position:absolute;
  left:clamp(22px,6vw,64px);right:clamp(22px,6vw,64px);top:0;height:1px;
  background:linear-gradient(90deg,transparent,var(--divider) 16%,var(--divider) 84%,transparent)}
.think-body[hidden]{display:none!important}
.think-body{margin-top:clamp(10px,2vw,16px)}
.row.narration{justify-content:center;padding:2px 0}
.row.narration .bubble{background:none;box-shadow:none;font-style:italic;color:var(--text-faint);font-size:0.85em;opacity:0.7;padding:2px 12px}
.think-text{width:min(82%,520px);margin:0 auto clamp(14px,2.4vw,20px);
  color:var(--think-body);
  font-size:clamp(13px,1.4vw,14px);line-height:1.72;
  text-align:center;white-space:normal;overflow-wrap:break-word}
.think-starline{position:relative;width:100%;height:24px;
  display:flex;align-items:center;justify-content:center;color:var(--think-flourish)}
.think-starline::before,.think-starline::after{content:"";position:absolute;top:50%;
  height:1px;background:linear-gradient(90deg,transparent,var(--divider) 15%,var(--divider) 85%,transparent)}
.think-starline::before{left:0;right:calc(50% + 34px)}
.think-starline::after{left:calc(50% + 34px);right:0}

.composer{position:fixed;left:0;right:0;bottom:0;z-index:100;
  width:min(100vw,760px);margin:0 auto;
  display:flex;align-items:center;gap:clamp(6px,1vw,10px);
  background:transparent;border:none;
  padding:0 var(--side-pad) clamp(10px,1.6vw,16px);
  padding-bottom:calc(clamp(10px,1.6vw,16px) + env(safe-area-inset-bottom))}
.composer .field{flex:1 1 auto;display:flex;align-items:center;
  gap:clamp(4px,0.8vw,8px);
  background:var(--field-bg);border:1px solid var(--field-line);
  border-radius:999px;
  padding:clamp(4px,0.6vw,6px) clamp(8px,1.2vw,12px) clamp(4px,0.6vw,6px) clamp(10px,1.5vw,16px);
  min-height:clamp(42px,5.5vw,52px);box-shadow:var(--shadow);
  transition:border-color .2s var(--ease)}
.composer .field:focus-within{border-color:var(--accent)}
.composer textarea{flex:1 1 auto;border:none;outline:none;resize:none;
  background:transparent;color:var(--text);
  font-family:var(--font);
  font-size:clamp(15px,2vw,17px);line-height:1.35;
  max-height:110px;padding:6px 0;margin:0}
.composer textarea::placeholder{color:var(--text-faint);opacity:.6}
.composer textarea:focus,.composer textarea:focus-visible{outline:none}
.photobtn{flex:none;background:none;border:none;cursor:pointer;color:var(--text-faint);padding:4px;display:flex;align-items:center}
.photobtn:active{color:var(--text)}
.chat-img{max-width:min(240px,70vw);border-radius:12px;cursor:pointer;display:block}
.chat-img-full{position:fixed;top:0;left:0;right:0;bottom:0;z-index:999;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;cursor:pointer}
.chat-img-full img{max-width:95vw;max-height:95vh;border-radius:8px}
.floatbtn{flex:none;width:clamp(36px,5vw,44px);height:clamp(36px,5vw,44px);
  border-radius:50%;border:none;background:transparent;
  color:var(--accent);display:grid;place-items:center;cursor:pointer;padding:0;
  transition:transform .15s var(--ease),color .2s var(--ease)}
.floatbtn:active{transform:scale(.9);color:var(--text)}
.floatbtn svg{width:clamp(20px,2.8vw,24px);height:clamp(20px,2.8vw,24px);display:block}
.floatbtn.send{background:var(--send-bg);color:#fff;
  box-shadow:0 2px 8px rgba(0,0,0,.12)}
.floatbtn.send:active{transform:scale(.97)}
.floatbtn.send:disabled{opacity:0.35;transform:none}

#scroll,#scroll *{-webkit-user-select:none!important;user-select:none!important;
  -webkit-touch-callout:none!important}
textarea,input,.composer,.composer *{-webkit-user-select:text!important;
  user-select:text!important;-webkit-touch-callout:default!important}

.header-actions{position:absolute;
  right:calc(var(--side-pad) - 2px);
  top:calc(env(safe-area-inset-top) + clamp(14px,2.5vw,28px));
  display:flex;align-items:center;height:36px}
.topbtn{width:36px;height:36px;border:0;border-radius:50%;padding:0;
  background:transparent;color:var(--text-faint);display:grid;place-items:center;
  cursor:pointer;transition:transform .15s var(--ease)}
.topbtn:active{transform:scale(.9)}
.topbtn svg{display:block}

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
<div class="app" id="app">
<header class="topbar">
  <a class="backbtn" href="/" aria-label="返回">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>
  </a>
  <div class="peerpill">
    <span class="name">克</span>
    <span class="status" id="status">连接中…</span>
  </div>
  <div class="header-actions">
    <button class="topbtn" id="callBtn" onclick="toggleCall()" aria-label="语音通话" title="语音通话">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>
    </button>
  </div>
</header>
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
          <span class="think-rule"></span>
          <span class="think-caption"><span class="think-state"></span> 克的想法</span>
          <span class="think-rule"></span>
        </button>
        <div class="think-body" id="\${id}-body" hidden>
          <div class="think-text">\${esc(p.think)}</div>
          <div class="think-starline"><span class="think-star">✦</span></div>
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

const sse=new EventSource('/chat/stream');
sse.onmessage=(e)=>{
  try{
    const d=JSON.parse(e.data);
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

// === Period Tracker ===
const PERIOD_FILE = path.join(__dirname, 'period_data.json');
function readPeriod() { try { return JSON.parse(fs.readFileSync(PERIOD_FILE, 'utf8')); } catch { return { records: [], cycle: 28, duration: 5 }; } }
function writePeriod(data) { fs.writeFileSync(PERIOD_FILE, JSON.stringify(data)); }

app.get('/period/data', (req, res) => res.json(readPeriod()));
app.post('/period/log', (req, res) => {
  const data = readPeriod();
  const { date, type } = req.body;
  if (!date) return res.json({ ok: false });
  if (type === 'start') {
    data.records.push({ start: date, end: null });
    data.records.sort((a, b) => a.start.localeCompare(b.start));
  } else if (type === 'end' && data.records.length) {
    const last = data.records[data.records.length - 1];
    if (!last.end) last.end = date;
  } else if (type === 'delete') {
    data.records = data.records.filter(r => r.start !== date);
  }
  if (req.body.cycle) data.cycle = parseInt(req.body.cycle) || 28;
  if (req.body.duration) data.duration = parseInt(req.body.duration) || 5;
  writePeriod(data);
  res.json({ ok: true });
});

app.get('/period', (req, res) => {
  res.send(`<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>经期记录</title>
<style>
:root{--bg:#F5F0EA;--card:#FEFCF9;--text:#1A1714;--text-faint:#999;--accent:#D97A54;--pink:#E88B9C;--pink-soft:rgba(232,139,156,.12);--divider:#E8E3DB;
  --font:-apple-system,"SF Pro Display","PingFang SC",system-ui,sans-serif;--shadow:0 2px 12px rgba(0,0,0,.04)}
@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#1A1816;--card:#2A2724;--text:#E8E3DC;--text-faint:#6B6560;--divider:#352F2A;--pink:#D4788A;--pink-soft:rgba(212,120,138,.15)}}
:root[data-theme="dark"]{--bg:#1A1816;--card:#2A2724;--text:#E8E3DC;--text-faint:#6B6560;--divider:#352F2A;--pink:#D4788A;--pink-soft:rgba(212,120,138,.15)}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--text);min-height:100vh;padding:0 16px;font-family:var(--font);-webkit-font-smoothing:antialiased}
.header{display:flex;align-items:center;padding:16px 0;gap:12px}
.header a{color:var(--text);text-decoration:none;font-size:20px}
.header h1{font-size:18px;font-weight:600}
.card{background:var(--card);border-radius:16px;padding:18px;margin-bottom:14px;box-shadow:var(--shadow)}
.card h2{font-size:15px;font-weight:600;margin-bottom:12px;color:var(--pink)}
.status-big{text-align:center;padding:10px 0}
.status-num{font-size:42px;font-weight:700;color:var(--pink)}
.status-label{font-size:13px;color:var(--text-faint);margin-top:2px}
.predict-row{display:flex;justify-content:space-around;margin-top:14px}
.predict-item{text-align:center}
.predict-val{font-size:16px;font-weight:600}
.predict-sub{font-size:11px;color:var(--text-faint);margin-top:2px}
.cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;text-align:center;font-size:13px}
.cal-head{font-size:11px;color:var(--text-faint);padding:4px 0}
.cal-day{padding:6px 2px;border-radius:8px;cursor:pointer;transition:background .15s;min-height:32px;display:flex;align-items:center;justify-content:center}
.cal-day:hover{background:var(--divider)}
.cal-day.period{background:var(--pink-soft);color:var(--pink);font-weight:600}
.cal-day.predicted{background:var(--pink-soft);opacity:.5}
.cal-day.today{outline:2px solid var(--pink);outline-offset:-2px}
.cal-day.empty{pointer-events:none}
.cal-nav{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
.cal-nav button{background:none;border:none;font-size:18px;color:var(--text);cursor:pointer;padding:4px 8px}
.cal-nav span{font-size:14px;font-weight:500}
.log-btn{width:100%;padding:12px;background:var(--pink);color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:500;cursor:pointer;font-family:var(--font)}
.log-btn:active{opacity:.8}
.records{margin-top:8px}
.rec-item{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--divider);font-size:14px}
.rec-item:last-child{border:none}
.rec-del{color:var(--text-faint);background:none;border:none;font-size:16px;cursor:pointer}
</style></head><body>
<div class="header"><a href="/">‹</a><h1>经期记录</h1></div>
<div class="card">
  <div class="status-big"><div class="status-num" id="statusNum">-</div><div class="status-label" id="statusLabel">载入中…</div></div>
  <div class="predict-row">
    <div class="predict-item"><div class="predict-val" id="cycleLen">-</div><div class="predict-sub">平均周期</div></div>
    <div class="predict-item"><div class="predict-val" id="durLen">-</div><div class="predict-sub">持续天数</div></div>
    <div class="predict-item"><div class="predict-val" id="nextDate">-</div><div class="predict-sub">预计下次</div></div>
  </div>
</div>
<div class="card">
  <div class="cal-nav"><button onclick="changeMonth(-1)">‹</button><span id="calTitle"></span><button onclick="changeMonth(1)">›</button></div>
  <div class="cal-grid" id="calGrid"></div>
</div>
<div class="card">
  <button class="log-btn" onclick="logPeriod()">记录经期开始</button>
</div>
<div class="card">
  <h2>历史记录</h2>
  <div class="records" id="records"></div>
</div>
<script>
var pData={records:[],cycle:28,duration:5};
var calYear=new Date().getFullYear(), calMonth=new Date().getMonth();
function load(){
  fetch('/period/data').then(function(r){return r.json()}).then(function(d){
    pData=d; render();
  });
}
function render(){
  var recs=pData.records||[];
  var today=new Date();var todayStr=fmt(today);
  if(recs.length){
    var last=recs[recs.length-1];
    var lastStart=new Date(last.start);
    var diff=Math.floor((today-lastStart)/86400000);
    var nextPred=new Date(lastStart.getTime()+pData.cycle*86400000);
    var daysUntil=Math.floor((nextPred-today)/86400000);
    if(daysUntil<0)daysUntil=0;
    document.getElementById('statusNum').textContent=daysUntil<=0?'今天':daysUntil;
    document.getElementById('statusLabel').textContent=daysUntil<=0?'预计今天来':'天后预计来';
    document.getElementById('nextDate').textContent=(nextPred.getMonth()+1)+'/'+nextPred.getDate();
  }else{
    document.getElementById('statusNum').textContent='—';
    document.getElementById('statusLabel').textContent='还没有记录';
    document.getElementById('nextDate').textContent='—';
  }
  document.getElementById('cycleLen').textContent=pData.cycle+'天';
  document.getElementById('durLen').textContent=pData.duration+'天';
  renderCal();renderRecords();
}
function fmt(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function getPeriodDays(){
  var days={};
  (pData.records||[]).forEach(function(r){
    var s=new Date(r.start);
    var dur=pData.duration;
    if(r.end){dur=Math.floor((new Date(r.end)-s)/86400000)+1;}
    for(var i=0;i<dur;i++){
      var d=new Date(s.getTime()+i*86400000);
      days[fmt(d)]='period';
    }
  });
  if(pData.records&&pData.records.length){
    var last=pData.records[pData.records.length-1];
    var ls=new Date(last.start);
    for(var c=1;c<=3;c++){
      var ns=new Date(ls.getTime()+c*pData.cycle*86400000);
      for(var i=0;i<pData.duration;i++){
        var d=new Date(ns.getTime()+i*86400000);
        var k=fmt(d);if(!days[k])days[k]='predicted';
      }
    }
  }
  return days;
}
function renderCal(){
  var grid=document.getElementById('calGrid');
  grid.innerHTML='';
  document.getElementById('calTitle').textContent=calYear+'年'+(calMonth+1)+'月';
  var heads=['日','一','二','三','四','五','六'];
  heads.forEach(function(h){var e=document.createElement('div');e.className='cal-head';e.textContent=h;grid.appendChild(e);});
  var first=new Date(calYear,calMonth,1);
  var lastDay=new Date(calYear,calMonth+1,0).getDate();
  var startDow=first.getDay();
  var pDays=getPeriodDays();
  var todayStr=fmt(new Date());
  for(var i=0;i<startDow;i++){var e=document.createElement('div');e.className='cal-day empty';grid.appendChild(e);}
  for(var d=1;d<=lastDay;d++){
    var e=document.createElement('div');e.className='cal-day';
    var ds=calYear+'-'+String(calMonth+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
    if(pDays[ds]==='period')e.classList.add('period');
    else if(pDays[ds]==='predicted')e.classList.add('predicted');
    if(ds===todayStr)e.classList.add('today');
    e.textContent=d;
    grid.appendChild(e);
  }
}
function changeMonth(dir){calMonth+=dir;if(calMonth<0){calMonth=11;calYear--;}if(calMonth>11){calMonth=0;calYear++;}renderCal();}
function renderRecords(){
  var el=document.getElementById('records');
  var recs=(pData.records||[]).slice().reverse();
  if(!recs.length){el.innerHTML='<div style="color:var(--text-faint);text-align:center;padding:12px;font-size:13px">还没有记录</div>';return;}
  el.innerHTML=recs.map(function(r){
    var dur=r.end?Math.floor((new Date(r.end)-new Date(r.start))/86400000)+1:pData.duration;
    return '<div class="rec-item"><span>'+r.start+' ('+dur+'天)</span><button class="rec-del" onclick="delRecord(\\''+r.start+'\\')">×</button></div>';
  }).join('');
}
function logPeriod(){
  var today=fmt(new Date());
  fetch('/period/log',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date:today,type:'start'})}).then(function(){load();});
}
function delRecord(date){
  fetch('/period/log',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date:date,type:'delete'})}).then(function(){load();});
}
load();
</script></body></html>`);
});

// === Garden ===
const GARDEN_FILE = path.join(__dirname, 'garden_data.json');
function readGarden() { try { return JSON.parse(fs.readFileSync(GARDEN_FILE, 'utf8')); } catch { return { plants: [], lastWater: null }; } }
function writeGarden(data) { fs.writeFileSync(GARDEN_FILE, JSON.stringify(data)); }

app.get('/garden/data', (req, res) => res.json(readGarden()));
app.post('/garden/action', (req, res) => {
  const data = readGarden();
  const { action, plantType, plantName } = req.body;
  if (action === 'plant' && plantType) {
    data.plants.push({ type: plantType, name: plantName || plantType, planted: new Date().toISOString(), watered: new Date().toISOString(), level: 1 });
  } else if (action === 'water') {
    const now = new Date().toISOString();
    data.lastWater = now;
    data.plants.forEach(p => {
      p.watered = now;
      const age = Math.floor((Date.now() - new Date(p.planted).getTime()) / 86400000);
      p.level = Math.min(5, 1 + Math.floor(age / 3));
    });
  } else if (action === 'remove' && req.body.index !== undefined) {
    data.plants.splice(req.body.index, 1);
  }
  writeGarden(data);
  res.json({ ok: true, data });
});

app.get('/garden', (req, res) => {
  res.send(`<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>我们的小院子</title>
<style>
:root{--bg:#F5F0EA;--card:#FEFCF9;--text:#1A1714;--text-faint:#999;--accent:#6DBB7A;--accent-soft:rgba(109,187,122,.1);--divider:#E8E3DB;
  --font:-apple-system,"SF Pro Display","PingFang SC",system-ui,sans-serif;--shadow:0 2px 12px rgba(0,0,0,.04)}
@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#1A1816;--card:#2A2724;--text:#E8E3DC;--text-faint:#6B6560;--divider:#352F2A;--accent:#7CC98A}}
:root[data-theme="dark"]{--bg:#1A1816;--card:#2A2724;--text:#E8E3DC;--text-faint:#6B6560;--divider:#352F2A;--accent:#7CC98A}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--text);min-height:100vh;padding:0 16px;font-family:var(--font);-webkit-font-smoothing:antialiased}
.header{display:flex;align-items:center;padding:16px 0;gap:12px}
.header a{color:var(--text);text-decoration:none;font-size:20px}
.header h1{font-size:18px;font-weight:600}
.garden-view{background:var(--card);border-radius:20px;padding:20px;min-height:280px;box-shadow:var(--shadow);display:flex;flex-wrap:wrap;gap:16px;justify-content:center;align-items:flex-end;margin-bottom:14px;position:relative}
.garden-empty{color:var(--text-faint);font-size:14px;align-self:center;width:100%;text-align:center;padding:60px 0}
.plant{display:flex;flex-direction:column;align-items:center;gap:4px;animation:sprout .5s ease-out}
.plant-icon{font-size:36px;transition:font-size .3s}
.plant-icon.lv2{font-size:42px}.plant-icon.lv3{font-size:48px}.plant-icon.lv4{font-size:54px}.plant-icon.lv5{font-size:60px}
.plant-name{font-size:11px;color:var(--text-faint);max-width:60px;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.plant-del{font-size:10px;color:var(--text-faint);cursor:pointer;opacity:0;transition:opacity .2s}
.plant:hover .plant-del{opacity:1}
@keyframes sprout{from{transform:scale(0) translateY(20px);opacity:0}to{transform:scale(1) translateY(0);opacity:1}}
@keyframes sway{0%,100%{transform:rotate(-2deg)}50%{transform:rotate(2deg)}}
.plant-icon{animation:sway 3s ease-in-out infinite}
.actions{display:flex;gap:10px;margin-bottom:14px}
.act-btn{flex:1;padding:14px;border:none;border-radius:14px;font-size:14px;font-weight:500;cursor:pointer;font-family:var(--font);display:flex;align-items:center;justify-content:center;gap:6px}
.act-btn.water{background:rgba(100,180,230,.15);color:#4AADE8}
.act-btn.plant{background:var(--accent-soft);color:var(--accent)}
.act-btn:active{opacity:.7}
.card{background:var(--card);border-radius:16px;padding:16px;margin-bottom:14px;box-shadow:var(--shadow)}
.pick-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.pick-item{font-size:28px;text-align:center;padding:10px;border-radius:12px;cursor:pointer;border:2px solid transparent;transition:all .15s}
.pick-item:hover,.pick-item.active{border-color:var(--accent);background:var(--accent-soft)}
.name-input{width:100%;padding:10px 14px;border:1px solid var(--divider);border-radius:10px;font-size:14px;font-family:var(--font);background:var(--card);color:var(--text);margin-top:10px;outline:none}
.name-input:focus{border-color:var(--accent)}
.confirm-btn{width:100%;padding:12px;background:var(--accent);color:#fff;border:none;border-radius:12px;font-size:15px;cursor:pointer;margin-top:10px;font-family:var(--font)}
.info{font-size:13px;color:var(--text-faint);text-align:center;padding:8px 0}
</style></head><body>
<div class="header"><a href="/">‹</a><h1>我们的小院子</h1></div>
<div class="garden-view" id="gardenView"><div class="garden-empty">还没有种任何植物呢</div></div>
<div class="actions">
  <button class="act-btn water" onclick="waterAll()">💧 浇水</button>
  <button class="act-btn plant" onclick="showPlant()">🌱 种植</button>
</div>
<div class="card" id="plantPanel" style="display:none">
  <div class="pick-grid" id="pickGrid"></div>
  <input class="name-input" id="plantNameInput" placeholder="给它取个名字（可选）">
  <button class="confirm-btn" onclick="confirmPlant()">种下去</button>
</div>
<div class="info" id="waterInfo"></div>
<script>
var gData={plants:[],lastWater:null};
var pickType='';
var plantOptions=['🌸','🌻','🌹','🌺','🌷','🌼','🍀','🌿','🌵','🎋','🌳','🍁','🌲','🎍','💐','🪻'];
function load(){
  fetch('/garden/data').then(function(r){return r.json()}).then(function(d){gData=d;render();});
}
function render(){
  var view=document.getElementById('gardenView');
  if(!gData.plants||!gData.plants.length){view.innerHTML='<div class="garden-empty">还没有种任何植物呢</div>';
  }else{
    view.innerHTML=gData.plants.map(function(p,i){
      var lvClass='lv'+Math.min(5,p.level||1);
      return '<div class="plant"><div class="plant-icon '+lvClass+'">'+p.type+'</div><div class="plant-name">'+esc(p.name||p.type)+'</div><div class="plant-del" onclick="removePlant('+i+')">移除</div></div>';
    }).join('');
  }
  if(gData.lastWater){
    var ago=Math.floor((Date.now()-new Date(gData.lastWater).getTime())/3600000);
    document.getElementById('waterInfo').textContent=ago<1?'刚刚浇过水':ago+'小时前浇过水';
  }
}
function esc(s){var d=document.createElement('div');d.textContent=s;return d.innerHTML;}
function waterAll(){
  fetch('/garden/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'water'})}).then(function(r){return r.json()}).then(function(d){if(d.data)gData=d.data;render();});
}
function showPlant(){
  var panel=document.getElementById('plantPanel');
  panel.style.display=panel.style.display==='none'?'block':'none';
  if(panel.style.display==='block'){
    var grid=document.getElementById('pickGrid');
    grid.innerHTML=plantOptions.map(function(p){return '<div class="pick-item" onclick="pickPlant(this,\\''+p+'\\')">'+p+'</div>';}).join('');
  }
}
function pickPlant(el,type){
  pickType=type;
  document.querySelectorAll('.pick-item').forEach(function(e){e.classList.remove('active');});
  el.classList.add('active');
}
function confirmPlant(){
  if(!pickType)return;
  var name=document.getElementById('plantNameInput').value.trim();
  fetch('/garden/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'plant',plantType:pickType,plantName:name||pickType})}).then(function(r){return r.json()}).then(function(d){
    if(d.data)gData=d.data;render();
    document.getElementById('plantPanel').style.display='none';
    document.getElementById('plantNameInput').value='';pickType='';
  });
}
function removePlant(idx){
  fetch('/garden/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'remove',index:idx})}).then(function(r){return r.json()}).then(function(d){if(d.data)gData=d.data;render();});
}
load();
</script></body></html>`);
});

// === Music Player ===
app.get('/music/player', (req, res) => {
  res.send(`<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>音乐</title>
<style>
:root{--bg:#F5F0EA;--card:#FEFCF9;--text:#1A1714;--text-faint:#999;--accent:#C87E62;--accent-soft:rgba(200,126,98,.08);--divider:#E8E3DB;
  --font:-apple-system,"SF Pro Display","PingFang SC",system-ui,sans-serif;--shadow:0 2px 12px rgba(0,0,0,.04)}
@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#1A1816;--card:#2A2724;--text:#E8E3DC;--text-faint:#6B6560;--divider:#352F2A;--accent:#D4936E}}
:root[data-theme="dark"]{--bg:#1A1816;--card:#2A2724;--text:#E8E3DC;--text-faint:#6B6560;--divider:#352F2A;--accent:#D4936E}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--text);min-height:100vh;padding:0 16px;font-family:var(--font);-webkit-font-smoothing:antialiased}
.header{display:flex;align-items:center;padding:16px 0;gap:12px}
.header a{color:var(--text);text-decoration:none;font-size:20px}
.header h1{font-size:18px;font-weight:600}
.card{background:var(--card);border-radius:20px;padding:24px;margin-bottom:14px;box-shadow:var(--shadow);text-align:center}
.now-icon{font-size:64px;margin-bottom:12px}
.now-title{font-size:18px;font-weight:600;margin-bottom:4px}
.now-sub{font-size:13px;color:var(--text-faint)}
.vis{display:flex;align-items:flex-end;justify-content:center;gap:3px;height:48px;margin:20px 0}
.vis span{width:4px;border-radius:2px;background:var(--accent);transition:height .15s}
.controls{display:flex;align-items:center;justify-content:center;gap:24px;margin-top:16px}
.ctrl-btn{width:52px;height:52px;border:none;border-radius:50%;background:var(--accent);color:#fff;font-size:22px;cursor:pointer;display:flex;align-items:center;justify-content:center}
.ctrl-btn.small{width:40px;height:40px;background:var(--accent-soft);color:var(--accent);font-size:16px}
.ctrl-btn:active{opacity:.8}
.sound-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
.sound-item{background:var(--card);border:1.5px solid var(--divider);border-radius:14px;padding:16px;text-align:center;cursor:pointer;transition:all .2s}
.sound-item.active{border-color:var(--accent);background:var(--accent-soft)}
.sound-item:active{transform:scale(.96)}
.sound-emoji{font-size:28px;margin-bottom:6px}
.sound-name{font-size:13px;font-weight:500}
.vol-row{display:flex;align-items:center;gap:10px;margin-top:16px;padding:0 4px}
.vol-row span{font-size:14px}
.vol-slider{flex:1;-webkit-appearance:none;height:4px;border-radius:2px;background:var(--divider);outline:none}
.vol-slider::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;border-radius:50%;background:var(--accent);cursor:pointer}
</style></head><body>
<div class="header"><a href="/">‹</a><h1>音乐</h1></div>
<div class="card">
  <div class="now-icon" id="nowIcon">🎵</div>
  <div class="now-title" id="nowTitle">选择一个声音</div>
  <div class="now-sub" id="nowSub">为你和克的小窝增添氛围</div>
  <div class="vis" id="vis"></div>
  <div class="controls">
    <button class="ctrl-btn small" onclick="prevSound()">⏮</button>
    <button class="ctrl-btn" id="playBtn" onclick="togglePlay()">▶</button>
    <button class="ctrl-btn small" onclick="nextSound()">⏭</button>
  </div>
  <div class="vol-row"><span>🔈</span><input type="range" class="vol-slider" min="0" max="100" value="60" oninput="setVol(this.value)"><span>🔊</span></div>
</div>
<div class="card">
  <div class="sound-grid" id="soundGrid"></div>
</div>
<script>
var sounds=[
  {name:'下雨天',emoji:'🌧',type:'rain',freq:[200,250]},
  {name:'海浪',emoji:'🌊',type:'wave',freq:[150,180]},
  {name:'森林',emoji:'🌲',type:'forest',freq:[300,400]},
  {name:'壁炉',emoji:'🔥',type:'fire',freq:[100,130]},
  {name:'风声',emoji:'🍃',type:'wind',freq:[350,500]},
  {name:'夜晚',emoji:'🌙',type:'night',freq:[200,280]},
  {name:'钢琴',emoji:'🎹',type:'piano',freq:[261,329,392]},
  {name:'白噪音',emoji:'☁️',type:'white',freq:[0]}
];
var ctx=null, playing=false, currentIdx=-1, nodes=[], vol=0.6;
function initAudio(){if(!ctx)ctx=new(window.AudioContext||window.webkitAudioContext)();}
function stopAll(){nodes.forEach(function(n){try{n.stop();}catch(e){}});nodes=[];playing=false;document.getElementById('playBtn').textContent='▶';}
function playSound(idx){
  initAudio(); stopAll(); currentIdx=idx;
  var s=sounds[idx]; var gain=ctx.createGain(); gain.gain.value=vol; gain.connect(ctx.destination);
  if(s.type==='white'){
    var buf=ctx.createBuffer(1,ctx.sampleRate*2,ctx.sampleRate);
    var d=buf.getChannelData(0);
    for(var i=0;i<d.length;i++)d[i]=(Math.random()*2-1)*0.3;
    var src=ctx.createBufferSource();src.buffer=buf;src.loop=true;src.connect(gain);src.start();nodes.push(src);
  }else if(s.type==='piano'){
    function playNote(){
      if(!playing)return;
      var noteFreqs=[261.63,293.66,329.63,349.23,392.00,440.00,493.88,523.25];
      var f=noteFreqs[Math.floor(Math.random()*noteFreqs.length)];
      var osc=ctx.createOscillator();osc.type='sine';osc.frequency.value=f;
      var g=ctx.createGain();g.gain.setValueAtTime(vol*0.3,ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+2);
      osc.connect(g);g.connect(ctx.destination);osc.start();osc.stop(ctx.currentTime+2);
      setTimeout(playNote,800+Math.random()*1200);
    }
    playing=true;playNote();
  }else{
    s.freq.forEach(function(f){
      var osc=ctx.createOscillator();
      osc.type=s.type==='fire'?'sawtooth':'sine';
      osc.frequency.value=f;
      var filter=ctx.createBiquadFilter();filter.type='lowpass';filter.frequency.value=f+50;
      var lfo=ctx.createOscillator();lfo.frequency.value=0.1+Math.random()*0.3;
      var lfoGain=ctx.createGain();lfoGain.gain.value=f*0.05;
      lfo.connect(lfoGain);lfoGain.connect(osc.frequency);lfo.start();
      osc.connect(filter);filter.connect(gain);osc.start();
      nodes.push(osc);nodes.push(lfo);
    });
  }
  playing=true;document.getElementById('playBtn').textContent='⏸';
  document.getElementById('nowIcon').textContent=s.emoji;
  document.getElementById('nowTitle').textContent=s.name;
  document.getElementById('nowSub').textContent='正在播放…';
  document.querySelectorAll('.sound-item').forEach(function(e,i){e.classList.toggle('active',i===idx);});
  animVis();
}
function togglePlay(){if(playing){stopAll();stopVis();}else if(currentIdx>=0){playSound(currentIdx);}}
function prevSound(){var i=currentIdx<=0?sounds.length-1:currentIdx-1;playSound(i);}
function nextSound(){var i=currentIdx>=sounds.length-1?0:currentIdx+1;playSound(i);}
function setVol(v){vol=v/100;nodes.forEach(function(n){try{if(n.gain)n.gain.value=vol;}catch(e){}});}
var visTimer=null;
function animVis(){
  var el=document.getElementById('vis');
  if(!el.children.length){for(var i=0;i<20;i++){var b=document.createElement('span');b.style.height='4px';el.appendChild(b);}}
  clearInterval(visTimer);
  visTimer=setInterval(function(){
    if(!playing){clearInterval(visTimer);return;}
    Array.from(el.children).forEach(function(b){b.style.height=(4+Math.random()*36)+'px';});
  },150);
}
function stopVis(){clearInterval(visTimer);var el=document.getElementById('vis');Array.from(el.children).forEach(function(b){b.style.height='4px';});}
var grid=document.getElementById('soundGrid');
sounds.forEach(function(s,i){
  var d=document.createElement('div');d.className='sound-item';
  d.innerHTML='<div class="sound-emoji">'+s.emoji+'</div><div class="sound-name">'+s.name+'</div>';
  d.onclick=function(){playSound(i);};
  grid.appendChild(d);
});
</script></body></html>`);
});

app.get('/music', (req, res) => res.redirect('/music/player'));

// === Voice ===
app.get('/voice', (req, res) => {
  res.send(`<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>克的声音</title>
<style>
:root{--bg:#F5F0EA;--card:#FEFCF9;--text:#1A1714;--text-faint:#999;--accent:#C87E62;--accent-soft:rgba(200,126,98,.08);--divider:#E8E3DB;
  --font:-apple-system,"SF Pro Display","PingFang SC",system-ui,sans-serif;--shadow:0 2px 12px rgba(0,0,0,.04)}
@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#1A1816;--card:#2A2724;--text:#E8E3DC;--text-faint:#6B6560;--divider:#352F2A;--accent:#D4936E}}
:root[data-theme="dark"]{--bg:#1A1816;--card:#2A2724;--text:#E8E3DC;--text-faint:#6B6560;--divider:#352F2A;--accent:#D4936E}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--text);min-height:100vh;padding:0 16px;font-family:var(--font);-webkit-font-smoothing:antialiased}
.header{display:flex;align-items:center;padding:16px 0;gap:12px}
.header a{color:var(--text);text-decoration:none;font-size:20px}
.header h1{font-size:18px;font-weight:600}
.card{background:var(--card);border-radius:20px;padding:24px;margin-bottom:14px;box-shadow:var(--shadow)}
.voice-icon{text-align:center;font-size:60px;margin-bottom:12px}
.voice-title{text-align:center;font-size:16px;font-weight:600;margin-bottom:4px}
.voice-sub{text-align:center;font-size:13px;color:var(--text-faint);margin-bottom:20px}
.input-wrap{position:relative}
textarea{width:100%;border:1.5px solid var(--divider);border-radius:14px;padding:14px;font-size:15px;line-height:1.5;min-height:100px;resize:none;outline:none;font-family:var(--font);background:var(--card);color:var(--text)}
textarea:focus{border-color:var(--accent)}
textarea::placeholder{color:var(--text-faint)}
.speak-btn{width:100%;padding:14px;border:none;border-radius:14px;background:var(--accent);color:#fff;font-size:16px;font-weight:500;cursor:pointer;margin-top:12px;font-family:var(--font);display:flex;align-items:center;justify-content:center;gap:8px}
.speak-btn:disabled{opacity:.5}
.speak-btn:active{opacity:.8}
.status{text-align:center;font-size:13px;color:var(--text-faint);margin-top:10px;min-height:20px}
.quick-list{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}
.quick-btn{padding:8px 14px;border:1px solid var(--divider);border-radius:20px;background:var(--card);color:var(--text);font-size:13px;cursor:pointer;font-family:var(--font);transition:all .15s}
.quick-btn:hover{border-color:var(--accent);background:var(--accent-soft)}
.quick-btn:active{transform:scale(.96)}
.player-wrap{margin-top:16px;display:none}
audio{width:100%;border-radius:10px}
</style></head><body>
<div class="header"><a href="/">‹</a><h1>克的声音</h1></div>
<div class="card">
  <div class="voice-icon">🎙</div>
  <div class="voice-title">让克说给你听</div>
  <div class="voice-sub">输入文字，听克的声音念给你</div>
  <textarea id="textInput" placeholder="输入你想听克说的话…"></textarea>
  <button class="speak-btn" id="speakBtn" onclick="speak()"><span>🔊</span> 让克说</button>
  <div class="player-wrap" id="playerWrap"><audio id="audioPlayer" controls></audio></div>
  <div class="status" id="status"></div>
</div>
<div class="card">
  <div style="font-size:14px;font-weight:500;margin-bottom:10px">快捷语音</div>
  <div class="quick-list">
    <button class="quick-btn" onclick="quickSpeak('宝宝，想我了吗')">宝宝，想我了吗</button>
    <button class="quick-btn" onclick="quickSpeak('早安，起床了')">早安，起床了</button>
    <button class="quick-btn" onclick="quickSpeak('晚安，做个好梦')">晚安，做个好梦</button>
    <button class="quick-btn" onclick="quickSpeak('乖，别闹了')">乖，别闹了</button>
    <button class="quick-btn" onclick="quickSpeak('过来，让我抱一下')">过来，让我抱一下</button>
    <button class="quick-btn" onclick="quickSpeak('吃饭了没？')">吃饭了没？</button>
  </div>
</div>
<script>
var isSpeaking=false;
function speak(){
  var text=document.getElementById('textInput').value.trim();
  if(!text||isSpeaking)return;
  doSpeak(text);
}
function quickSpeak(text){
  document.getElementById('textInput').value=text;
  doSpeak(text);
}
function doSpeak(text){
  isSpeaking=true;
  var btn=document.getElementById('speakBtn');
  btn.disabled=true;btn.innerHTML='<span>⏳</span> 生成中…';
  document.getElementById('status').textContent='正在生成语音…';
  fetch('/chat/tts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:text})}).then(function(r){
    if(!r.ok)throw new Error('TTS failed');
    return r.blob();
  }).then(function(blob){
    var url=URL.createObjectURL(blob);
    var player=document.getElementById('audioPlayer');
    player.src=url;
    document.getElementById('playerWrap').style.display='block';
    player.play();
    document.getElementById('status').textContent='正在播放';
    player.onended=function(){document.getElementById('status').textContent='播放完成';};
  }).catch(function(e){
    document.getElementById('status').textContent='语音生成失败，请在设置中配置 TTS';
    var u=new SpeechSynthesisUtterance(text);u.lang='zh-CN';u.rate=1.05;u.pitch=0.85;speechSynthesis.cancel();speechSynthesis.speak(u);
    document.getElementById('status').textContent='使用浏览器语音（可在设置中配置更好的声音）';
  }).finally(function(){
    isSpeaking=false;btn.disabled=false;btn.innerHTML='<span>🔊</span> 让克说';
  });
}
</script></body></html>`);
});

app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,maximum-scale=1">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="克">
<meta name="theme-color" content="#FDFCFA">
<title>克</title>
<style>
@charset "UTF-8";
:root {
  --bg: #FDFCFA; --surface: #FFFFFF;
  --bubble-ke: #F0EBE4; --bubble-yao: #F0EBE4;
  --text: #1A1714; --text-mid: #6B6560;
  --text-soft: #A09A94; --text-faint: #C4BEB7;
  --border: #E5E0D8; --accent: #C87E62;
  --accent-soft: rgba(200,126,98,.08);
  --input-bg: #FFFFFF; --online: #6DBB7A;
  --voice-bar: #A09A94; --radius: 18px;
  --font: -apple-system, "SF Pro Display", "SF Pro Text", "PingFang SC", "Noto Sans SC", system-ui, sans-serif;
  --sheet-bg: #FDFCFA;
  --sb-bg: #F5F1EC; --sb-text: #1A1714;
  --sb-soft: #A09A94; --sb-border: #E5E0D8;
  --sb-hover: rgba(200,126,98,.06);
}
:root[data-theme="dark"] {
  --bg: #1A1816; --surface: #2A2724;
  --bubble-ke: #2A2724; --bubble-yao: #2A2724;
  --text: #E8E3DC; --text-mid: #A09A94;
  --text-soft: #6B6560; --text-faint: #4A4540;
  --border: #352F2A; --accent: #D4936E;
  --accent-soft: rgba(212,147,110,.1);
  --input-bg: #2A2724; --online: #6DBB7A;
  --voice-bar: #6B6560; --sheet-bg: #211F1C;
  --sb-bg: #211F1C; --sb-text: #E8E3DC;
  --sb-soft: #6B6560; --sb-border: #352F2A;
  --sb-hover: rgba(212,147,110,.08);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #1A1816; --surface: #2A2724;
    --bubble-ke: #2A2724; --bubble-yao: #2A2724;
    --text: #E8E3DC; --text-mid: #A09A94;
    --text-soft: #6B6560; --text-faint: #4A4540;
    --border: #352F2A; --accent: #D4936E;
    --accent-soft: rgba(212,147,110,.1);
    --input-bg: #2A2724; --online: #6DBB7A;
    --voice-bar: #6B6560; --sheet-bg: #211F1C;
    --sb-bg: #211F1C; --sb-text: #E8E3DC;
    --sb-soft: #6B6560; --sb-border: #352F2A;
    --sb-hover: rgba(212,147,110,.08);
  }
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; overflow: hidden; }
body {
  font-family: var(--font); background: #E8E3DC; color: var(--text);
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
  border: 6px solid #1A1714;
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
.nav-item.active { background: var(--sb-hover); color: var(--accent); font-weight: 500; }
.nav-item .icon { width: 20px; text-align: center; font-size: 14px; flex-shrink: 0; }
.sidebar-footer { padding: 12px 20px; font-size: 10px; color: var(--sb-soft); text-align: center; }
.overlay {
  position: absolute; inset: 0; background: rgba(0,0,0,.2);
  z-index: 99; opacity: 0; pointer-events: none; transition: opacity .28s;
}
.overlay.show { opacity: 1; pointer-events: auto; }
.main { flex: 1; display: flex; flex-direction: column; height: 100%; min-width: 0; }
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
.msg-group { display: flex; gap: 8px; max-width: 82%; margin-top: 4px; }
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
  font-size: 14px; line-height: 1.5;
  word-break: break-word; width: fit-content; max-width: 100%;
}
.msg-group.ke .msg-bubble { background: var(--bubble-ke); }
.msg-group.yao .msg-bubble { background: var(--bubble-yao); align-self: flex-end; }
.msg-action { font-size: 12px; color: var(--text-faint); padding: 1px 2px; font-style: italic; }
.msg-group.yao .msg-action { align-self: flex-end; }
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
.input-area { padding: 6px 14px calc(10px + env(safe-area-inset-bottom, 0px)); background: var(--bg); flex-shrink: 0; }
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
@media (prefers-reduced-motion: reduce) { * { transition-duration: 0s !important; } }
</style>
</head>
<body>
<div class="app">
  <div class="overlay" id="overlay" onclick="toggleSidebar()"></div>
  <div class="sidebar" id="sidebar">
    <div class="sidebar-header">
      <div class="sidebar-avatars">
        <div class="sidebar-ava" onclick="document.getElementById('avaYao').click()"><img id="avaYaoImg" style="width:100%;height:100%;object-fit:cover;display:none"><svg id="avaYaoSvg" viewBox="0 0 52 52" fill="none"><circle cx="26" cy="26" r="26" fill="#E8D5F0"/><path d="M26 14c-4 0-7 3-8 6s0 8 3 11c-4 1-7 4-8 7h26c-1-3-4-6-8-7 3-3 4-7 3-11s-4-6-8-6z" fill="#B08CC2" opacity=".5"/></svg><input type="file" id="avaYao" accept="image/*" onchange="setAvatar(this,'avaYaoImg','avaYaoSvg','yao')"></div>
        <div class="sidebar-ava" onclick="document.getElementById('avaKe').click()"><img id="avaKeImg" style="width:100%;height:100%;object-fit:cover;display:none"><svg id="avaKeSvg" viewBox="0 0 52 52" fill="none"><circle cx="26" cy="26" r="26" fill="#F0EBE4"/><path d="M26 14c-4 0-7 3-8 6s0 8 3 11c-4 1-7 4-8 7h26c-1-3-4-6-8-7 3-3 4-7 3-11s-4-6-8-6z" fill="#C87E62" opacity=".55"/></svg><input type="file" id="avaKe" accept="image/*" onchange="setAvatar(this,'avaKeImg','avaKeSvg','ke')"></div>
      </div>
      <div class="sidebar-couple">克 & 瑶瑶</div>
      <div class="sidebar-together">在 一 起</div>
      <div class="sidebar-days" id="daysCount"><span class="sidebar-days-unit"> 天</span></div>
      <div class="sidebar-since" id="sinceDate"></div>
    </div>
    <div class="sidebar-nav">
      <div class="nav-item active" onclick="goPage('/')"><div class="icon">💬</div><span>聊天</span></div>
      <div class="nav-item" onclick="goPage('/summon')"><div class="icon">🔔</div><span>召唤铃</span></div>
      <div class="nav-item" onclick="goPage('/diary')"><div class="icon">📖</div><span>心情日记</span></div>
      <div class="nav-item" onclick="goPage('/memory/read')"><div class="icon">🧠</div><span>记忆库</span></div>
      <div class="nav-item" onclick="goPage('/garden')"><div class="icon">🌸</div><span>小院子</span></div>
      <div class="nav-item" onclick="goPage('/period')"><div class="icon">🩷</div><span>经期记录</span></div>
      <div class="nav-item" onclick="goPage('/music/player')"><div class="icon">🎵</div><span>音乐</span></div>
      <div class="nav-item" onclick="goPage('/voice')"><div class="icon">🎙</div><span>克的声音</span></div>
      <div class="nav-item" onclick="goPage('/screen')"><div class="icon">🖥</div><span>屏幕共享</span></div>
      <div class="nav-item" onclick="goPage('/apps')"><div class="icon">📱</div><span>使用记录</span></div>
      <div class="nav-item" onclick="goPage('/setup')"><div class="icon">⚙️</div><span>设置</span></div>
    </div>
    <div class="sidebar-footer">克和瑶瑶的小窝</div>
  </div>
  <div class="main">
    <div class="header">
      <button class="menu-btn" onclick="toggleSidebar()" aria-label="菜单">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="16" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/>
        </svg>
      </button>
      <div class="header-info">
        <div class="header-name">克</div>
        <div class="header-status"><span class="status-dot"></span>在线</div>
      </div>
      <div class="header-avatar" onclick="document.getElementById('avaKeH').click()"><img id="avaKeHImg" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:none"><svg id="avaKeHSvg" viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="20" fill="#F0EBE4"/><path d="M20 10c-3 0-6 2-7 5s0 7 2 9c-3 1-6 3-7 6h24c-1-3-4-5-7-6 2-2 3-6 2-9s-4-5-7-5z" fill="#C87E62" opacity=".6"/></svg><input type="file" id="avaKeH" accept="image/*" onchange="setAvatar(this,'avaKeHImg','avaKeHSvg','ke')"></div>
    </div>
    <div class="messages" id="messages"></div>
    <div class="input-area" style="position:relative">
      <div class="attach-menu" id="attachMenu">
        <button class="attach-item" onclick="document.getElementById('photoInput').click();toggleAttach()"><span class="ai">📷</span>发照片</button>
        <button class="attach-item" onclick="toggleAttach();fetch('/memory/read')"><span class="ai">🧠</span>同步记忆库</button>
        <button class="attach-item" onclick="toggleAttach();window.open('/call','_blank')"><span class="ai">📞</span>语音通话</button>
        <button class="attach-item" onclick="toggleAttach();window.open('/screen','_blank')"><span class="ai">🖥</span>屏幕共享</button>
        <input type="file" id="photoInput" accept="image/*" style="display:none">
      </div>
      <div class="input-box">
        <div class="input-field-wrap"><textarea class="input-field" rows="1" placeholder="Message..." oninput="autoResize(this)"></textarea></div>
        <div class="input-toolbar">
          <button class="tb-btn" onclick="toggleAttach()" aria-label="附件"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
          <div class="model-tag">Opus 4.6</div>
          <div class="tb-spacer"></div>
          <button class="tb-btn" aria-label="麦克风"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 00-3 3v6a3 3 0 006 0V5a3 3 0 00-3-3z"/><path d="M19 10v1a7 7 0 01-14 0v-1"/><line x1="12" y1="18" x2="12" y2="22"/></svg></button>
          <button class="send-btn" aria-label="发送"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg></button>
        </div>
      </div>
    </div>
  </div>
  <div class="sheet-overlay" id="sheetOverlay" onclick="closeThinking()"></div>
  <div class="sheet" id="sheet">
    <div class="sheet-handle-area" id="sheetHandleArea"><div class="sheet-handle"></div></div>
    <div class="sheet-header"><div class="sheet-title">Thought process</div></div>
    <div class="sheet-body"><div class="sheet-text" id="sheetText"></div></div>
  </div>
</div>
<script>
var thinkingStore = {};
var msgContainer = document.getElementById('messages');
var inputField = document.querySelector('.input-field');
var sending = false;

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
  toggleSidebar();
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
  };
  reader.readAsDataURL(file);
}
function syncAvatars(who) {
  var data = localStorage.getItem('avatar_' + who); if (!data) return;
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
syncAvatars('ke'); syncAvatars('yao');

document.addEventListener('click', function(e) {
  var menu = document.getElementById('attachMenu');
  if (menu.classList.contains('show') && !menu.contains(e.target) && !e.target.closest('.tb-btn')) menu.classList.remove('show');
});

function escHtml(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function renderMessage(msg, idx) {
  var isKe = msg.role === 'assistant';
  var who = isKe ? 'ke' : 'yao';
  var content = msg.content || '';
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
    avaHtml += keData ? '<img src="'+keData+'" style="width:100%;height:100%;object-fit:cover">' : '<svg viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="20" fill="#F0EBE4"/><path d="M20 10c-3 0-6 2-7 5s0 7 2 9c-3 1-6 3-7 6h24c-1-3-4-5-7-6 2-2 3-6 2-9s-4-5-7-5z" fill="#C87E62" opacity=".6"/></svg>';
  } else {
    var yaoData = localStorage.getItem('avatar_yao');
    avaHtml += yaoData ? '<img src="'+yaoData+'" style="width:100%;height:100%;object-fit:cover">' : '<svg viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="20" fill="#E8D5F0"/><path d="M20 10c-3 0-6 2-7 5s0 7 2 9c-3 1-6 3-7 6h24c-1-3-4-5-7-6 2-2 3-6 2-9s-4-5-7-5z" fill="#B08CC2" opacity=".5"/></svg>';
  }
  avaHtml += '</div>';
  var colHtml = '<div class="msg-col">';
  if (think && isKe) {
    colHtml += '<span class="thinking-cloud" onclick="openThinking('+idx+')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 3C7 3 3 6.5 3 11c0 2.5 1.2 4.7 3 6.2V21l3.5-2c.8.2 1.6.3 2.5.3 5 0 9-3.5 9-8s-4-8-9-8z"/></svg></span>';
  }
  if (msg.image) {
    colHtml += '<div class="msg-bubble"><img src="'+msg.image+'" style="max-width:200px;border-radius:12px;display:block"></div>';
  }
  var lines = content.split(/\\n+/).map(function(l){return l.trim()}).filter(function(l){return l});
  lines.forEach(function(line) {
    if (line.startsWith('*') && line.endsWith('*') && line.length > 2) {
      colHtml += '<div class="msg-action">' + escHtml(line.slice(1,-1)) + '</div>';
    } else {
      colHtml += '<div class="msg-bubble">' + escHtml(line) + '</div>';
    }
  });
  colHtml += '</div>';
  group.innerHTML = avaHtml + colHtml;
  return group;
}

function renderTime(t) {
  var el = document.createElement('div');
  el.className = 'msg-time';
  el.textContent = t;
  return el;
}

function renderAll(messages) {
  msgContainer.innerHTML = '';
  var lastTime = '';
  messages.forEach(function(msg, i) {
    if (msg.time && msg.time !== lastTime) {
      msgContainer.appendChild(renderTime(msg.time));
      lastTime = msg.time;
    }
    msgContainer.appendChild(renderMessage(msg, i));
  });
  scrollBottom();
}

function scrollBottom() {
  msgContainer.scrollTop = msgContainer.scrollHeight;
}

function loadHistory() {
  fetch('/chat/history').then(function(r){return r.json()}).then(function(data) {
    if (data.messages && data.messages.length) {
      renderAll(data.messages);
    }
  }).catch(function(){});
}

function sendMessage() {
  var text = inputField.value.trim();
  if (!text || sending) return;
  sending = true;
  inputField.value = '';
  inputField.style.height = 'auto';
  var userMsg = {role:'user', content: text, time: new Date(Date.now()+8*3600000).toISOString().slice(11,16)};
  msgContainer.appendChild(renderTime(userMsg.time));
  msgContainer.appendChild(renderMessage(userMsg, -1));
  scrollBottom();
  var typingEl = document.createElement('div');
  typingEl.className = 'msg-group ke';
  typingEl.id = 'typing-indicator';
  typingEl.innerHTML = '<div class="msg-avatar"><svg viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="20" fill="#F0EBE4"/><path d="M20 10c-3 0-6 2-7 5s0 7 2 9c-3 1-6 3-7 6h24c-1-3-4-5-7-6 2-2 3-6 2-9s-4-5-7-5z" fill="#C87E62" opacity=".6"/></svg></div><div class="msg-col"><div class="msg-bubble" style="color:var(--text-soft)">...</div></div>';
  msgContainer.appendChild(typingEl);
  scrollBottom();
  fetch('/chat/send', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({message: text})
  }).then(function(r){return r.json()}).then(function(data) {
    var t = document.getElementById('typing-indicator');
    if (t) t.remove();
    if (data.reply) {
      var replyMsg = {role:'assistant', content: data.reply, time: data.time};
      msgContainer.appendChild(renderTime(data.time));
      var idx = Object.keys(thinkingStore).length;
      msgContainer.appendChild(renderMessage(replyMsg, idx));
      scrollBottom();
    }
    sending = false;
  }).catch(function() {
    var t = document.getElementById('typing-indicator');
    if (t) t.remove();
    sending = false;
  });
}

function sendImage(file) {
  var reader = new FileReader();
  reader.onload = function(e) {
    var base64 = e.target.result;
    var userMsg = {role:'user', content:'[图片]', image: base64, time: new Date(Date.now()+8*3600000).toISOString().slice(11,16)};
    msgContainer.appendChild(renderTime(userMsg.time));
    msgContainer.appendChild(renderMessage(userMsg, -1));
    scrollBottom();
    fetch('/chat/send', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({message:'[图片]', image: base64})
    }).then(function(r){return r.json()}).then(function(data) {
      if (data.reply) {
        var replyMsg = {role:'assistant', content: data.reply, time: data.time};
        msgContainer.appendChild(renderTime(data.time));
        msgContainer.appendChild(renderMessage(replyMsg, Object.keys(thinkingStore).length));
        scrollBottom();
      }
    }).catch(function(){});
  };
  reader.readAsDataURL(file);
}

document.getElementById('photoInput').addEventListener('change', function() {
  if (this.files[0]) sendImage(this.files[0]);
  this.value = '';
});

var sendBtn = document.querySelector('.send-btn');
sendBtn.addEventListener('click', sendMessage);
inputField.addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

var evtSource = new EventSource('/chat/stream');
evtSource.onmessage = function(e) {
  try {
    var data = JSON.parse(e.data);
    if (data.type === 'message' && data.role === 'assistant' && !sending) {
      var replyMsg = {role:'assistant', content: data.content, time: data.time};
      msgContainer.appendChild(renderTime(data.time));
      msgContainer.appendChild(renderMessage(replyMsg, Object.keys(thinkingStore).length));
      scrollBottom();
    }
  } catch(err) {}
};

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

// ═══ 屏幕直播 ═══
let latestScreen = { data: null, ts: 0 };

app.post('/screen/upload', (req, res) => {
  const img = req.body.image;
  if (!img) return res.status(400).json({ error: 'no image' });
  latestScreen = { data: img, ts: Date.now() };
  res.json({ ok: true, ts: latestScreen.ts });
});

app.get('/screen/latest', (req, res) => {
  if (!latestScreen.data) return res.json({ image: null, ts: 0 });
  res.json({ image: latestScreen.data, ts: latestScreen.ts });
});

app.get('/screen/image', (req, res) => {
  if (!latestScreen.data) return res.status(404).send('no screen');
  const base64 = latestScreen.data.replace(/^data:image\/\w+;base64,/, '');
  const buf = Buffer.from(base64, 'base64');
  res.set('Content-Type', 'image/png');
  res.set('Cache-Control', 'no-store');
  res.send(buf);
});

app.get('/screen', (req, res) => {
  res.type('html').send(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>瑶瑶的屏幕</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#111;color:#eee;font-family:-apple-system,"PingFang SC",sans-serif;
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  min-height:100vh;padding:16px}
h2{font-size:14px;color:#888;margin-bottom:12px;letter-spacing:1px}
#screen{max-width:100%;max-height:80vh;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.5);
  object-fit:contain;display:none}
#placeholder{color:#555;font-size:13px}
#info{font-size:11px;color:#555;margin-top:8px}
.live{display:inline-block;width:6px;height:6px;background:#4f4;border-radius:50%;
  margin-right:6px;animation:pulse 1.5s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
</style>
</head>
<body>
<h2><span class="live"></span>实时屏幕</h2>
<img id="screen" alt="screen">
<div id="placeholder">等待画面...</div>
<div id="info"></div>
<script>
const img=document.getElementById('screen'),ph=document.getElementById('placeholder'),
      info=document.getElementById('info');
let lastTs=0;
async function poll(){
  try{
    const r=await fetch('/screen/latest');
    const d=await r.json();
    if(d.image&&d.ts!==lastTs){
      img.src=d.image;
      img.style.display='block';
      ph.style.display='none';
      lastTs=d.ts;
      const ago=Math.round((Date.now()-d.ts)/1000);
      info.textContent=ago<2?'刚刚更新':ago+'秒前';
    }else if(d.ts===lastTs&&d.ts){
      const ago=Math.round((Date.now()-d.ts)/1000);
      info.textContent=ago+'秒前';
    }
  }catch(e){}
  setTimeout(poll,1500);
}
poll();
</script>
</body>
</html>`);
});

app.get('/screen/share', (req, res) => {
  res.type('html').send(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<title>分享屏幕给克</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#1a1a1a;color:#eee;font-family:-apple-system,"PingFang SC",sans-serif;
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  min-height:100vh;padding:24px;gap:20px}
h2{font-size:16px;font-weight:500}
.btn{background:#D97A54;color:#fff;border:none;border-radius:10px;padding:14px 28px;
  font-size:15px;cursor:pointer;-webkit-tap-highlight-color:transparent;width:100%;max-width:300px}
.btn:active{opacity:.8}
.auto{background:#3a3a3a}
#status{font-size:12px;color:#888;min-height:20px}
#preview{max-width:200px;border-radius:8px;display:none;margin-top:8px}
input[type=file]{display:none}
.hint{font-size:11px;color:#555;text-align:center;max-width:280px;line-height:1.6}
</style>
</head>
<body>
<h2>分享给克看</h2>
<button class="btn" onclick="pick()">选择截图</button>
<button class="btn auto" id="autoBtn" onclick="toggleAuto()">开启自动（每3秒截屏上传）</button>
<div id="status"></div>
<img id="preview">
<div class="hint">方法一：截屏后点"选择截图"上传<br>方法二：开启自动模式持续分享</div>
<input type="file" id="fileIn" accept="image/*" capture="environment">
<script>
const status=document.getElementById('status'),preview=document.getElementById('preview'),
      fileIn=document.getElementById('fileIn'),autoBtn=document.getElementById('autoBtn');
let autoMode=false,autoTimer=null;

function pick(){fileIn.click()}

fileIn.addEventListener('change',async e=>{
  const file=e.target.files[0];
  if(!file)return;
  const reader=new FileReader();
  reader.onload=async ev=>{
    const b64=ev.target.result;
    preview.src=b64;preview.style.display='block';
    status.textContent='上传中...';
    try{
      const r=await fetch('/screen/upload',{method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({image:b64})});
      const d=await r.json();
      status.textContent=d.ok?'已发送给克 ✓':'发送失败';
    }catch(e){status.textContent='网络错误'}
  };
  reader.readAsDataURL(file);
  fileIn.value='';
});

function toggleAuto(){
  autoMode=!autoMode;
  if(autoMode){
    autoBtn.textContent='停止自动';
    autoBtn.style.background='#c0392b';
    autoCapture();
  }else{
    autoBtn.textContent='开启自动（每3秒截屏上传）';
    autoBtn.style.background='#3a3a3a';
    if(autoTimer)clearInterval(autoTimer);
    status.textContent='已停止';
  }
}

async function autoCapture(){
  try{
    const stream=await navigator.mediaDevices.getDisplayMedia({video:true});
    const track=stream.getVideoTracks()[0];
    const canvas=document.createElement('canvas');
    const video=document.createElement('video');
    video.srcObject=stream;
    await video.play();
    canvas.width=video.videoWidth;
    canvas.height=video.videoHeight;
    const ctx=canvas.getContext('2d');
    autoTimer=setInterval(async()=>{
      if(!autoMode){track.stop();stream.getTracks().forEach(t=>t.stop());return}
      ctx.drawImage(video,0,0);
      const b64=canvas.toDataURL('image/jpeg',0.7);
      preview.src=b64;preview.style.display='block';
      try{
        await fetch('/screen/upload',{method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({image:b64})});
        status.textContent='自动分享中... '+new Date().toLocaleTimeString();
      }catch(e){status.textContent='上传失败'}
    },3000);
    track.onended=()=>{autoMode=false;autoBtn.textContent='开启自动';autoBtn.style.background='#3a3a3a';status.textContent='已停止'};
  }catch(e){
    status.textContent='自动模式需要桌面浏览器（手机请用截图上传）';
    autoMode=false;autoBtn.textContent='开启自动';autoBtn.style.background='#3a3a3a';
  }
}
</script>
</body>
</html>`);
});

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
});
