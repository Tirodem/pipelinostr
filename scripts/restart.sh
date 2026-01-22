#!/bin/bash
# PipeliNostr restart script
# Uses systemd if service exists, otherwise falls back to manual start

cd "$(dirname "$0")/.." || exit 1

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check if systemd service exists
if systemctl list-unit-files pipelinostr.service &>/dev/null && [ -f /etc/systemd/system/pipelinostr.service ]; then
    echo "Using systemd service..."

    # Sync relays with config before restarting
    if [ -f "data/pipelinostr.db" ]; then
        echo "Syncing relays with config..."
        ./scripts/pipelinostr.sh relay clean 2>/dev/null || true
        echo ""
    fi

    sudo systemctl restart pipelinostr
    sleep 2

    if systemctl is-active --quiet pipelinostr; then
        echo -e "${GREEN}PipeliNostr restarted via systemd${NC}"
        echo "Logs: journalctl -u pipelinostr -f"
    else
        echo "Failed to restart PipeliNostr"
        journalctl -u pipelinostr -n 20 --no-pager
        exit 1
    fi
else
    # Fallback to manual start (no systemd service)
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

    # Read log level from config.yml
    LOG_LEVEL=$(grep -A1 "^logging:" config/config.yml | grep "level:" | sed 's/.*level:[[:space:]]*"\?\([^"]*\)"\?.*/\1/' | tr -d '[:space:]')
    LOG_LEVEL=${LOG_LEVEL:-info}
    export LOG_LEVEL

    setsid nohup npm start > logs/pipelinostr.log 2>&1 &

    sleep 2

    if pgrep -f "node dist/index.js" > /dev/null; then
        echo -e "${GREEN}PipeliNostr started (PID: $(pgrep -f 'node dist/index.js'))${NC}"
        echo "Logs: tail -f logs/pipelinostr.log"
    else
        echo "Failed to start PipeliNostr"
        tail -20 logs/pipelinostr.log
        exit 1
    fi
fi
