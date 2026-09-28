#!/usr/bin/env bash
# Deploy / update Indinite Events on the server (aaPanel + PM2). See docs/DEPLOY-AAPANEL.md.
#   bash scripts/deploy.sh            # pull, install, build, reload
#   bash scripts/deploy.sh --seed     # first deploy of a staging server: also load the demo data
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env.local ]]; then
  echo "✗ $ROOT/.env.local is missing. Copy deploy/env.staging.example to .env.local and fill it in." >&2
  exit 1
fi
# Read single values without exporting .env.local: PM2 saves the environment it's started from, and a stale
# copy there would override later edits to .env.local (Node's --env-file doesn't replace existing variables).
# Missing optional settings (DEPLOY_ENV, MEDIA_DIR, PORT) must not stop the script under `set -euo pipefail`.
envval() { { grep -E "^$1=" .env.local || true; } | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"; }
[[ -n "$(envval MONGODB_URI)" ]] || { echo "✗ MONGODB_URI is not set in .env.local" >&2; exit 1; }
APP_URL="$(envval APP_URL)"; [[ -n "$APP_URL" ]] || { echo "✗ APP_URL is not set in .env.local" >&2; exit 1; }
PORT="$(envval PORT)"; PORT="${PORT:-3005}"
DEPLOY_ENV="$(envval DEPLOY_ENV)"
MEDIA_DIR="$(envval MEDIA_DIR)"
for v in EMAIL_FROM RESEND_API_KEY MONGODB_URI APP_URL BETTER_AUTH_URL; do
  # printenv only sees exported variables (what PM2 would save), not this script's own shell variables.
  if printenv "$v" >/dev/null 2>&1; then echo "✗ $v is exported in this shell; open a fresh terminal (or unset it) so .env.local is the only source." >&2; exit 1; fi
done

if [[ "${SKIP_PULL:-}" != "1" ]]; then
  echo "→ Pulling latest code"
  git pull --ff-only
fi

echo "→ Installing dependencies"
corepack enable >/dev/null 2>&1 || true
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 pnpm install --frozen-lockfile

# Next.js reads env from its own folder.
ln -sfn ../../.env.local apps/web/.env.local
mkdir -p logs "${MEDIA_DIR:-$ROOT/storage/media}"

echo "→ Building the web app"
NODE_OPTIONS="--max-old-space-size=2048" pnpm --filter @indinite/web build

echo "→ Syncing database indexes"
pnpm --filter @indinite/db sync-indexes
pnpm --filter @indinite/auth sync-indexes

if [[ "${1:-}" == "--seed" ]]; then
  if [[ "${DEPLOY_ENV:-}" != "staging" ]]; then
    echo "✗ --seed is only for staging servers (DEPLOY_ENV=staging)." >&2
    exit 1
  fi
  echo "→ Loading demo data (staging)"
  pnpm --filter @indinite/db seed || echo "  (demo events already exist; skipped)"
  pnpm --filter @indinite/auth seed-users
fi

echo "→ Starting / reloading PM2"
if pm2 describe indinite-web >/dev/null 2>&1; then
  PORT="$PORT" pm2 reload ecosystem.config.cjs --update-env
else
  PORT="$PORT" pm2 start ecosystem.config.cjs
fi
pm2 save >/dev/null

echo "→ Health check"
for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    echo "✓ Deployed. Web on 127.0.0.1:${PORT}, worker running. Public URL: ${APP_URL}"
    exit 0
  fi
  sleep 2
done
echo "✗ Web app didn't answer on 127.0.0.1:${PORT}/api/health. Check: pm2 logs indinite-web" >&2
exit 1
