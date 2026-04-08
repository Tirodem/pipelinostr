# Configuration GPIO sur Raspberry Pi

Guide complet pour configurer les GPIO sur Raspberry Pi avec PipeliNostr.

## 1. Identification du Modèle Raspberry Pi

### Commandes pour identifier votre Raspberry Pi

```bash
# Modèle et révision
cat /proc/device-tree/model
# Exemple: "Raspberry Pi 4 Model B Rev 1.4"

# Informations CPU
cat /proc/cpuinfo | grep -E "(Hardware|Revision|Model)"

# Version du firmware
vcgencmd version

# Température actuelle (vérifie que vcgencmd fonctionne)
vcgencmd measure_temp
```

### Tableau des modèles courants

| Modèle | RAM | GPIO Pins | Notes |
|--------|-----|-----------|-------|
| RPi Zero 2 W | 512 MB | 40 | Compact, WiFi intégré |
| RPi 3 Model B+ | 1 GB | 40 | Bon rapport qualité/prix |
| RPi 4 Model B | 2-8 GB | 40 | **Recommandé** |
| RPi 5 | 4-8 GB | 40 | Nouveau, plus rapide |

## 2. Identification des PINs GPIO

### Numérotation des PINs

**IMPORTANT**: Il existe 3 systèmes de numérotation différents :

| Système | Description | Exemple LED |
|---------|-------------|-------------|
| **Numéro physique (Board)** | Position sur le connecteur 40 pins | Pin 11, Pin 13 |
| **Numéro GPIO (BCM)** | Numéro logique Broadcom | GPIO17, GPIO27 |
| **WiringPi** | Ancien système (obsolète) | Éviter |

**PipeliNostr utilise la numérotation GPIO (BCM)** via la librairie `onoff`.

### Commandes pour explorer les GPIO

```bash
# Voir tous les GPIO et leur état actuel
raspi-gpio get

# Voir l'état d'un GPIO spécifique
raspi-gpio get 17

# Pinout interactif (très utile!)
pinout
# ou
gpio readall  # Si wiringpi installé
```

### Pinout Raspberry Pi 40 pins

```
                    3V3  (1)  (2)  5V
         I2C SDA GPIO2  (3)  (4)  5V
         I2C SCL GPIO3  (5)  (6)  GND
                GPIO4  (7)  (8)  GPIO14 UART TX
                  GND  (9)  (10) GPIO15 UART RX
               GPIO17 (11)  (12) GPIO18 PWM0
               GPIO27 (13)  (14) GND
               GPIO22 (15)  (16) GPIO23
                  3V3 (17)  (18) GPIO24
      SPI MOSI GPIO10 (19)  (20) GND
       SPI MISO GPIO9 (21)  (22) GPIO25
       SPI SCLK GPIO11 (23)  (24) GPIO8  SPI CE0
                  GND (25)  (26) GPIO7  SPI CE1
         EEPROM ID_SD (27)  (28) ID_SC EEPROM
                GPIO5 (29)  (30) GND
                GPIO6 (31)  (32) GPIO12 PWM0
          PWM1 GPIO13 (33)  (34) GND
          PWM1 GPIO19 (35)  (36) GPIO16
               GPIO26 (37)  (38) GPIO20
                  GND (39)  (40) GPIO21
```

### Correspondance Pin Physique ↔ GPIO BCM

| Pin Physique | GPIO BCM | Fonction spéciale |
|--------------|----------|-------------------|
| 3 | GPIO2 | I2C SDA |
| 5 | GPIO3 | I2C SCL |
| 7 | GPIO4 | 1-Wire |
| 11 | GPIO17 | - |
| 12 | GPIO18 | PWM0 |
| 13 | GPIO27 | - |
| 15 | GPIO22 | - |
| 16 | GPIO23 | - |
| 18 | GPIO24 | - |
| 19 | GPIO10 | SPI MOSI |
| 21 | GPIO9 | SPI MISO |
| 22 | GPIO25 | - |
| 23 | GPIO11 | SPI SCLK |
| 24 | GPIO8 | SPI CE0 |
| 26 | GPIO7 | SPI CE1 |
| 29 | GPIO5 | - |
| 31 | GPIO6 | - |
| 32 | GPIO12 | PWM0 |
| 33 | GPIO13 | PWM1 |
| 35 | GPIO19 | PWM1 |
| 36 | GPIO16 | - |
| 37 | GPIO26 | - |
| 38 | GPIO20 | - |
| 40 | GPIO21 | - |

### GPIOs recommandés pour LED/relais (sans fonction spéciale)

Les GPIO suivants sont "libres" et peuvent être utilisés sans conflit :
- **GPIO17** (pin 11) - Utilisé dans l'exemple LED verte
- **GPIO27** (pin 13) - Utilisé dans l'exemple LED rouge
- **GPIO22** (pin 15)
- **GPIO23** (pin 16)
- **GPIO24** (pin 18)
- **GPIO25** (pin 22)
- **GPIO5** (pin 29)
- **GPIO6** (pin 31)
- **GPIO26** (pin 37)

## 3. Configuration des Permissions GPIO

### Ajouter l'utilisateur au groupe gpio

```bash
# Vérifier les groupes actuels
groups

# Ajouter au groupe gpio
sudo usermod -aG gpio $USER

# IMPORTANT: Déconnexion/reconnexion requise pour appliquer
logout
# ou
sudo reboot

# Vérifier après reconnexion
groups  # Doit inclure 'gpio'
```

### Vérifier l'accès GPIO

```bash
# Test rapide avec raspi-gpio
raspi-gpio set 17 op dh  # GPIO17 en sortie, HIGH
raspi-gpio set 17 op dl  # GPIO17 en sortie, LOW

# Vérifier /sys/class/gpio
ls -la /sys/class/gpio/
```

## 4. Installation du Module onoff

PipeliNostr utilise la librairie Node.js `onoff` pour contrôler les GPIO.

```bash
cd ~/pipelinostr

# Installer onoff
npm install onoff

# Vérifier l'installation
npm ls onoff
```

### Test rapide en Node.js

```javascript
// test-gpio.js
const Gpio = require('onoff').Gpio;

// Vérifier si GPIO accessible
if (Gpio.accessible) {
    console.log('GPIO accessible!');

    // Test LED sur GPIO17
    const led = new Gpio(17, 'out');
    led.writeSync(1);  // Allumer
    setTimeout(() => {
        led.writeSync(0);  // Éteindre
        led.unexport();
        console.log('Test terminé');
    }, 1000);
} else {
    console.log('GPIO non accessible (mode simulation)');
}
```

```bash
node test-gpio.js
```

## 5. Configuration PipeliNostr pour GPIO

### Fichier config/handlers/gpio.yml

```yaml
gpio:
  enabled: true
  default_direction: "out"

  # Mapping optionnel des noms vers GPIO
  pins:
    led_verte: 17
    led_rouge: 27
    relay_1: 22
    buzzer: 23
```

### Workflow exemple : config/workflows/nostr-to-gpio.yml

```yaml
id: nostr-to-gpio
name: GPIO LED Control
enabled: true

trigger:
  type: nostr_event
  filters:
    kinds: [4]
    from_whitelist: true
    content_pattern: "^gpio:(?<color>green|red)$"

actions:
  # LED Verte - Allumée pendant 10 secondes
  - id: green_led
    type: gpio
    when: "match.color == 'green'"
    config:
      pin: 17
      action: pulse
      duration: 10000

  # LED Rouge - Clignotement 2Hz pendant 10 secondes
  - id: red_led
    type: gpio
    when: "match.color == 'red'"
    config:
      pin: 27
      action: blink
      frequency: 2
      duration: 10000
```

## 6. Actions GPIO Disponibles

| Action | Description | Paramètres |
|--------|-------------|------------|
| `set` | Met le pin à HIGH (1) | `pin` |
| `clear` | Met le pin à LOW (0) | `pin` |
| `toggle` | Inverse l'état actuel | `pin` |
| `pulse` | HIGH pendant X ms puis LOW | `pin`, `duration` |
| `read` | Lit l'état du pin | `pin` |
| `blink` | Clignotement à fréquence donnée | `pin`, `frequency`, `duration` |
| `pwm` | PWM logiciel (peu précis) | `pin`, `duty_cycle`, `pwm_frequency` |

## 7. Câblage LED

### Schéma de base

```
GPIO (ex: 17) ─────┬────── LED (+) anode (patte longue)
                   │
                [220Ω]
                   │
GND ───────────────┴────── LED (-) cathode (patte courte)
```

### Calcul de la résistance

Pour une LED standard (rouge/verte) :
- Tension LED (Vf) : ~2V
- Courant LED (If) : ~20mA
- Tension GPIO : 3.3V

```
R = (Vgpio - Vled) / I = (3.3V - 2V) / 0.02A = 65Ω minimum
```

**Recommandé : 220Ω à 330Ω** (plus sûr, LED légèrement moins brillante)

## 8. Dépannage

### "Permission denied" sur GPIO

```bash
# Vérifier le groupe
groups | grep gpio

# Si absent, ajouter et redémarrer
sudo usermod -aG gpio $USER
sudo reboot
```

### "GPIO non accessible"

```bash
# Vérifier que /sys/class/gpio existe
ls /sys/class/gpio/

# Sur Raspberry Pi OS récent, vérifier config.txt
sudo cat /boot/config.txt | grep gpio

# Activer GPIO si désactivé
# (normalement activé par défaut)
```

### LED ne s'allume pas

1. **Vérifier la polarité** : Anode (+) vers GPIO, Cathode (-) vers GND
2. **Vérifier le pin** : GPIO17 = pin physique 11 (pas le même numéro!)
3. **Tester manuellement** :
   ```bash
   raspi-gpio set 17 op dh  # Doit allumer
   raspi-gpio set 17 op dl  # Doit éteindre
   ```
4. **Vérifier la résistance** : Pas de court-circuit, pas trop haute valeur

### Handler GPIO non chargé

```bash
# Vérifier que gpio.yml existe et enabled: true
cat config/handlers/gpio.yml

# Vérifier les logs au démarrage
npm start 2>&1 | grep -i gpio
```

## 9. Ressources

- [Raspberry Pi GPIO Pinout (pinout.xyz)](https://pinout.xyz/)
- [Documentation onoff](https://github.com/fivdi/onoff)
- [Raspberry Pi Documentation GPIO](https://www.raspberrypi.com/documentation/computers/raspberry-pi.html#gpio-and-the-40-pin-header)
- [raspi-gpio documentation](https://www.raspberrypi.com/documentation/computers/raspberry-pi.html#raspi-gpio)

## 10. Checklist Installation Complète

- [ ] Identifier le modèle RPi : `cat /proc/device-tree/model`
- [ ] Mettre à jour le système : `sudo apt update && sudo apt upgrade -y`
- [ ] Installer Node.js 22 : `curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -`
- [ ] Ajouter au groupe gpio : `sudo usermod -aG gpio $USER`
- [ ] Redémarrer : `sudo reboot`
- [ ] Vérifier gpio dans groups : `groups`
- [ ] Cloner PipeliNostr : `git clone https://github.com/Tirodem/pipelinostr.git`
- [ ] Installer dépendances : `npm install`
- [ ] Installer onoff : `npm install onoff`
- [ ] Build : `npm run build`
- [ ] Créer config/handlers/gpio.yml avec `enabled: true`
- [ ] Créer/copier le workflow GPIO
- [ ] Configurer .env avec NOSTR_PRIVATE_KEY
- [ ] Tester : `npm start`
- [ ] Envoyer DM test : `gpio:green`
