# PipeliNostr

**Le n8n de Nostr** - Un routeur d'événements Nostr vers des services externes.

PipeliNostr écoute les événements Nostr (DMs, mentions, etc.) et les route vers des actions configurables : emails, webhooks HTTP, réponses Nostr, et plus encore.

## Progression

### Workflows testés et fonctionnels

| Fichier | Description |
|---------|-------------|
| `zulip-forward.yml` | Forward DM vers Zulip |
| `zap-notification.yml` | Notification sur zap recu |
| `nostr-to-telegram.yml` | Forward DM vers Telegram |
| `nostr-to-email.yml` | Forward DM vers Email |
| `nostr-to-calendar.yml` | DM vers invitation calendrier (iCal) |
| `nostr-to-sms.yml` | DM vers SMS (via Traccar) |
| `dm-to-mastodon.yml` | DM vers post Mastodon public |
| `dm-to-bluesky.yml` | DM vers post Bluesky |
| `dm-to-mongodb.yml` | DM vers MongoDB (event tracking) |
| `dm-to-ftp.yml` | DM vers fichier log FTP (append) |
| `dm-to-ftp-with-local-storage.yml` | DM vers fichier local + sync FTP |
| `mempool-tx-lookup.yml` | Lookup TX Bitcoin via mempool.space |
| `zulip-workflow-notification.yml` | Notification Zulip sur fin de workflow |

Les exemples sont dans `examples/workflows/`. Pour les utiliser :
```bash
cp examples/workflows/<fichier>.yml config/workflows/
```

## Fonctionnalités

- **Multi-relay** : Connexion simultanée à plusieurs relays avec gestion automatique des reconnexions
- **Quarantaine progressive** : Les relays défaillants sont mis en quarantaine avec backoff exponentiel
- **Chiffrement NIP-04/NIP-44** : Support des DMs chiffrés
- **Workflows YAML** : Configuration déclarative des règles de routage
- **Pattern matching** : Filtrage par regex avec groupes de capture nommés
- **Templates Handlebars** : Interpolation dynamique dans les actions
- **Handlers extensibles** : Email, HTTP, Nostr DM, Nostr Note

## Installation

### Prérequis

- Node.js >= 20.0.0
- npm ou yarn

### Installation

```bash
git clone https://github.com/Tirodem/pipelinostr.git
cd pipelinostr
npm install
```

### Configuration

1. Copiez les fichiers d'exemple :

```bash
cp .env.example .env
```

2. Éditez `.env` avec votre clé privée Nostr :

```env
NOSTR_PRIVATE_KEY=nsec1...
```

3. Configurez `config/config.yml` selon vos besoins (voir section Configuration)

4. Créez vos workflows dans `config/workflows/`

### Lancement

```bash
# Build et lancement
npm run build
npm start

# Mode développement (hot-reload)
npm run dev
```

## Configuration

### Structure des fichiers

```
config/
├── config.yml           # Configuration principale
├── handlers/
│   └── email.yml        # Configuration du handler email
└── workflows/
    ├── email-forward.yml
    ├── command-handler.yml
    └── ...
```

### config.yml

```yaml
pipelinostr:
  name: "Mon PipeliNostr"
  version: "0.1.0"

nostr:
  private_key: ${NOSTR_PRIVATE_KEY}  # Variable d'environnement

whitelist:
  enabled: true
  npubs:
    - "npub1..."  # npubs autorisés

relays:
  primary:
    - "wss://relay.damus.io"
    - "wss://nos.lol"
  blacklist: []
  quarantine:
    enabled: true
    thresholds:
      - failures: 1
        duration: "15m"
      - failures: 3
        duration: "6h"
    max_quarantine_duration: "6M"

database:
  path: "./data/pipelinostr.db"

logging:
  level: "info"  # debug, info, warn, error

# Queue (optionnel)
queue:
  enabled: true              # Active la file d'attente
  poll_interval_ms: 1000     # Intervalle de polling
  concurrency: 1             # Traitement parallèle
```

## Queue d'événements

La queue permet de :
- **Fiabilité** : Les événements sont persistés avant traitement
- **Retry automatique** : Backoff exponentiel en cas d'échec
- **Replay** : Rejouer des événements échoués ou passés
- **Audit** : Historique complet de tous les événements

### Cycle de vie
```
pending → processing → completed
                    → failed → (retry) → pending
                            → dead (après max retries)
```

### Commandes SQLite utiles
```bash
# Voir les événements en queue
sqlite3 -header -column ./data/pipelinostr.db \
  "SELECT id, status, retry_count, workflow_id FROM event_queue LIMIT 20;"

# Statistiques
sqlite3 ./data/pipelinostr.db \
  "SELECT status, COUNT(*) FROM event_queue GROUP BY status;"

# Rejouer les événements échoués (via l'application)
# db.replayFailedEvents()
```

## Workflows

Les workflows définissent comment les événements sont traités. Chaque workflow contient :
- Un **trigger** : conditions de déclenchement
- Des **actions** : opérations à exécuter

### Exemple simple : Forward vers email

```yaml
id: email-forward
name: Email Forward
enabled: true

trigger:
  type: nostr_event
  filters:
    kinds: [4]           # NIP-04 DMs
    from_whitelist: true

actions:
  - id: send_email
    type: email
    config:
      to: "alerts@example.com"
      subject: "DM de {{ trigger.from }}"
      body: "{{ trigger.content }}"
```

### Exemple avec commandes

```yaml
id: command-handler
name: Command Handler
enabled: true

trigger:
  type: nostr_event
  filters:
    kinds: [4]
    from_whitelist: true
    starts_with: "/"
    content_pattern: "^/(?<command>\\w+)(?:\\s+(?<args>.*))?$"

actions:
  - id: ping_response
    type: nostr_dm
    when: "match.command === 'ping'"
    config:
      to: "{{ trigger.from }}"
      content: "pong!"

  - id: echo_response
    type: nostr_dm
    when: "match.command === 'echo'"
    config:
      to: "{{ trigger.from }}"
      content: "{{ match.args }}"
```

### Filtres disponibles

| Filtre | Description |
|--------|-------------|
| `kinds` | Types d'événements Nostr (4=DM, 1=note, etc.) |
| `from_whitelist` | Uniquement les npubs de la whitelist |
| `from_npubs` | Liste spécifique de npubs |
| `starts_with` | Le contenu commence par... |
| `contains` | Le contenu contient... |
| `ends_with` | Le contenu finit par... |
| `content_pattern` | Regex avec groupes nommés |

### Variables de contexte

Dans les templates `{{ }}` et conditions `when`, vous avez accès à :

**trigger** - Données de l'événement :
- `trigger.from` : npub de l'expéditeur
- `trigger.pubkey` : clé publique hex
- `trigger.content` : contenu déchiffré
- `trigger.kind` : type d'événement
- `trigger.timestamp` : timestamp Unix
- `trigger.relayUrl` : URL du relay source
- `trigger.event` : événement Nostr complet

**match** - Groupes capturés par regex :
- `match.command`, `match.args`, etc. (selon votre pattern)

**actions** - Résultats des actions précédentes :
- `actions.<id>.success` : booléen
- `actions.<id>.error` : message d'erreur
- `actions.<id>.response` : données retournées

## Handlers

### Email

```yaml
type: email
config:
  to: "dest@example.com"
  subject: "Sujet"
  body: "Corps texte"
  html: "<p>Corps HTML</p>"  # optionnel
  cc: "cc@example.com"       # optionnel
  bcc: "bcc@example.com"     # optionnel
```

Configuration SMTP dans `config/handlers/email.yml`.

### HTTP

```yaml
type: http
config:
  url: "https://api.example.com/webhook"
  method: POST  # GET, POST, PUT, PATCH, DELETE
  headers:
    Authorization: "Bearer token"
  body:
    event_id: "{{ trigger.event.id }}"
    content: "{{ trigger.content }}"
  timeout_ms: 10000
```

### Nostr DM

```yaml
type: nostr_dm
config:
  to: "{{ trigger.from }}"  # npub ou hex
  content: "Votre message"
```

### Nostr Note

```yaml
type: nostr_note
config:
  content: "Note publique"
  kind: 1  # optionnel, défaut: 1
  tags:    # optionnel
    - ["t", "hashtag"]
```

## Scripts npm

| Commande | Description |
|----------|-------------|
| `npm run build` | Compile TypeScript |
| `npm run build:clean` | Clean + build |
| `npm start` | Lance en production |
| `npm run dev` | Mode développement (hot-reload) |
| `npm run typecheck` | Vérifie les types |
| `npm run lint` | Analyse statique ESLint |
| `npm test` | Lance les tests (watch) |
| `npm run test:run` | Lance les tests (une fois) |

## Architecture

```
src/
├── index.ts              # Point d'entrée
├── config/
│   ├── loader.ts         # Chargement YAML + env
│   └── schema.ts         # Validation Ajv
├── persistence/
│   ├── database.ts       # SQLite (better-sqlite3)
│   └── logger.ts         # Pino logger
├── relay/
│   ├── manager.ts        # Gestion multi-relay
│   ├── quarantine.ts     # Logique de quarantaine
│   └── health-checker.ts # Vérification santé
├── inbound/
│   └── nostr-listener.ts # Écoute événements
├── core/
│   ├── workflow-engine.ts    # Moteur principal
│   ├── workflow-loader.ts    # Chargement workflows
│   ├── workflow-matcher.ts   # Matching regex
│   └── expression-evaluator.ts # Évaluation conditions
├── outbound/
│   ├── handler.interface.ts  # Interface commune
│   ├── email.handler.ts      # Handler email
│   ├── http.handler.ts       # Handler HTTP
│   └── nostr.handler.ts      # Handlers Nostr
└── utils/
    ├── crypto.ts         # NIP-04/NIP-44
    └── retry.ts          # Logique de retry
```

## Licence

MIT
