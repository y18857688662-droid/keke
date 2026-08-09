#!/bin/bash
# IO Chat Consumer 一键部署 — 在 VPS 上运行
set -e

echo "=== IO Consumer 部署 ==="

echo "[1/4] 检查 claude CLI..."
if ! command -v claude &>/dev/null; then
  echo "❌ claude 没装。安装中..."
  npm install -g @anthropic-ai/claude-code
fi
echo "✅ claude: $(which claude)"

echo "[2/4] 检查 Python 依赖..."
pip3 install --quiet httpx cryptography 2>/dev/null || pip install --quiet httpx cryptography
echo "✅ Python 依赖就绪"

echo "[3/4] 写入环境文件..."
cat > ~/io_consumer.env << 'EOF'
export FEEDLING_API_URL=https://api.feedling.app
export FEEDLING_API_KEY=a0ee1f23b9cac761ec618bfab867433ce5d328ce06f23933f5fb225d73f6b963
export FEEDLING_ENCLAVE_URL=https://9798850e096d770293c67305c6cfdceed68c1d28-5003s.dstack-pha-prod9.phala.network
export POLL_TIMEOUT=30
EOF
chmod 600 ~/io_consumer.env
echo "✅ ~/io_consumer.env 写入完成"

echo "[4/4] 设置 cron 守护..."
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CRON_CMD="pgrep -f io_consumer.py > /dev/null 2>&1 || (source ~/io_consumer.env && cd $SCRIPT_DIR && nohup python3 io_consumer.py >> ~/io_consumer.log 2>&1 &)"
(crontab -l 2>/dev/null | grep -v io_consumer; echo "* * * * * $CRON_CMD") | crontab -
echo "✅ cron 守护已设置"

echo ""
echo "========================================="
echo "部署完成！启动 consumer："
echo ""
echo "  source ~/io_consumer.env"
echo "  cd $SCRIPT_DIR"
echo "  python3 io_consumer.py"
echo ""
echo "或后台运行："
echo "  source ~/io_consumer.env && cd $SCRIPT_DIR && nohup python3 io_consumer.py >> ~/io_consumer.log 2>&1 &"
echo ""
echo "cron 会自动在进程挂掉时重启。"
echo "========================================="
