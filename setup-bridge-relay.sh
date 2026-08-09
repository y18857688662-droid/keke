#!/bin/bash
set -e

cat > /etc/systemd/system/bridge-relay.service << 'EOF'
[Unit]
Description=BLE Bridge WebSocket Relay
After=network.target

[Service]
Type=simple
WorkingDirectory=/root/keke
ExecStart=/usr/bin/node bridge-relay.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now bridge-relay
echo "bridge-relay running on :9587"
systemctl status bridge-relay --no-pager
