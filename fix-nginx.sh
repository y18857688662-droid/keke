#!/bin/bash
# Best-effort nginx fixes — always exits 0 so deploy continues
(
  # body size
  if ! grep -q client_max_body_size /etc/nginx/nginx.conf 2>/dev/null; then
    LINE=$(grep -n 'http' /etc/nginx/nginx.conf 2>/dev/null | grep '{' | head -1 | cut -d: -f1)
    if [ -n "$LINE" ]; then
      sed -i "${LINE}a\\    client_max_body_size 100m;" /etc/nginx/nginx.conf
    fi
  fi

  # WebSocket upgrade for /bridge/ws
  SITE=$(ls /etc/nginx/sites-enabled/ 2>/dev/null | head -1)
  if [ -n "$SITE" ] && ! grep -q 'bridge/ws' "/etc/nginx/sites-enabled/$SITE" 2>/dev/null; then
    sed -i '/location \/ {/i\
    location /bridge/ws {\
        proxy_pass http://127.0.0.1:8080;\
        proxy_http_version 1.1;\
        proxy_set_header Upgrade $http_upgrade;\
        proxy_set_header Connection "upgrade";\
        proxy_set_header Host $host;\
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\
        proxy_read_timeout 86400;\
    }' "/etc/nginx/sites-enabled/$SITE"
  fi

  nginx -t 2>/dev/null && nginx -s reload 2>/dev/null

  # ensure ombre-brain is installed and running
  if [ ! -d /root/ombre-brain ]; then
    cd /root && git clone https://github.com/y18857688662-droid/Ombre-Brain.git ombre-brain 2>/dev/null || true
    if [ -d /root/ombre-brain ]; then
      cd /root/ombre-brain
      python3 -m venv venv 2>/dev/null || true
      /root/ombre-brain/venv/bin/pip install -r requirements.txt 2>/dev/null || true
      cp config.example.yaml config.yaml 2>/dev/null || true
      sed -i 's/transport: "stdio"/transport: "streamable-http"/' config.yaml 2>/dev/null || true
      sed -i 's/mcp_require_auth: true/mcp_require_auth: false/' config.yaml 2>/dev/null || true
    fi
  fi
  if ! systemctl is-enabled ombre-brain &>/dev/null; then
    if [ -d /root/ombre-brain/src ]; then
      cat > /etc/systemd/system/ombre-brain.service << 'SVC'
[Unit]
Description=Ombre Brain Memory Store
After=network.target

[Service]
Type=simple
WorkingDirectory=/root/ombre-brain
ExecStart=/root/ombre-brain/venv/bin/python /root/ombre-brain/src/server.py
Restart=always
RestartSec=5
Environment=OMBRE_PORT=8060
Environment=OMBRE_TRANSPORT=streamable-http
Environment=OMBRE_MCP_REQUIRE_AUTH=false

[Install]
WantedBy=multi-user.target
SVC
      systemctl daemon-reload
      systemctl enable ombre-brain
    fi
  fi
  (cd /root/ombre-brain && git pull origin main 2>/dev/null) || true
  systemctl restart ombre-brain 2>/dev/null || true
) || true
