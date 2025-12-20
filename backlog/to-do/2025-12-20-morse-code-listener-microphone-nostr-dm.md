---
title: "Morse Code Listener (Microphone → Nostr DM)"
priority: "Low"
status: "Proposed"
created: "2025-12-20"
---

### Morse Code Listener (Microphone → Nostr DM)

**Priority:** Low
**Status:** Proposed

#### Description

Écouter du code Morse via un microphone connecté en GPIO (ou USB), le décoder en texte et l'envoyer en DM Nostr à une npub configurée.

#### Use Case

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ Microphone  │────►│ PipeliNostr │────►│ Nostr DM    │
│ (Morse in)  │     │ (decode)    │     │ (text out)  │
└─────────────┘     └─────────────┘     └─────────────┘

Entrée audio: "... --- ..." (bips Morse)
Sortie DM: "SOS"
```

#### Architecture

```
┌──────────────────────────────────────────────────────────┐
│                     Raspberry Pi                          │
│                                                           │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │
│  │ Microphone  │───►│ ADC         │───►│ GPIO/I2C    │  │
│  │ (analog)    │    │ (MCP3008)   │    │             │  │
│  └─────────────┘    └─────────────┘    └──────┬──────┘  │
│                                                │         │
│        OU                                      │         │
│                                                │         │
│  ┌─────────────┐                               │         │
│  │ USB Sound   │───────────────────────────────┤         │
│  │ Card + Mic  │                               │         │
│  └─────────────┘                               │         │
│                                                ▼         │
│                                       ┌─────────────┐   │
│                                       │ Morse       │   │
│                                       │ Decoder     │   │
│                                       └──────┬──────┘   │
│                                              │          │
│                                              ▼          │
│                                       ┌─────────────┐   │
│                                       │ Nostr DM    │   │
│                                       └─────────────┘   │
└──────────────────────────────────────────────────────────┘
```

#### Implémentation

1. **Inbound listener** pour audio (nouveau type de trigger)
2. **Algorithme de détection** :
   - Seuil de volume pour détecter ON/OFF
   - Mesure des durées pour distinguer points/traits
   - Détection des silences (lettres/mots)
3. **Décodage Morse → texte** (inverse du handler existant)
4. **Envoi DM** à une npub configurée

#### Configuration

```yaml
# config/handlers/morse-listener.yml
morse_listener:
  enabled: true

  # Source audio
  input: "usb"  # ou "gpio" avec ADC
  device: "/dev/snd/pcmC1D0c"  # ou "hw:1,0"

  # ou GPIO avec ADC
  # input: "gpio"
  # adc_channel: 0
  # adc_type: "mcp3008"

  # Paramètres de détection
  threshold: 0.3           # Seuil de volume (0-1)
  unit_ms: 100             # Durée estimée d'un point
  tolerance: 0.4           # Tolérance timing (40%)

  # Destination
  send_to_npub: "npub1..."  # Destinataire des messages décodés
  min_chars: 2              # Minimum de caractères avant envoi
```

#### Workflow exemple

```yaml
id: morse-listener-to-dm
trigger:
  type: morse_audio
  config:
    device: "/dev/snd/pcmC1D0c"
    threshold: 0.3

actions:
  - type: nostr_dm
    config:
      to: "npub1_destinataire"
      content: |
        Morse reçu: {{ trigger.decoded_text }}

        Brut: {{ trigger.morse_sequence }}
        Confiance: {{ trigger.confidence }}%
```

#### Matériel requis

**Configuration recommandée : USB (capture depuis buzzer KY-012)**

| # | Composant | Modèle | Prix | Lien type |
|---|-----------|--------|------|-----------|
| 1 | Carte son USB | **Sabrent AU-MMSA** | ~8€ | Amazon "Sabrent AU-MMSA" |
| 2 | Microphone | Micro cravate TRS 3.5mm | ~3-5€ | AliExpress "lavalier mic 3.5mm TRS PC" |
| 3 | Buzzer (émetteur) | AZDelivery KY-012 | ~3€ | Déjà prévu pour Morse output |

**Total : ~14€** (hors Raspberry Pi)

**Pourquoi Sabrent AU-MMSA ?**
- Plug & play sur Linux (pas de drivers)
- Entrée micro 3.5mm (TRS, pas TRRS)
- Sample rate 44.1kHz (suffisant pour Morse 300-1000Hz)
- Faible consommation, compact

**Attention micro :** Vérifier que c'est une prise **TRS 3.5mm** (3 segments) et non TRRS (4 segments pour smartphones).

```
TRS (compatible Sabrent):        TRRS (smartphones, incompatible):
    ┌─┐                              ┌─┐
    │●│ Tip (Signal)                 │●│ Tip
    ├─┤                              ├─┤
    │●│ Ring (Signal)                │●│ Ring 1
    ├─┤                              ├─┤
    │●│ Sleeve (GND)                 │●│ Ring 2
    └─┘                              ├─┤
                                     │●│ Sleeve
                                     └─┘
```

**Montage physique (couplage acoustique) :**

```
        ┌─────────────────────────────────────────────────┐
        │                   Boîtier                       │
        │                                                 │
        │   ┌──────────┐         ┌──────────┐            │
        │   │  KY-012  │  ~2cm   │   Micro  │            │
        │   │  Buzzer  │ ◄─────► │ cravate  │            │
        │   │   (•))   │         │    ●     │            │
        │   └────┬─────┘         └────┬─────┘            │
        │        │                    │                  │
        └────────┼────────────────────┼──────────────────┘
                 │                    │ Câble 3.5mm
                 │                    ▼
                 │              ┌───────────┐
                 │              │  Sabrent  │
                 │              │  AU-MMSA  │
                 │              └─────┬─────┘
                 │                    │ USB
                 │                    ▼
           GPIO 27              ┌───────────┐
                 │              │ Raspberry │
                 └──────────────┤    Pi     │
                                └───────────┘
```

**Astuce isolation bruit :** Créer un "tunnel acoustique" avec un tube carton/plastique (~3cm diamètre) entre le buzzer et le micro pour éviter le bruit ambiant.

**Vérification à la réception :**

```bash
# Vérifier que la Sabrent est détectée
arecord -l

# Tester l'enregistrement (5 secondes)
arecord -D plughw:1,0 -f S16_LE -r 44100 -d 5 test.wav

# Écouter le résultat
aplay test.wav
```

**Alternative GPIO (déconseillée) :**

| Option | Composants | Prix |
|--------|------------|------|
| GPIO + ADC | MCP3008 + micro electret + ampli | ~15€ |

L'option GPIO avec ADC (MCP3008) est déconseillée car :
- Max ~200 kHz sampling théorique, ~10-50 kHz en pratique
- Gigue de timing rend le décodage peu fiable
- Plus complexe à câbler

#### Défis techniques

- **Bruit ambiant** : Filtrage nécessaire
- **Calibration** : Vitesse variable selon l'opérateur
- **Timing** : Tolérance sur les durées points/traits
- **Latence** : Traitement temps réel

#### Ressources

- [Goertzel Algorithm](https://en.wikipedia.org/wiki/Goertzel_algorithm) - Détection de fréquence
- [node-audiorecorder](https://www.npmjs.com/package/node-audiorecorder)
- [MCP3008 avec pigpio](http://abyz.me.uk/rpi/pigpio/cif.html#spiOpen)

---


---
