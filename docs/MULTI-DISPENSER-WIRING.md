# Installation electrique multi-distributeur

Guide de cablage pour un distributeur de boissons avec 3 pompes et 1 gyrophare, pilote par Raspberry Pi via GPIO.

## Materiel necessaire

### Composants electroniques
| Composant | Quantite | Specification | Usage |
|-----------|----------|---------------|-------|
| Transistor NPN | 3 | 2N2222 (TO-92) | Interrupteurs (3 pompes) |
| Resistance | 3 | 330 ohms (330R) | Protection base transistors |
| Diode | 3 | 1N4007 (optionnel) | Protection flyback moteurs |
| Fils dupont | ~20 | Male-femelle | Connexions GPIO |
| Breadboard | 1 | 400 points min | Prototypage |

### Actionneurs
| Composant | Quantite | Specification |
|-----------|----------|---------------|
| Pompe peristaltique | 3 | 3.7-6V DC, type distributeur |
| Gyrophare LED | 1 | 4.8-6V, ex: GTIWUNG RC 15x9mm |

### Alimentation
- Raspberry Pi 4 (ou 3B+)
- Alimentation 5V 3A minimum (les moteurs consomment du courant)

## Schema de cablage

```
                         +5V (pins 2, 4)
                            │
        ┌───────────────────┼───────────────────┬───────────────────┐
        │                   │                   │                   │
        │                   │                   │                   │
    [POMPE 1]           [POMPE 2]           [POMPE 3]         [GYROPHARE]
    Vin Rouge           Vin Blanc           Vin Rose           3 fils
        │                   │                   │                   │
        M+ ────────────     M+ ────────────     M+ ────────────  Rouge (+5V)
        │                   │                   │                   │
        M-                  M-                  M-               Marron (GND) ──┐
        │                   │                   │                   │           │
        ▼ C                 ▼ C                 ▼ C              Jaune ◄────────┼── GPIO 18
    ┌───────┐           ┌───────┐           ┌───────┐           (signal)       │   (pin 12)
    │ NPN 1 │           │ NPN 2 │           │ NPN 3 │                          │   (direct, pas
    └───────┘           └───────┘           └───────┘                          │   de transistor)
     B     E             B     E             B     E                           │
     │     │             │     │             │     │                           │
     │     └─────────────┼─────┴─────────────┼─────┴───────────────────────────┴── GND
     │                   │                   │                                     (pins 6,9,14...)
  [330Ω]              [330Ω]              [330Ω]
     │                   │                   │
     │                   │                   │
  GPIO 17            GPIO 27            GPIO 22
  (pin 11)           (pin 13)           (pin 15)
```

### Gyrophare GTIWUNG RC (3 fils)

Le gyrophare a un signal de controle integre, pas besoin de transistor :

| Fil | Connexion |
|-----|-----------|
| Rouge | +5V (pin 2 ou 4) |
| Marron | GND (pin 6, 9, 14...) |
| Jaune | GPIO 18 (pin 12) - direct |

## Correspondance GPIO / Pins physiques

| Fonction | GPIO (BCM) | Pin physique | Couleur fil suggeree |
|----------|------------|--------------|----------------------|
| Pompe 1 (Vin Rouge) | GPIO 17 | Pin 11 | Rouge |
| Pompe 2 (Vin Blanc) | GPIO 27 | Pin 13 | Blanc |
| Pompe 3 (Vin Rose) | GPIO 22 | Pin 15 | Rose |
| Gyrophare | GPIO 18 | Pin 12 | Jaune |
| +5V | - | Pin 2 ou 4 | Rouge |
| GND | - | Pin 6, 9, 14, 20, 25, 30, 34 ou 39 | Noir |

## Pinout Raspberry Pi (reference)

```
                    Pin 1 (3.3V)  Pin 2 (+5V)
                           │         │
   ┌───────────────────────┼─────────┼───────────────────────┐
   │                       ○ ○       │                       │
   │  GPIO 2 (SDA)    3 ○ ○ 4  +5V ──┘                       │
   │  GPIO 3 (SCL)    5 ○ ○ 6  GND ◄────────────────────────┐│
   │  GPIO 4          7 ○ ○ 8  GPIO 14                      ││
   │  GND             9 ○ ○ 10 GPIO 15                      ││
   │  GPIO 17 ──────► 11 ○ ○ 12 ◄── GPIO 18 (Gyrophare)     ││
   │  GPIO 27 ──────► 13 ○ ○ 14 GND ◄───────────────────────┤│
   │  GPIO 22 ──────► 15 ○ ○ 16 GPIO 23                     ││
   │  3.3V           17 ○ ○ 18 GPIO 24                      ││
   │  GPIO 10        19 ○ ○ 20 GND ◄────────────────────────┤│
   │  GPIO 9         21 ○ ○ 22 GPIO 25                      ││
   │  GPIO 11        23 ○ ○ 24 GPIO 8                       ││
   │  GND            25 ○ ○ 26 GPIO 7                       ││
   │  ...            ...                                    ││
   └────────────────────────────────────────────────────────┘│
              Pompe 1 (pin 11)                               │
              Pompe 2 (pin 13)                               │
              Pompe 3 (pin 15)                               │
              Tous les GND sont connectes ◄──────────────────┘
```

## Detail du cablage d'un transistor

Pour chaque pompe/gyrophare, le cablage est identique :

```
        +5V
         │
         │
    ┌────┴────┐
    │  CHARGE │  (Moteur ou Gyrophare)
    │   M+/+  │
    └────┬────┘
         │
    ┌────┴────┐
    │   M-/-  │
    └────┬────┘
         │
         ▼ Collecteur (C)
     ┌───────┐
     │       │  2N2222 (face plate vers vous)
     │ 2N2222│  Pattes: E - B - C (gauche a droite)
     │       │
     └───────┘
    E    B    C
    │    │    │
    │    │    └── vers M- de la charge (deja connecte ci-dessus)
    │    │
    │    └── Resistance 330 ohms ── GPIO
    │
    └── GND
```

### Identification du transistor 2N2222 (boitier TO-92)

```
    ┌─────────┐
    │  face   │
    │  plate  │
    │ 2N2222  │
    └─┬─┬─┬───┘
      │ │ │
      E B C

E = Emetteur (gauche)
B = Base (centre)
C = Collecteur (droite)
```

### Code couleur resistance 330 ohms

| Bande | Couleur |
|-------|---------|
| 1 | Orange |
| 2 | Orange |
| 3 | Marron |
| 4 | Or (tolerance) |

Code imprime sur bande de resistances : **330R** ou **331**

## Configuration PipeliNostr

### config/config.yml

```yaml
nostr:
  zapRecipients:
    - "npub1xxx..."  # Npub du distributeur
```

### Workflows (un par bouteille)

Creer 3 workflows bases sur `zap-to-gpio-dispenser-with-warning-signal.yml.example` :

| Workflow | Produit | GPIO moteur | zap_event_id |
|----------|---------|-------------|--------------|
| `zap-dispenser-rouge.yml` | Vin Rouge | 17 | note1xxx... |
| `zap-dispenser-blanc.yml` | Vin Blanc | 27 | note1yyy... |
| `zap-dispenser-rose.yml` | Vin Rose | 22 | note1zzz... |

Le gyrophare (GPIO 18) est commun a tous les workflows.

### Exemple de configuration workflow

```yaml
variables:
  bar_name: "CAVE A VINS NOSTR"
  product_name: "1 verre de vin rouge"
  product_volume: "12.5 cL"
  product_price: 21
  product_vat: 0
  tip_vat: 0
  vat_exemption_text: "TVA non applicable - Art. 293B du CGI"
  gpio_warning: 18    # Gyrophare (commun)
  gpio_motor: 17      # Pompe vin rouge
  delay_before: 3000
  pour_duration: 2000
  delay_after: 2000

trigger:
  type: zap
  filters:
    zap_recipients:
      - "npub1xxx..."
    zap_min_amount: 1
    zap_event_id: "note1xxx..."  # Note specifique au vin rouge
```

## Commandes de test

```bash
# Demarrer pigpiod
sudo systemctl start pigpiod

# Tester chaque GPIO individuellement
pigs w 17 1   # Pompe 1 ON
pigs w 17 0   # Pompe 1 OFF

pigs w 27 1   # Pompe 2 ON
pigs w 27 0   # Pompe 2 OFF

pigs w 22 1   # Pompe 3 ON
pigs w 22 0   # Pompe 3 OFF

pigs w 18 1   # Gyrophare ON
pigs w 18 0   # Gyrophare OFF

# Test sequence complete (gyrophare + pompe 1)
pigs w 18 1 && sleep 2 && pigs w 17 1 && sleep 2 && pigs w 17 0 && sleep 1 && pigs w 18 0
```

## Securite electrique

1. **Ne jamais depasser 5V** sur les actionneurs
2. **Toujours utiliser des resistances** sur les bases des transistors
3. **Verifier les polarites** avant de brancher
4. **Couper l'alimentation** avant toute modification
5. **Diodes flyback recommandees** sur les moteurs pour proteger les transistors des pics de tension

## Depannage

| Symptome | Cause probable | Solution |
|----------|----------------|----------|
| Rien ne fonctionne | pigpiod pas demarre | `sudo systemctl start pigpiod` |
| LED OK, moteur non | Courant insuffisant | Reduire resistance a 220Ω |
| Moteur tourne a l'envers | Polarite inversee | Inverser M+ et M- |
| Gyrophare ne clignote pas | Normal | Le gyrophare clignote de lui-meme une fois alimente |
| GPIO ne repond pas | Mauvais pin | Verifier BCM vs pin physique |

## Photos de reference

(A completer avec photos de votre installation)

- Vue d'ensemble du cablage
- Detail branchement transistor
- Connexions sur le Raspberry Pi
- Montage final du distributeur
