#!/bin/bash
# PipeliNostr restart script

cd "$(dirname "$0")/.." || exit 1

echo "Stopping PipeliNostr..."
pkill -9 -f "node dist/index.js" 2>/dev/null || true

sleep 1

echo "Starting PipeliNostr..."
mkdir -p logs
nohup npm start > logs/pipelinostr.log 2>&1 &

sleep 2

if pgrep -f "node dist/index.js" > /dev/null; then
  echo "PipeliNostr started (PID: $(pgrep -f 'node dist/index.js'))"
  echo "Logs: tail -f logs/pipelinostr.log"
else
  echo "Failed to start PipeliNostr"
  tail -20 logs/pipelinostr.log
  exit 1
fi
