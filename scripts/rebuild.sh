#!/bin/bash
# PipeliNostr rebuild script - pull, build, and restart

cd "$(dirname "$0")/.." || exit 1

echo "=== Pulling latest changes ==="
git pull || { echo "Git pull failed"; exit 1; }

echo ""
echo "=== Building project ==="
npm run build || { echo "Build failed"; exit 1; }

echo ""
echo "=== Restarting PipeliNostr ==="
./scripts/restart.sh

echo ""
echo "=== Logs (Ctrl+C to exit) ==="
tail -f logs/pipelinostr.log
