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
    # insert before the last closing brace of the server block
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
) || true
