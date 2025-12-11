# Self-Hosted Hardware Guide

Guide pour choisir le matériel adapté à l'hébergement local de PipeliNostr.

## Prérequis Techniques

| Ressource | Minimum | Recommandé |
|-----------|---------|------------|
| CPU | ARM Cortex-A53+ / x86-64 | ARMv8 quad-core / x86 N100 |
| RAM | 512 MB | 1-2 GB |
| Stockage | 2 GB | 8-16 GB |
| Node.js | v20+ | v22 LTS |
| Réseau | WiFi ou Ethernet | Ethernet |
| OS | Linux (Debian/Ubuntu) | Raspberry Pi OS / Debian 12 |

## Options Matérielles

### Tier Budget (20-40€)

| Appareil | RAM | Prix | Conso | Avantages | Inconvénients |
|----------|-----|------|-------|-----------|---------------|
| **Raspberry Pi Zero 2 W** | 512 MB | ~20€ | 1W | Ultra compact, WiFi | RAM limite, pas Ethernet |
| **Orange Pi Zero 3** | 1 GB | ~25€ | 2W | Bon rapport qualité/prix | Écosystème moins mature |
| **Libre Computer Le Potato** | 2 GB | ~35€ | 3W | Compatible RPi | Moins de support |

### Tier Recommandé (50-80€)

| Appareil | RAM | Prix | Conso | Avantages | Inconvénients |
|----------|-----|------|-------|-----------|---------------|
| **Raspberry Pi 4 Model B 2GB** | 2 GB | ~50€ | 3-6W | Meilleur écosystème, GPIO | Stock parfois limité |
| **Raspberry Pi 5 2GB** | 2 GB | ~60€ | 4-8W | Plus rapide, PCIe | Plus cher, chauffe |
| **Orange Pi 5** | 4 GB | ~70€ | 5W | Excellent perf, RK3588S | Support variable |

### Tier Mini PC (100-150€)

| Appareil | RAM | Prix | Conso | Avantages | Inconvénients |
|----------|-----|------|-------|-----------|---------------|
| **Mini PC Intel N100** | 8 GB | ~120€ | 10-15W | x86, SSD inclus | Pas de GPIO |
| **HP T620 (occasion)** | 4-8 GB | ~30€ | 10W | Très économique | Occasion |
| **Beelink Mini S12** | 8 GB | ~130€ | 15W | Compact, silencieux | Prix |

### Matériel Recyclé

| Appareil | Notes |
|----------|-------|
| Vieux smartphone Android | Termux + Node.js, batterie intégrée |
| Ancien laptop | Surdimensionné mais disponible |
| NAS Synology/QNAP | Docker, toujours allumé |

## Coût Électrique Annuel

Base : 0.20€/kWh, fonctionnement 24/7

| Appareil | Conso moyenne | Coût annuel |
|----------|---------------|-------------|
| RPi Zero 2 W | 1W | **1.75€** |
| RPi 4 2GB | 4W | **7.00€** |
| RPi 5 2GB | 5W | **8.76€** |
| Orange Pi 5 | 5W | **8.76€** |
| Mini PC N100 | 12W | **21.02€** |
| HP T620 | 10W | **17.52€** |

## Comparaison VPS vs Self-Hosted

| Critère | VPS (5€/mois) | RPi 4 (50€) | Mini PC (120€) |
|---------|---------------|-------------|----------------|
| **Coût 1ère année** | 60€ | ~60€ | ~140€ |
| **Coût année 2+** | 60€/an | ~7€/an | ~21€/an |
| **Disponibilité** | 99.9% | Dépend réseau | Dépend réseau |
| **IP fixe** | Inclus | DDNS requis | DDNS requis |
| **Maintenance** | Hébergeur | Vous | Vous |
| **GPIO/Hardware** | Non | Oui | Non |
| **Latence locale** | Variable | <1ms | <1ms |

## Recommandations par Usage

### Usage Nostr uniquement (pas de hardware IoT)

**Recommandé : VPS 5€/mois**
- Plus simple à maintenir
- IP fixe incluse
- Disponibilité garantie
- Pas de gestion matérielle

### Usage avec hardware IoT (GPIO, I2C, MQTT local)

**Recommandé : Raspberry Pi 4 2GB**

Kit complet (~70€) :
- Raspberry Pi 4 2GB : 50€
- Carte microSD 32GB : 10€
- Alimentation officielle : 10€

Avantages :
- GPIO 40 pins pour capteurs/actionneurs
- I2C, SPI, UART intégrés
- Écosystème mature
- Documentation abondante

### Usage mixte (plusieurs services)

**Recommandé : Mini PC Intel N100**

Avantages :
- 8GB RAM pour Docker/Proxmox
- SSD NVMe inclus
- Compatible tous logiciels x86
- Peut héberger d'autres services

### Budget ultra-serré

**Option 1 : Raspberry Pi Zero 2 W (~25€ total)**
- Fonctionnel mais mémoire limite
- WiFi intégré
- Ultra basse consommation

**Option 2 : HP T620 occasion (~30-40€)**
- x86 fiable et testé
- 4-8GB RAM possible
- SSD SATA supporté

## Installation sur Raspberry Pi

### 1. Préparer la carte SD

```bash
# Télécharger Raspberry Pi Imager
# Choisir "Raspberry Pi OS Lite (64-bit)"
# Configurer SSH, WiFi, hostname dans les options avancées
```

### 2. Premier démarrage

```bash
# Connexion SSH
ssh pi@pipelinostr.local

# Mise à jour
sudo apt update && sudo apt upgrade -y

# Installation Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Vérification
node --version  # v22.x.x
npm --version   # 10.x.x
```

### 3. Installation PipeliNostr

```bash
# Clone
git clone https://github.com/Tirodem/pipelinostr.git
cd pipelinostr

# Installation
npm install
npm run build

# Configuration
cp .env.example .env
nano .env  # Ajouter NOSTR_PRIVATE_KEY

# Test
npm start
```

### 4. Service systemd (démarrage auto)

```bash
sudo nano /etc/systemd/system/pipelinostr.service
```

```ini
[Unit]
Description=PipeliNostr
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/pipelinostr
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable pipelinostr
sudo systemctl start pipelinostr
sudo systemctl status pipelinostr
```

## Accès Distant

### Option 1 : Port forwarding (simple)

Configurer votre box/routeur pour rediriger le port 3000 vers le Raspberry Pi.

### Option 2 : DDNS (IP dynamique)

Services gratuits :
- DuckDNS (duckdns.org)
- No-IP (noip.com)
- FreeDNS (freedns.afraid.org)

### Option 3 : Tailscale (recommandé)

```bash
# Installation
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up

# Votre appareil reçoit une IP 100.x.x.x
# Accessible depuis n'importe où via Tailscale
```

### Option 4 : Cloudflare Tunnel

```bash
# Installation cloudflared
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 -o cloudflared
chmod +x cloudflared
sudo mv cloudflared /usr/local/bin/

# Configuration tunnel
cloudflared tunnel login
cloudflared tunnel create pipelinostr
cloudflared tunnel route dns pipelinostr pipelinostr.votredomaine.com
```

## Monitoring

### Température CPU (RPi)

```bash
# Température actuelle
vcgencmd measure_temp

# Monitoring continu
watch -n 2 vcgencmd measure_temp
```

### Ressources système

```bash
# RAM et CPU
htop

# Espace disque
df -h

# Logs PipeliNostr
journalctl -u pipelinostr -f
```

## Tableau de Décision

| Situation | Recommandation |
|-----------|----------------|
| Débutant, veut tester | VPS 5€/mois |
| Production, pas de hardware | VPS |
| Projet IoT, GPIO requis | Raspberry Pi 4 |
| Budget minimal | RPi Zero 2 W ou T620 occasion |
| Multi-services, Docker | Mini PC N100 |
| Déjà un NAS | Docker sur NAS |
| Mobilité requise | Vieux smartphone + Termux |

## Ressources

- [Raspberry Pi Documentation](https://www.raspberrypi.com/documentation/)
- [Node.js on Raspberry Pi](https://nodejs.org/en/download/package-manager)
- [Tailscale](https://tailscale.com/)
- [Cloudflare Tunnels](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/)
