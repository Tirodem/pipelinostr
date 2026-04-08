# GPIO Morse Code Buzzer

Transforme les DMs Nostr en code Morse joué sur un buzzer.

## Commandes

```
morse: SOS                    # Vitesse normale (~12 WPM)
morse:slow: HELLO WORLD       # Vitesse lente (~6 WPM)
morse:fast: CQ CQ CQ          # Vitesse rapide (~20 WPM)
```

## Matériel requis

| Composant | Quantité | Prix estimé | Notes |
|-----------|----------|-------------|-------|
| Buzzer actif 5V | 1 | ~1€ | Recommandé (plus simple) |
| Résistance 100Ω | 1 | ~0.10€ | Protection optionnelle |
| Transistor 2N2222 | 1 | ~0.20€ | Pour buzzer > 20mA |
| Fils Dupont | 3 | ~0.50€ | Mâle-Femelle |
| Breadboard | 1 | ~3€ | Optionnel |

**Coût total : ~5€**

## Types de buzzers

### Buzzer actif (recommandé)
- Contient un oscillateur interne
- Émet un son quand alimenté (ON/OFF simple)
- Fréquence fixe (~2-4 kHz)
- **Polarisé** : respecter + et -

### Buzzer passif
- Nécessite un signal PWM pour émettre un son
- Permet de contrôler la fréquence (tonalité)
- Plus complexe à câbler
- Non couvert dans ce guide

## Schéma de connexion

### Option A : Connexion directe (buzzer < 20mA)

```
                    Raspberry Pi
                    ┌─────────────────────────┐
                    │                         │
                    │  GPIO 27 (Pin 13) ──────┼──────┐
                    │                         │      │
                    │  GND (Pin 14) ──────────┼──┐   │
                    │                         │  │   │
                    └─────────────────────────┘  │   │
                                                 │   │
                           ┌─────────────────────┘   │
                           │                         │
                           │    ┌────────────────────┘
                           │    │
                           │    │     Buzzer Actif
                           │    │    ┌──────────┐
                           │    └────┤ +   (__) │
                           │         │    ||||  │
                           └─────────┤ -        │
                                     └──────────┘
```

### Option B : Avec transistor (buzzer > 20mA, recommandé)

```
                    Raspberry Pi
                    ┌─────────────────────────┐
                    │                         │
                    │  GPIO 27 (Pin 13) ──────┼─────┐
                    │                         │     │
                    │  GND (Pin 14) ──────────┼──┐  │
                    │                         │  │  │
                    │  5V (Pin 2) ────────────┼──┼──┼─────────┐
                    │                         │  │  │         │
                    └─────────────────────────┘  │  │         │
                                                 │  │         │
                                                 │  │  100Ω   │
                                                 │  │  ┌───┐  │
                                                 │  └──┤   ├──┘
                                                 │     └─┬─┘
                                                 │       │
                                                 │       │ B
                                                 │     ┌─┴─┐
                              Buzzer Actif       │   E │   │ C
                             ┌──────────┐        │   ──┤2N2│──────┐
                             │ +   (__) ├────────┼─────┤222│      │
                             │    ||||  │        │     └───┘      │
                             │ -        ├────────┘                │
                             └──────────┘                         │
                                  5V ─────────────────────────────┘
```

## Diagramme Breadboard

```
         Breadboard
    ┌───────────────────────────────────────┐
    │  + │ - │ a │ b │ c │ d │ e │ f │ g │ h │
    ├────┼───┼───┼───┼───┼───┼───┼───┼───┼───┤
  1 │ ●  │   │   │   │   │   │   │   │   │   │ ← 5V (Pin 2)
  2 │    │ ● │   │   │   │   │   │   │   │   │ ← GND (Pin 14)
  3 │    │   │   │   │   │   │   │   │   │   │
  4 │    │   │ ● │   │   │   │   │   │   │   │ ← GPIO 27 (Pin 13)
  5 │    │   │ ● │ ● │   │   │   │   │   │   │   Résistance 100Ω
  6 │    │   │   │ ● │   │   │   │   │   │   │   ↓
  7 │    │   │   │ ● │ ● │   │   │   │   │   │   Transistor 2N2222
  8 │    │   │   │   │ ● │   │   │   │   │   │   (E-B-C)
  9 │    │   │   │   │ ● │   │   │   │   │   │   ↓
 10 │    │ ● │   │   │ ● │   │   │   │   │   │ ← Vers GND
 11 │    │   │   │   │   │   │   │   │   │   │
 12 │ ●  │   │   │   │   │ ● │   │   │   │   │   Buzzer + → 5V
 13 │    │   │   │   │ ● │ ● │   │   │   │   │   Buzzer - → Collecteur
    └────┴───┴───┴───┴───┴───┴───┴───┴───┴───┘

    Connexions:
    - 5V (Pin 2)      → Rail + (rangée 1)
    - GND (Pin 14)    → Rail - (rangée 2)
    - GPIO 27 (Pin 13) → a4
    - Résistance 100Ω → a4-b5 vers b6
    - 2N2222 (E-B-C)  → b7-c7-c8 (Emetteur-Base-Collecteur)
    - Emetteur (c9)   → Rail - (GND)
    - Collecteur (c8) → Buzzer -
    - Buzzer +        → Rail + (5V)
```

## Pinout Raspberry Pi

```
                    Raspberry Pi GPIO Header
           ┌─────────────────────────────────────┐
           │  3V3  (1) (2)  5V    ← Alimentation │
           │  SDA  (3) (4)  5V                   │
           │  SCL  (5) (6)  GND                  │
           │  GP4  (7) (8)  TXD                  │
           │  GND  (9) (10) RXD                  │
           │  GP17(11) (12) GP18                 │
    ────►  │  GP27(13) (14) GND   ← Masse        │
           │  GP22(15) (16) GP23                 │
           │  3V3 (17) (18) GP24                 │
           │  MOSI(19) (20) GND                  │
           │  MISO(21) (22) GP25                 │
           │  SCLK(23) (24) CE0                  │
           │  GND (25) (26) CE1                  │
           │  ID_SD(27)(28) ID_SC                │
           │  GP5 (29) (30) GND                  │
           │  GP6 (31) (32) GP12                 │
           │  GP13(33) (34) GND                  │
           │  GP19(35) (36) GP16                 │
           │  GP26(37) (38) GP20                 │
           │  GND (39) (40) GP21                 │
           └─────────────────────────────────────┘

    Connexions utilisées:
    - Pin 2  (5V)    → Alimentation buzzer
    - Pin 13 (GPIO27)→ Signal (via résistance/transistor)
    - Pin 14 (GND)   → Masse commune
```

## Transistor 2N2222 - Pinout

```
         Vue de face (côté plat)
              ┌─────┐
              │     │
              │ 2N  │
              │2222 │
              │     │
              └──┬──┘
                /|\
               / | \
              E  B  C

    E = Emetteur (vers GND)
    B = Base (signal GPIO via résistance)
    C = Collecteur (vers buzzer -)
```

## Configuration handler

```yaml
# config/handlers/gpio.yml
gpio:
  enabled: true
  host: localhost
  port: 8888

  pins:
    buzzer: 27      # GPIO 27 = Pin 13
    led_green: 17   # GPIO 17 = Pin 11
    led_red: 22     # GPIO 22 = Pin 15
```

## Workflow

Copier le workflow exemple :

```bash
cp examples/workflows/nostr-to-morse.yml config/workflows/
```

Éditer si nécessaire (changer le pin, la vitesse par défaut, etc.).

## Audio Telegram (optionnel)

Le workflow peut également envoyer une version audio du code Morse sur Telegram sous forme de message vocal.

### Prérequis

1. **Bot Telegram configuré** : voir `config/handlers/telegram.yml`
2. **ffmpeg installé** : pour la conversion en OGG (format Telegram)

```bash
# Installer ffmpeg (Debian/Ubuntu)
sudo apt install ffmpeg

# Vérifier l'installation
ffmpeg -version
```

### Fonctionnement

Quand vous envoyez un DM avec `morse: SOS` :

1. **Buzzer GPIO** : Le code Morse est joué sur le buzzer physique
2. **Génération audio** : Un fichier WAV avec des tonalités à 700Hz est généré
3. **Conversion OGG** : Le fichier est converti en OGG Opus (format Telegram)
4. **Envoi Telegram** : Le message vocal est envoyé sur le chat Telegram configuré
5. **Confirmation DM** : Un DM de confirmation est envoyé avec la représentation textuelle

### Configuration Telegram

```yaml
# config/handlers/telegram.yml
telegram:
  enabled: true
  bot_token: "123456789:ABCdefGHIjklMNOpqrSTUvwxYZ"
  default_chat_id: "-1001234567890"  # Chat où envoyer les audios
```

### Sans Telegram

Si Telegram n'est pas configuré, le workflow fonctionne toujours :
- Le buzzer joue le code Morse
- Le DM de confirmation est envoyé
- L'action Telegram est simplement ignorée

## Test

### Test matériel (sans PipeliNostr)

```bash
# Installer pigpio si pas déjà fait
sudo apt install pigpio
sudo systemctl enable pigpiod
sudo systemctl start pigpiod

# Test rapide du buzzer
pigs w 27 1   # ON
sleep 0.5
pigs w 27 0   # OFF
```

### Test via DM Nostr

Envoyer un DM à votre npub PipeliNostr :

```
morse: SOS
```

Vous devriez entendre : `... --- ...` (3 courts, 3 longs, 3 courts)

## Code Morse - Référence

```
A .-      N -.      0 -----
B -...    O ---     1 .----
C -.-.    P .--.    2 ..---
D -..     Q --.-    3 ...--
E .       R .-.     4 ....-
F ..-.    S ...     5 .....
G --.     T -       6 -....
H ....    U ..-     7 --...
I ..      V ...-    8 ---..
J .---    W .--     9 ----.
K -.-     X -..-
L .-..    Y -.--
M --      Z --..
```

## Timing Morse (ITU standard)

| Élément | Durée |
|---------|-------|
| Point (dit) | 1 unité |
| Trait (dah) | 3 unités |
| Espace intra-caractère | 1 unité |
| Espace inter-lettres | 3 unités |
| Espace inter-mots | 7 unités |

### Vitesses disponibles

| Vitesse | Unité | WPM | Usage |
|---------|-------|-----|-------|
| `slow` | 200ms | ~6 | Débutants, décodage à l'oreille |
| normal | 100ms | ~12 | Standard |
| `fast` | 60ms | ~20 | Opérateurs expérimentés |

## Dépannage

### Le buzzer ne fait aucun son

1. Vérifier que pigpiod tourne : `systemctl status pigpiod`
2. Vérifier la polarité du buzzer (+ vers 5V ou collecteur)
3. Tester manuellement : `pigs w 27 1`
4. Vérifier les connexions sur breadboard

### Le son est faible

- Utiliser l'alimentation 5V au lieu de 3.3V
- Ajouter un transistor si connexion directe

### Le buzzer reste allumé

- Vérifier que le workflow se termine correctement
- Redémarrer pigpiod : `sudo systemctl restart pigpiod`

### Erreur "pigpiod not available"

```bash
sudo systemctl start pigpiod
sudo systemctl enable pigpiod  # Auto-start au boot
```

## Alternatives au buzzer

| Alternative | Avantages | Inconvénients |
|-------------|-----------|---------------|
| **LED** | Silencieux, visuel | Moins "authentique" |
| **Haut-parleur** | Meilleur son | Plus complexe (ampli) |
| **Vibreur** | Feedback tactile | Faible portée |
| **Relay + sirène** | Très fort | Bruyant, complexe |

Pour utiliser une LED à la place, modifier simplement le pin dans le workflow.

## Ressources

- [Code Morse International (ITU)](https://www.itu.int/rec/R-REC-M.1677)
- [pigpio Documentation](http://abyz.me.uk/rpi/pigpio/)
- [Raspberry Pi GPIO Pinout](https://pinout.xyz/)
