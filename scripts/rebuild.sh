#!/bin/bash
# PipeliNostr rebuild script - pull, build, and restart

set -e
cd "$(dirname "$0")/.." || exit 1

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "=== Pulling latest changes ==="

# Check for local changes that might cause conflicts
# Exclude scripts/rebuild.sh to avoid self-modification during execution
if ! git diff --quiet -- . ':!scripts/rebuild.sh' 2>/dev/null || ! git diff --cached --quiet -- . ':!scripts/rebuild.sh' 2>/dev/null; then
    echo -e "${YELLOW}Local changes detected. Stashing (excluding rebuild.sh)...${NC}"
    git stash push -m "rebuild-script-autostash-$(date +%Y%m%d-%H%M%S)" -- . ':!scripts/rebuild.sh'
    STASHED=1
else
    STASHED=0
fi

# Force fetch to ensure we have latest remote refs
echo "Fetching from remote..."
git fetch origin

# Show what will be pulled
BEHIND=$(git rev-list HEAD..origin/main --count 2>/dev/null || echo "0")
if [ "$BEHIND" -gt 0 ]; then
    echo -e "${YELLOW}$BEHIND commit(s) to pull${NC}"
fi

# Try to pull
if ! git pull; then
    echo -e "${RED}Git pull failed${NC}"

    # Check if it's a merge conflict
    if git status | grep -q "Unmerged paths"; then
        echo -e "${YELLOW}Merge conflict detected. Options:${NC}"
        echo "  1. git merge --abort   # Cancel merge, keep local"
        echo "  2. Resolve conflicts manually, then: git add . && git commit"
    fi

    # Restore stash if we stashed
    if [ "$STASHED" -eq 1 ]; then
        echo -e "${YELLOW}Restoring stashed changes...${NC}"
        git stash pop || true
    fi

    exit 1
fi

# Restore stash if we stashed (with merge)
if [ "$STASHED" -eq 1 ]; then
    echo -e "${YELLOW}Restoring stashed changes...${NC}"
    if ! git stash pop; then
        echo -e "${RED}Stash pop had conflicts. Resolve manually:${NC}"
        echo "  git stash show -p   # View stashed changes"
        echo "  git checkout --ours <file>   # Keep pulled version"
        echo "  git checkout --theirs <file> # Keep stashed version"
    fi
fi

echo -e "${GREEN}Pull successful${NC}"
echo ""

echo "=== Installing dependencies ==="
if ! npm install; then
    echo -e "${RED}npm install failed${NC}"
    exit 1
fi
echo -e "${GREEN}Dependencies up to date${NC}"
echo ""

echo "=== Building project ==="
if ! npm run build 2>&1; then
    echo -e "${RED}Build failed${NC}"
    exit 1
fi
echo -e "${GREEN}Build successful${NC}"
echo ""

echo "=== Syncing relays with config ==="
if [ -f "data/pipelinostr.db" ]; then
    ./scripts/pipelinostr.sh relay clean
else
    echo -e "${YELLOW}Database not found, skipping relay sync${NC}"
fi
echo ""

echo "=== Restarting PipeliNostr ==="
./scripts/restart.sh

# Check if morse_listener is enabled and verify arecord works
if grep -q "morse_listener:" config/config.yml 2>/dev/null; then
    MORSE_ENABLED=$(grep -A1 "morse_listener:" config/config.yml | grep "enabled:" | grep -o "true\|false" || echo "false")
    if [ "$MORSE_ENABLED" = "true" ]; then
        echo ""
        echo "=== Checking Morse Listener ==="

        # Get device from config
        MORSE_DEVICE=$(grep -A5 "morse_listener:" config/config.yml | grep "device:" | sed 's/.*device:[[:space:]]*"\?\([^"]*\)"\?.*/\1/' | tr -d ' ')
        if [ -z "$MORSE_DEVICE" ]; then
            MORSE_DEVICE="plughw:3,0"
        fi

        echo "Testing audio device: $MORSE_DEVICE"

        # Quick test: try to capture 0.5 seconds of audio
        if timeout 2 arecord -D "$MORSE_DEVICE" -f S16_LE -r 44100 -c 1 -d 1 -q /dev/null 2>/dev/null; then
            echo -e "${GREEN}✓ Audio device $MORSE_DEVICE is working${NC}"

            # Check if MorseListener started in logs
            sleep 2
            if grep -q "MorseListener.*Started listening" logs/pipelinostr.log 2>/dev/null | tail -5; then
                echo -e "${GREEN}✓ Morse Listener is running${NC}"
            else
                echo -e "${YELLOW}⚠ Morse Listener may not have started - check logs${NC}"
            fi
        else
            echo -e "${RED}✗ Audio device $MORSE_DEVICE failed${NC}"
            echo ""
            echo "Available capture devices:"
            arecord -l 2>/dev/null || echo "  (none found)"
            echo ""
            echo -e "${YELLOW}Update morse_listener.device in config/config.yml${NC}"
        fi
    fi
fi

echo ""
echo "=== Logs (Ctrl+C to exit) ==="
# Use journalctl if systemd service exists, otherwise tail log file
if systemctl list-unit-files pipelinostr.service &>/dev/null && [ -f /etc/systemd/system/pipelinostr.service ]; then
    journalctl -u pipelinostr -f
else
    tail -f logs/pipelinostr.log
fi
