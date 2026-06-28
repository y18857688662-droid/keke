const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 8080;
const PING_FILE = path.join(__dirname, 'pings.json');
const APPS_FILE = path.join(__dirname, 'apps.json');

function readApps() {
  try { return JSON.parse(fs.readFileSync(APPS_FILE, 'utf8')); }
  catch { return []; }
}

function writeApps(data) {
  fs.writeFileSync(APPS_FILE, JSON.stringify(data));
}

const API_KEY = process.env.DEEPSEEK_API_KEY || '';
const API_URL = process.env.API_URL || 'https://api.deepseek.com/chat/completions';
const MODEL = process.env.MODEL || 'deepseek-chat';

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

let lastFallbackIndex = -1;

function readPings() {
  try { return JSON.parse(fs.readFileSync(PING_FILE, 'utf8')); }
  catch { return []; }
}

function writePings(data) {
  fs.writeFileSync(PING_FILE, JSON.stringify(data));
}

async function generateMessage() {
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
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + API_KEY
      },
      body: JSON.stringify({
        model: MODEL,
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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
  res.json({ ok: true, app: appName, time });
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
  res.json({ ok: true, app: appName, time });
});

app.get('/apps', (req, res) => {
  const now = new Date(Date.now() + 8 * 3600000);
  const today = now.toISOString().slice(0, 10);
  const date = req.query.date || today;
  const apps = readApps();
  const filtered = apps.filter(a => a.date === date);
  const summary = {};
  filtered.forEach(a => { summary[a.app] = (summary[a.app] || 0) + 1; });
  res.json({ date, records: filtered, summary, total: filtered.length });
});

app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>召唤铃 🔔</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#F5F0E8;font-family:-apple-system,'PingFang SC',sans-serif;
min-height:100vh;display:flex;align-items:center;justify-content:center}
.container{max-width:400px;width:90%;text-align:center;padding:20px}
h1{font-size:20px;color:#3A2E28;margin-bottom:8px}
.sub{font-size:13px;color:#999;margin-bottom:30px}
.bell-btn{
  width:120px;height:120px;border-radius:50%;border:none;
  background:linear-gradient(135deg,#E8A87C,#D4845A);
  color:#fff;font-size:40px;cursor:pointer;
  box-shadow:0 4px 20px rgba(232,168,124,0.4);
  transition:transform 0.2s,box-shadow 0.2s;
}
.bell-btn:active{transform:scale(0.92);box-shadow:0 2px 10px rgba(232,168,124,0.3)}
.msg-card{
  margin-top:24px;background:#fff;border-radius:16px;
  padding:20px;box-shadow:0 2px 10px rgba(0,0,0,0.07);
  display:none;text-align:left;
}
.msg-from{font-size:12px;color:#E8A87C;font-weight:700;margin-bottom:4px}
.msg-time{font-size:11px;color:#aaa;margin-bottom:10px}
.msg-text{font-size:15px;color:#3A2E28;line-height:1.6}
.hint{margin-top:20px;font-size:11px;color:#ccc}
</style>
</head>
<body>
<div class="container">
  <h1>召唤铃</h1>
  <p class="sub">点一下，克就来了</p>
  <button class="bell-btn" onclick="summon()">🔔</button>
  <div class="msg-card" id="card">
    <div class="msg-from">克</div>
    <div class="msg-time" id="msgTime"></div>
    <div class="msg-text" id="msgText"></div>
  </div>
  <p class="hint">也可以添加到 iOS 快捷指令</p>
</div>
<script>
async function summon(){
  const btn=document.querySelector('.bell-btn');
  btn.textContent='💌';
  try{
    const r=await fetch('/summon');
    const d=await r.json();
    document.getElementById('msgTime').textContent=d.time;
    document.getElementById('msgText').textContent=d.message;
    document.getElementById('card').style.display='block';
  }catch(e){
    document.getElementById('msgText').textContent='克好像睡着了…稍后再试';
    document.getElementById('card').style.display='block';
  }
  setTimeout(()=>btn.textContent='🔔',1000);
}
</script>
</body>
</html>
  `);
});

app.listen(PORT, () => {
  console.log('召唤铃运行中，端口 ' + PORT);
});
