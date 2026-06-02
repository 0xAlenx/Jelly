#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_ROOT="${JELLYAI_WEB_ROOT:-/var/www/jellyai-app}"
GATEWAY_DEPLOY_DIR="$ROOT_DIR/services/jelly-gateway/deploy/tencent-cloud"

if [[ ! -f "$ROOT_DIR/dist/client/index.html" ]]; then
  echo "缺少 dist/client/index.html。请先执行: npm install && npm run build" >&2
  exit 1
fi

if [[ ! -f "$GATEWAY_DEPLOY_DIR/.env" ]]; then
  echo "缺少 $GATEWAY_DEPLOY_DIR/.env" >&2
  echo "请复制 .env.example 为 .env，填写新的数据库密码和 JellyAI 密钥。" >&2
  exit 1
fi

mkdir -p "$WEB_ROOT"
find "$WEB_ROOT" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
cp -R "$ROOT_DIR/dist/client/." "$WEB_ROOT/"

cd "$GATEWAY_DEPLOY_DIR"
docker compose up -d --build postgres gateway

echo
echo "JellyAI 新版文件已部署："
echo "- 前端静态文件: $WEB_ROOT"
echo "- 云端网关: docker compose postgres gateway"
echo
echo "请执行以下命令确认："
echo "curl -fsS http://127.0.0.1:8787/health"
echo "curl -fsS https://app.jellyai.cloud/ | head"
