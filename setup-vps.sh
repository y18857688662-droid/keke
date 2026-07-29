#!/bin/bash
# keke VPS 部署脚本
# 在 Vultr VPS 上运行: curl -sL https://raw.githubusercontent.com/y18857688662-droid/keke/main/setup-vps.sh | bash

set -e

echo "=== keke 部署开始 ==="

# 1. 检查 Node.js
if ! command -v node &> /dev/null; then
  echo "安装 Node.js..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
echo "Node.js: $(node -v)"

# 2. 克隆代码
if [ -d /root/keke ]; then
  echo "更新代码..."
  cd /root/keke && git pull
else
  echo "克隆代码..."
  cd /root && git clone https://github.com/y18857688662-droid/keke.git
fi
cd /root/keke

# 3. 安装依赖
echo "安装依赖..."
npm install --production

# 4. 从备份恢复数据
echo "从备份恢复数据..."
node -e "
const http = require('http');
const fs = require('fs');
const names = ['chat','auth','api-config','push-subs','diary','period','garden','pings','netease-cred','music-playlist'];
let done = 0;
names.forEach(name => {
  http.get('http://127.0.0.1:9588/backup/' + name, res => {
    let d = '';
    res.on('data', c => d += c);
    res.on('end', () => {
      try {
        JSON.parse(d);
        const fname = name === 'chat' ? 'chat.json'
          : name === 'auth' ? 'auth.json'
          : name === 'api-config' ? 'api-config.json'
          : name === 'push-subs' ? 'push_subs.json'
          : name === 'diary' ? 'diary.json'
          : name === 'period' ? 'period.json'
          : name === 'garden' ? 'garden.json'
          : name === 'pings' ? 'pings.json'
          : name === 'netease-cred' ? 'netease-cred.json'
          : name === 'music-playlist' ? 'music-playlist.json'
          : name + '.json';
        fs.writeFileSync('/root/keke/' + fname, d);
        console.log('  restored: ' + name);
      } catch(e) {}
      if (++done === names.length) console.log('数据恢复完成');
    });
  }).on('error', () => { if (++done === names.length) console.log('数据恢复完成'); });
});
"

# 5. 创建 systemd 服务
echo "创建服务..."
cat > /etc/systemd/system/keke.service << 'SVC'
[Unit]
Description=Keke Chat Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/root/keke
ExecStart=/usr/bin/node /root/keke/server.js
Restart=always
RestartSec=5
Environment=PORT=8080
Environment=CHAT_BACKUP_URL=http://127.0.0.1:9588

[Install]
WantedBy=multi-user.target
SVC

systemctl daemon-reload
systemctl enable keke
systemctl start keke
echo "keke 服务已启动"

# 6. 更新 nginx 配置
echo "更新 nginx..."
NGINX_CONF="/etc/nginx/sites-available/yyaokeke"
if [ -f "$NGINX_CONF" ]; then
  cp "$NGINX_CONF" "${NGINX_CONF}.bak"
fi

cat > "$NGINX_CONF" << 'NGINX'
server {
    listen 80;
    server_name yyaokeke.top;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name yyaokeke.top;

    ssl_certificate /etc/letsencrypt/live/yyaokeke.top/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yyaokeke.top/privkey.pem;

    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }
}
NGINX

ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/yyaokeke
nginx -t && systemctl reload nginx
echo "nginx 已更新"

# 7. 开放防火墙
ufw allow 8080 2>/dev/null || true

echo ""
echo "=== 部署完成！==="
echo "keke 已在 https://yyaokeke.top 运行"
echo "用 systemctl status keke 查看状态"
