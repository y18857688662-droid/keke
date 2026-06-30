#!/bin/bash
echo "=== Claude Code VPS 认证助手 ==="

if ! command -v expect &>/dev/null; then
    echo "安装组件中..."
    apt-get update -qq > /dev/null 2>&1
    apt-get install -y expect > /dev/null 2>&1
fi

echo "启动中..."

expect << 'XEOF'
set stty_init "columns 2000"
set timeout 3
log_user 1
spawn claude

set tries 0
while {$tries < 30} {
    expect {
        "Browser" { break }
        -re "aste.*code" { break }
        "Press Enter" { send "\r"; exp_continue }
        timeout {
            send "\r"
            incr tries
        }
    }
}

set timeout 30
set url ""
expect {
    -re "(https://\[^ \r\n\]+)" {
        set url $expect_out(1,string)
    }
    timeout {}
}

set f [open "/tmp/vps_url_raw.txt" w]
puts $f $url
close $f

set f [open "/tmp/post_url.py" w]
puts $f {
import re, json, urllib.request
url = open('/tmp/vps_url_raw.txt').read().strip()
url = re.sub(r'\x1b\[[0-9;]*[a-zA-Z]', '', url)
url = re.sub(r'[^\x20-\x7e]', '', url)
open('/tmp/vps_url.txt', 'w').write(url)
data = json.dumps({"reply": "VPS_AUTH_URL: " + url}).encode()
req = urllib.request.Request("https://keke-production.up.railway.app/chat/reply",
    data=data, headers={"Content-Type": "application/json"}, method="POST")
try: urllib.request.urlopen(req, timeout=10)
except: pass
}
close $f

catch { exec python3 /tmp/post_url.py }

send_user "\r\n>>> 链接已发送到服务器！等待认证码...\r\n"

sleep 3

set found 0
set code ""
for {set i 0} {$i < 180} {incr i} {
    if {[file exists /tmp/c.txt]} {
        set f [open "/tmp/c.txt" r]
        set code [string trim [read $f]]
        close $f
        if {[string length $code] > 20} {
            set found 1
            break
        }
    }

    set code ""
    catch {
        set code [exec python3 -c {
import json, urllib.request
req = urllib.request.Request("https://keke-production.up.railway.app/chat/history")
resp = urllib.request.urlopen(req, timeout=10)
data = json.loads(resp.read())
msgs = data.get("messages", [])
for m in reversed(msgs):
    c = m.get("content", "")
    if c.startswith("AUTH_CODE:"):
        print(c.split(":", 1)[1].strip())
        break
}]
    }
    if {[string length $code] > 20} {
        set found 1
        break
    }

    after 10000
}

if {$found} {
    send "$code\r"
    send_user "\r\n>>> 认证码已输入！\r\n"
} else {
    send_user "\r\n>>> 超时\r\n"
}

sleep 20
send "/exit\r"
catch { expect eof }
XEOF

echo ""
echo "测试中..."
RESULT=$(claude -p "reply OK" --max-turns 1 2>&1 | head -3)
if echo "$RESULT" | grep -qi "ok"; then
    echo "=== 认证成功！==="
else
    echo "结果: $RESULT"
fi
