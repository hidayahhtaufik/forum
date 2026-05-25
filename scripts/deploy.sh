#!/usr/bin/env bash
#
# FORUM VPS deploy — single-command idempotent deploy.
#
# Assumptions:
#   - Repo cloned at $REPO_ROOT (default: ~/forum)
#   - Node 22+ and pnpm 9+ installed
#   - PM2 installed globally (`npm i -g pm2`)
#   - `.env` already populated at $REPO_ROOT/.env
#
# Usage on VPS:
#   cd ~/forum && bash scripts/deploy.sh
#
# Steps:
#   1. git pull
#   2. pnpm install --frozen-lockfile
#   3. pnpm -r build
#   4. mkdir -p logs
#   5. pm2 reload ecosystem.config.cjs --update-env (or start if first deploy)
#   6. pm2 save
#
# Re-runnable: zero-downtime via `pm2 reload`. No data migrations (SQLite file
# survives across deploys; clear with `rm apps/market-api/data/forum.db` if
# you want a fresh DB).
set -euo pipefail

# Resolve the repo root from the script's own location so this works no matter
# what the parent directory is called (`forum`, `forum-arc`, etc.).
# Override with `REPO_ROOT=/path/to/repo bash scripts/deploy.sh` if you need.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
cd "$REPO_ROOT"

echo "▶ forum deploy from $REPO_ROOT"
echo "  $(git log -1 --oneline)"
echo

# 1. Pull latest
echo "▶ git pull"
git pull --ff-only

# 2. Install + build
echo
echo "▶ pnpm install"
pnpm install --frozen-lockfile

echo
echo "▶ pnpm -r build"
pnpm -r build

# 3. Ensure logs dir
mkdir -p logs

# 4. PM2 reload (or start on first deploy)
echo
if pm2 list 2>/dev/null | grep -q "forum-market-api"; then
  echo "▶ pm2 reload (zero-downtime)"
  pm2 reload ecosystem.config.cjs --update-env
else
  echo "▶ pm2 start (first deploy)"
  pm2 start ecosystem.config.cjs
  pm2 startup || true
fi

pm2 save

echo
echo "✓ deploy complete"
echo "  pm2 list      # check status"
echo "  pm2 logs      # tail all logs"
echo "  pm2 monit     # live dashboard"
