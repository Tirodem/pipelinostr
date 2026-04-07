#!/bin/bash
# PipeliNostr v2 rebuild script — pull, install, build, restart

set -e
cd "$(dirname "$0")/.." || exit 1

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "=== Pulling latest changes ==="
git pull || { echo -e "${RED}Git pull failed${NC}"; exit 1; }
echo -e "${GREEN}Pull successful${NC}"
echo ""

echo "=== Installing dependencies ==="
npm install || { echo -e "${RED}npm install failed${NC}"; exit 1; }
echo -e "${GREEN}Dependencies up to date${NC}"
echo ""

echo "=== Building project ==="
npm run build || { echo -e "${RED}Build failed${NC}"; exit 1; }
echo -e "${GREEN}Build successful${NC}"
echo ""

echo "=== Validating ==="
if ! npm run validate; then
    echo -e "${RED}Validation failed — not restarting${NC}"
    exit 1
fi
echo ""

echo "=== Restarting PipeliNostr ==="

# Stop existing process if running
PID=$(pgrep -f "node dist/index.js" || true)
if [ -n "$PID" ]; then
    echo "Stopping PipeliNostr (PID: $PID)..."
    kill "$PID" 2>/dev/null || true
    sleep 2
    # Force kill if still running
    kill -9 "$PID" 2>/dev/null || true
fi

# Start
echo "Starting PipeliNostr..."
nohup node dist/index.js > logs/pipelinostr.log 2>&1 &
NEW_PID=$!
sleep 2

# Check if started
if kill -0 "$NEW_PID" 2>/dev/null; then
    echo -e "${GREEN}PipeliNostr started (PID: $NEW_PID)${NC}"
else
    echo -e "${RED}Failed to start PipeliNostr${NC}"
    echo "Last log lines:"
    tail -20 logs/pipelinostr.log
    exit 1
fi

echo ""
echo "=== Logs (Ctrl+C to exit) ==="
tail -f logs/pipelinostr.log
