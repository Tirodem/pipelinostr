#!/bin/bash
#
# PipeliNostr - Script d'initialisation
#
# Usage: ./scripts/initialize.sh
#
# - Installe Node.js/npm si manquant
# - Copie les fichiers de configuration depuis les exemples
# - Crée les dossiers nécessaires
# - Lance npm install et npm run build
#

set -e

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Trouver le dossier racine du projet
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo -e "${CYAN}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║           PipeliNostr - Initialisation                    ║${NC}"
echo -e "${CYAN}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""

# =============================================================================
# Détection de la plateforme
# =============================================================================

detect_platform() {
    if [ -d "/data/data/com.termux" ]; then
        echo "termux"
    elif [ -f /etc/debian_version ]; then
        echo "debian"
    elif [ -f /etc/redhat-release ]; then
        echo "redhat"
    elif [ -f /etc/alpine-release ]; then
        echo "alpine"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        echo "macos"
    else
        echo "unknown"
    fi
}

PLATFORM=$(detect_platform)
echo -e "${CYAN}Plateforme détectée : ${PLATFORM}${NC}"
echo ""

# =============================================================================
# Installation des outils système
# =============================================================================

install_system_tools() {
    echo -e "${CYAN}[1/6] Vérification des outils système...${NC}"

    case "$PLATFORM" in
        termux)
            # Toujours vérifier/installer sqlite sur Termux (pour monitoring.sh)
            if ! command -v sqlite3 &> /dev/null; then
                echo -e "${YELLOW}  ⚠ sqlite3 non trouvé, installation...${NC}"
                pkg install -y sqlite
            fi
            echo -e "${GREEN}  ✓ sqlite3 disponible${NC}"
            ;;
        *)
            # Sur les autres plateformes, sqlite3 est généralement préinstallé
            if command -v sqlite3 &> /dev/null; then
                echo -e "${GREEN}  ✓ sqlite3 disponible${NC}"
            else
                echo -e "${YELLOW}  ⚠ sqlite3 non trouvé (monitoring.sh ne fonctionnera pas)${NC}"
            fi
            ;;
    esac
}

# =============================================================================
# Installation de Node.js/npm
# =============================================================================

install_nodejs() {
    echo -e "${CYAN}[2/6] Vérification de Node.js...${NC}"

    if command -v node &> /dev/null && command -v npm &> /dev/null; then
        NODE_VERSION=$(node -v)
        NPM_VERSION=$(npm -v)
        echo -e "${GREEN}  ✓ Node.js ${NODE_VERSION} déjà installé${NC}"
        echo -e "${GREEN}  ✓ npm ${NPM_VERSION} déjà installé${NC}"
        return 0
    fi

    echo -e "${YELLOW}  ⚠ Node.js/npm non trouvé, installation...${NC}"

    case "$PLATFORM" in
        termux)
            pkg update -y
            pkg install -y nodejs-lts git
            ;;
        debian)
            # Utilise NodeSource pour avoir une version récente
            if ! command -v curl &> /dev/null; then
                sudo apt-get update
                sudo apt-get install -y curl
            fi
            curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
            sudo apt-get install -y nodejs git
            ;;
        redhat)
            curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
            sudo yum install -y nodejs git
            ;;
        alpine)
            apk add --no-cache nodejs npm git
            ;;
        macos)
            if command -v brew &> /dev/null; then
                brew install node git
            else
                echo -e "${RED}  ✗ Homebrew requis. Installez-le : https://brew.sh${NC}"
                exit 1
            fi
            ;;
        *)
            echo -e "${RED}  ✗ Plateforme non supportée pour l'installation automatique${NC}"
            echo -e "${YELLOW}  Installez Node.js 20+ manuellement : https://nodejs.org${NC}"
            exit 1
            ;;
    esac

    # Vérification
    if command -v node &> /dev/null; then
        echo -e "${GREEN}  ✓ Node.js $(node -v) installé${NC}"
        echo -e "${GREEN}  ✓ npm $(npm -v) installé${NC}"
    else
        echo -e "${RED}  ✗ Échec de l'installation de Node.js${NC}"
        exit 1
    fi
}

# =============================================================================
# Créer les dossiers
# =============================================================================

create_directories() {
    echo ""
    echo -e "${CYAN}[3/6] Création des dossiers...${NC}"

    mkdir -p data
    mkdir -p config/workflows
    mkdir -p config/handlers
    mkdir -p logs

    echo -e "${GREEN}  ✓ data/${NC}"
    echo -e "${GREEN}  ✓ config/workflows/${NC}"
    echo -e "${GREEN}  ✓ config/handlers/${NC}"
    echo -e "${GREEN}  ✓ logs/${NC}"

    # Make all scripts executable
    chmod +x scripts/*.sh 2>/dev/null || true
    echo -e "${GREEN}  ✓ scripts/*.sh rendus exécutables${NC}"
}

# =============================================================================
# Copier les fichiers de config
# =============================================================================

copy_config_files() {
    echo ""
    echo -e "${CYAN}[4/6] Configuration...${NC}"

    # .env
    if [ -f ".env" ]; then
        echo -e "${YELLOW}  ⚠ .env existe déjà, conservation${NC}"
    else
        if [ -f ".env.example" ]; then
            cp .env.example .env
            echo -e "${GREEN}  ✓ .env créé depuis .env.example${NC}"
        else
            echo -e "${RED}  ✗ .env.example introuvable${NC}"
        fi
    fi

    # config.yml
    if [ -f "config/config.yml" ]; then
        echo -e "${YELLOW}  ⚠ config/config.yml existe déjà, conservation${NC}"
    else
        if [ -f "config/config.yml.example" ]; then
            cp config/config.yml.example config/config.yml
            echo -e "${GREEN}  ✓ config/config.yml créé${NC}"
        else
            echo -e "${RED}  ✗ config/config.yml.example introuvable${NC}"
        fi
    fi
}

# =============================================================================
# npm install
# =============================================================================

run_npm_install() {
    echo ""
    echo -e "${CYAN}[5/6] Installation des dépendances npm...${NC}"

    if npm install --silent 2>&1 | tail -3; then
        echo -e "${GREEN}  ✓ Dépendances installées${NC}"
    else
        echo -e "${RED}  ✗ npm install a échoué${NC}"
        exit 1
    fi
}

# =============================================================================
# npm run build
# =============================================================================

run_npm_build() {
    echo ""
    echo -e "${CYAN}[6/6] Compilation TypeScript...${NC}"

    if npm run build 2>&1 | tail -3; then
        echo -e "${GREEN}  ✓ Projet compilé${NC}"
    else
        echo -e "${RED}  ✗ Build a échoué${NC}"
        exit 1
    fi
}

# =============================================================================
# Dépendances optionnelles : Audio/TTS
# =============================================================================

install_audio_tools() {
    echo ""
    echo -e "${CYAN}[Optionnel] Dépendances Audio/TTS${NC}"
    echo -e "  Requis pour : morse-audio, tts handlers"
    echo -e "  Packages : ffmpeg, espeak-ng"
    echo ""
    read -p "  Installer les outils Audio/TTS ? (y/N) " -n 1 -r
    echo ""

    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}  ⏭ Audio/TTS ignoré${NC}"
        return 0
    fi

    case "$PLATFORM" in
        termux)
            pkg install -y ffmpeg espeak
            ;;
        debian)
            sudo apt-get install -y ffmpeg espeak-ng
            ;;
        redhat)
            sudo yum install -y ffmpeg espeak-ng
            ;;
        alpine)
            apk add --no-cache ffmpeg espeak-ng
            ;;
        macos)
            brew install ffmpeg espeak
            ;;
        *)
            echo -e "${YELLOW}  ⚠ Installation manuelle requise${NC}"
            return 0
            ;;
    esac

    echo -e "${GREEN}  ✓ Audio/TTS installé${NC}"
}

# =============================================================================
# Dépendances optionnelles : GPIO (Raspberry Pi)
# =============================================================================

install_gpio_tools() {
    # GPIO uniquement pertinent sur Linux avec GPIO physique
    if [[ "$PLATFORM" != "debian" && "$PLATFORM" != "alpine" ]]; then
        return 0
    fi

    # Vérifier si on est sur un Raspberry Pi
    if [ ! -f /proc/device-tree/model ] || ! grep -qi "raspberry" /proc/device-tree/model 2>/dev/null; then
        return 0
    fi

    echo ""
    echo -e "${CYAN}[Optionnel] Dépendances GPIO (Raspberry Pi détecté)${NC}"
    echo -e "  Requis pour : gpio handler, i2c (LCD), servo"
    echo -e "  Packages : pigpio, i2c-tools"
    echo ""
    read -p "  Installer les outils GPIO ? (y/N) " -n 1 -r
    echo ""

    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}  ⏭ GPIO ignoré${NC}"
        return 0
    fi

    sudo apt-get install -y pigpio i2c-tools

    # Activer pigpiod au démarrage
    sudo systemctl enable pigpiod
    sudo systemctl start pigpiod

    # Activer I2C
    if command -v raspi-config &> /dev/null; then
        sudo raspi-config nonint do_i2c 0
        echo -e "${GREEN}  ✓ I2C activé${NC}"
    fi

    echo -e "${GREEN}  ✓ GPIO installé (pigpiod démarré)${NC}"
}

# =============================================================================
# Résumé
# =============================================================================

print_summary() {
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║           Initialisation terminée !                       ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${CYAN}Prochaines étapes :${NC}"
    echo ""
    echo "  1. Configurer ta clé privée Nostr :"
    echo -e "     ${YELLOW}nano .env${NC}"
    echo "     → NOSTR_PRIVATE_KEY=nsec1..."
    echo ""
    echo "  2. Ajouter ton npub à la whitelist :"
    echo -e "     ${YELLOW}nano config/config.yml${NC}"
    echo "     → whitelist.npubs: [\"npub1...\"]"
    echo ""
    echo "  3. Démarrer PipeliNostr :"
    echo -e "     ${YELLOW}npm start${NC}"
    echo ""
}

# =============================================================================
# Main
# =============================================================================

install_system_tools
install_nodejs
create_directories
copy_config_files
run_npm_install
run_npm_build

# Dépendances optionnelles (prompts interactifs)
install_audio_tools
install_gpio_tools

print_summary
