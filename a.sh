#!/bin/bash
# Claude Code VPS 认证助手
echo "=== Claude Code VPS 认证助手 ==="
echo ""

if ! command -v expect &>/dev/null; then
    echo "安装组件中..."
    apt-get update -qq > /dev/null 2>&1
    apt-get install -y expect > /dev/null 2>&1
    echo "安装完成"
fi

echo "启动 Claude Code..."
echo "URL 出来后截图发给克"
echo "拿到 Authentication Code 后发给克"
echo ""

expect << 'XEOF'
set timeout 600
log_user 1

spawn claude

expect {
    -re "theme|Choose|style|select" {
        send "\r"
        exp_continue
    }
    -re "trust|Trust|allow|Allow|project|yes|No" {
        send "\r"
        exp_continue
    }
    "Paste code" {
        send_user "\r\n\r\n"
        send_user "========================================\r\n"
        send_user "  等待认证码中...\r\n"
        send_user "  请把 Authentication Code 发给克\r\n"
        send_user "  脚本会自动读取并输入\r\n"
        send_user "========================================\r\n\r\n"

        set found 0
        for {set i 0} {$i < 120} {incr i} {
            if {[file exists /tmp/c.txt]} {
                set f [open "/tmp/c.txt" r]
                set code [string trim [read $f]]
                close $f
                if {[string length $code] > 20} {
                    send "$code\r"
                    send_user "\r\n>>> 认证码已输入！等待验证...\r\n"
                    set found 1
                    break
                }
            }

            catch {
                set r [exec curl -sL "https://raw.githubusercontent.com/y18857688662-droid/keke/main/c.txt" 2>/dev/null]
                set r [string trim $r]
                if {[string length $r] > 20 && [string first "404" $r] == -1 && [string first "\"message\"" $r] == -1} {
                    send "$r\r"
                    send_user "\r\n>>> 认证码已输入！等待验证...\r\n"
                    set found 1
                    break
                }
            }

            after 10000
        }

        if {!$found} {
            send_user "\r\n>>> 超时，请手动输入 code\r\n"
        }
    }
}

sleep 15
send "/exit\r"
expect eof
XEOF

echo ""
echo "=== 测试认证 ==="
RESULT=$(claude -p "reply with just OK" --max-turns 1 2>&1 | head -5)
if echo "$RESULT" | grep -qi "ok\|OK"; then
    echo "认证成功！Claude Code 可以用了！"
else
    echo "测试结果: $RESULT"
fi
