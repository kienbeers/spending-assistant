#!/usr/bin/env bash
# Deploy qua git: push lên GitHub → Jetson lấy code từ đó, build và khởi động lại.
# Dữ liệu (data/) và cấu hình (.env.local) trên Jetson không bị ảnh hưởng vì đã nằm trong .gitignore.
# Dùng: npm run deploy
set -euo pipefail

HOST="${JETSON_HOST:-thinhhv@100.88.32.64}"
DIR="projects/chi-tieu"

cd "$(dirname "$0")/.."
BRANCH="$(git rev-parse --abbrev-ref HEAD)"

if [ -n "$(git status --porcelain)" ]; then
  echo "✗ Còn thay đổi chưa commit, không deploy được:"
  git status --short
  echo "→ Commit rồi chạy lại: git add -A && git commit -m \"...\" && npm run deploy"
  exit 1
fi

echo "→ Push $BRANCH lên GitHub"
git push -q origin "$BRANCH"

echo "→ Jetson lấy code, build và khởi động lại"
ssh "$HOST" "set -e; . ~/.nvm/nvm.sh; cd ~/$DIR
  git fetch -q origin $BRANCH
  git reset -q --hard origin/$BRANCH
  npm ci --no-audit --no-fund | tail -1
  npx next build | grep -E 'Compiled|rror' || true
  pm2 restart chi-tieu --update-env >/dev/null 2>&1 || pm2 start npm --name chi-tieu -- start >/dev/null
  pm2 save >/dev/null
  sleep 3
  echo \"✓ HTTP \$(curl -s -o /dev/null -w %{http_code} localhost:3005/)\""

echo "✓ Đã deploy $(git rev-parse --short HEAD) ($BRANCH) lên $HOST"
