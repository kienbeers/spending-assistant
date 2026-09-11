#!/usr/bin/env bash
# Đẩy code lên Jetson, build và khởi động lại app. Dữ liệu (data/) trên Jetson được giữ nguyên.
# Dùng: npm run deploy
set -euo pipefail

HOST="${JETSON_HOST:-thinhhv@100.88.32.64}"
DIR="projects/chi-tieu"

cd "$(dirname "$0")/.."

echo "→ Đồng bộ code lên $HOST:~/$DIR"
ssh "$HOST" "mkdir -p ~/$DIR"
rsync -az --delete \
  --exclude node_modules --exclude .next --exclude data --exclude .git --exclude tsconfig.tsbuildinfo --exclude '.env*' \
  ./ "$HOST:~/$DIR/"

echo "→ Cài thư viện, build, khởi động lại"
ssh "$HOST" "set -e; . ~/.nvm/nvm.sh; cd ~/$DIR
  npm ci --no-audit --no-fund | tail -1
  npx next build | grep -E 'Compiled|rror' || true
  pm2 restart chi-tieu --update-env >/dev/null 2>&1 || pm2 start npm --name chi-tieu -- start >/dev/null
  pm2 save >/dev/null
  sleep 3
  echo \"✓ HTTP \$(curl -s -o /dev/null -w %{http_code} localhost:3005/)\""
