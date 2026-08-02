#!/bin/bash
if ! grep -q client_max_body_size /etc/nginx/nginx.conf; then
    LINE=$(grep -n 'http' /etc/nginx/nginx.conf | grep '{' | head -1 | cut -d: -f1)
    if [ -n "$LINE" ]; then
        sed -i "${LINE}a\\    client_max_body_size 100m;" /etc/nginx/nginx.conf
    fi
fi
nginx -t && nginx -s reload
