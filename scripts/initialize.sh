#!/bin/bash
#
# PipeliNostr - Script d'initialisation
#
# Usage: ./scripts/initialize.sh
#
# Copie les fichiers de configuration depuis les exemples
# et crée les dossiers nécessaires.
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

echo -e "${CYAN}PipeliNostr - Initialisation${NC}"
echo ""

# =============================================================================
# Créer les dossiers
# =============================================================================

echo -e "${CYAN}[1/3] Création des dossiers...${NC}"

mkdir -p data
mkdir -p config/workflows
mkdir -p config/handlers
mkdir -p logs

echo -e "${GREEN}  ✓ data/${NC}"
echo -e "${GREEN}  ✓ config/workflows/${NC}"
echo -e "${GREEN}  ✓ config/handlers/${NC}"
echo -e "${GREEN}  ✓ logs/${NC}"

# =============================================================================
# Copier .env
# =============================================================================

echo ""
echo -e "${CYAN}[2/3] Configuration .env...${NC}"

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

# =============================================================================
# Copier config.yml
# =============================================================================

echo ""
echo -e "${CYAN}[3/3] Configuration config.yml...${NC}"

if [ -f "config/config.yml" ]; then
    echo -e "${YELLOW}  ⚠ config/config.yml existe déjà, conservation${NC}"
else
    if [ -f "config/config.yml.example" ]; then
        cp config/config.yml.example config/config.yml
        echo -e "${GREEN}  ✓ config/config.yml créé depuis config.yml.example${NC}"
    else
        echo -e "${RED}  ✗ config/config.yml.example introuvable${NC}"
    fi
fi

# =============================================================================
# Résumé
# =============================================================================

echo ""
echo -e "${GREEN}Initialisation terminée !${NC}"
echo ""
echo -e "${CYAN}Prochaines étapes :${NC}"
echo ""
echo "  1. Éditer la configuration :"
echo -e "     ${YELLOW}nano config/config.yml${NC}"
echo ""
echo "  2. Configurer les secrets dans .env :"
echo -e "     ${YELLOW}nano .env${NC}"
echo ""
echo "  3. Installer les dépendances :"
echo -e "     ${YELLOW}npm install${NC}"
echo ""
echo "  4. Compiler :"
echo -e "     ${YELLOW}npm run build${NC}"
echo ""
echo "  5. Démarrer :"
echo -e "     ${YELLOW}npm start${NC}"
echo ""
