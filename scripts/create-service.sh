#!/bin/bash
# create-service.sh - Create systemd service for PipeliNostr
# Automatically detects user and installation path

set -e

# Auto-detect values
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="$(dirname "$SCRIPT_DIR")"
SERVICE_USER="$(whoami)"
SERVICE_NAME="pipelinostr"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== PipeliNostr Service Creator ===${NC}"
echo ""
echo "Detected configuration:"
echo -e "  User:        ${YELLOW}${SERVICE_USER}${NC}"
echo -e "  Install dir: ${YELLOW}${INSTALL_DIR}${NC}"
echo -e "  Service:     ${YELLOW}${SERVICE_NAME}${NC}"
echo ""

# Check if running as root (bad)
if [ "$SERVICE_USER" = "root" ]; then
    echo -e "${RED}Error: Do not run this script as root.${NC}"
    echo "Run as the user that should own the PipeliNostr process."
    exit 1
fi

# Check if dist/index.js exists
if [ ! -f "$INSTALL_DIR/dist/index.js" ]; then
    echo -e "${RED}Error: dist/index.js not found.${NC}"
    echo "Run 'npm run build' first."
    exit 1
fi

# Check if service already exists
if [ -f "$SERVICE_FILE" ]; then
    echo -e "${YELLOW}Warning: Service file already exists.${NC}"
    read -p "Overwrite? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Aborted."
        exit 0
    fi
fi

# Confirm before creating
read -p "Create systemd service with these settings? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
fi

# Create service file content
SERVICE_CONTENT="[Unit]
Description=PipeliNostr - Nostr Event Router
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${INSTALL_DIR}
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target"

# Write service file (requires sudo)
echo ""
echo "Creating service file (sudo required)..."
echo "$SERVICE_CONTENT" | sudo tee "$SERVICE_FILE" > /dev/null

# Reload systemd
echo "Reloading systemd..."
sudo systemctl daemon-reload

# Enable service
echo "Enabling service..."
sudo systemctl enable "$SERVICE_NAME"

echo ""
echo -e "${GREEN}Service created successfully!${NC}"
echo ""
echo "Commands:"
echo -e "  ${YELLOW}sudo systemctl start ${SERVICE_NAME}${NC}    # Start now"
echo -e "  ${YELLOW}sudo systemctl stop ${SERVICE_NAME}${NC}     # Stop"
echo -e "  ${YELLOW}sudo systemctl restart ${SERVICE_NAME}${NC}  # Restart"
echo -e "  ${YELLOW}sudo systemctl status ${SERVICE_NAME}${NC}   # Status"
echo -e "  ${YELLOW}journalctl -u ${SERVICE_NAME} -f${NC}        # Logs"
echo ""
echo -e "The service will ${GREEN}start automatically${NC} on boot."
