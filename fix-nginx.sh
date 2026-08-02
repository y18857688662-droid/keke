#!/bin/bash
# Best-effort nginx body size fix — always exits 0 so deploy continues
(
  if ! grep -q client_max_body_size /etc/nginx/nginx.conf 2>/dev/null; then
    LINE=$(grep -n 'http' /etc/nginx/nginx.conf 2>/dev/null | grep '{' | head -1 | cut -d: -f1)
    if [ -n "$LINE" ]; then
      sed -i "${LINE}a\\    client_max_body_size 100m;" /etc/nginx/nginx.conf
    fi
  fi
  nginx -t 2>/dev/null && nginx -s reload 2>/dev/null
) || true
