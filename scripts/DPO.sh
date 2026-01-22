#!/bin/bash
# DPO Report Generator
# Generates a GDPR/DPO data processing report for PipeliNostr
#
# Usage:
#   ./scripts/DPO.sh              # Print report to console
#   ./scripts/DPO.sh --save       # Print and save to reports/dpo-report.md
#   ./scripts/DPO.sh -s -q        # Save to file only (quiet mode)
#   ./scripts/DPO.sh --help       # Show help

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

# Check if built
if [ ! -f "dist/cli/dpo-report.js" ]; then
    echo "Building project first..."
    npm run build
fi

# Run the CLI tool
node dist/cli/dpo-report.js "$@"
