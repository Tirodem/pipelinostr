# PipeliNostr - Spécifications Techniques

> **Version** : 0.1.0 (Prototype)  
> **Date** : 2025-01-09  
> **Stack** : TypeScript / Node.js

---

## 1. Vision du projet

**PipeliNostr** est un event router Nostr self-hosted, léger et extensible. Il agit comme un middleware bidirectionnel entre le réseau Nostr et des services externes (email, messageries, APIs, hardware, réseaux sociaux).

### Positionnement

- **Le "n8n de Nostr"** mais plus léger, Nostr-native, orienté DevOps
- Comble un vide : aucun event router Nostr générique n'existe actuellement
- Les bridges existants sont mono-fonction (Discord↔Nostr, Twitter→Nostr, etc.)

### Cas d'usage principaux

| Entrée | Sortie |
|--------|--------|
| DM Nostr | Email |
| DM Nostr | WhatsApp / Signal / Telegram |
| DM Nostr | Call API externe |
| DM Nostr | Action GPIO (hardware) |
| DM Nostr | Publication X (Twitter) |
| DM Nostr | Note publique Nostr |
| DM Nostr | Fichier FTP |
| Call API entrant | DM Nostr |
| Email entrant | DM Nostr |
| Message WhatsApp/Telegram/Signal | DM Nostr |

---

## 2. Architecture globale

```
┌─────────────────────────────────────────────────────────────────────┐
│                          PipeliNostr                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────────┐ │
│  │   INBOUND   │    │   ROUTER    │    │        OUTBOUND         │ │
│  │   LAYER     │───▶│   ENGINE    │───▶│        HANDLERS         │ │
│  └─────────────┘    └─────────────┘    └─────────────────────────┘ │
│        │                  │                       │                 │
│        ▼                  ▼                       ▼                 │
│  ┌───────────┐     ┌───────────┐          ┌─────────────┐          │
│  │ Nostr     │     │ Workflow  │          │ Email       │          │
│  │ Listener  │     │ Matcher   │          │ Telegram    │          │
│  │ API Server│     │ Templating│          │ WhatsApp    │          │
│  │ Email RX  │     │ Conditions│          │ Signal      │          │
│  │ Webhooks  │     │           │          │ X/Twitter   │          │
│  └───────────┘     └───────────┘          │ Nostr TX    │          │
│        │                  │               │ HTTP/API    │          │
│        ▼                  ▼               │ FTP         │          │
│  ┌─────────────────────────────────────┐  │ GPIO        │          │
│  │            PERSISTENCE              │  └─────────────┘          │
│  │  SQLite DB │ Logs │ Relay State     │                           │
│  └─────────────────────────────────────┘                           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Stack technique

### Core

| Composant | Technologie | Justification |
|-----------|-------------|---------------|
| Runtime | Node.js 20 LTS | Stabilité, support long terme |
| Langage | TypeScript 5.x | Typage fort, maintenabilité |
| Nostr | `nostr-tools` | Lib la plus maintenue et documentée |
| DB | SQLite + `better-sqlite3` | Léger, zero-config, performant |
| Process | PM2 ou systemd | Restart auto, logs |
| Config | YAML + dotenv | Lisibilité + secrets séparés |

### Handlers (dépendances optionnelles)

| Handler | Package |
|---------|---------|
| Email | `nodemailer` |
| Telegram | `telegraf` ou `node-telegram-bot-api` |
| WhatsApp | `whatsapp-web.js` ou API Business |
| Signal | `signal-cli` (via subprocess) |
| X/Twitter | `twitter-api-v2` |
| HTTP | `axios` ou `fetch` natif |
| FTP | `basic-ftp` |
| GPIO | `onoff` (pour RPi) |
| Serial/RS232 | `serialport` |

---

## 4. Structure du projet

```
pipelinostr/
├── src/
│   ├── index.ts                 # Entry point
│   ├── config/
│   │   ├── loader.ts            # Charge YAML + .env
│   │   └── schema.ts            # Validation JSON Schema
│   ├── core/
│   │   ├── router.ts            # Moteur de routing
│   │   ├── workflow-engine.ts   # Exécution des workflows
│   │   └── template-engine.ts   # Templating Handlebars/Mustache
│   ├── inbound/
│   │   ├── nostr-listener.ts    # Écoute events Nostr
│   │   ├── api-server.ts        # API HTTP entrante
│   │   └── email-receiver.ts    # (futur) IMAP listener
│   ├── outbound/
│   │   ├── handler.interface.ts # Interface commune
│   │   ├── email.handler.ts
│   │   ├── telegram.handler.ts
│   │   ├── whatsapp.handler.ts
│   │   ├── signal.handler.ts
│   │   ├── x-twitter.handler.ts
│   │   ├── nostr.handler.ts
│   │   ├── http.handler.ts
│   │   ├── ftp.handler.ts
│   │   └── gpio.handler.ts
│   ├── relay/
│   │   ├── manager.ts           # Gestion multi-relay
│   │   ├── health-checker.ts    # Monitoring santé relays
│   │   └── quarantine.ts        # Logique de quarantaine
│   ├── persistence/
│   │   ├── database.ts          # SQLite setup
│   │   ├── models/
│   │   │   ├── event-log.ts
│   │   │   ├── workflow-execution.ts
│   │   │   └── relay-state.ts
│   │   └── logger.ts            # Winston/Pino
│   └── utils/
│       ├── retry.ts             # Retry avec backoff
│       └── crypto.ts            # Helpers NIP-04/NIP-44
├── config/
│   ├── config.yml               # Config principale
│   ├── handlers/
│   │   ├── email.yml
│   │   ├── telegram.yml
│   │   └── ...
│   └── workflows/
│       ├── email-forward.yml
│       └── ...
├── scripts/
│   └── install.sh               # Script d'installation
├── .env.example
├── package.json
├── tsconfig.json
└── README.md
```

---

## 5. Configuration

### 5.1 Structure des fichiers

```
/etc/pipelinostr/          # ou ~/.pipelinostr/ pour install user
├── .env                   # SECRETS uniquement
├── config.yml             # Config générale
├── handlers/              # Config par handler
│   ├── email.yml
│   ├── telegram.yml
│   └── ...
└── workflows/             # Définitions des workflows
    ├── email-forward.yml
    └── ...
```

### 5.2 Fichier principal : `config.yml`

```yaml
# config.yml
pipelinostr:
  name: "Mon PipeliNostr"
  version: "0.1.0"

# Identité Nostr du bot
nostr:
  private_key: ${NOSTR_PRIVATE_KEY}  # Référence .env
  # OU
  # private_key_file: /path/to/nsec.txt

# Whitelist des npub autorisées à envoyer des commandes
whitelist:
  enabled: true
  npubs:
    - "npub1abc..."
    - "npub1def..."
  # OU référence fichier externe
  # file: /etc/pipelinostr/whitelist.txt

# Gestion des relays
relays:
  # Relays principaux (toujours utilisés)
  primary:
    - "wss://relay.damus.io"
    - "wss://nos.lol"
    - "wss://relay.nostr.band"
  
  # Relays blacklistés (jamais utilisés)
  blacklist:
    - "wss://spam-relay.example.com"
  
  # Discovery automatique (optionnel)
  discovery:
    enabled: false
    sources:
      - "https://api.nostr.watch/v1/online"
    max_relays: 10
    auto_add_from_events: false  # Ajouter relays vus dans les events

  # Paramètres de quarantaine
  quarantine:
    enabled: true
    thresholds:
      # Après N échecs consécutifs → durée de quarantaine
      - failures: 1
        duration: "15m"
      - failures: 2
        duration: "2h"
      - failures: 3
        duration: "6h"
      - failures: 4
        duration: "24h"
      - failures: 5
        duration: "2d"
      - failures: 6
        duration: "4d"
      - failures: 7
        duration: "1w"
      - failures: 8
        duration: "2w"
    # Après 2 semaines, ping mensuel pendant 6 mois puis abandon
    max_quarantine_duration: "6M"
    health_check_interval: "30d"

# API entrante
api:
  enabled: true
  port: 3000
  host: "127.0.0.1"  # Localhost only par défaut
  
  # Authentification
  auth:
    # Méthodes supportées (peuvent être combinées)
    methods:
      - type: "api_key"
        header: "X-API-Key"
        keys:
          - ${API_KEY_1}
          - ${API_KEY_2}
      - type: "jwt"
        secret: ${JWT_SECRET}
        algorithm: "HS256"
      - type: "nostr_signature"
        # Vérifie que le body est signé par une npub whitelistée
        enabled: true
  
  # Rate limiting
  rate_limit:
    enabled: true
    window_ms: 60000        # 1 minute
    max_requests: 100       # 100 req/min (ajustable)

# Base de données
database:
  path: "/var/lib/pipelinostr/pipelinostr.db"
  # OU pour install user: "~/.pipelinostr/data/pipelinostr.db"

# Logging
logging:
  level: "info"  # debug, info, warn, error
  
  # Fichiers de log séparés
  files:
    general: "/var/log/pipelinostr/general.log"
    events: "/var/log/pipelinostr/events.log"      # Events entrants/sortants
    workflows: "/var/log/pipelinostr/workflows.log" # Exécution workflows
    relays: "/var/log/pipelinostr/relays.log"      # Gestion relays
  
  # Rotation
  rotation:
    max_size: "10M"
    max_files: 5

# Retry global (peut être overridé par workflow)
retry:
  max_attempts: 5
  backoff:
    type: "exponential"
    initial_delay_ms: 1000    # 1s
    multiplier: 2             # 1s, 2s, 4s, 8s, 16s
    max_delay_ms: 60000       # Cap à 1 minute
```

### 5.3 Fichier secrets : `.env`

```bash
# .env - SECRETS UNIQUEMENT
NOSTR_PRIVATE_KEY=nsec1...

# API
API_KEY_1=sk_live_xxxxx
API_KEY_2=sk_live_yyyyy
JWT_SECRET=your-jwt-secret-here

# Handlers
SMTP_PASSWORD=xxxxx
TELEGRAM_BOT_TOKEN=123456:ABC-xxx
WHATSAPP_SESSION_SECRET=xxxxx
SIGNAL_USERNAME=+33612345678
X_TWITTER_API_KEY=xxxxx
X_TWITTER_API_SECRET=xxxxx
X_TWITTER_ACCESS_TOKEN=xxxxx
X_TWITTER_ACCESS_SECRET=xxxxx
FTP_PASSWORD=xxxxx
```

### 5.4 Config handler : exemple `handlers/email.yml`

```yaml
# handlers/email.yml
email:
  enabled: true
  
  # SMTP sortant
  smtp:
    host: "smtp.example.com"
    port: 587
    secure: false  # true pour 465
    auth:
      user: "bot@example.com"
      pass: ${SMTP_PASSWORD}
    
    # Expéditeur par défaut
    from:
      name: "PipeliNostr Bot"
      address: "bot@example.com"
  
  # IMAP entrant (futur)
  imap:
    enabled: false
    host: "imap.example.com"
    port: 993
    auth:
      user: "bot@example.com"
      pass: ${SMTP_PASSWORD}
    poll_interval: "60s"
```

---

## 6. Workflows

### 6.1 Structure d'un workflow

```yaml
# workflows/email-forward.yml
id: "email-forward"
name: "Forward DM to Email"
description: "Transfère un DM Nostr vers une adresse email"
enabled: true

# Déclencheur
trigger:
  type: "nostr_event"
  
  # Filtres sur l'event Nostr
  filters:
    # Types d'events (kinds)
    kinds:
      - 4       # NIP-04 DM (encrypted)
      - 1059    # NIP-44 Gift Wrap
    
    # Restriction aux npubs whitelistées (défaut: true)
    from_whitelist: true
    
    # OU npubs spécifiques pour ce workflow
    # from_npubs:
    #   - "npub1specific..."
    
    # Pattern regex sur le contenu déchiffré
    content_pattern: "^email:\\s*(?<to>[^|]+)\\|(?<subject>[^|]+)\\|(?<body>.+)$"
    
    # OU pattern simple (startsWith)
    # content_starts_with: "email:"

# Variables extraites (disponibles dans les actions)
# - trigger.event      : Event Nostr complet
# - trigger.from       : npub de l'expéditeur
# - trigger.content    : Contenu déchiffré
# - trigger.timestamp  : Timestamp de l'event
# - match.*            : Groupes capturés par le regex

# Actions à exécuter (séquentielles)
actions:
  - id: "send-email"
    type: "email"
    config:
      to: "{{ match.to | trim }}"
      subject: "{{ match.subject | trim }}"
      body: |
        Message transféré depuis Nostr:
        
        {{ match.body }}
        
        ---
        De: {{ trigger.from }}
        Date: {{ trigger.timestamp | date:"YYYY-MM-DD HH:mm" }}
    
    # Retry spécifique (optionnel, sinon utilise global)
    retry:
      max_attempts: 3
  
  - id: "confirm-dm"
    type: "nostr_dm"
    config:
      to: "{{ trigger.from }}"
      content: "✅ Email envoyé à {{ match.to }}"
    
    # Condition d'exécution (optionnel)
    when: "{{ actions.send-email.status == 'success' }}"

  - id: "error-dm"
    type: "nostr_dm"
    config:
      to: "{{ trigger.from }}"
      content: "❌ Échec envoi email: {{ actions.send-email.error }}"
    when: "{{ actions.send-email.status == 'fail' }}"
```

### 6.2 Autres exemples de workflows

#### API Call

```yaml
# workflows/api-webhook.yml
id: "api-webhook"
name: "Trigger API Webhook"
enabled: true

trigger:
  type: "nostr_event"
  filters:
    kinds: [4, 1059]
    content_pattern: "^api:\\s*(?<method>GET|POST|PUT|DELETE)\\s+(?<url>https?://\\S+)(?:\\s+(?<body>.+))?$"

actions:
  - id: "call-api"
    type: "http"
    config:
      method: "{{ match.method }}"
      url: "{{ match.url }}"
      headers:
        Content-Type: "application/json"
      body: "{{ match.body | default:'{}' }}"
      timeout_ms: 30000

  - id: "respond"
    type: "nostr_dm"
    config:
      to: "{{ trigger.from }}"
      content: "API {{ match.method }} {{ match.url }}\nStatus: {{ actions.call-api.response.status }}\nBody: {{ actions.call-api.response.body | truncate:500 }}"
```

#### Publication X/Twitter

```yaml
# workflows/tweet.yml
id: "tweet"
name: "Post to X/Twitter"
enabled: true

trigger:
  type: "nostr_event"
  filters:
    kinds: [4, 1059]
    content_pattern: "^tweet:\\s*(?<text>.+)$"

actions:
  - id: "post-tweet"
    type: "x_twitter"
    config:
      action: "tweet"
      text: "{{ match.text }}"

  - id: "confirm"
    type: "nostr_dm"
    config:
      to: "{{ trigger.from }}"
      content: "✅ Tweet publié: {{ actions.post-tweet.response.url }}"
```

#### Note publique Nostr

```yaml
# workflows/nostr-public.yml
id: "nostr-public"
name: "Post Public Note"
enabled: true

trigger:
  type: "nostr_event"
  filters:
    kinds: [4, 1059]
    content_pattern: "^note:\\s*(?<content>.+)$"

actions:
  - id: "post-note"
    type: "nostr_note"
    config:
      kind: 1  # Short text note
      content: "{{ match.content }}"
      tags:
        - ["client", "PipeliNostr"]

  - id: "confirm"
    type: "nostr_dm"
    config:
      to: "{{ trigger.from }}"
      content: "✅ Note publiée: nostr:{{ actions.post-note.event_id }}"
```

#### Workflow déclenché par API entrante

```yaml
# workflows/api-to-nostr.yml
id: "api-to-nostr"
name: "API Webhook to Nostr DM"
enabled: true

trigger:
  type: "http_webhook"
  config:
    path: "/webhook/notify"
    method: "POST"
    # Validation du body (JSON Schema)
    body_schema:
      type: "object"
      required: ["npub", "message"]
      properties:
        npub:
          type: "string"
          pattern: "^npub1[a-z0-9]{58}$"
        message:
          type: "string"
          maxLength: 1000

actions:
  - id: "send-dm"
    type: "nostr_dm"
    config:
      to: "{{ trigger.body.npub }}"
      content: "{{ trigger.body.message }}"

  - id: "respond"
    type: "http_response"
    config:
      status: 200
      body:
        success: true
        event_id: "{{ actions.send-dm.event_id }}"
```

---

## 7. Persistance

### 7.1 Schéma base de données (SQLite)

```sql
-- Table principale : log de tous les events traités
CREATE TABLE event_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    
    -- Timestamps
    received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    workflow_matched_at DATETIME,
    workflow_started_at DATETIME,
    workflow_completed_at DATETIME,
    
    -- Source
    source_type TEXT NOT NULL,  -- 'nostr_dm', 'nostr_event', 'api', 'email', 'telegram', 'whatsapp', 'signal'
    source_identifier TEXT,      -- npub, email, phone, api_key_id
    source_raw TEXT,             -- Event/message brut (JSON)
    
    -- Workflow
    workflow_id TEXT,
    workflow_name TEXT,
    
    -- Statut
    status TEXT NOT NULL DEFAULT 'received',  -- 'received', 'matched', 'processing', 'success', 'success_with_retry', 'pending_with_retry', 'fail_after_retries', 'no_match'
    retry_count INTEGER DEFAULT 0,
    error_message TEXT,
    
    -- Sortie
    target_type TEXT,            -- 'email', 'telegram', 'nostr_dm', 'http', etc.
    target_identifier TEXT,      -- Destinataire
    target_response TEXT,        -- Réponse/accusé (JSON)
    
    -- Index
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_event_log_received_at ON event_log(received_at);
CREATE INDEX idx_event_log_source ON event_log(source_type, source_identifier);
CREATE INDEX idx_event_log_workflow ON event_log(workflow_id);
CREATE INDEX idx_event_log_status ON event_log(status);

-- Table état des relays
CREATE TABLE relay_state (
    url TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'active',  -- 'active', 'quarantined', 'abandoned'
    
    consecutive_failures INTEGER DEFAULT 0,
    last_success_at DATETIME,
    last_failure_at DATETIME,
    last_failure_reason TEXT,
    
    quarantine_until DATETIME,
    quarantine_level INTEGER DEFAULT 0,
    
    total_events_received INTEGER DEFAULT 0,
    total_events_sent INTEGER DEFAULT 0,
    
    discovered_from TEXT,        -- 'config', 'discovery', 'event'
    first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Table exécutions de workflows (détail)
CREATE TABLE workflow_execution (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_log_id INTEGER REFERENCES event_log(id),
    
    workflow_id TEXT NOT NULL,
    action_id TEXT NOT NULL,
    action_type TEXT NOT NULL,
    
    started_at DATETIME NOT NULL,
    completed_at DATETIME,
    
    status TEXT NOT NULL,  -- 'pending', 'running', 'success', 'failed', 'skipped'
    attempt_number INTEGER DEFAULT 1,
    
    input_data TEXT,       -- JSON
    output_data TEXT,      -- JSON
    error_message TEXT,
    
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_workflow_execution_event ON workflow_execution(event_log_id);
CREATE INDEX idx_workflow_execution_workflow ON workflow_execution(workflow_id);
```

### 7.2 Fichiers de logs

| Fichier | Contenu |
|---------|---------|
| `general.log` | Démarrage, arrêt, erreurs système |
| `events.log` | Events entrants/sortants (JSON lines) |
| `workflows.log` | Exécution des workflows, actions, erreurs |
| `relays.log` | Connexions, déconnexions, quarantaines |

Format : JSON Lines pour parsing facile

```json
{"ts":"2025-01-09T12:00:00Z","level":"info","module":"relay","msg":"Connected","relay":"wss://relay.damus.io"}
{"ts":"2025-01-09T12:00:01Z","level":"info","module":"event","msg":"Received DM","from":"npub1...","kind":4}
```

---

## 8. Gestion des relays

### 8.1 Logique de quarantaine

```
Échec #1  → Quarantaine 15 minutes
Échec #2  → Quarantaine 2 heures
Échec #3  → Quarantaine 6 heures
Échec #4  → Quarantaine 24 heures
Échec #5  → Quarantaine 2 jours
Échec #6  → Quarantaine 4 jours
Échec #7  → Quarantaine 1 semaine
Échec #8  → Quarantaine 2 semaines
Échec #9+ → Blacklist avec health check mensuel
           → Abandon définitif après 6 mois d'échecs
```

### 8.2 Health check

- Connexion WebSocket test
- Envoi d'un REQ simple
- Timeout : 10 secondes
- Un succès reset le compteur d'échecs

---

## 9. Retry & Error Handling

### 9.1 Stratégie de retry

```typescript
interface RetryConfig {
  maxAttempts: 5;
  backoff: {
    type: 'exponential';
    initialDelayMs: 1000;   // 1s
    multiplier: 2;          // x2 à chaque retry
    maxDelayMs: 60000;      // Cap 1 minute
  };
}

// Délais: 1s → 2s → 4s → 8s → 16s
```

### 9.2 Statuts d'exécution

| Statut | Description |
|--------|-------------|
| `success` | Succès du premier coup |
| `success_with_retry` | Succès après 1-2 échecs |
| `pending_with_retry` | 3+ échecs, retry en cours |
| `fail_after_retries` | Échec après 5 tentatives |

---

## 10. API Entrante

### 10.1 Endpoints

```
POST /api/v1/send
  → Envoie un message Nostr (DM ou note)
  
POST /api/v1/webhook/:workflow_id
  → Déclenche un workflow spécifique
  
GET  /api/v1/status
  → Statut du service (health check)
  
GET  /api/v1/relays
  → Liste des relays et leur état
  
GET  /api/v1/logs?limit=100&offset=0
  → Derniers events traités (futur: filtres)
```

### 10.2 Authentification

Trois méthodes supportées (configurables) :

1. **API Key** : Header `X-API-Key: sk_xxx`
2. **JWT** : Header `Authorization: Bearer xxx`
3. **Signature Nostr** : Body signé par npub whitelistée

### 10.3 Rate Limiting

- Fenêtre : 1 minute
- Max requests : 100 (configurable)
- Header `X-RateLimit-Remaining` dans les réponses

---

## 11. Déploiement

### 11.1 Script d'installation

```bash
curl -fsSL https://raw.githubusercontent.com/xxx/pipelinostr/main/install.sh | bash
```

Le script :
1. Vérifie les prérequis (Node.js 20+)
2. Installe Node.js si absent (via nvm ou package manager)
3. Clone le repo ou télécharge la release
4. Installe les dépendances (`npm ci --production`)
5. Crée la structure de config dans `~/.pipelinostr/` ou `/etc/pipelinostr/`
6. Génère les fichiers de config avec valeurs par défaut
7. Crée le service systemd
8. Affiche les instructions de configuration

### 11.2 Service systemd

```ini
# /etc/systemd/system/pipelinostr.service
[Unit]
Description=PipeliNostr - Nostr Event Router
After=network.target

[Service]
Type=simple
User=pipelinostr
Group=pipelinostr
WorkingDirectory=/opt/pipelinostr
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10

# Environnement
Environment=NODE_ENV=production
EnvironmentFile=/etc/pipelinostr/.env

# Sécurité
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/pipelinostr /var/log/pipelinostr

[Install]
WantedBy=multi-user.target
```

### 11.3 Commandes

```bash
# Démarrage
sudo systemctl start pipelinostr

# Arrêt
sudo systemctl stop pipelinostr

# Logs temps réel
sudo journalctl -u pipelinostr -f

# Recharger config (sans restart)
sudo systemctl reload pipelinostr  # SIGHUP → hot reload workflows
```

---

## 12. Roadmap

### Phase 1 : MVP (Prototype)

- [ ] Core : Config loader (YAML + .env)
- [ ] Core : Nostr listener (NIP-04 DM)
- [ ] Core : Workflow engine basique (regex matching, templating)
- [ ] Core : SQLite persistence
- [ ] Handler : Email (SMTP sortant)
- [ ] Handler : Nostr (DM + Note sortants)
- [ ] Handler : HTTP (API calls)
- [ ] Relay : Multi-relay basique
- [ ] Relay : Quarantaine
- [ ] Deploy : Script install + systemd

### Phase 2 : Handlers complets

- [ ] Handler : Telegram
- [ ] Handler : WhatsApp (via API Business ou whatsapp-web.js)
- [ ] Handler : Signal (via signal-cli)
- [ ] Handler : X/Twitter
- [ ] Handler : FTP
- [ ] Inbound : API Server avec auth

### Phase 3 : Hardware & Avancé

- [ ] Handler : GPIO (Raspberry Pi)
- [ ] Handler : Serial/RS232
- [ ] Handler : USB devices
- [ ] Inbound : Email (IMAP)
- [ ] Inbound : Telegram/WhatsApp/Signal → Nostr

### Phase 4 : Administration

- [ ] Web UI : Dashboard logs/stats
- [ ] Web UI : Éditeur de workflows
- [ ] Web UI : Gestion relays
- [ ] LLM : Assistant création workflows
- [ ] NIP-44 : Support chiffrement moderne

---

## 13. Ressources

### Documentation Nostr

- [NIPs Repository](https://github.com/nostr-protocol/nips)
- [NIP-01 : Basic Protocol](https://github.com/nostr-protocol/nips/blob/master/01.md)
- [NIP-04 : Encrypted DM](https://github.com/nostr-protocol/nips/blob/master/04.md)
- [NIP-44 : Versioned Encryption](https://github.com/nostr-protocol/nips/blob/master/44.md)
- [nostr-tools](https://github.com/nbd-wtf/nostr-tools)

### Libs principales

- [nostr-tools (npm)](https://www.npmjs.com/package/nostr-tools)
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- [nodemailer](https://nodemailer.com/)
- [telegraf](https://telegraf.js.org/)

---

*Document généré le 2025-01-09 - PipeliNostr v0.1.0*
