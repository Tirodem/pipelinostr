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
if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
    echo -e "${YELLOW}Local changes detected. Stashing...${NC}"
    git stash push -m "rebuild-script-autostash-$(date +%Y%m%d-%H%M%S)"
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
if ! npm install --silent; then
    echo -e "${RED}npm install failed${NC}"
    exit 1
fi
echo -e "${GREEN}Dependencies up to date${NC}"
echo ""

echo "=== Building project ==="
if ! npm run build; then
    echo -e "${RED}Build failed${NC}"
    exit 1
fi
echo -e "${GREEN}Build successful${NC}"
echo ""

echo "=== Restarting PipeliNostr ==="
./scripts/restart.sh

echo ""
echo "=== Logs (Ctrl+C to exit) ==="
tail -f logs/pipelinostr.log
