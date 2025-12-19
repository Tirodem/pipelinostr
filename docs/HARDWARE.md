# PipeliNostr - Guide Hardware

> Guide complet des plateformes matérielles compatibles avec PipeliNostr.
> Dernière mise à jour : 2025-12-19

## Table des matières

1. [Prérequis minimum](#prérequis-minimum)
2. [Comparatif des plateformes](#comparatif-des-plateformes)
3. [Orange Pi Zero 2W (Recommandé)](#orange-pi-zero-2w-recommandé)
4. [Raspberry Pi](#raspberry-pi)
5. [Smartphones Android](#smartphones-android)
6. [Tablettes Android](#tablettes-android)
7. [TV Box Android](#tv-box-android)
8. [VPS / Cloud](#vps--cloud)
9. [Périphériques GPIO](#périphériques-gpio)
10. [Architectures recommandées](#architectures-recommandées)

---

## Prérequis minimum

### Pour faire tourner PipeliNostr "confortablement"

| Ressource | Minimum | Recommandé | Optimal |
|-----------|---------|------------|---------|
| RAM | 2 Go | 4 Go | 8 Go+ |
| CPU | Quad-core 1.2GHz | Quad-core 1.5GHz+ | Octa-core |
| Stockage | 8 Go | 32 Go | 64 Go+ |
| OS | Linux / Android 10+ | Linux / Android 12+ | Linux |

### Consommation mémoire PipeliNostr

```
┌─────────────────────────────────────────┐
│ Composant              │ RAM utilisée   │
├────────────────────────┼────────────────┤
│ Node.js runtime        │ ~50 Mo         │
│ PipeliNostr core       │ ~30-50 Mo      │
│ SQLite DB              │ ~10-20 Mo      │
│ WebSocket (5 relays)   │ ~20 Mo         │
├────────────────────────┼────────────────┤
│ TOTAL (idle)           │ ~100-150 Mo    │
│ TOTAL (pic)            │ ~200 Mo        │
└─────────────────────────────────────────┘
```

---

## Comparatif des plateformes

### Par prix (neuf)

| Plateforme | RAM | Prix | GPIO | SMS | Stabilité 24/7 |
|------------|-----|------|------|-----|----------------|
| **Orange Pi Zero 2W 4GB** | 4 Go | ~24€ | ✅ | ❌ | ✅ Excellente |
| TV Box Android 4GB | 4 Go | ~40€ | ❌ | ❌ | ⚠️ Moyenne |
| Raspberry Pi 4 (4GB) | 4 Go | ~60€ | ✅ | ❌ | ✅ Excellente |
| Smartphone budget | 4 Go | ~90€ | ❌ | ✅ | ⚠️ Moyenne |
| Tablette Android | 8 Go | ~150€ | ❌ | ❌ | ⚠️ Moyenne |
| VPS basique | 1-2 Go | ~60€/an | ❌ | ❌ | ✅ Excellente |

### Par cas d'usage

| Cas d'usage | Meilleur choix | Prix |
|-------------|----------------|------|
| Budget minimal + GPIO | Orange Pi Zero 2W 4GB | ~24€ |
| Stabilité + communauté | Raspberry Pi 4 | ~60€ |
| SMS Gateway intégré | Smartphone Android | ~90€ |
| Dashboard tactile | Tablette Android | ~150€ |
| 24/7 sans maintenance | VPS | ~60€/an |
| GPIO + SMS combo | Orange Pi + Smartphone | ~120€ |

---

## Orange Pi Zero 2W (Recommandé)

### Pourquoi c'est le meilleur choix budget

Le Orange Pi Zero 2W avec 4GB de RAM offre le meilleur rapport qualité/prix pour PipeliNostr :
- **24€** pour 4 Go RAM (vs 60€ pour un RPi 4 4GB)
- GPIO 40 pins compatible Raspberry Pi
- Linux natif (pas de workarounds Android/Termux)
- Consommation ultra-faible (~3W)

### Spécifications

| Critère | Valeur |
|---------|--------|
| CPU | Allwinner H618 Quad-core Cortex-A53 @ 1.5GHz |
| GPU | Mali G31 MP2 |
| RAM | 1GB / 1.5GB / 2GB / **4GB** |
| Stockage | microSD + 16MB SPI Flash |
| WiFi | **802.11ac dual-band (2.4GHz + 5GHz)** |
| Bluetooth | **5.0 BLE** |
| USB | 1x USB 2.0 Type-C (data) + 1x USB-C (power) |
| Vidéo | Mini HDMI (4K@60fps) |
| GPIO | **40 pins (compatible RPi)** |
| Dimensions | 65 x 30 mm |
| Consommation | ~3W idle, ~5W charge |

### Connectivité réseau

```
┌─────────────────────────────────────────────────────────┐
│ ORANGE PI ZERO 2W - OPTIONS RÉSEAU                      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ ✅ WiFi intégré (recommandé)                           │
│    • 802.11 a/b/g/n/ac (WiFi 5)                        │
│    • Dual-band : 2.4 GHz + 5 GHz                       │
│    • Antenne intégrée sur PCB                          │
│    • Portée : ~15-20m intérieur                        │
│                                                         │
│ ✅ Bluetooth 5.0                                        │
│    • BLE supporté                                       │
│    • Utile pour périphériques IoT                      │
│                                                         │
│ ⚠️ Ethernet (via adaptateur)                           │
│    • USB-C vers Ethernet (~10€)                        │
│    • Expansion board officielle (~5€)                   │
│    • Recommandé pour stabilité 24/7                    │
│                                                         │
│ ⚠️ 4G/LTE (via dongle USB)                             │
│    • Huawei E3372 ou similaire (~30€)                  │
│    • Nécessite config NetworkManager                    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Où acheter

| Vendeur | Prix (4GB) | Délai | Notes |
|---------|------------|-------|-------|
| AliExpress (officiel) | ~24€ | 2-4 semaines | Moins cher |
| Amazon | ~28€ | 2-3 jours | Plus rapide |
| Kubii (FR) | ~30€ | 2-3 jours | SAV français |

### Kit de démarrage complet

| Composant | Prix | Notes |
|-----------|------|-------|
| Orange Pi Zero 2W 4GB | ~24€ | Board seule |
| Carte microSD 32GB (A1) | ~8€ | Samsung/SanDisk recommandé |
| Alimentation USB-C 5V/3A | ~10€ | Ou récup chargeur téléphone |
| Boîtier (optionnel) | ~5€ | Impression 3D ou acrylique |
| **TOTAL** | **~42-47€** | |

### Installation du système

```bash
# 1. Télécharger l'image
# Armbian (recommandé) : https://www.armbian.com/orangepi-zero-2w/
# ou Orange Pi OS : http://www.orangepi.org/html/hardWare/computerAndMicrocontrollers/service-and-support/Orange-Pi-Zero-2W.html

# 2. Flasher sur microSD
# Windows : Balena Etcher ou Raspberry Pi Imager
# Linux :
sudo dd if=Armbian_*.img of=/dev/sdX bs=4M status=progress

# 3. Premier démarrage
# - Insérer la carte SD
# - Brancher l'alimentation USB-C
# - Se connecter en SSH (trouver l'IP via routeur)
ssh root@<ip>  # Mot de passe : 1234

# 4. Configuration WiFi (si pas Ethernet)
nmtui  # Interface graphique terminal
# ou
nmcli device wifi connect "MonWiFi" password "motdepasse"
```

### Installation PipeliNostr

```bash
# 1. Mise à jour système
sudo apt update && sudo apt upgrade -y

# 2. Installer Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 3. Vérifier les versions
node -v  # v20.x.x
npm -v   # 10.x.x

# 4. Cloner PipeliNostr
git clone https://github.com/Tirodem/pipelinostr.git
cd pipelinostr

# 5. Installer et compiler
npm install
npm run build

# 6. Configurer
cp .env.example .env
nano .env  # Éditer les variables

# 7. Lancer
npm start

# 8. (Optionnel) Service systemd pour démarrage auto
sudo nano /etc/systemd/system/pipelinostr.service
```

```ini
# /etc/systemd/system/pipelinostr.service
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
# Activer le service
sudo systemctl enable pipelinostr
sudo systemctl start pipelinostr
sudo systemctl status pipelinostr
```

### GPIO sur Orange Pi Zero 2W

Le GPIO est compatible avec le pinout Raspberry Pi 40 pins.

```
                    Orange Pi Zero 2W GPIO
                    ┌───────────────────┐
            3.3V  1 │ o o │ 2   5V
   I2C SDA (GPIO3) 3 │ o o │ 4   5V
   I2C SCL (GPIO5) 5 │ o o │ 6   GND
          (GPIO7)  7 │ o o │ 8   GPIO14 (UART TX)
             GND   9 │ o o │ 10  GPIO15 (UART RX)
         (GPIO17) 11 │ o o │ 12  GPIO18 (PWM)
         (GPIO27) 13 │ o o │ 14  GND
         (GPIO22) 15 │ o o │ 16  GPIO23
            3.3V  17 │ o o │ 18  GPIO24
  SPI MOSI(GPIO10)19 │ o o │ 20  GND
  SPI MISO(GPIO9) 21 │ o o │ 22  GPIO25
  SPI SCLK(GPIO11)23 │ o o │ 24  GPIO8 (SPI CE0)
             GND  25 │ o o │ 26  GPIO7 (SPI CE1)
   I2C SDA (ID)   27 │ o o │ 28  I2C SCL (ID)
         (GPIO5)  29 │ o o │ 30  GND
         (GPIO6)  31 │ o o │ 32  GPIO12
         (GPIO13) 33 │ o o │ 34  GND
         (GPIO19) 35 │ o o │ 36  GPIO16
         (GPIO26) 37 │ o o │ 38  GPIO20
             GND  39 │ o o │ 40  GPIO21
                    └───────────────────┘
```

**Librairies GPIO pour Orange Pi :**

```bash
# WiringOP (fork de WiringPi pour Orange Pi)
git clone https://github.com/orangepi-xunlong/wiringOP.git
cd wiringOP
sudo ./build clean
sudo ./build

# ou lgpio (recommandé pour H618)
sudo apt install python3-lgpio
```

**Note :** Pour PipeliNostr, utiliser `pigpio` via le daemon `pigpiod` ou la lib `rpi-gpio` avec compatibilité OrangePi.

---

## Raspberry Pi

### Modèles compatibles

| Modèle | RAM | Prix | PipeliNostr | Notes |
|--------|-----|------|-------------|-------|
| RPi Zero 2 W | 512 Mo | ~18€ | ❌ Insuffisant | RAM trop faible |
| RPi 3B+ | 1 Go | ~40€ | ⚠️ Limite | Fonctionne mais serré |
| RPi 4 (2GB) | 2 Go | ~45€ | ⚠️ Limite | OK pour usage léger |
| **RPi 4 (4GB)** | 4 Go | ~60€ | ✅ Recommandé | Confortable |
| RPi 4 (8GB) | 8 Go | ~80€ | ✅ Overkill | Multi-usage |
| RPi 5 (4GB) | 4 Go | ~70€ | ✅ Excellent | Plus rapide |
| RPi 5 (8GB) | 8 Go | ~90€ | ✅ Excellent | Futur-proof |

### Problème GPIO sur Raspberry Pi OS Bookworm

Depuis Bookworm (2023), la librairie `onoff` ne fonctionne plus. Utiliser `pigpio` à la place.

```bash
# Installer pigpio
sudo apt install pigpio python3-pigpio

# Démarrer le daemon
sudo systemctl enable pigpiod
sudo systemctl start pigpiod
```

Dans PipeliNostr, le handler GPIO utilise déjà `pigpio` pour la compatibilité Bookworm.

---

## Smartphones Android

### Prérequis

| Critère | Minimum | Recommandé |
|---------|---------|------------|
| RAM | 3 Go | 4 Go+ |
| Android | 10 | 12+ |
| Stockage | 32 Go | 64 Go+ |

### Modèles testés/recommandés

| Modèle | RAM | Android | Prix | Verdict |
|--------|-----|---------|------|---------|
| Haehne Q88A | 1 Go | 7 | ~45€ | ❌ Insuffisant |
| Crosscall Action-X3 | 3 Go | 7.1 | ~150€ | ⚠️ Limite |
| **Crosscall Action-X5** | 4 Go | 11 | ~300€ | ✅ Bon (terrain) |
| Poco M6 Plus | 4 Go | 13 | ~90€ | ✅ Bon (budget) |
| Redmi 13C | 4 Go | 13 | ~100€ | ✅ Bon |
| **Nothing Phone 3a** | 8-12 Go | 15 | ~380€ | ✅ Excellent |

### Installation via Termux

```bash
# 1. Installer Termux depuis F-Droid (PAS Play Store)
# https://f-droid.org/packages/com.termux/

# 2. Mise à jour
pkg update && pkg upgrade

# 3. Installer Node.js
pkg install nodejs-lts git

# 4. Cloner et installer
git clone https://github.com/Tirodem/pipelinostr.git
cd pipelinostr
npm install
npm run build

# 5. Lancer avec wake lock
termux-wake-lock
npm start
```

### Démarrage automatique (Termux:Boot)

```bash
# Installer Termux:Boot depuis F-Droid
# https://f-droid.org/packages/com.termux.boot/

# Créer le script de démarrage
mkdir -p ~/.termux/boot
cat > ~/.termux/boot/pipelinostr.sh << 'EOF'
#!/data/data/com.termux/files/usr/bin/bash
termux-wake-lock
cd ~/pipelinostr
npm start &
sleep infinity
EOF
chmod +x ~/.termux/boot/pipelinostr.sh
```

### Limitations Android

| Limitation | Impact | Workaround |
|------------|--------|------------|
| Background kill | Service arrêté | Wake lock + notification |
| Pas de GPIO | Pas de hardware | Utiliser SBC pour GPIO |
| Batterie | Consomme 3-10%/h | Brancher sur secteur |
| Redémarrage | Service doit restart | Termux:Boot |

### Combo idéal : SMS Gateway + PipeliNostr

Sur le même smartphone Android :

```
┌─────────────────────────────────────────────────────────┐
│                    ANDROID                               │
│                                                          │
│  ┌─────────────────┐        ┌─────────────────────────┐ │
│  │ PipeliNostr     │◄──────►│ SMS Gateway for Android │ │
│  │ (Termux)        │ REST   │ (App capcom6)           │ │
│  │ localhost:3000  │ API    │ localhost:8080          │ │
│  └────────┬────────┘        └────────┬────────────────┘ │
│           │                          │                   │
│           ▼                          ▼                   │
│  ┌─────────────────┐        ┌─────────────────┐        │
│  │ Nostr Relays    │        │ Réseau GSM      │        │
│  │ (Internet)      │        │ (SMS)           │        │
│  └─────────────────┘        └─────────────────┘        │
└─────────────────────────────────────────────────────────┘
```

---

## Tablettes Android

### Modèles recommandés

| Modèle | RAM | Android | Écran | Prix | Verdict |
|--------|-----|---------|-------|------|---------|
| Haehne Q88A | 1 Go | 7 | 7" | ~45€ | ❌ Insuffisant |
| Blackview Tab 7 | 3 Go | 11 | 10" | ~100€ | ⚠️ Limite |
| Lenovo Tab M9 | 4 Go | 12 | 9" | ~130€ | ✅ OK |
| **DOOGEE T10** | 8 Go | 12 | 10" | ~130€ | ✅ Bon |
| **DOOGEE T30 Ultra** | 12 Go | 13 | 11" 2.5K | ~200€ | ✅ Excellent |
| Samsung Tab A9+ | 8 Go | 13 | 11" | ~230€ | ✅ Excellent |

### DOOGEE T30 Ultra - Meilleur rapport qualité/prix

| Critère | Valeur |
|---------|--------|
| CPU | Helio G99 (6nm, octa-core) |
| RAM | 12 Go (+20 Go virtuel) |
| Stockage | 256 Go + microSD 2 To |
| Écran | 11" 2.5K IPS |
| Batterie | 8580 mAh (~30-40h idle) |
| OS | Android 13 |
| Prix | ~200€ |

Idéal pour :
- Dashboard de monitoring PipeliNostr
- Écran 11" confortable pour logs/config
- Grosse batterie = autonomie en cas de coupure

---

## TV Box Android

### Avantages

- Prix bas (~35-50€)
- 4 Go RAM courant
- HDMI = dashboard sur TV
- Ethernet disponible
- Alimentation secteur (pas de batterie)

### Modèles compatibles

| Modèle | CPU | RAM | Prix | Notes |
|--------|-----|-----|------|-------|
| X96 Max+ | S905X3 | 4 Go | ~40€ | Populaire |
| H96 Max | RK3566 | 4 Go | ~45€ | Bon support |
| T95 Plus | S905X4 | 4 Go | ~50€ | Plus récent |

### Limitations

- Pas de GPIO
- Pas de batterie (coupure = arrêt)
- Background Android (mêmes problèmes que smartphone)
- Termux nécessaire

---

## VPS / Cloud

Pour une solution sans maintenance hardware.

### Providers recommandés

| Provider | RAM | Prix/mois | Notes |
|----------|-----|-----------|-------|
| Hetzner Cloud | 2 Go | ~4€ | Allemagne, bon rapport |
| Contabo | 4 Go | ~5€ | Allemagne, moins cher |
| OVH VPS | 2 Go | ~4€ | France, bon support |
| DigitalOcean | 1 Go | ~6$ | Simple, bien documenté |
| Vultr | 1 Go | ~6$ | Global, SSD rapide |

### Avantages VPS

- Stabilité 24/7 garantie
- Pas de maintenance hardware
- Accessible de partout
- Sauvegardes automatiques possibles

### Inconvénients VPS

- Pas de GPIO (pas de hardware control)
- Pas de SMS (pas de carte SIM)
- Coût récurrent
- Dépendance au provider

---

## Périphériques GPIO

### Compatibilité par plateforme

| Périphérique | Orange Pi | RPi | Android | VPS |
|--------------|-----------|-----|---------|-----|
| LED | ✅ | ✅ | ❌ | ❌ |
| Buzzer | ✅ | ✅ | ❌ | ❌ |
| Servo SG90 | ✅ | ✅ | ❌ | ❌ |
| LCD I2C 16x2 | ✅ | ✅ | ❌ | ❌ |
| OLED SSD1306 | ✅ | ✅ | ❌ | ❌ |
| Bouton poussoir | ✅ | ✅ | ❌ | ❌ |
| Relais | ✅ | ✅ | ❌ | ❌ |
| Capteur température | ✅ | ✅ | ❌ | ❌ |
| Pompe péristaltique | ✅ | ✅ | ❌ | ❌ |
| Électrovanne | ✅ | ✅ | ❌ | ❌ |

### Câblages de référence

Voir `docs/GPIO-SETUP.md` pour les schémas de câblage détaillés.

---

## Projets de distributeurs automatisés

### Distributeur de cacahuètes/bonbons (solides)

#### Principe de fonctionnement

```
┌─────────────────────────────────────────┐
│         RÉSERVOIR (cacahuètes)          │
│              ┌─────┐                    │
│              │     │                    │
│              │  ●  │ ← Cacahuètes       │
│              │     │                    │
│         ─────┴─────┴─────               │
│              ╔═════╗                    │
│              ║  ◐  ║ ← Roue servo       │
│              ╚══╤══╝                    │
│                 │                       │
│                 ▼                       │
│            [ Sortie ]                   │
└─────────────────────────────────────────┘
```

Un servo fait tourner une roue à compartiments. Chaque rotation de ~60° libère une portion.

#### Composants requis

| Composant | Prix | Notes |
|-----------|------|-------|
| Servo MG90S (métal) | ~5€ | Plus robuste que SG90 pour usage répété |
| Distributeur bonbons manuel | ~15€ | À modifier, ou impression 3D |
| Fils dupont | ~3€ | Mâle-femelle |
| **TOTAL** | **~23€** | Sans Orange Pi |

#### Câblage servo

```
ORANGE PI ZERO 2W              SERVO MG90S
     ┌─────────┐               ┌─────────┐
     │  GPIO18 │──────────────►│ Signal  │ (orange/jaune)
     │   5V    │──────────────►│ VCC     │ (rouge)
     │   GND   │──────────────►│ GND     │ (marron/noir)
     └─────────┘               └─────────┘
```

**Note :** Pour plusieurs servos ou servos puissants, utiliser une alimentation 5V externe.

#### Projets de référence

- [Raspberry Pi Candy Dispenser](https://www.hackster.io/gatoninja236/raspberry-pi-powered-candy-dispenser-fd018f)
- [Arduino Touchless Candy Dispenser](https://www.instructables.com/A-Simple-Touchless-Candy-Dispenser/)
- [Mini Touchless Dispenser](https://www.instructables.com/Mini-Touchless-Candy-Dispenser/)

---

### Distributeur de boissons (liquides)

Deux options principales : pompe péristaltique ou électrovanne.

#### Option A : Pompe péristaltique (recommandé)

```
┌─────────────────────────────────────────┐
│         BOUTEILLE                       │
│            │                            │
│            │ Tuyau silicone             │
│            ▼                            │
│     ┌──────────────┐                    │
│     │   POMPE      │ ← Péristaltique    │
│     │ PÉRISTALTIQUE│   12V DC           │
│     └──────┬───────┘                    │
│            │                            │
│            ▼                            │
│        [ Verre ]                        │
└─────────────────────────────────────────┘
```

**Avantages :**
- Le liquide ne touche que le tuyau (hygiénique)
- Dosage précis (débit constant en ml/min)
- Auto-amorçant (pas besoin de pression)
- Utilisé dans les machines à cocktails professionnelles

**Inconvénients :**
- Plus cher qu'une électrovanne
- Légèrement bruyant

#### Débits des pompes péristaltiques

| Type | Tension | Débit | Prix | Usage |
|------|---------|-------|------|-------|
| Basique | 12V | ~100 ml/min | ~10€ | Shots, petites quantités |
| Medium | 12V/24V | ~200 ml/min | ~15€ | Verres standards |
| Rapide | 24V | ~500 ml/min | ~25€ | Grands volumes |

Pour un verre de 200ml à 100ml/min = **2 minutes** (lent)
Pour un verre de 200ml à 500ml/min = **24 secondes** (acceptable)

#### Composants pompe péristaltique

| Composant | Prix | Notes |
|-----------|------|-------|
| Pompe péristaltique 12V | ~10-15€ | 100-200 ml/min |
| Module relais 5V 1 canal | ~2€ | Isolation électrique |
| Alimentation 12V 2A | ~8€ | Séparée du Orange Pi |
| Tuyau silicone food-grade 1m | ~5€ | Diamètre 6mm |
| Fils dupont + borniers | ~5€ | Connexions |
| **TOTAL** | **~30-35€** | Sans Orange Pi |

#### Option B : Électrovanne + gravité

```
┌─────────────────────────────────────────┐
│     BOUTEILLE (en hauteur)              │
│            │                            │
│            │ Tuyau                       │
│            ▼                            │
│     ┌──────────────┐                    │
│     │ ÉLECTROVANNE │ ← 12V, N/C         │
│     │   (fermée)   │                    │
│     └──────┬───────┘                    │
│            │                            │
│            ▼ Gravité                    │
│        [ Verre ]                        │
└─────────────────────────────────────────┘
```

**Avantages :** Simple, moins cher, silencieux, pas de pièces mobiles
**Inconvénients :** Dosage moins précis (dépend du niveau bouteille)

**Important :** Choisir une électrovanne **"zero pressure"** ou **"gravity feed"** car les vannes standard nécessitent une pression minimale (~3 PSI) pour s'ouvrir.

#### Composants électrovanne

| Composant | Prix | Notes |
|-----------|------|-------|
| Électrovanne 12V N/C zero-pressure | ~10-15€ | Pour système gravité |
| Module relais 5V 1 canal | ~2€ | |
| Alimentation 12V 2A | ~8€ | |
| Tuyau silicone 1m | ~5€ | |
| **TOTAL** | **~25-30€** | Sans Orange Pi |

#### Câblage pompe/électrovanne (identique)

```
ORANGE PI                       RELAIS 5V              POMPE/VANNE 12V
     ┌─────────┐               ┌─────────┐            ┌─────────┐
     │  GPIO18 │──────────────►│ IN      │            │         │
     │   3.3V  │──────────────►│ VCC     │            │         │
     │   GND   │──────────────►│ GND     │            │         │
     └─────────┘               │         │            │         │
                               │ COM ────┼──► Alim 12V+         │
                               │ NO  ────┼───────────►│ +       │
                               └─────────┘            │         │
                                                      │         │
                     Alim 12V GND ───────────────────►│ -       │
                                                      └─────────┘

⚠️ IMPORTANT : Alimentation 12V séparée pour la pompe/vanne
   Ne jamais alimenter depuis le Orange Pi !
```

#### Code exemple PipeliNostr (workflow)

```yaml
id: zap-to-drink
name: Zap to Drink Dispenser
enabled: true

trigger:
  type: nostr_event
  filters:
    kinds: [9735]  # Zap
    min_amount_sats: 100

actions:
  - id: activate_pump
    type: gpio
    config:
      pin: 18
      action: high
      duration: 5000      # 5 secondes = ~8ml à 100ml/min
      return_state: low

  - id: notify
    type: nostr_dm
    config:
      to: "{{ trigger.from }}"
      content: "🍺 Boisson servie ! Merci pour le zap de {{ trigger.amount }} sats"
```

#### Projets de référence cocktails

- [Arduino Cocktail Machine (7 pompes)](https://magazine.raspberrypi.com/articles/how-i-made-an-arduino-cocktail-machine)
- [Instructables Cocktail Machine](https://www.instructables.com/Make-Your-Own-Crude-Cocktail-Machine/)
- [Make Magazine Drinkbot](https://makezine.com/projects/build-cocktail-drinkbot/)
- [Hackaday Peristaltic Pump](https://hackaday.io/project/167967-peristaltic-pump-for-beverage-dispenser)

---

### Comparatif distributeur solide vs liquide

| Critère | Cacahuètes (servo) | Boissons (pompe) | Boissons (vanne) |
|---------|-------------------|------------------|------------------|
| Coût | ~23€ | ~35€ | ~30€ |
| Complexité | Simple | Moyenne | Simple |
| Précision | Portions fixes | Très précis (ml) | Approximatif |
| Bruit | Silencieux | Léger bruit pompe | Silencieux |
| Entretien | Faible | Nettoyer tuyaux | Faible |
| Hygiène | Bon | Excellent (tuyau) | Bon |

---

### Kits complets avec Orange Pi

#### Kit "Distributeur Cacahuètes" (~60€)

| Composant | Prix |
|-----------|------|
| Orange Pi Zero 2W 2GB | ~30€ |
| Carte microSD 32GB | ~8€ |
| Alimentation USB-C 5V/3A | ~10€ |
| Servo MG90S | ~5€ |
| Distributeur manuel à modifier | ~15€ |
| Fils dupont | ~3€ |
| **TOTAL** | **~71€** |

#### Kit "Distributeur Boissons" (~75€)

| Composant | Prix |
|-----------|------|
| Orange Pi Zero 2W 2GB | ~30€ |
| Carte microSD 32GB | ~8€ |
| Alimentation USB-C 5V/3A | ~10€ |
| Pompe péristaltique 12V | ~12€ |
| Module relais 5V | ~2€ |
| Alimentation 12V 2A | ~8€ |
| Tuyau silicone food-grade | ~5€ |
| Fils + borniers | ~5€ |
| **TOTAL** | **~80€** |

#### Kit "Machine à Cocktails 3 ingrédients" (~130€)

| Composant | Prix |
|-----------|------|
| Orange Pi Zero 2W 2GB | ~30€ |
| Carte microSD 32GB | ~8€ |
| Alimentation USB-C 5V/3A | ~10€ |
| Pompe péristaltique 12V x3 | ~36€ |
| Module relais 5V 4 canaux | ~4€ |
| Alimentation 12V 5A | ~12€ |
| Tuyau silicone 3m | ~10€ |
| Fils + borniers | ~10€ |
| Structure (bois/impression 3D) | ~20€ |
| **TOTAL** | **~140€** |

---

## Structures physiques pour distributeurs

### Distributeurs de solides (cacahuètes, bonbons)

#### Option 1 : Distributeur vintage "gumball machine" (~20-40€)

Structure classique avec globe en verre et pied en métal, style rétro.

```
     ┌─────────┐
     │  ◯◯◯◯  │ ← Globe verre
     │ ◯◯◯◯◯ │    (cacahuètes)
     └────┬────┘
        ╔═╧═╗
        ║ $ ║ ← Monnayeur (à retirer pour servo)
        ╠═══╣
        ║   ║ ← Pied métal
        ║   ║
       ═╩═══╩═
```

| Produit | Prix | Lien |
|---------|------|------|
| **ScrapCooking Vintage Candy** | ~25€ | [ScrapCooking](https://www.scrapcooking.fr/fr/7745-distributeur-de-bonbons-vintage-candy.html) |
| Great Northern 15" | ~35€ | [Amazon US](https://www.amazon.com/6260-Great-Northern-Gumball-Machine/dp/B0055OR32Y) |
| Retro Gumball 28cm | ~20£ | [GiftsTomorrow UK](https://giftstomorrow.co.uk/product/retro-coin-operated-gumball-machine-sweet-dispenser-money-bank-box/) |
| Occasion/vintage | ~10-30€ | [eBay FR](https://www.ebay.fr/b/Distributeur-bonbon/114788/bn_7005552318) |

**Caractéristiques ScrapCooking Vintage Candy :**
- Globe en verre, pied en métal laqué rouge
- Hauteur totale : 28 cm
- Monnayeur intégré (compatible pièces 2-20 centimes)
- Facile à démonter pour motorisation

**Comment motoriser :**
1. Démonter le mécanisme monnayeur
2. Fixer un servo MG90S dans l'espace libéré
3. Imprimer une roue à encoches en 3D ou modifier la roue existante
4. Connecter signal servo au GPIO du Orange Pi

#### Option 2 : Distributeur mural gravité (~15-30€)

Idéal pour une installation fixe type bar ou cuisine.

```
      ┌──────────┐
      │ ◯◯◯◯◯◯ │ ← Réservoir transparent
      │ ◯◯◯◯◯◯ │
      │ ◯◯◯◯◯◯ │
      └────┬─────┘
         ┌─┴─┐
         │ ▼ │ ← Mécanisme doseur (à motoriser)
         └───┘
```

| Produit | Prix | Lien |
|---------|------|------|
| Distributeur céréales mural 3L | ~29€ | [Walmart](https://www.walmart.com/c/kp/cereal-dispenser-wall-mount) |
| UKPOS Gravity Dispenser | ~40£ | [UKPOS](https://www.ukpos.com/gravity-food-dispenser-wall-mounted-or-countertop) |
| VKF Renzel (pro) | ~50€+ | [VKF Renzel](https://www.vkf-renzel.com/bulk-food-dispensers-gravity-bins/) |

**Comment motoriser :**
- Servo qui actionne la palette de dosage existante
- Ou électroaimant (solénoïde) pour ouvrir/fermer la trappe

#### Option 3 : DIY avec bocal + impression 3D (~10-15€)

Solution la moins chère si tu as accès à une imprimante 3D.

```
      ┌─────────┐
      │ Bocal   │ ← Bocal Le Parfait / Mason Jar
      │ verre   │    (~5€)
      └────┬────┘
      ╔════╧════╗
      ║ Méca 3D ║ ← Base imprimée 3D avec servo
      ╚════╤════╝
          ═╧═
```

| Composant | Prix | Source |
|-----------|------|--------|
| Bocal verre 1L | ~5€ | Supermarché / Amazon |
| Base imprimée 3D | ~5-10€ | Fichiers STL gratuits |
| Servo MG90S | ~2€ | AliExpress |

**Fichiers STL gratuits :**
- [Thingiverse - Candy Dispenser](https://www.thingiverse.com/search?q=candy+dispenser+servo)
- [Printables - Gumball Machine](https://www.printables.com/search/models?q=gumball%20dispenser)

---

### Structures pour distributeurs de liquides

Pour les boissons, la structure est plus simple car le liquide s'écoule par gravité.

#### Option 1 : Support bouteille inversée (~10-20€)

```
         ║ ║
      ┌──╨─╨──┐
      │BOUTEILLE│ ← Bouteille inversée
      │        │
      └───┬────┘
          │
       ┌──┴──┐
       │POMPE│ ← Pompe péristaltique
       └──┬──┘
          │
          ▼
       [VERRE]
```

| Produit | Prix | Source |
|---------|------|--------|
| Support bouteille mural | ~10€ | Amazon "bottle dispenser stand" |
| Support multi-bouteilles | ~20€ | Amazon "liquor dispenser" |

#### Option 2 : Fontaine à boisson modifiée (~20-40€)

Fontaine avec robinet à remplacer par électrovanne.

| Produit | Prix | Source |
|---------|------|--------|
| Fontaine verre 4L avec robinet | ~20€ | Amazon / Gifi |
| Fontaine verre 8L avec robinet | ~35€ | Amazon |

**Modification :** Remplacer le robinet manuel par une électrovanne 12V.

#### Option 3 : DIY étagère + bouteille (~5€)

Simple étagère avec bouteille posée, tuyau silicone vers pompe.

---

### Recommandation pour débuter

#### Distributeur cacahuètes : ScrapCooking Vintage (~25€)

Le [ScrapCooking Vintage Candy](https://www.scrapcooking.fr/fr/7745-distributeur-de-bonbons-vintage-candy.html) est idéal :
- Globe verre + pied métal solide
- Mécanisme existant facile à modifier
- Look rétro sympa
- Disponible en France, livraison rapide

#### Coût total "Distributeur cacahuètes complet"

| Composant | Prix | Source |
|-----------|------|--------|
| ScrapCooking Vintage | ~25€ | ScrapCooking.fr |
| Orange Pi Zero 2W 2GB | ~19€ | AliExpress |
| Servo MG90S | ~2€ | AliExpress |
| Carte microSD 32GB | ~8€ | Amazon |
| Alimentation USB-C | ~10€ | Amazon/récup |
| Fils dupont | ~2€ | AliExpress |
| **TOTAL** | **~66€** | |

#### Distributeur boissons : Fontaine verre + pompe (~50€)

| Composant | Prix | Source |
|-----------|------|--------|
| Fontaine verre 4L | ~20€ | Amazon/Gifi |
| Pompe péristaltique 12V | ~2€ | AliExpress |
| Module relais 5V | ~0.50€ | AliExpress |
| Alimentation 12V 2A | ~5€ | AliExpress |
| Tuyau silicone | ~3€ | AliExpress |
| **Sous-total structure** | **~30€** | |
| + Orange Pi + accessoires | ~40€ | |
| **TOTAL** | **~70€** | |

---

## Architectures recommandées

### Architecture 1 : Minimaliste (~40€)

```
┌─────────────────────────────────────────┐
│ Orange Pi Zero 2W 4GB                   │
│                                         │
│ • PipeliNostr                           │
│ • GPIO (LED, buzzer, servo)             │
│ • WiFi → Nostr relays                   │
└─────────────────────────────────────────┘
```

**Coût :** ~40€ (board + SD + alim)
**Avantages :** Très économique, GPIO, stable
**Inconvénients :** Pas de SMS

---

### Architecture 2 : SMS Gateway (~130€)

```
┌─────────────────────────────────────────┐
│ Smartphone Android 4GB (Poco M6)        │
│                                         │
│ • PipeliNostr (Termux)                  │
│ • SMS Gateway for Android               │
│ • WiFi/4G → Nostr relays                │
│ • Batterie = UPS intégré                │
└─────────────────────────────────────────┘
```

**Coût :** ~90-130€
**Avantages :** SMS bidirectionnel, batterie backup
**Inconvénients :** Pas de GPIO, stabilité Android

---

### Architecture 3 : Complète GPIO + SMS (~160€)

```
┌─────────────────────────────────────────────────────────┐
│                                                          │
│  ┌─────────────────────┐     ┌─────────────────────┐   │
│  │ Orange Pi Zero 2W   │     │ Smartphone Android  │   │
│  │ 4GB                 │◄───►│ (Crosscall X5)      │   │
│  │                     │WiFi │                     │   │
│  │ • PipeliNostr       │     │ • SMS Gateway       │   │
│  │ • GPIO hardware     │     │ • Backup 4G         │   │
│  │ • Stable 24/7       │     │ • Terrain IP68      │   │
│  └─────────────────────┘     └─────────────────────┘   │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

**Coût :** ~40€ + ~90-300€ = ~130-340€
**Avantages :** Tout en un (GPIO + SMS + stabilité)
**Inconvénients :** Deux devices à gérer

---

### Architecture 4 : Dashboard tactile (~250€)

```
┌─────────────────────────────────────────────────────────┐
│ DOOGEE T30 Ultra (Tablette 11")                         │
│                                                          │
│ • PipeliNostr (Termux)                                  │
│ • Dashboard web local                                    │
│ • Monitoring visuel                                      │
│ • 8580 mAh = ~30h autonomie                             │
│                                                          │
│  ┌─────────────────────────────────────────────────┐   │
│  │                                                  │   │
│  │   PipeliNostr Dashboard                          │   │
│  │   ════════════════════════════════════════════  │   │
│  │   Workflows: 20/28 actifs                       │   │
│  │   Queue: 3 pending, 0 failed                    │   │
│  │   Relays: 5/5 connectés                         │   │
│  │   Uptime: 3j 14h 22m                            │   │
│  │                                                  │   │
│  └─────────────────────────────────────────────────┘   │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

**Coût :** ~200€
**Avantages :** Grand écran, batterie énorme, monitoring visuel
**Inconvénients :** Pas de GPIO, pas de SMS

---

### Architecture 5 : Production (~100€/an)

```
┌─────────────────────────────────────────────────────────┐
│                       CLOUD                              │
│  ┌─────────────────────────────────────────────────┐   │
│  │ VPS (Hetzner/Contabo)                           │   │
│  │ 2-4 Go RAM, ~5€/mois                            │   │
│  │                                                  │   │
│  │ • PipeliNostr                                   │   │
│  │ • 99.9% uptime                                  │   │
│  │ • Backups automatiques                          │   │
│  │ • Accès SSH mondial                             │   │
│  └─────────────────────────────────────────────────┘   │
│                         │                                │
│                         ▼                                │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Optionnel : Raspberry Pi local                  │   │
│  │ • GPIO uniquement                               │   │
│  │ • Reçoit commandes du VPS                       │   │
│  └─────────────────────────────────────────────────┘   │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

**Coût :** ~60€/an VPS + ~60€ RPi (optionnel)
**Avantages :** Fiabilité maximale, pas de maintenance locale
**Inconvénients :** Coût récurrent, GPIO distant si besoin

---

## Résumé des recommandations

| Budget | Recommandation | Coût |
|--------|----------------|------|
| **Minimal** | Orange Pi Zero 2W 4GB | ~40€ |
| **SMS** | Poco M6 / Redmi 13C | ~90€ |
| **GPIO + stable** | RPi 4 (4GB) | ~80€ |
| **Terrain** | Crosscall Action-X5 | ~300€ |
| **Dashboard** | DOOGEE T30 Ultra | ~200€ |
| **Production** | VPS + RPi optionnel | ~60€/an |

---

## Annexes

### Liens d'achat AliExpress (Décembre 2025)

#### Orange Pi Zero 2W

| Variante | Prix | Lien |
|----------|------|------|
| **2GB RAM (recommandé)** | ~19€ | [AliExpress](https://www.aliexpress.com/item/1005006016199298.html) |
| 4GB RAM | ~24€ | [AliExpress](https://www.aliexpress.com/item/1005006020222990.html) |
| 1GB RAM | ~13€ | [AliExpress](https://www.aliexpress.com/item/1005006020125658.html) |
| Recherche générale | - | [Tous les Orange Pi Zero 2](https://www.aliexpress.com/w/wholesale-orange-pi-zero-2.html) |

#### Servos

| Produit | Prix | Lien |
|---------|------|------|
| **MG90S Metal Gear (1 pcs)** | ~1.65€ | [AliExpress](https://www.aliexpress.com/item/1000005402860.html) |
| MG90S Metal Gear (1 pcs) | ~2.36€ | [AliExpress](https://www.aliexpress.com/item/32844869330.html) |
| MG90S 10 pcs lot | ~19.79€ | [AliExpress](https://www.aliexpress.com/item/32679996711.html) |
| Recherche générale | - | [Tous les MG90S](https://www.aliexpress.com/w/wholesale-mg90s-servo-motor.html) |

#### Pompes péristaltiques

| Produit | Prix | Débit | Lien |
|---------|------|-------|------|
| **INTLLAB 12V DC (recommandé)** | ~1.80€ | ~72 ml/min | [AliExpress](https://www.aliexpress.com/item/32872201122.html) |
| Pompe 12V DC DIY | ~3.31€ | ~100 ml/min | [AliExpress](https://www.aliexpress.com/item/1005001405356078.html) |
| Pompe 12V/24V rapide | ~8.00€ | ~500 ml/min | [AliExpress](https://www.aliexpress.com/item/32817707131.html) |
| Pompe 12V Head | ~5.99€ | Variable | [AliExpress](https://www.aliexpress.com/item/4000398227103.html) |
| Recherche générale | - | - | [Toutes les pompes 12V](https://www.aliexpress.com/popular/12v-dc-peristaltic-pump.html) |

#### Modules relais

| Produit | Prix | Lien |
|---------|------|------|
| **1 canal 5V optocoupler** | ~0.34€ | [AliExpress](https://www.aliexpress.com/item/33017381912.html) |
| 1 canal 5V optocoupler | ~0.47€ | [AliExpress](https://www.aliexpress.com/item/33005089829.html) |
| 1 canal 5V LED | ~0.49€ | [AliExpress](https://www.aliexpress.com/item/32821459430.html) |
| **30A 1 canal (haute puissance)** | ~1.26€ | [AliExpress](https://www.aliexpress.com/item/32814917488.html) |
| 5 pcs lot | ~2.12€ | [AliExpress](https://www.aliexpress.com/item/32963046699.html) |

#### Accessoires

| Produit | Prix indicatif | Recherche |
|---------|----------------|-----------|
| Carte microSD 32GB (Samsung/SanDisk) | ~8€ | Amazon.fr |
| Alimentation USB-C 5V/3A | ~10€ | Amazon.fr |
| Alimentation 12V 2A | ~8€ | [AliExpress](https://www.aliexpress.com/w/wholesale-12v-2a-power-supply.html) |
| Tuyau silicone food-grade 6mm | ~5€ | [AliExpress](https://www.aliexpress.com/w/wholesale-silicone-tube-6mm-food.html) |
| Fils dupont mâle-femelle | ~3€ | [AliExpress](https://www.aliexpress.com/w/wholesale-dupont-wire.html) |

---

### Paniers d'achat prêts à commander

#### Panier "Orange Pi + Distributeur Cacahuètes" (~35€ AliExpress)

| # | Produit | Lien | Prix |
|---|---------|------|------|
| 1 | Orange Pi Zero 2W 2GB | [Lien](https://www.aliexpress.com/item/1005006016199298.html) | ~19€ |
| 2 | Servo MG90S Metal Gear | [Lien](https://www.aliexpress.com/item/1000005402860.html) | ~2€ |
| 3 | Fils dupont 40pcs | [Recherche](https://www.aliexpress.com/w/wholesale-dupont-wire.html) | ~2€ |
| | **Sous-total AliExpress** | | **~23€** |
| + | Carte microSD 32GB | Amazon | ~8€ |
| + | Alimentation USB-C (ou récup) | Amazon/récup | ~0-10€ |
| | **TOTAL** | | **~31-41€** |

#### Panier "Orange Pi + Distributeur Boissons" (~45€ AliExpress)

| # | Produit | Lien | Prix |
|---|---------|------|------|
| 1 | Orange Pi Zero 2W 2GB | [Lien](https://www.aliexpress.com/item/1005006016199298.html) | ~19€ |
| 2 | Pompe péristaltique 12V | [Lien](https://www.aliexpress.com/item/32872201122.html) | ~2€ |
| 3 | Module relais 5V 1ch | [Lien](https://www.aliexpress.com/item/33017381912.html) | ~0.50€ |
| 4 | Alimentation 12V 2A | [Recherche](https://www.aliexpress.com/w/wholesale-12v-2a-power-supply.html) | ~5€ |
| 5 | Tuyau silicone 1m | [Recherche](https://www.aliexpress.com/w/wholesale-silicone-tube-6mm-food.html) | ~3€ |
| 6 | Fils dupont 40pcs | [Recherche](https://www.aliexpress.com/w/wholesale-dupont-wire.html) | ~2€ |
| | **Sous-total AliExpress** | | **~32€** |
| + | Carte microSD 32GB | Amazon | ~8€ |
| + | Alimentation USB-C | Amazon/récup | ~0-10€ |
| | **TOTAL** | | **~40-50€** |

#### Panier "Machine à Cocktails 3 pompes" (~70€ AliExpress)

| # | Produit | Lien | Prix |
|---|---------|------|------|
| 1 | Orange Pi Zero 2W 2GB | [Lien](https://www.aliexpress.com/item/1005006016199298.html) | ~19€ |
| 2 | Pompe péristaltique 12V x3 | [Lien](https://www.aliexpress.com/item/32872201122.html) x3 | ~6€ |
| 3 | Module relais 5V 4ch | [Recherche](https://www.aliexpress.com/w/wholesale-4-channel-relay-5v.html) | ~2€ |
| 4 | Alimentation 12V 5A | [Recherche](https://www.aliexpress.com/w/wholesale-12v-5a-power-supply.html) | ~8€ |
| 5 | Tuyau silicone 3m | [Recherche](https://www.aliexpress.com/w/wholesale-silicone-tube-6mm-food.html) | ~6€ |
| 6 | Fils + borniers | [Recherche](https://www.aliexpress.com/w/wholesale-dupont-wire.html) | ~4€ |
| | **Sous-total AliExpress** | | **~45€** |
| + | Carte microSD 32GB | Amazon | ~8€ |
| + | Alimentation USB-C | Amazon/récup | ~0-10€ |
| + | Structure (bois/3D print) | Local | ~10-20€ |
| | **TOTAL** | | **~63-83€** |

---

### Liens utiles

- [Orange Pi Zero 2W - Page officielle](http://www.orangepi.org/html/hardWare/computerAndMicrocontrollers/details/Orange-Pi-Zero-2W.html)
- [Armbian pour Orange Pi](https://www.armbian.com/orangepi-zero-2w/)
- [Termux - F-Droid](https://f-droid.org/packages/com.termux/)
- [SMS Gateway for Android](https://github.com/capcom6/android-sms-gateway)

### Projets de référence

- [Raspberry Pi Candy Dispenser](https://www.hackster.io/gatoninja236/raspberry-pi-powered-candy-dispenser-fd018f)
- [Arduino Cocktail Machine](https://magazine.raspberrypi.com/articles/how-i-made-an-arduino-cocktail-machine)
- [Instructables Cocktail Machine](https://www.instructables.com/Make-Your-Own-Crude-Cocktail-Machine/)
- [Make Magazine Drinkbot](https://makezine.com/projects/build-cocktail-drinkbot/)

### Changelog

- 2025-12-19 : Création initiale avec comparatifs complets
- 2025-12-19 : Ajout section distributeurs (cacahuètes, boissons)
- 2025-12-19 : Ajout liens d'achat AliExpress et paniers prêts à commander
