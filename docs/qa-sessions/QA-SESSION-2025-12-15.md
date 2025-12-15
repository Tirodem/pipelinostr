# QA Session - 2025-12-15

## Résumé

Session focalisée sur le support GPIO avancé (servo SG90) et la création d'un workflow de distributeur automatique activé par zaps Lightning.

## Travail Effectué

### 1. Documentation GPIO Raspberry Pi

Création d'un guide complet `docs/GPIO-RASPBERRY-PI-SETUP.md` couvrant :
- Identification du modèle Raspberry Pi (`cat /proc/device-tree/model`)
- Systèmes de numérotation des pins (Physique vs BCM vs WiringPi)
- Pinout complet 40 pins avec correspondances
- Configuration des permissions (`usermod -aG gpio`)
- Installation et test du module `onoff`
- Câblage LED avec calcul de résistance
- Dépannage courant

### 2. Correction Regex PCRE dans Workflow Matcher

**Problème initial :**
Les workflows disabled généraient des erreurs de regex invalide :
```
ERROR: Invalid regex pattern
pattern: "(?i)^(hello|hi|hey|bonjour|salut)\b"
error: "Invalid regular expression: /(?i)^(hello|hi|hey|bonjour|salut)\\b/s: Invalid group"
```

**Cause :**
JavaScript ne supporte pas les flags inline PCRE comme `(?i)`. Cette syntaxe est valide en Python/PCRE mais pas en JS.

**Solution :**
1. Ajout de `convertPcreFlags()` dans `workflow-matcher.ts` qui :
   - Détecte les flags inline `(?i)`, `(?s)`, `(?m)` au début du pattern
   - Les convertit en flags JavaScript du RegExp
   - Exemple : `(?i)^hello` → `new RegExp("^hello", "si")`

2. Skip du matching regex pour les workflows disabled (optimisation) :
   - Les workflows `enabled: false` passent le matching basique (kind, whitelist)
   - Mais skipent la validation regex coûteuse
   - Évite les erreurs sur des workflows inactifs

**Fichiers modifiés :**
- `src/core/workflow-matcher.ts` - convertPcreFlags(), skipExpensiveChecks

**Commit :**
- `0cf88dc` - fix: support PCRE inline flags (?i) in regex patterns, skip regex for disabled workflows

### 3. Action Servo pour GPIO Handler

**Ajout de l'action `servo`** pour contrôler les servomoteurs SG90/MG90 :

```yaml
- type: gpio
  config:
    pin: 18
    action: servo
    angle: 180        # 0-180 degrés
    duration: 1000    # Temps en position (ms)
    return_angle: 0   # Position de retour
```

**Implémentation technique :**
- PWM software à 50Hz (période 20ms)
- Conversion angle → duty cycle :
  - 0° = 0.5ms pulse = 2.5% duty
  - 90° = 1.5ms pulse = 7.5% duty
  - 180° = 2.5ms pulse = 12.5% duty
- Formule : `duty = (angle / 180) * 10 + 2.5`

**Fichiers modifiés :**
- `src/outbound/gpio.handler.ts` - servoMove(), GpioActionConfig
- `config/handlers/gpio.yml.example` - Documentation servo

### 4. Workflow Zap-to-Dispenser

Création de `examples/workflows/zap-to-dispenser.yml` :

**Fonctionnalités :**
1. **Trigger** : Zap receipt (kind 9735) avec seuil minimum configurable
2. **Action 1** : Servo GPIO pour distribuer (angle 180° → retour 0°)
3. **Action 2** : Log FTP avec timestamp, montant, expéditeur
4. **Action 3** : DM de confirmation au zappeur

**Configuration :**
```yaml
trigger:
  type: nostr_event
  filters:
    kinds: [9735]
    zap_min_amount: 21  # Seuil en sats

actions:
  - id: dispense
    type: gpio
    config:
      pin: 18
      action: servo
      angle: 180
      duration: 1000
      return_angle: 0
```

**Commit :**
- `33c3f41` - feat: add servo action for SG90 motors, zap-to-dispenser workflow

### 5. Problème GPIO sur Raspberry Pi OS Bookworm

**Problème découvert :**
L'interface sysfs GPIO utilisée par `onoff` ne fonctionne plus correctement sur Bookworm :
```
Error: EINVAL: invalid argument, write
    at Object.writeFileSync (node:fs:2368:20)
    at exportGpio
```

**Diagnostic :**
```bash
$ cat /etc/os-release | grep VERSION
VERSION="12 (bookworm)"

$ ls -la /sys/class/gpio/
gpiochip512 -> ../../devices/platform/soc/fe200000.gpio/gpio/gpiochip512
```

**Cause :**
Raspberry Pi OS Bookworm utilise la nouvelle interface `libgpiod` avec un offset de chip (gpiochip512). L'ancienne interface sysfs est dépréciée.

**Solution recommandée : pigpio**
```bash
sudo apt install pigpio -y
sudo pigpiod
pigs s 18 1500   # Servo à 90°
```

Avantages de pigpio :
- Hardware-timed PWM (plus précis pour servos)
- Compatible Bookworm
- Daemon avec interface socket

**Valeurs pigpio pour servo SG90 :**
| Angle | Pulse (µs) | Commande |
|-------|------------|----------|
| 0° | 500 | `pigs s 18 500` |
| 90° | 1500 | `pigs s 18 1500` |
| 180° | 2500 | `pigs s 18 2500` |
| Off | 0 | `pigs s 18 0` |

**Status :** En cours de test par l'utilisateur

## Câblage Servo SG90

```
RASPBERRY PI                    SERVO SG90
Pin 2  [5V]     ●──────────────● Rouge (VCC)
Pin 6  [GND]    ●──────────────● Marron (GND)
Pin 12 [GPIO18] ●──────────────● Orange (Signal)
```

**Note :** Pas de résistance nécessaire sur le signal servo (contrairement aux LEDs).

## Tests Effectués

### Build Verification
- `npm run build` : OK après chaque modification

### Regex PCRE Conversion
- Pattern `(?i)^hello` correctement converti en `/^hello/si`
- Workflows disabled ne génèrent plus d'erreurs regex

### GPIO sur Bookworm
- Interface sysfs : FAIL (EINVAL)
- pigpio : En cours de test

## Commits du Jour

| Hash | Message |
|------|---------|
| `0cf88dc` | fix: support PCRE inline flags (?i) in regex patterns, skip regex for disabled workflows |
| `33c3f41` | feat: add servo action for SG90 motors, zap-to-dispenser workflow |

## Fichiers Créés/Modifiés

```
docs/GPIO-RASPBERRY-PI-SETUP.md          # Nouveau - Guide complet GPIO
docs/qa-sessions/QA-SESSION-2025-12-15.md # Nouveau - Cette session
examples/workflows/zap-to-dispenser.yml   # Nouveau - Workflow distributeur
src/core/workflow-matcher.ts              # PCRE flags, skip disabled
src/outbound/gpio.handler.ts              # Action servo
config/handlers/gpio.yml.example          # Documentation servo
```

## Problèmes Ouverts

### GPIO Handler et Bookworm

Le handler GPIO actuel utilise `onoff` (sysfs) qui ne fonctionne pas sur Bookworm.

**Options à explorer :**
1. **Utiliser pigpio** - Remplacer onoff par pigpio-client dans le handler
2. **Activer legacy sysfs** - `dtoverlay=gpio-sysfs` dans config.txt
3. **Utiliser rpi-gpio** - Alternative Node.js compatible Bookworm

**Recommandation :** Migrer vers pigpio pour le support servo (hardware PWM).

## Améliorations Futures Identifiées

1. **Migrer GPIO handler vers pigpio** - Meilleur support servo, compatible Bookworm
2. **Ajouter action `stepper`** - Pour moteurs pas-à-pas (ULN2003, A4988)
3. **Dashboard distributeur** - Compteur de distributions, stats zaps

## Notes Techniques

### Différence LED vs Servo (résistance)

| Composant | Résistance | Raison |
|-----------|------------|--------|
| LED | Oui (220Ω) | Limiter courant, sinon LED grille |
| Servo | Non | Signal de contrôle seulement, servo alimenté séparément |

### PWM Hardware vs Software

| Type | Pins RPi | Précision | Usage |
|------|----------|-----------|-------|
| Hardware | GPIO12, 13, 18, 19 | Excellent | Servos, audio |
| Software | Tous | Variable (jitter) | LEDs, relais |

Pour les servos, privilégier GPIO18 (PWM0 hardware) ou utiliser pigpio.
