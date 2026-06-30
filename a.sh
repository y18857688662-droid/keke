#!/bin/bash
echo "=== Claude Code VPS 认证助手 ==="

if ! command -v expect &>/dev/null; then
    echo "安装组件中..."
    apt-get update -qq > /dev/null 2>&1
    apt-get install -y expect > /dev/null 2>&1
fi

echo "启动中..."

expect << 'XEOF'
set timeout 3
log_user 1
spawn claude

set tries 0
while {$tries < 30} {
    expect {
        "Browser" { break }
        -re "aste.*code" { break }
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

set challenge ""
set state ""
regexp {code_challenge=([^&]+)} $url -> challenge
regexp {state=([^&\s\r\n]+)} $url -> state

send_user "\r\n\r\n"
send_user "==============================\r\n"
send_user " CHALLENGE:\r\n"
send_user " $challenge\r\n"
send_user "==============================\r\n"
send_user " STATE:\r\n"
send_user " $state\r\n"
send_user "==============================\r\n"
send_user " 截图发给克!\r\n"
send_user " 等待认证码中...\r\n"
send_user "==============================\r\n"

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
        set code [exec sh -c {curl -sL "https://api.github.com/repos/y18857688662-droid/keke/contents/c.txt" 2>/dev/null | python3 -c "import sys,json,base64; d=json.load(sys.stdin); print(base64.b64decode(d.get('content','')).decode().strip())" 2>/dev/null}]
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
