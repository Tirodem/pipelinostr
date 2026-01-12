#!/bin/bash
# PipeliNostr restart script

cd "$(dirname "$0")/.." || exit 1

# Colors
YELLOW='\033[1;33m'
NC='\033[0m'

echo "Stopping PipeliNostr..."
pkill -9 -f "node dist/index.js" 2>/dev/null || true

sleep 1

# Sync relays with config before starting
if [ -f "data/pipelinostr.db" ]; then
    echo "Syncing relays with config..."
    ./scripts/pipelinostr.sh relay clean 2>/dev/null || true
    echo ""
fi

echo "Starting PipeliNostr..."
mkdir -p logs
setsid nohup npm start > logs/pipelinostr.log 2>&1 &

sleep 2

if pgrep -f "node dist/index.js" > /dev/null; then
  echo "PipeliNostr started (PID: $(pgrep -f 'node dist/index.js'))"
  echo "Logs: tail -f logs/pipelinostr.log"
else
  echo "Failed to start PipeliNostr"
  tail -20 logs/pipelinostr.log
  exit 1
fi
