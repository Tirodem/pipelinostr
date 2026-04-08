# TODO: Test GPIO sur Raspberry Pi 4

**Date prévue :** ~2025-12-13

## Objectif

Valider le handler GPIO avec du hardware réel sur Raspberry Pi 4.

## Hardware Requis

| Composant | Quantité | Notes |
|-----------|----------|-------|
| Raspberry Pi 4 | 1 | 2GB+ RAM |
| LED (rouge/verte) | 1-2 | 5mm standard |
| Résistance 220Ω | 1-2 | Protection LED |
| Breadboard | 1 | Mini ou half-size |
| Jumpers M/F | 4-6 | Connexion GPIO |
| (Optionnel) BME280 | 1 | Test I2C |
| (Optionnel) Relay module | 1 | Test charge AC |

## Schéma de Câblage (LED)

```
RPi GPIO 17 (pin 11) ──────┬────── LED (+) anode (patte longue)
                           │
                        [220Ω]
                           │
RPi GND (pin 6) ───────────┴────── LED (-) cathode (patte courte)
```

## Pré-Installation RPi

```bash
# 1. Mise à jour système
sudo apt update && sudo apt upgrade -y

# 2. Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# 3. Vérification
node --version  # v22.x.x
npm --version   # 10.x.x

# 4. Permissions GPIO (éviter sudo)
sudo usermod -aG gpio $USER
# Déconnexion/reconnexion requise

# 5. Clone PipeliNostr
git clone https://github.com/Tirodem/pipelinostr.git
cd pipelinostr
npm install
npm run build

# 6. Configuration
cp .env.example .env
nano .env  # Ajouter NOSTR_PRIVATE_KEY
```

## Fichiers à Créer

### config/handlers/gpio.yml

```yaml
gpio:
  enabled: true
  # Pas de config globale nécessaire pour GPIO basique
```

### config/workflows/nostr-to-gpio.yml

```yaml
id: nostr-to-gpio
name: Nostr to GPIO
description: Control GPIO pins via Nostr DM
enabled: true

trigger:
  type: nostr_event
  filters:
    kinds: [4]
    from_whitelist: true
    content_pattern: "^\\[gpio\\]\\s*(?<action>on|off|toggle)(?:\\s+pin:(?<pin>\\d+))?"

actions:
  - id: gpio_control
    type: gpio
    config:
      pin: "{{ match.pin | default: '17' }}"
      mode: "output"
      state: "{{ match.action === 'on' ? 'high' : 'low' }}"

  - id: confirm
    type: nostr_dm
    config:
      to: "{{ trigger.from }}"
      content: "GPIO {{ match.pin | default: '17' }} → {{ match.action }}"
```

## Tests à Effectuer

### Test 1 : LED ON/OFF

```bash
# Depuis un client Nostr, envoyer DM :
[gpio] on          # LED allumée (pin 17 par défaut)
[gpio] off         # LED éteinte
[gpio] on pin:27   # LED sur pin 27
```

**Résultat attendu :**
- LED s'allume/s'éteint
- Confirmation DM reçue
- Event visible dans monitoring queue

### Test 2 : Vérification Queue

```bash
./scripts/monitoring.sh
# Doit montrer event_type: nostr_dm, status: completed, workflow: nostr-to-gpio
```

### Test 3 : Hook Notification (optionnel)

Ajouter hook on_complete vers zulip-workflow-notification pour confirmer l'exécution.

## Dépannage

### "Permission denied" sur GPIO

```bash
# Vérifier groupe
groups  # Doit inclure 'gpio'

# Si non, refaire :
sudo usermod -aG gpio $USER
# Puis logout/login
```

### LED ne s'allume pas

1. Vérifier polarité LED (anode = +, cathode = -)
2. Vérifier pin correct (GPIO 17 = pin physique 11)
3. Tester avec `raspi-gpio` :
   ```bash
   raspi-gpio set 17 op dh  # HIGH
   raspi-gpio set 17 op dl  # LOW
   ```

### Handler GPIO non trouvé

Vérifier que `config/handlers/gpio.yml` existe avec `enabled: true`.

## Ressources

- [Raspberry Pi GPIO Pinout](https://pinout.xyz/)
- [Node.js onoff library](https://github.com/fivdi/onoff)
- [PipeliNostr GPIO Handler](../src/outbound/gpio.handler.ts)

## Notes Post-Session

_À compléter après les tests..._
