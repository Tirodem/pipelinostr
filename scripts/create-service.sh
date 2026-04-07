#!/bin/bash
# create-service.sh - Create systemd service for PipeliNostr
# Copies project to /opt/pipelinostr, creates dedicated user, installs service

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$(dirname "$SCRIPT_DIR")"
INSTALL_DIR="/opt/pipelinostr"
SERVICE_NAME="pipelinostr"
SERVICE_USER="pipelinostr"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}=== PipeliNostr Service Creator ===${NC}"
echo ""

# Must be root
if [ "$(id -u)" -ne 0 ]; then
    echo -e "${RED}Error: Run this script as root or with sudo.${NC}"
    exit 1
fi

# Check if built
if [ ! -f "$SOURCE_DIR/dist/index.js" ]; then
    echo -e "${RED}Error: dist/index.js not found. Run 'npm run build' first.${NC}"
    exit 1
fi

# Stop existing service if running
if systemctl is-active "$SERVICE_NAME" &>/dev/null; then
    echo "Stopping existing service..."
    systemctl stop "$SERVICE_NAME"
fi

# Create user
if id "$SERVICE_USER" &>/dev/null; then
    echo -e "  User ${YELLOW}${SERVICE_USER}${NC} already exists"
else
    echo -e "  Creating user ${YELLOW}${SERVICE_USER}${NC}..."
    useradd -r -m -d "$INSTALL_DIR" -s /usr/sbin/nologin "$SERVICE_USER"
fi

# Copy project to /opt/pipelinostr
echo "  Copying project to ${INSTALL_DIR}..."
mkdir -p "$INSTALL_DIR"

# Copy essential dirs/files (not .git, not node_modules — reinstall clean)
for item in dist src config workflows scripts package.json package-lock.json tsconfig.json .gitignore; do
    if [ -e "$SOURCE_DIR/$item" ]; then
        cp -r "$SOURCE_DIR/$item" "$INSTALL_DIR/"
    fi
done

# Copy .env if exists
if [ -f "$SOURCE_DIR/.env" ]; then
    cp "$SOURCE_DIR/.env" "$INSTALL_DIR/.env"
    chmod 600 "$INSTALL_DIR/.env"
fi

# Create runtime directories
mkdir -p "$INSTALL_DIR/data" "$INSTALL_DIR/logs" "$INSTALL_DIR/config/workflows" "$INSTALL_DIR/config/handlers"

# Copy config files if not already there
if [ -d "$SOURCE_DIR/config/workflows" ]; then
    cp -n "$SOURCE_DIR/config/workflows/"*.yml "$INSTALL_DIR/config/workflows/" 2>/dev/null || true
fi
if [ -d "$SOURCE_DIR/config/handlers" ]; then
    cp -n "$SOURCE_DIR/config/handlers/"*.yml "$INSTALL_DIR/config/handlers/" 2>/dev/null || true
fi
if [ -f "$SOURCE_DIR/config/config.yml" ]; then
    cp -n "$SOURCE_DIR/config/config.yml" "$INSTALL_DIR/config/config.yml" 2>/dev/null || true
fi

# Install node_modules in /opt
echo "  Installing dependencies in ${INSTALL_DIR}..."
cd "$INSTALL_DIR"
npm install --production --silent 2>/dev/null

# Set ownership
echo "  Setting ownership..."
chown -R "$SERVICE_USER":"$SERVICE_USER" "$INSTALL_DIR"

# Detect Node.js path
NODE_PATH="$(which node)"

echo ""
echo "Configuration:"
echo -e "  User:        ${YELLOW}${SERVICE_USER}${NC}"
echo -e "  Install dir: ${YELLOW}${INSTALL_DIR}${NC}"
echo -e "  Node:        ${YELLOW}${NODE_PATH}${NC}"
echo -e "  Service:     ${YELLOW}${SERVICE_NAME}${NC}"
echo ""

# Check if service already exists
if [ -f "$SERVICE_FILE" ]; then
    echo -e "${YELLOW}Updating existing service file.${NC}"
fi

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
ReadWritePaths=${INSTALL_DIR}
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
echo "Project installed at: ${INSTALL_DIR}"
echo "Source repo stays at: ${SOURCE_DIR}"
echo ""
echo "To update after git pull + build:"
echo -e "  ${YELLOW}bash ${SOURCE_DIR}/scripts/create-service.sh${NC}"
echo ""
