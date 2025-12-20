---
title: "Afficheur Digital GPIO pour Pseudonyme Nostr"
priority: "Medium"
status: "Proposed"
created: "2025-12-20"
---

### Afficheur Digital GPIO pour Pseudonyme Nostr

**Priority:** Medium
**Status:** Proposed

#### Description

Afficher le pseudonyme (display_name ou name) du profil Nostr de l'expéditeur d'un DM sur un écran LCD/OLED connecté en GPIO (I2C ou SPI).

#### Use Case

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ DM Nostr    │────►│ PipeliNostr │────►│ Écran LCD   │
│ de @alice   │     │ (fetch      │     │ "alice"     │
│             │     │  profile)   │     │             │
└─────────────┘     └─────────────┘     └─────────────┘
```

#### Types d'afficheurs supportés

| Type | Interface | Résolution | Prix | Notes |
|------|-----------|------------|------|-------|
| **LCD 16x2** | I2C (PCF8574) | 16 chars x 2 lignes | ~5€ | Classique, rétroéclairé |
| **LCD 20x4** | I2C (PCF8574) | 20 chars x 4 lignes | ~8€ | Plus de texte |
| **OLED SSD1306** | I2C | 128x64 pixels | ~5€ | Graphique, contraste élevé |
| **OLED SSD1306** | SPI | 128x64 pixels | ~5€ | Plus rapide |
| **E-Ink** | SPI | Variable | ~15€ | Très basse conso, lent |

#### Configuration handler

```yaml
# config/handlers/display.yml
display:
  enabled: true

  type: lcd_i2c          # lcd_i2c | oled_i2c | oled_spi | e_ink
  i2c_address: 0x27      # Adresse I2C (0x27 ou 0x3F pour LCD, 0x3C pour OLED)

  # Dimensions
  cols: 16               # Caractères par ligne (LCD)
  rows: 2                # Nombre de lignes (LCD)
  # ou
  width: 128             # Pixels (OLED)
  height: 64             # Pixels (OLED)

  # Options
  backlight: true        # LCD uniquement
  scroll_long_text: true # Défiler si texte trop long
  scroll_speed_ms: 300   # Vitesse défilement
  display_duration_ms: 5000  # Durée affichage avant effacement
```

#### Workflow exemple

```yaml
id: dm-to-display
name: Show sender name on LCD
enabled: true

trigger:
  type: nostr_event
  filters:
    kinds: [4]
    from_whitelist: true

actions:
  # Récupérer le profil Nostr de l'expéditeur
  - id: fetch_profile
    type: nostr_profile
    config:
      pubkey: "{{ trigger.pubkey }}"

  # Afficher sur l'écran
  - id: show_name
    type: display
    config:
      line1: "DM de:"
      line2: "{{ actions.fetch_profile.response.display_name | default: actions.fetch_profile.response.name | default: trigger.from | truncate:16 }}"
      duration_ms: 10000
```

#### Action `nostr_profile` (nouvelle)

Pour récupérer le profil (kind 0) d'une npub :

```yaml
- id: fetch_profile
  type: nostr_profile
  config:
    pubkey: "{{ trigger.pubkey }}"
    # ou
    npub: "{{ trigger.from }}"
    timeout_ms: 5000

# Response:
# {
#   "name": "alice",
#   "display_name": "Alice",
#   "about": "...",
#   "picture": "https://...",
#   "nip05": "alice@example.com",
#   ...
# }
```

#### Câblage LCD I2C (16x2)

```
RASPBERRY PI                    LCD I2C (PCF8574)
Pin 1  [3.3V]    ●──────────────● VCC
Pin 6  [GND]     ●──────────────● GND
Pin 3  [GPIO2/SDA] ●────────────● SDA
Pin 5  [GPIO3/SCL] ●────────────● SCL
```

#### Câblage OLED SSD1306 I2C

```
RASPBERRY PI                    OLED SSD1306
Pin 1  [3.3V]    ●──────────────● VCC
Pin 6  [GND]     ●──────────────● GND
Pin 3  [GPIO2/SDA] ●────────────● SDA
Pin 5  [GPIO3/SCL] ●────────────● SCL
```

#### Librairies Node.js

| Écran | Package npm | Notes |
|-------|-------------|-------|
| LCD I2C | `lcd` ou `raspberrypi-liquid-crystal` | PCF8574 backpack |
| OLED SSD1306 | `ssd1306-i2c-js` ou `oled-js` | Via I2C |
| E-Ink | `epd-waveshare` | Waveshare displays |

#### Implémentation

- Fichier : `src/outbound/display.handler.ts`
- Action : `nostr_profile` dans `src/outbound/nostr.handler.ts` (ou nouveau fichier)
- Complexité : ~200-300 lignes
- Dépendance : `i2c-bus` + lib spécifique écran

#### Tâches d'implémentation

- [ ] Créer `display.handler.ts` avec support LCD I2C
- [ ] Ajouter action `nostr_profile` pour fetch kind 0
- [ ] Support OLED SSD1306 (optionnel)
- [ ] Gestion du scroll pour texte long
- [ ] Tests avec LCD 16x2
- [ ] Documentation câblage dans `docs/GPIO-DISPLAY-SETUP.md`

---


---
