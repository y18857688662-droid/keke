#!/bin/bash
# 编辑前同步脚本：确保本地代码跟远程一致
cd "$(dirname "$0")"

git fetch origin main 2>/dev/null

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
  echo "[sync] 已是最新"
else
  BEHIND=$(git rev-list HEAD..origin/main --count)
  echo "[sync] 本地落后 $BEHIND 个提交，正在拉取..."

  # 检查有没有未提交的修改
  if [ -n "$(git status --porcelain)" ]; then
    echo "[sync] 检测到未提交的修改，先 stash..."
    git stash push -q
    git pull origin main --ff-only
    git stash pop -q 2>/dev/null
  else
    git pull origin main --ff-only
  fi

  if [ $? -eq 0 ]; then
    echo "[sync] 同步完成"
  else
    echo "[sync] 同步失败，请手动处理"
    exit 1
  fi
fi
