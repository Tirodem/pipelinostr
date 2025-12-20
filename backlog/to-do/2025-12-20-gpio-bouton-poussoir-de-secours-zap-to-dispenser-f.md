---
title: "GPIO Bouton Poussoir de Secours (Zap-to-Dispenser Fallback)"
priority: "Medium"
status: "Proposed"
created: "2025-12-20"
---

### GPIO Bouton Poussoir de Secours (Zap-to-Dispenser Fallback)

**Priority:** Medium
**Status:** Proposed

#### Description

Ajouter un bouton poussoir physique qui déclenche l'action du servomoteur du distributeur même en l'absence de connexion réseau ou de zap. Mode "offline fallback" pour le workflow `zap-to-dispenser`.

#### Use Case

```
┌─────────────────────────────────────────────────────────────┐
│                    ZAP-TO-DISPENSER                          │
│                                                              │
│   Mode Normal (online):                                      │
│   ┌─────────┐     ┌─────────────┐     ┌─────────┐          │
│   │ Zap     │────►│ PipeliNostr │────►│ Servo   │          │
│   │ (Nostr) │     │             │     │ (GPIO)  │          │
│   └─────────┘     └─────────────┘     └─────────┘          │
│                                                              │
│   Mode Fallback (offline):                                   │
│   ┌─────────┐     ┌─────────────┐     ┌─────────┐          │
│   │ Bouton  │────►│ GPIO        │────►│ Servo   │          │
│   │ (GPIO)  │     │ Listener    │     │ (GPIO)  │          │
│   └─────────┘     └─────────────┘     └─────────┘          │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

#### Implémentation

**Option A : Listener GPIO intégré à PipeliNostr**

```yaml
# config/handlers/gpio.yml
gpio:
  enabled: true

  # Écoute bouton (inbound)
  inputs:
    - pin: 17
      name: "dispenser_button"
      edge: "falling"          # falling | rising | both
      debounce_ms: 200         # Anti-rebond
      pull: "up"               # up | down | none (pull-up interne)
```

```yaml
# Workflow déclenché par bouton
id: button-to-dispenser
name: Manual Dispenser Trigger
enabled: true

trigger:
  type: gpio_input
  filters:
    pin: 17
    edge: falling

actions:
  - id: dispense
    type: gpio
    config:
      pin: 18
      action: servo
      angle: 180
      duration: 1000
      return_angle: 0

  - id: log_local
    type: file
    config:
      path: "/var/log/pipelinostr/manual-dispense.log"
      content: "{{ now | date }} - Manual dispense triggered\n"
      append: true
```

**Option B : Script externe avec systemd (sans PipeliNostr)**

```bash
#!/bin/bash
# /usr/local/bin/manual-dispense.sh
# Déclenché par systemd sur événement GPIO

pigs s 18 2500  # Servo à 180°
sleep 1
pigs s 18 500   # Retour à 0°
echo "$(date) - Manual dispense" >> /var/log/manual-dispense.log
```

```ini
# /etc/systemd/system/dispenser-button.service
[Unit]
Description=Manual Dispenser Button

[Service]
Type=simple
ExecStart=/usr/bin/gpiomon --falling-edge --num-events=1 gpiochip0 17
ExecStartPost=/usr/local/bin/manual-dispense.sh
Restart=always

[Install]
WantedBy=multi-user.target
```

#### Câblage

```
RASPBERRY PI                    BOUTON POUSSOIR
Pin 11 [GPIO17]  ●──────────────● Contact 1
Pin 9  [GND]     ●──────────────● Contact 2

Note: Utiliser la résistance pull-up interne du RPi
      Le bouton tire GPIO17 vers GND quand pressé
```

#### Matériel requis

| Composant | Prix | Notes |
|-----------|------|-------|
| Bouton poussoir 12mm | ~1€ | Momentané, normalement ouvert |
| Câbles dupont | ~1€ | 2 câbles femelle-femelle |

#### Considérations

- **Debounce** : Filtrer les rebonds mécaniques (200ms recommandé)
- **Pull-up** : Utiliser le pull-up interne du RPi pour éviter les faux déclenchements
- **Logging** : Garder une trace des déclenchements manuels pour audit
- **LED indicateur** : Optionnel - allumer une LED pendant l'action

#### Tâches d'implémentation

- [ ] Ajouter `GpioInputListener` dans `src/inbound/gpio-input.ts`
- [ ] Supporter trigger `type: gpio_input` dans workflow-matcher
- [ ] Debounce et gestion des edges (rising/falling/both)
- [ ] Tests avec bouton physique
- [ ] Documentation câblage

---


---
