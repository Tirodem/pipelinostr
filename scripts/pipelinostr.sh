#!/bin/bash
# PipeliNostr v2 CLI wrapper
# Delegates to Node.js CLI at dist/cli/index.js

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Check if built
if [ ! -f "$PROJECT_DIR/dist/cli/index.js" ]; then
    echo "Error: PipeliNostr not built. Run: npm run build"
    exit 1
fi

exec node "$PROJECT_DIR/dist/cli/index.js" "$@"
