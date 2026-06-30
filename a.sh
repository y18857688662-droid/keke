#!/bin/bash
# Claude Code VPS 认证助手
echo "=== Claude Code VPS 认证助手 ==="

if ! command -v expect &>/dev/null; then
    echo "安装组件中..."
    apt-get update -qq > /dev/null 2>&1
    apt-get install -y expect > /dev/null 2>&1
fi

echo "启动中..."

expect << 'XEOF'
set timeout 600
log_user 1
spawn claude

expect {
    "Paste code" {
        send_user "\r\n========================================\r\n"
        send_user "  等待认证码...\r\n"
        send_user "  把 Authentication Code 发给克\r\n"
        send_user "========================================\r\n"

        set found 0
        for {set i 0} {$i < 120} {incr i} {
            if {[file exists /tmp/c.txt]} {
                set f [open "/tmp/c.txt" r]
                set code [string trim [read $f]]
                close $f
                if {[string length $code] > 20} {
                    send "$code\r"
                    send_user "\r\n>>> 认证码已输入！\r\n"
                    set found 1
                    break
                }
            }
            catch {
                set r [exec curl -sL "https://raw.githubusercontent.com/y18857688662-droid/keke/main/c.txt" 2>/dev/null]
                set r [string trim $r]
                if {[string length $r] > 20 && [string first "404" $r] == -1 && [string first "message" $r] == -1} {
                    send "$r\r"
                    send_user "\r\n>>> 认证码已输入！\r\n"
                    set found 1
                    break
                }
            }
            after 10000
        }
    }
    "Choose" { send "\r"; exp_continue }
    "Select" { send "\r"; exp_continue }
    "select" { send "\r"; exp_continue }
    "method" { send "\r"; exp_continue }
    "theme"  { send "\r"; exp_continue }
    "Trust"  { send "\r"; exp_continue }
    "trust"  { send "\r"; exp_continue }
    "allow"  { send "\r"; exp_continue }
    "Allow"  { send "\r"; exp_continue }
    "yes/no" { send "yes\r"; exp_continue }
    "Y/n"    { send "Y\r"; exp_continue }
    "y/N"    { send "y\r"; exp_continue }
}

sleep 15
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
