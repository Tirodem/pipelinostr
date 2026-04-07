#!/bin/bash
# PipeliNostr v2 — One-line installer
# curl -sL https://raw.githubusercontent.com/Tirodem/pipelinostr/v2/scripts/install.sh | bash
#
# Or with a specific branch:
# curl -sL https://raw.githubusercontent.com/Tirodem/pipelinostr/v2/scripts/install.sh | bash -s -- --branch main

set -e

REPO="https://github.com/Tirodem/pipelinostr.git"
BRANCH="v2"
INSTALL_DIR="/opt/pipelinostr"
SERVICE_USER="pipelinostr"
SERVICE_NAME="pipelinostr"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Parse args
while [[ $# -gt 0 ]]; do
    case $1 in
        --branch) BRANCH="$2"; shift 2 ;;
        *) shift ;;
    esac
done

echo -e "${CYAN}"
echo "╔══════════════════════════════════════╗"
echo "║     PipeliNostr v2 — Installer       ║"
echo "╚══════════════════════════════════════╝"
echo -e "${NC}"

# Must be root
if [ "$(id -u)" -ne 0 ]; then
    echo -e "${RED}Error: Run as root.${NC}"
    exit 1
fi

# --- Step 1: System dependencies ---
echo -e "${YELLOW}[1/8] Installing system dependencies...${NC}"
apt-get update -qq
apt-get install -y -qq git curl build-essential python3 sqlite3 > /dev/null 2>&1
echo -e "${GREEN}  Done${NC}"

# --- Step 2: Node.js ---
echo -e "${YELLOW}[2/8] Installing Node.js LTS...${NC}"
if command -v node &>/dev/null; then
    NODE_VERSION=$(node -v)
    echo -e "  Node.js ${NODE_VERSION} already installed"
else
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - > /dev/null 2>&1
    apt-get install -y -qq nodejs > /dev/null 2>&1
    echo -e "  Node.js $(node -v) installed"
fi
echo -e "${GREEN}  Done${NC}"

# --- Step 3: Create user ---
echo -e "${YELLOW}[3/8] Creating pipelinostr user...${NC}"
if id "$SERVICE_USER" &>/dev/null; then
    echo "  User already exists"
else
    useradd -r -m -d "$INSTALL_DIR" -s /bin/bash "$SERVICE_USER"
    echo "  User created"
fi
echo -e "${GREEN}  Done${NC}"

# --- Step 4: Clone repo ---
echo -e "${YELLOW}[4/8] Cloning PipeliNostr (branch: ${BRANCH})...${NC}"
if [ -d "$INSTALL_DIR/.git" ]; then
    echo "  Repo exists, pulling latest..."
    su - "$SERVICE_USER" -c "cd $INSTALL_DIR && git pull origin $BRANCH"
else
    # Clone to temp, move to install dir (user may already have home there)
    rm -rf "$INSTALL_DIR/tmp_clone"
    git clone -b "$BRANCH" "$REPO" "$INSTALL_DIR/tmp_clone"
    # Move contents (preserving .git)
    shopt -s dotglob
    mv "$INSTALL_DIR/tmp_clone"/* "$INSTALL_DIR/" 2>/dev/null || true
    mv "$INSTALL_DIR/tmp_clone"/.* "$INSTALL_DIR/" 2>/dev/null || true
    rm -rf "$INSTALL_DIR/tmp_clone"
fi
chown -R "$SERVICE_USER":"$SERVICE_USER" "$INSTALL_DIR"
echo -e "${GREEN}  Done${NC}"

# --- Step 5: Install npm dependencies ---
echo -e "${YELLOW}[5/8] Installing dependencies...${NC}"
su - "$SERVICE_USER" -c "cd $INSTALL_DIR && npm install --silent 2>/dev/null"
echo -e "${GREEN}  Done${NC}"

# --- Step 6: Build ---
echo -e "${YELLOW}[6/8] Building...${NC}"
su - "$SERVICE_USER" -c "cd $INSTALL_DIR && npm run build 2>/dev/null"
echo -e "${GREEN}  Done${NC}"

# --- Step 7: Create systemd service ---
echo -e "${YELLOW}[7/8] Creating systemd service...${NC}"

NODE_PATH="$(which node)"

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

systemctl daemon-reload
systemctl enable "$SERVICE_NAME" > /dev/null 2>&1

# --- Step 8: Sudoers for pipelinostr update command ---
echo -e "${YELLOW}[8/8] Configuring permissions...${NC}"

# Allow pipelinostr user to restart its own service
cat > /etc/sudoers.d/pipelinostr << EOF
${SERVICE_USER} ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart ${SERVICE_NAME}
${SERVICE_USER} ALL=(ALL) NOPASSWD: /usr/bin/systemctl stop ${SERVICE_NAME}
${SERVICE_USER} ALL=(ALL) NOPASSWD: /usr/bin/systemctl start ${SERVICE_NAME}
${SERVICE_USER} ALL=(ALL) NOPASSWD: /usr/bin/systemctl status ${SERVICE_NAME}
EOF
chmod 440 /etc/sudoers.d/pipelinostr

echo -e "${GREEN}  Done${NC}"

# --- Summary ---
echo ""
echo -e "${CYAN}╔══════════════════════════════════════╗"
echo -e "║     Installation complete!            ║"
echo -e "╚══════════════════════════════════════╝${NC}"
echo ""
echo -e "  Install dir: ${YELLOW}${INSTALL_DIR}${NC}"
echo -e "  User:        ${YELLOW}${SERVICE_USER}${NC}"
echo -e "  Branch:      ${YELLOW}${BRANCH}${NC}"
echo ""
echo -e "  ${YELLOW}Next steps:${NC}"
echo ""
echo -e "  1. Run the setup wizard:"
echo -e "     ${YELLOW}su - ${SERVICE_USER} -c 'cd ${INSTALL_DIR} && node dist/cli/index.js setup'${NC}"
echo ""
echo -e "  2. Start PipeliNostr:"
echo -e "     ${YELLOW}systemctl start ${SERVICE_NAME}${NC}"
echo ""
echo -e "  3. Check logs:"
echo -e "     ${YELLOW}journalctl -u ${SERVICE_NAME} -f${NC}"
echo ""
echo -e "  4. Update later:"
echo -e "     ${YELLOW}su - ${SERVICE_USER} -c 'cd ${INSTALL_DIR} && node dist/cli/index.js update'${NC}"
echo ""
