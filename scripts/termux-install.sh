#!/data/data/com.termux/files/usr/bin/bash
#
# PipeliNostr - Script d'installation pour Termux (Android)
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/Tirodem/pipelinostr/main/scripts/termux-install.sh | bash
#
# Ou manuellement:
#   curl -O https://raw.githubusercontent.com/Tirodem/pipelinostr/main/scripts/termux-install.sh
#   chmod +x termux-install.sh
#   ./termux-install.sh
#

set -e

# =============================================================================
# Configuration
# =============================================================================

REPO_URL="https://github.com/Tirodem/pipelinostr.git"
INSTALL_DIR="$HOME/pipelinostr"
NODE_MIN_VERSION="18"
REQUIRED_SPACE_MB=500

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# =============================================================================
# Fonctions utilitaires
# =============================================================================

print_banner() {
    echo -e "${CYAN}"
    echo "╔═══════════════════════════════════════════════════════════════╗"
    echo "║                                                               ║"
    echo "║   ██████╗ ██╗██████╗ ███████╗██╗     ██╗███╗   ██╗ ██████╗   ║"
    echo "║   ██╔══██╗██║██╔══██╗██╔════╝██║     ██║████╗  ██║██╔═══██╗  ║"
    echo "║   ██████╔╝██║██████╔╝█████╗  ██║     ██║██╔██╗ ██║██║   ██║  ║"
    echo "║   ██╔═══╝ ██║██╔═══╝ ██╔══╝  ██║     ██║██║╚██╗██║██║   ██║  ║"
    echo "║   ██║     ██║██║     ███████╗███████╗██║██║ ╚████║╚██████╔╝  ║"
    echo "║   ╚═╝     ╚═╝╚═╝     ╚══════╝╚══════╝╚═╝╚═╝  ╚═══╝ ╚═════╝   ║"
    echo "║                                                               ║"
    echo "║              Installation Termux (Android)                    ║"
    echo "║                                                               ║"
    echo "╚═══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_step() {
    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}  $1${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

check_termux() {
    if [ ! -d "/data/data/com.termux" ]; then
        log_error "Ce script doit être exécuté dans Termux"
        log_info "Installez Termux depuis F-Droid: https://f-droid.org/packages/com.termux/"
        exit 1
    fi
}

check_storage_permission() {
    if [ ! -d "$HOME/storage" ]; then
        log_warn "Permission de stockage non accordée"
        log_info "Exécution de termux-setup-storage..."
        termux-setup-storage
        sleep 2
    fi
}

check_disk_space() {
    local available_mb
    available_mb=$(df -m "$HOME" | awk 'NR==2 {print $4}')

    if [ "$available_mb" -lt "$REQUIRED_SPACE_MB" ]; then
        log_error "Espace disque insuffisant: ${available_mb}MB disponible, ${REQUIRED_SPACE_MB}MB requis"
        exit 1
    fi

    log_success "Espace disque: ${available_mb}MB disponible"
}

check_internet() {
    log_info "Vérification de la connexion internet..."
    if ! ping -c 1 github.com &> /dev/null; then
        log_error "Pas de connexion internet"
        log_info "Vérifiez votre connexion WiFi/données mobiles"
        exit 1
    fi
    log_success "Connexion internet OK"
}

# =============================================================================
# Installation des dépendances
# =============================================================================

update_packages() {
    log_step "Mise à jour des packages Termux"

    log_info "Mise à jour de la liste des packages..."
    pkg update -y

    log_info "Mise à niveau des packages installés..."
    pkg upgrade -y

    log_success "Packages mis à jour"
}

install_dependencies() {
    log_step "Installation des dépendances"

    local packages="nodejs-lts git openssh"

    for pkg_name in $packages; do
        if ! command -v "${pkg_name%%-*}" &> /dev/null; then
            log_info "Installation de $pkg_name..."
            pkg install -y "$pkg_name"
        else
            log_success "$pkg_name déjà installé"
        fi
    done

    # Vérification de Node.js
    local node_version
    node_version=$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1)

    if [ -z "$node_version" ]; then
        log_error "Node.js n'a pas pu être installé"
        exit 1
    fi

    if [ "$node_version" -lt "$NODE_MIN_VERSION" ]; then
        log_error "Node.js v${node_version} trop ancien (minimum v${NODE_MIN_VERSION} requis)"
        exit 1
    fi

    log_success "Node.js v$(node -v) installé"
    log_success "npm v$(npm -v) installé"
    log_success "Git v$(git --version | cut -d' ' -f3) installé"
}

# =============================================================================
# Installation de PipeliNostr
# =============================================================================

clone_repository() {
    log_step "Clonage du repository PipeliNostr"

    if [ -d "$INSTALL_DIR" ]; then
        log_warn "Le dossier $INSTALL_DIR existe déjà"
        read -p "Voulez-vous le supprimer et réinstaller ? (o/N) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Oo]$ ]]; then
            rm -rf "$INSTALL_DIR"
        else
            log_info "Mise à jour du repository existant..."
            cd "$INSTALL_DIR"
            git pull
            return 0
        fi
    fi

    log_info "Clonage depuis $REPO_URL..."
    git clone "$REPO_URL" "$INSTALL_DIR"

    log_success "Repository cloné dans $INSTALL_DIR"
}

install_npm_packages() {
    log_step "Installation des packages npm"

    cd "$INSTALL_DIR"

    log_info "Installation des dépendances npm (peut prendre quelques minutes)..."
    npm install --no-optional 2>&1 | tail -5

    log_success "Packages npm installés"
}

build_project() {
    log_step "Compilation du projet"

    cd "$INSTALL_DIR"

    log_info "Compilation TypeScript..."
    npm run build 2>&1 | tail -5

    log_success "Projet compilé"
}

# =============================================================================
# Configuration
# =============================================================================

create_env_file() {
    log_step "Configuration de l'environnement"

    local env_file="$INSTALL_DIR/.env"

    if [ -f "$env_file" ]; then
        log_warn "Le fichier .env existe déjà, conservation"
        return 0
    fi

    if [ -f "$INSTALL_DIR/.env.example" ]; then
        cp "$INSTALL_DIR/.env.example" "$env_file"
        log_success "Fichier .env créé depuis .env.example"
    else
        cat > "$env_file" << 'ENVEOF'
# PipeliNostr Configuration
# Généré par termux-install.sh

# Clé privée Nostr (nsec ou hex)
NOSTR_PRIVATE_KEY=

# Relays Nostr (séparés par des virgules)
NOSTR_RELAYS=wss://relay.damus.io,wss://nos.lol,wss://relay.nostr.band

# Port du serveur HTTP (webhooks)
HTTP_PORT=3000

# Niveau de log (debug, info, warn, error)
LOG_LEVEL=info

# Base de données SQLite
DATABASE_PATH=./data/pipelinostr.db
ENVEOF
        log_success "Fichier .env créé avec configuration par défaut"
    fi

    log_warn "N'oubliez pas de configurer votre clé privée Nostr dans .env"
}

create_data_directory() {
    mkdir -p "$INSTALL_DIR/data"
    mkdir -p "$INSTALL_DIR/config/workflows"
    mkdir -p "$INSTALL_DIR/config/handlers"
    log_success "Dossiers data/ et config/ créés"
}

create_config_file() {
    log_step "Configuration principale"

    local config_file="$INSTALL_DIR/config/config.yml"

    if [ -f "$config_file" ]; then
        log_warn "Le fichier config/config.yml existe déjà, conservation"
        return 0
    fi

    if [ -f "$INSTALL_DIR/config/config.yml.example" ]; then
        cp "$INSTALL_DIR/config/config.yml.example" "$config_file"
        log_success "Fichier config/config.yml créé depuis config.yml.example"
    else
        log_error "Fichier config.yml.example introuvable"
        return 1
    fi

    log_warn "N'oubliez pas de configurer config/config.yml"
}

# =============================================================================
# Configuration Termux:Boot (optionnel)
# =============================================================================

setup_termux_boot() {
    log_step "Configuration du démarrage automatique (optionnel)"

    echo ""
    echo "Voulez-vous configurer le démarrage automatique avec Termux:Boot ?"
    echo "Cela permettra à PipeliNostr de démarrer automatiquement au boot du téléphone."
    echo ""
    read -p "Configurer Termux:Boot ? (o/N) " -n 1 -r
    echo

    if [[ ! $REPLY =~ ^[Oo]$ ]]; then
        log_info "Configuration Termux:Boot ignorée"
        return 0
    fi

    # Vérifier si Termux:Boot est installé
    if [ ! -d "$HOME/.termux/boot" ]; then
        mkdir -p "$HOME/.termux/boot"
    fi

    local boot_script="$HOME/.termux/boot/pipelinostr.sh"

    cat > "$boot_script" << 'BOOTEOF'
#!/data/data/com.termux/files/usr/bin/bash
#
# PipeliNostr - Script de démarrage automatique
#

# Attendre que le réseau soit disponible
sleep 10

# Activer le wake lock pour empêcher la mise en veille
termux-wake-lock

# Se placer dans le dossier PipeliNostr
cd ~/pipelinostr

# Démarrer PipeliNostr en arrière-plan
npm start >> ~/pipelinostr/logs/boot.log 2>&1 &

# Garder le script actif pour maintenir la notification Termux
sleep infinity
BOOTEOF

    chmod +x "$boot_script"

    # Créer le dossier logs
    mkdir -p "$INSTALL_DIR/logs"

    log_success "Script de démarrage créé: $boot_script"
    log_warn "Installez Termux:Boot depuis F-Droid pour activer le démarrage automatique"
    log_info "https://f-droid.org/packages/com.termux.boot/"
}

# =============================================================================
# Scripts utilitaires
# =============================================================================

create_helper_scripts() {
    log_step "Création des scripts utilitaires"

    # Script de démarrage rapide
    cat > "$INSTALL_DIR/start.sh" << 'STARTEOF'
#!/data/data/com.termux/files/usr/bin/bash
cd "$(dirname "$0")"
termux-wake-lock
echo "Démarrage de PipeliNostr..."
npm start
STARTEOF
    chmod +x "$INSTALL_DIR/start.sh"

    # Script de démarrage en arrière-plan
    cat > "$INSTALL_DIR/start-bg.sh" << 'BGEOF'
#!/data/data/com.termux/files/usr/bin/bash
cd "$(dirname "$0")"
termux-wake-lock
echo "Démarrage de PipeliNostr en arrière-plan..."
nohup npm start >> logs/pipelinostr.log 2>&1 &
echo "PID: $!"
echo "Logs: tail -f logs/pipelinostr.log"
BGEOF
    chmod +x "$INSTALL_DIR/start-bg.sh"

    # Script d'arrêt
    cat > "$INSTALL_DIR/stop.sh" << 'STOPEOF'
#!/data/data/com.termux/files/usr/bin/bash
echo "Arrêt de PipeliNostr..."
pkill -f "node dist/index.js" || echo "PipeliNostr n'était pas en cours d'exécution"
termux-wake-unlock
echo "PipeliNostr arrêté"
STOPEOF
    chmod +x "$INSTALL_DIR/stop.sh"

    # Script de statut
    cat > "$INSTALL_DIR/status.sh" << 'STATUSEOF'
#!/data/data/com.termux/files/usr/bin/bash
echo "=== PipeliNostr Status ==="
echo ""
if pgrep -f "node dist/index.js" > /dev/null; then
    echo "État: EN COURS D'EXÉCUTION"
    echo "PID: $(pgrep -f 'node dist/index.js')"
else
    echo "État: ARRÊTÉ"
fi
echo ""
echo "=== Derniers logs ==="
if [ -f ~/pipelinostr/logs/pipelinostr.log ]; then
    tail -10 ~/pipelinostr/logs/pipelinostr.log
else
    echo "(pas de logs)"
fi
STATUSEOF
    chmod +x "$INSTALL_DIR/status.sh"

    log_success "Scripts créés: start.sh, start-bg.sh, stop.sh, status.sh"
}

# =============================================================================
# Termux:Widget shortcuts (optionnel)
# =============================================================================

setup_termux_widget() {
    log_step "Configuration Termux:Widget (optionnel)"

    echo ""
    echo "Voulez-vous créer des raccourcis pour Termux:Widget ?"
    echo "Cela permettra de contrôler PipeliNostr depuis l'écran d'accueil."
    echo ""
    read -p "Créer les raccourcis Widget ? (o/N) " -n 1 -r
    echo

    if [[ ! $REPLY =~ ^[Oo]$ ]]; then
        log_info "Configuration Termux:Widget ignorée"
        return 0
    fi

    mkdir -p "$HOME/.shortcuts"

    # Raccourci Start
    cat > "$HOME/.shortcuts/PipeliNostr-Start.sh" << 'WSTARTEOF'
#!/data/data/com.termux/files/usr/bin/bash
cd ~/pipelinostr && ./start.sh
WSTARTEOF
    chmod +x "$HOME/.shortcuts/PipeliNostr-Start.sh"

    # Raccourci Stop
    cat > "$HOME/.shortcuts/PipeliNostr-Stop.sh" << 'WSTOPEOF'
#!/data/data/com.termux/files/usr/bin/bash
cd ~/pipelinostr && ./stop.sh
WSTOPEOF
    chmod +x "$HOME/.shortcuts/PipeliNostr-Stop.sh"

    # Raccourci Status
    cat > "$HOME/.shortcuts/PipeliNostr-Status.sh" << 'WSTATUSEOF'
#!/data/data/com.termux/files/usr/bin/bash
cd ~/pipelinostr && ./status.sh
read -p "Appuyez sur Entrée pour fermer..."
WSTATUSEOF
    chmod +x "$HOME/.shortcuts/PipeliNostr-Status.sh"

    log_success "Raccourcis Widget créés dans ~/.shortcuts/"
    log_warn "Installez Termux:Widget depuis F-Droid pour utiliser les raccourcis"
    log_info "https://f-droid.org/packages/com.termux.widget/"
}

# =============================================================================
# Finalisation
# =============================================================================

print_success() {
    echo ""
    echo -e "${GREEN}"
    echo "╔═══════════════════════════════════════════════════════════════╗"
    echo "║                                                               ║"
    echo "║              INSTALLATION TERMINÉE AVEC SUCCÈS !              ║"
    echo "║                                                               ║"
    echo "╚═══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
    echo ""
    echo -e "${CYAN}Prochaines étapes :${NC}"
    echo ""
    echo "  1. Configurez votre clé privée Nostr :"
    echo -e "     ${YELLOW}nano ~/pipelinostr/.env${NC}"
    echo ""
    echo "  2. Ajoutez vos workflows :"
    echo -e "     ${YELLOW}cp ~/pipelinostr/examples/workflows/*.yml ~/pipelinostr/config/workflows/${NC}"
    echo ""
    echo "  3. Démarrez PipeliNostr :"
    echo -e "     ${YELLOW}cd ~/pipelinostr && ./start.sh${NC}"
    echo ""
    echo "  Ou en arrière-plan :"
    echo -e "     ${YELLOW}cd ~/pipelinostr && ./start-bg.sh${NC}"
    echo ""
    echo -e "${CYAN}Scripts disponibles :${NC}"
    echo ""
    echo "  ./start.sh     - Démarrer (foreground)"
    echo "  ./start-bg.sh  - Démarrer (background)"
    echo "  ./stop.sh      - Arrêter"
    echo "  ./status.sh    - Vérifier le statut"
    echo ""
    echo -e "${CYAN}Documentation :${NC}"
    echo ""
    echo "  README:   ~/pipelinostr/README.md"
    echo "  Hardware: ~/pipelinostr/docs/HARDWARE.md"
    echo "  Exemples: ~/pipelinostr/examples/workflows/"
    echo ""
    echo -e "${YELLOW}Important :${NC}"
    echo ""
    echo "  - Désactivez l'optimisation de batterie pour Termux"
    echo "  - Utilisez termux-wake-lock pour éviter la mise en veille"
    echo "  - Installez Termux:Boot pour le démarrage automatique"
    echo ""
}

# =============================================================================
# Main
# =============================================================================

main() {
    print_banner

    # Vérifications préalables
    log_step "Vérifications préalables"
    check_termux
    check_storage_permission
    check_disk_space
    check_internet

    # Installation
    update_packages
    install_dependencies
    clone_repository
    install_npm_packages
    build_project

    # Configuration
    create_env_file
    create_config_file
    create_data_directory
    create_helper_scripts

    # Options
    setup_termux_boot
    setup_termux_widget

    # Fin
    print_success
}

# Exécution
main "$@"
