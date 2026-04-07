#!/bin/bash
# create-service.sh - Create systemd service for PipeliNostr
# Handles root: creates a dedicated 'pipelinostr' user if needed

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="$(dirname "$SCRIPT_DIR")"
SERVICE_NAME="pipelinostr"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}=== PipeliNostr Service Creator ===${NC}"
echo ""

# Must be root or sudo to create systemd service
if [ "$(id -u)" -ne 0 ]; then
    echo -e "${RED}Error: Run this script as root or with sudo.${NC}"
    exit 1
fi

# Check if dist/index.js exists
if [ ! -f "$INSTALL_DIR/dist/index.js" ]; then
    echo -e "${RED}Error: dist/index.js not found. Run 'npm run build' first.${NC}"
    exit 1
fi

# Create dedicated user if running as root
SERVICE_USER="pipelinostr"
if id "$SERVICE_USER" &>/dev/null; then
    echo -e "  User ${YELLOW}${SERVICE_USER}${NC} already exists"
else
    echo -e "  Creating user ${YELLOW}${SERVICE_USER}${NC}..."
    useradd -r -s /usr/sbin/nologin "$SERVICE_USER"
fi

# Set ownership
echo "  Setting ownership on ${INSTALL_DIR}..."
chown -R "$SERVICE_USER":"$SERVICE_USER" "$INSTALL_DIR"

echo ""
echo "Configuration:"
echo -e "  User:        ${YELLOW}${SERVICE_USER}${NC}"
echo -e "  Install dir: ${YELLOW}${INSTALL_DIR}${NC}"
echo -e "  Service:     ${YELLOW}${SERVICE_NAME}${NC}"
echo ""

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

# Detect Node.js path
NODE_PATH="$(which node)"

# Create service file
cat > "$SERVICE_FILE" << EOF
[Unit]
Description=PipeliNostr - Nostr Event Router
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${INSTALL_DIR}
ExecStart=${NODE_PATH} dist/index.js
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production
EnvironmentFile=${INSTALL_DIR}/.env

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=${INSTALL_DIR}/data ${INSTALL_DIR}/logs ${INSTALL_DIR}/config
ProtectHome=true

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=pipelinostr

[Install]
WantedBy=multi-user.target
EOF

echo "Created ${SERVICE_FILE}"

# Reload systemd
systemctl daemon-reload
echo "Systemd reloaded"

# Enable service
systemctl enable "$SERVICE_NAME"
echo -e "Service ${GREEN}enabled${NC} (starts on boot)"

echo ""
echo -e "${GREEN}Done!${NC}"
echo ""
echo "Commands:"
echo -e "  ${YELLOW}systemctl start ${SERVICE_NAME}${NC}     Start now"
echo -e "  ${YELLOW}systemctl stop ${SERVICE_NAME}${NC}      Stop"
echo -e "  ${YELLOW}systemctl restart ${SERVICE_NAME}${NC}   Restart"
echo -e "  ${YELLOW}systemctl status ${SERVICE_NAME}${NC}    Status"
echo -e "  ${YELLOW}journalctl -u ${SERVICE_NAME} -f${NC}    Follow logs"
echo ""
