#!/bin/bash
# PipeliNostr v2 — One-line installer
# curl -sL https://raw.githubusercontent.com/Tirodem/the-ultra-secret-wip-side-project-we-dont-want-to-talk-about/v2/scripts/install.sh | sudo bash
#
# Or with a specific branch:
# curl -sL https://raw.githubusercontent.com/Tirodem/the-ultra-secret-wip-side-project-we-dont-want-to-talk-about/v2/scripts/install.sh | sudo bash -s -- --branch main
#
# Note: `sudo` must apply to `bash`, not to `curl`. Piping `sudo curl ... | bash`
# will NOT work — sudo only affects curl, bash still runs as the calling user
# and the script will exit with "Error: Run as root."

set -e

REPO="https://github.com/Tirodem/the-ultra-secret-wip-side-project-we-dont-want-to-talk-about.git"
BRANCH="v2"
INSTALL_DIR="/opt/pipelinostr"

# Parse args
while [[ $# -gt 0 ]]; do
    case $1 in
        --branch) BRANCH="$2"; shift 2 ;;
        *) shift ;;
    esac
done

# Must be root
if [ "$(id -u)" -ne 0 ]; then
    echo "Error: Run as root."
    exit 1
fi

# Bootstrap: clone repo so the wizard is available
if [ ! -d "$INSTALL_DIR/.git" ]; then
    echo "Downloading PipeliNostr..."
    apt-get update -qq && apt-get install -y -qq git >/dev/null 2>&1
    mkdir -p "$INSTALL_DIR"
    git clone -b "$BRANCH" "$REPO" "$INSTALL_DIR"
fi

# Launch the wizard
exec bash "$INSTALL_DIR/scripts/setup-wizard.sh"
