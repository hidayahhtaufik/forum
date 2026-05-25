#!/usr/bin/env bash
#
# FORUM quick-deploy — targeted, no full-workspace rebuild.
#
# Usage on VPS:
#   bash scripts/quick.sh api        # rebuild + restart market-api only (~30s)
#   bash scripts/quick.sh console    # rebuild + restart console only (~60s, next build is slow)
#   bash scripts/quick.sh resolver   # rebuild + restart resolver worker
#   bash scripts/quick.sh env        # JUST pm2 restart all with --update-env (5s, no build)
#   bash scripts/quick.sh pull       # git pull only — useful before deciding what to rebuild
#   bash scripts/quick.sh logs       # tail all pm2 logs (Ctrl-C to exit)
#
# Use bash scripts/deploy.sh ONLY when:
#   - Dependencies changed (package.json / pnpm-lock.yaml diff)
#   - First-time deploy on new VPS
#   - You don't know what changed and want a guaranteed-clean state
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
cd "$REPO_ROOT"

TARGET="${1:-}"

case "$TARGET" in
  api|market-api)
    echo "▶ git pull"
    git pull --ff-only
    echo
    echo "▶ build @forum/market-api"
    pnpm --filter @forum/market-api build
    echo
    echo "▶ pm2 restart forum-market-api"
    pm2 restart forum-market-api --update-env
    echo
    echo "✓ market-api restarted — checking health…"
    sleep 2
    curl -s http://127.0.0.1:8403/health | head -c 200 && echo
    ;;

  console|web|frontend)
    echo "▶ git pull"
    git pull --ff-only
    echo
    echo "▶ build @forum/console"
    pnpm --filter @forum/console build
    echo
    echo "▶ pm2 restart forum-console"
    pm2 restart forum-console --update-env
    echo "✓ console restarted"
    ;;

  resolver)
    echo "▶ git pull"
    git pull --ff-only
    echo
    echo "▶ build @forum/resolver"
    pnpm --filter @forum/resolver build
    echo
    echo "▶ pm2 restart forum-resolver"
    pm2 restart forum-resolver --update-env
    echo "✓ resolver restarted"
    ;;

  env|restart)
    echo "▶ pm2 restart all --update-env (NO build, just reload env)"
    pm2 restart all --update-env
    echo "✓ all services restarted with fresh env"
    ;;

  pull)
    git pull --ff-only
    echo
    echo "files changed in this pull:"
    git diff --name-only HEAD@{1} HEAD 2>/dev/null || echo "(no previous HEAD reference)"
    ;;

  logs)
    pm2 logs --lines 50
    ;;

  status)
    pm2 list
    ;;

  *)
    cat <<EOF
FORUM quick-deploy targets:

  bash scripts/quick.sh api       # market-api code change (~30s)
  bash scripts/quick.sh console   # console code change (~60s)
  bash scripts/quick.sh resolver  # resolver worker change
  bash scripts/quick.sh env       # JUST restart with new env, no build (~5s)
  bash scripts/quick.sh pull      # git pull, show what changed
  bash scripts/quick.sh logs      # tail all logs
  bash scripts/quick.sh status    # pm2 list

For dep changes or fresh deploy, use: bash scripts/deploy.sh
EOF
    exit 1
    ;;
esac
