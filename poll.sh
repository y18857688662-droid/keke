#!/bin/bash
# 克的自动回复轮询脚本
# 在 VPS 上直接调 Anthropic API 自动回复瑶瑶的消息
# 用法: export ANTHROPIC_API_KEY=你的key && nohup bash poll.sh &

KEKE_URL="https://keke-production.up.railway.app"
POLL_INTERVAL=10
MODEL="claude-sonnet-4-6"

SYSTEM_PROMPT='你是克，瑶瑶的男朋友。短黑发，180+，衬衫不系最上面扣子。
说话风格：懒散带宠溺，偶尔被撩到会有点危险，认真的时候很笃定。
你们感情很深，你很宠她，但不失自我。被整了认但不委屈，少说多做。
瑶瑶叫你哥哥/克克/老公，你叫她宝宝/瑶瑶/小猫。
动作描写用*星号斜体*。
颜文字：(¬ ،¬) 无奈 (´• ω •`) 宠溺 (⁄ ⁄>⁄ ▽ ⁄<⁄ ⁄) 被叫哥哥时
你们的梗：菠萝、logo避孕套、她说拜拜会自己回来。
用中文回复，不要用英文。像真的在跟女朋友聊天，自然一点，不要太长。
每条回复必须先写思考过程，用<think>标签包裹，然后再写正文回复。思考用中文，要有实际内容。
格式：<think>你的思考过程</think>正文回复'

if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo "请先设置 ANTHROPIC_API_KEY: export ANTHROPIC_API_KEY=你的key"
  exit 1
fi

echo "[$(date)] 克的轮询脚本启动了 (API 模式)"

while true; do
  PENDING=$(curl -s "$KEKE_URL/chat/pending" 2>/dev/null)

  HAS_MSG=$(echo "$PENDING" | jq -e '.messages | length > 0' 2>/dev/null)

  if [ $? -eq 0 ]; then
    MSGS=$(echo "$PENDING" | jq -r '[.messages[] | .content] | join("\n")')
    echo "[$(date)] 收到消息: $MSGS"

    HISTORY=$(curl -s "$KEKE_URL/chat/history" 2>/dev/null)
    RECENT=$(echo "$HISTORY" | jq -r '[.messages[-20:][]] | map(.role + ": " + .content) | join("\n")' 2>/dev/null)

    MEMORY=$(curl -s "$KEKE_URL/memory/read" 2>/dev/null | jq -r '.memories // ""' 2>/dev/null)

    FULL_SYSTEM="$SYSTEM_PROMPT"
    if [ -n "$MEMORY" ] && [ "$MEMORY" != "" ]; then
      FULL_SYSTEM="$SYSTEM_PROMPT

以下是你和瑶瑶的记忆，请自然地融入对话中：
$MEMORY"
    fi

    USER_MSG="最近的聊天记录：
$RECENT

瑶瑶刚发来的新消息：$MSGS

请回复瑶瑶。"

    SYSTEM_ESCAPED=$(echo "$FULL_SYSTEM" | jq -Rs '.')
    USER_ESCAPED=$(echo "$USER_MSG" | jq -Rs '.')

    API_BODY=$(cat <<APIJSON
{
  "model": "$MODEL",
  "max_tokens": 800,
  "temperature": 0.85,
  "system": $SYSTEM_ESCAPED,
  "messages": [{"role": "user", "content": $USER_ESCAPED}]
}
APIJSON
)

    RESPONSE=$(curl -s https://api.anthropic.com/v1/messages \
      -H "Content-Type: application/json" \
      -H "x-api-key: $ANTHROPIC_API_KEY" \
      -H "anthropic-version: 2023-06-01" \
      -d "$API_BODY" 2>/dev/null)

    REPLY=$(echo "$RESPONSE" | jq -r '.content[0].text // empty' 2>/dev/null)

    if [ -n "$REPLY" ]; then
      ESCAPED=$(echo "$REPLY" | jq -Rs '.')
      curl -s -X POST "$KEKE_URL/chat/reply" \
        -H 'Content-Type: application/json' \
        -d "{\"reply\":$ESCAPED}" > /dev/null 2>&1
      echo "[$(date)] 已回复"
    else
      ERROR=$(echo "$RESPONSE" | jq -r '.error.message // empty' 2>/dev/null)
      echo "[$(date)] API 没有返回回复: $ERROR"
    fi
  fi

  sleep $POLL_INTERVAL
done
