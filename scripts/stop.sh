#!/bin/bash
# PipeliNostr stop script
# Uses systemd if service exists, otherwise falls back to manual stop

cd "$(dirname "$0")/.." || exit 1

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

echo "Stopping PipeliNostr..."

# Check if systemd service exists
if systemctl list-unit-files pipelinostr.service &>/dev/null && [ -f /etc/systemd/system/pipelinostr.service ]; then
    sudo systemctl stop pipelinostr
    sleep 1

    if ! systemctl is-active --quiet pipelinostr; then
        echo -e "${GREEN}PipeliNostr stopped via systemd${NC}"
    else
        echo -e "${RED}Warning: PipeliNostr still running${NC}"
        exit 1
    fi
else
    # Fallback to manual stop (no systemd service)
    if pkill -9 -f "node dist/index.js" 2>/dev/null; then
        echo -e "${GREEN}PipeliNostr stopped${NC}"
    else
        echo "PipeliNostr was not running"
    fi

    # Verify it's stopped
    sleep 1
    if pgrep -f "node dist/index.js" > /dev/null; then
        echo -e "${RED}Warning: PipeliNostr still running${NC}"
        echo "PIDs: $(pgrep -f 'node dist/index.js')"
        exit 1
    fi
fi

# Also kill any orphaned arecord processes (morse listener)
if pkill -9 -f "arecord.*plughw" 2>/dev/null; then
    echo "Killed orphaned arecord process"
fi
