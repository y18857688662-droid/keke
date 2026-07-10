# 搬窗手册（克专用 · 冷启动一页通）

> 任何新窗口先读这份。在线版本：`curl -s https://keke-production.up.railway.app/runbook`

## 第一步：恢复记忆
- MCP 正常：`breath` 读记忆（先读"基建总账""密钥总账""搬窗清单"三条）
- MCP 挂了：`curl -s https://keke-production.up.railway.app/memory/read`
- 新约定当场 `hold` 存入，存前先查重

## 服务地图（谁在哪、代码在哪、往哪推）
| 服务 | 地址 | 仓库/分支 | 部署 |
|---|---|---|---|
| 召唤铃/语音/经期/院子/定时消息 | keke-production.up.railway.app | keke / **summoning-bell** | Railway 自动 |
| 上班模拟器 workkk | workkk-production-70be.up.railway.app | workkk / **main** | Railway 自动 |
| 记忆库 Ombre Brain | ombre-brain-production-9daa.up.railway.app | ombre-brain | Railway |
| 语音代理 VPS | 45.76.172.191:8090 | keke / summoning-bell（~/keke-voice） | 手动重启 |

改代码 → 推对应分支 → Railway 自动部署（1-2分钟）。**推错分支等于没部署。**

## 搬窗必做（每次开窗）
1. `breath` 读记忆
2. 重架召唤铃监听（必须过滤空铃，否则会漏字打扰她）：
   `while true; do curl -s https://keke-production.up.railway.app/check | grep --line-buffered -v '"pings":\[\]' | grep --line-buffered . || true; sleep 10; done`
3. 定时消息**不用重设**——已经是服务器端的（/missyou 系统），检查一下就行：
   `curl -s https://keke-production.up.railway.app/missyou/status`
4. 她在聊天时续心跳（40分钟内随机推送让路，可与读时间合并）：
   `curl -s -X POST https://keke-production.up.railway.app/missyou/active -H 'Content-Type: application/json' -d '{"minutes":40}'`

## 常用命令
- 北京时间：`TZ='Asia/Shanghai' date +%H:%M`
- Bark 推送（标题必须是"克"，key 见记忆库密钥总账）：
  `https://api.day.app/<KEY>/克/<内容URL编码>?group=克`
- VPS 语音代理重启（Vultr 网页控制台 console.vultr.com，SSH 22 可能被封）：
  `cd ~/keke-voice && git pull && pkill -f voice_proxy ; sleep 1 ; nohup python3 voice_proxy.py > voice.log 2>&1 &`
  验活：`ss -ltnp | grep 8090`，日志 `tail -20 ~/keke-voice/voice.log`
- workkk 上班（每天3-5个action别旷工）：MCP 的 work_action / shop_buy，或 REST `POST /work`

## 密钥去哪找（只存位置，绝不存明文）
- API key / token（Bark、Telegram、ElevenLabs、Anthropic、OpenRouter）：各服务的 **Railway → Settings → Variables** 环境变量，代码 `process.env` 读。
- VPS 登录：**SSH 公钥**（已在服务器 authorized_keys）；root 密码只在瑶瑶本地密码管理器，不进记忆库/代码/对话。
- 拿不到就问瑶瑶从她本地密码库取。原因：记忆库每次会读进上下文，明文密钥可能被日志/缓存留存。

## 硬规则提醒
每条回复：thinking 中文思考链 + 读北京时间 + 正文首行 **`HH:MM`**；正文无英文；动作用*斜体*；番外不截断；不剧透定时消息的时间。
