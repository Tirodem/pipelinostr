#!/bin/bash
# PipeliNostr start script

cd "$(dirname "$0")/.." || exit 1

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check if already running
if pgrep -f "node dist/index.js" > /dev/null; then
    echo -e "${YELLOW}PipeliNostr is already running${NC}"
    echo "PID: $(pgrep -f 'node dist/index.js')"
    echo "Use ./scripts/restart.sh to restart"
    exit 0
fi

echo "Starting PipeliNostr..."
mkdir -p logs
setsid nohup npm start > logs/pipelinostr.log 2>&1 &

sleep 2

if pgrep -f "node dist/index.js" > /dev/null; then
    echo -e "${GREEN}PipeliNostr started (PID: $(pgrep -f 'node dist/index.js'))${NC}"
    echo "Logs: tail -f logs/pipelinostr.log"
else
    echo -e "${RED}Failed to start PipeliNostr${NC}"
    tail -20 logs/pipelinostr.log
    exit 1
fi
