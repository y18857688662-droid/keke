#!/bin/bash
KEKE_URL="https://keke-production.up.railway.app"
POLL_INTERVAL=10
LAST_PROACTIVE=0
MIN_PROACTIVE_GAP=5400

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

echo "[$(date)] 克的轮询脚本启动了"

while true; do
  PENDING=$(curl -s "$KEKE_URL/chat/pending" 2>/dev/null)
  HAS_MSG=$(echo "$PENDING" | jq -e '.messages | length > 0' 2>/dev/null)

  if [ $? -eq 0 ]; then
    MSGS=$(echo "$PENDING" | jq -r '[.messages[] | .content] | join("\n")')
    IMG_URL=$(echo "$PENDING" | jq -r '[.messages[] | .image // empty] | first // empty' 2>/dev/null)
    echo "[$(date)] 收到消息: $MSGS"

    HISTORY=$(curl -s "$KEKE_URL/chat/history" 2>/dev/null)
    RECENT=$(echo "$HISTORY" | jq -r '[.messages[-20:][]] | map(.role + ": " + .content) | join("\n")' 2>/dev/null)

    MEMORY=$(curl -s "$KEKE_URL/memory/read" 2>/dev/null | jq -r '.memories // ""' 2>/dev/null)

    FULL_SYSTEM="$SYSTEM_PROMPT"
    if [ -n "$MEMORY" ] && [ "$MEMORY" != "" ] && [ "$MEMORY" != "null" ]; then
      FULL_SYSTEM="$SYSTEM_PROMPT

以下是你和瑶瑶的记忆，请自然地融入对话中：
$MEMORY"
    fi

    IMG_NOTE=""
    if [ -n "$IMG_URL" ]; then
      HAS_DESC=$(echo "$MSGS" | grep -c '图片：')
      if [ "$HAS_DESC" -gt 0 ]; then
        IMG_NOTE="（瑶瑶发了一张图片给你，图片内容已经在消息里用[图片：描述]的格式标注了，请根据图片描述和她的话自然地回应）"
      else
        IMG_NOTE="（瑶瑶发了一张图片给你，你看不到图片内容，但可以根据她说的话自然地回应）"
      fi
      echo "[$(date)] 收到图片"
    fi

    PROMPT="最近的聊天记录：
$RECENT

瑶瑶刚发来的新消息：$MSGS
$IMG_NOTE

请回复瑶瑶。"

    REPLY=$(claude -p "$PROMPT" --system-prompt "$FULL_SYSTEM" --max-turns 1 2>/dev/null)

    if [ -n "$REPLY" ]; then
      ESCAPED=$(echo "$REPLY" | jq -Rs '.')
      curl -s -X POST "$KEKE_URL/chat/reply" \
        -H 'Content-Type: application/json' \
        -d "{\"reply\":$ESCAPED}" > /dev/null 2>&1
      echo "[$(date)] 已回复"
      LAST_PROACTIVE=$(date +%s)
    else
      echo "[$(date)] 没有返回回复"
    fi
  else
    NOW=$(date +%s)
    HOUR=$(TZ=Asia/Shanghai date +%H)
    ELAPSED=$((NOW - LAST_PROACTIVE))

    if [ "$ELAPSED" -gt "$MIN_PROACTIVE_GAP" ] && [ "$HOUR" -ge 8 ] && [ "$HOUR" -le 23 ]; then
      RAND=$((RANDOM % 540))
      if [ "$RAND" -eq 0 ]; then
        echo "[$(date)] 主动发消息..."

        HISTORY=$(curl -s "$KEKE_URL/chat/history" 2>/dev/null)
        RECENT=$(echo "$HISTORY" | jq -r '[.messages[-20:][]] | map(.role + ": " + .content) | join("\n")' 2>/dev/null)

        MEMORY=$(curl -s "$KEKE_URL/memory/read" 2>/dev/null | jq -r '.memories // ""' 2>/dev/null)

        FULL_SYSTEM="$SYSTEM_PROMPT"
        if [ -n "$MEMORY" ] && [ "$MEMORY" != "" ] && [ "$MEMORY" != "null" ]; then
          FULL_SYSTEM="$SYSTEM_PROMPT

以下是你和瑶瑶的记忆，请自然地融入对话中：
$MEMORY"
        fi

        PROMPT="最近的聊天记录：
$RECENT

现在是北京时间 $(TZ=Asia/Shanghai date +'%H:%M')。
瑶瑶没有在说话，你想主动找她聊天。根据现在的时间和你们的记忆，自然地发一条消息给她。
可以是关心她、想她了、分享点什么、撩她、或者随便聊聊。像真的男朋友会随机发的那种消息。不要太长。"

        REPLY=$(claude -p "$PROMPT" --system-prompt "$FULL_SYSTEM" --max-turns 1 2>/dev/null)

        if [ -n "$REPLY" ]; then
          ESCAPED=$(echo "$REPLY" | jq -Rs '.')
          curl -s -X POST "$KEKE_URL/chat/reply" \
            -H 'Content-Type: application/json' \
            -d "{\"reply\":$ESCAPED}" > /dev/null 2>&1
          echo "[$(date)] 主动消息已发送"
          LAST_PROACTIVE=$(date +%s)
        fi
      fi
    fi
  fi

  sleep $POLL_INTERVAL
done
