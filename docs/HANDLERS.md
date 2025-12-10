# PipeliNostr - Guide de Configuration des Handlers

Ce document détaille la configuration de tous les handlers disponibles dans PipeliNostr.

## Table des matières

### Handlers Entrants (Inbound)
- [Webhook Server](#webhook-server) - Recevoir des requêtes HTTP
- [API Poller](#api-poller) - Polling périodique d'APIs
- [Scheduler](#scheduler) - Tâches planifiées (cron)

### Handlers Sortants (Outbound)
1. [Handlers Nostr](#handlers-nostr)
   - [Nostr DM](#nostr-dm)
   - [Nostr Note](#nostr-note)
2. [Handlers Messaging](#handlers-messaging)
   - [Email (SMTP)](#email-smtp)
   - [Telegram](#telegram)
   - [Slack](#slack)
   - [Discord](#discord)
   - [WhatsApp](#whatsapp)
   - [Signal](#signal)
   - [Zulip](#zulip)
   - [Matrix](#matrix)
3. [Handlers Réseaux Sociaux](#handlers-réseaux-sociaux)
   - [Twitter/X](#twitterx)
   - [Mastodon](#mastodon)
   - [Bluesky](#bluesky)
   - [Lemmy](#lemmy)
4. [Handlers HTTP/API](#handlers-httpapi)
   - [HTTP (Webhook)](#http-webhook)
   - [ntfy](#ntfy)
5. [Handlers Fichiers](#handlers-fichiers)
   - [File](#file)
   - [FTP](#ftp)
   - [SFTP](#sftp)
6. [Handlers Cloud Storage](#handlers-cloud-storage)
   - [S3 (Compatible)](#s3-compatible)
7. [Handlers Base de données](#handlers-base-de-données)
   - [MongoDB](#mongodb)
   - [MySQL](#mysql)
   - [PostgreSQL](#postgresql)
   - [Redis](#redis)
8. [Handlers DevOps](#handlers-devops)
   - [GitHub](#github)
   - [GitLab](#gitlab)
9. [Handlers Hardware/IoT](#handlers-hardwareiot)
   - [Serial (RS232/USB)](#serial-rs232usb)
   - [GPIO](#gpio)
   - [MQTT](#mqtt)
   - [Bluetooth LE](#bluetooth-le)
   - [USB HID](#usb-hid)
   - [I2C](#i2c)

---

## Handlers Entrants (Inbound)

Les handlers entrants permettent de déclencher des workflows depuis des sources externes autres que Nostr.

### Webhook Server

Serveur HTTP pour recevoir des webhooks et déclencher des workflows.

**Fichier de config** : `config/handlers/webhook.yml`

```yaml
webhook:
  enabled: true
  port: 3000
  host: "0.0.0.0"
  max_body_size: 1048576  # 1MB

  cors:
    enabled: true
    origins: ["*"]

  webhooks:
    - id: "github"
      path: "/webhook/github"
      methods: ["POST"]
      secret: ${WEBHOOK_GITHUB_SECRET}
      description: "GitHub webhook"

    - id: "generic"
      path: "/webhook"
      methods: ["POST"]
```

**Variables d'environnement** :
```bash
WEBHOOK_GITHUB_SECRET=your-secret-here
```

**Exemple d'utilisation** :

```bash
# Envoyer un webhook
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello from webhook"}'
```

**Authentification supportée** :
- Header `X-Webhook-Secret`
- Header `Authorization: Bearer <token>`
- GitHub signature `X-Hub-Signature-256`

**Workflow pour webhook** :

```yaml
name: "Process Webhook"
enabled: true
trigger:
  source: webhook  # Filtre sur source
  # ou
  kinds: [20000]   # Kind 20000 = webhook

actions:
  - type: telegram
    params:
      text: "Webhook reçu: {{content}}"
```

---

### API Poller

Interroge périodiquement des APIs externes et déclenche des workflows.

**Fichier de config** : `config/handlers/api-poller.yml`

```yaml
api_poller:
  enabled: true
  default_timeout: 30000

  pollers:
    - id: "status_check"
      name: "Status API"
      url: "https://api.example.com/status"
      method: "GET"
      interval: 60000  # 60 secondes
      headers:
        Authorization: "Bearer ${API_TOKEN}"
      response_type: "json"
      change_detection:
        enabled: true
        mode: "hash"  # Déclenche seulement si le contenu change

    - id: "data_feed"
      name: "Data Feed"
      url: "https://api.example.com/feed"
      interval: 30000
      change_detection:
        mode: "json_path"
        json_path: "$.data.items[*].id"
```

**Modes de détection de changement** :
| Mode | Description |
|------|-------------|
| `hash` | Hash du contenu complet |
| `json_path` | Hash d'un chemin JSON spécifique |
| `status` | Toujours déclencher |

**Variables d'environnement** :
```bash
API_TOKEN=your-api-token
```

**Workflow pour poller** :

```yaml
name: "API Change Detected"
enabled: true
trigger:
  source: api_poller
  # ou
  kinds: [20001]  # Kind 20001 = api_poller

conditions:
  - field: "$.hasChanged"
    operator: "equals"
    value: true

actions:
  - type: slack
    params:
      text: "API data changed: {{content}}"
```

---

### Scheduler

Planification de tâches avec expressions cron.

**Fichier de config** : `config/handlers/scheduler.yml`

```yaml
scheduler:
  enabled: true
  timezone: "Europe/Paris"

  schedules:
    - id: "every_5min"
      name: "Every 5 Minutes"
      cron: "*/5 * * * *"
      enabled: true
      payload:
        task: "health_check"

    - id: "daily_report"
      name: "Daily Report"
      cron: "0 9 * * *"
      payload:
        task: "generate_report"

    - id: "weekly_backup"
      name: "Weekly Backup"
      cron: "0 2 * * 0"
      payload:
        task: "backup"
```

**Syntaxe Cron** :
```
┌───────────── minute (0 - 59)
│ ┌───────────── heure (0 - 23)
│ │ ┌───────────── jour du mois (1 - 31)
│ │ │ ┌───────────── mois (1 - 12)
│ │ │ │ ┌───────────── jour de la semaine (0 - 6) (Dimanche=0)
│ │ │ │ │
* * * * *
```

**Exemples d'expressions cron** :
| Expression | Description |
|------------|-------------|
| `*/15 * * * *` | Toutes les 15 minutes |
| `0 * * * *` | Toutes les heures |
| `0 0 * * *` | Tous les jours à minuit |
| `0 9 * * 1-5` | 9h du lundi au vendredi |
| `0 0 1 * *` | Premier jour de chaque mois |
| `0 0 * * 0` | Tous les dimanches à minuit |

**Workflow pour schedule** :

```yaml
name: "Scheduled Task"
enabled: true
trigger:
  source: scheduler
  # ou
  kinds: [20002]  # Kind 20002 = scheduler

conditions:
  - field: "$.payload.task"
    operator: "equals"
    value: "health_check"

actions:
  - type: http
    params:
      url: "https://api.example.com/health"
      method: "GET"
```

---

## Handlers Sortants (Outbound)

## Handlers Nostr

### Nostr DM

Envoie un message privé (DM) chiffré via Nostr.

**Configuration** : Utilise la clé privée principale de PipeliNostr.

**Exemple de workflow** :

```yaml
actions:
  - type: nostr_dm
    params:
      recipient: "npub1..."  # ou hex pubkey
      message: "Nouveau message reçu: {{content}}"
```

**Paramètres** :
| Param | Type | Requis | Description |
|-------|------|--------|-------------|
| `recipient` | string | Oui | npub ou pubkey hex du destinataire |
| `message` | string | Oui | Contenu du message |

---

### Nostr Note

Publie une note publique (kind 1) sur les relays Nostr.

**Configuration** : Utilise la clé privée principale de PipeliNostr.

**Exemple de workflow** :

```yaml
actions:
  - type: nostr_note
    params:
      content: "Nouvel événement détecté: {{content}}"
      tags:
        - ["t", "notification"]
        - ["p", "{{pubkey}}"]
```

**Paramètres** :
| Param | Type | Requis | Description |
|-------|------|--------|-------------|
| `content` | string | Oui | Contenu de la note |
| `tags` | array | Non | Tags Nostr additionnels |

---

## Handlers Messaging

### Email (SMTP)

Envoie des emails via SMTP.

**Fichier de config** : `config/handlers/email.yml`

```yaml
email:
  enabled: true
  smtp:
    host: "smtp.gmail.com"
    port: 587
    secure: false  # true pour port 465
    auth:
      user: "your-email@gmail.com"
      pass: ${SMTP_PASSWORD}  # Variable d'environnement
  from:
    name: "PipeliNostr"
    address: "your-email@gmail.com"
```

**Variables d'environnement** (`.env`) :
```bash
SMTP_PASSWORD=votre-mot-de-passe-application
```

**Exemple de workflow** :

```yaml
actions:
  - type: email
    params:
      to: "destinataire@example.com"
      subject: "Nouveau message Nostr"
      body: |
        Vous avez reçu un nouveau message:

        De: {{pubkey}}
        Contenu: {{content}}
      html: "<h1>Nouveau message</h1><p>{{content}}</p>"  # Optionnel
      cc: "copie@example.com"  # Optionnel
      bcc: "copie-cachee@example.com"  # Optionnel
```

**Configuration Gmail** :
1. Activer la validation en deux étapes
2. Créer un "Mot de passe d'application" dans les paramètres Google
3. Utiliser ce mot de passe dans `SMTP_PASSWORD`

---

### Telegram

Envoie des messages via un bot Telegram.

**Fichier de config** : `config/handlers/telegram.yml`

```yaml
telegram:
  enabled: true
  bot_token: ${TELEGRAM_BOT_TOKEN}
  default_chat_id: "-1001234567890"  # Optionnel
```

**Variables d'environnement** :
```bash
TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
```

**Création du bot** :
1. Parler à [@BotFather](https://t.me/BotFather) sur Telegram
2. Envoyer `/newbot` et suivre les instructions
3. Copier le token fourni

**Obtenir le Chat ID** :
- Groupe : Ajouter le bot au groupe, envoyer un message, puis visiter `https://api.telegram.org/bot<TOKEN>/getUpdates`
- Utilisateur : Parler au bot [@userinfobot](https://t.me/userinfobot)

**Exemple de workflow** :

```yaml
actions:
  - type: telegram
    params:
      chat_id: "-1001234567890"  # Ou utilisez default_chat_id
      text: "🔔 Nouveau message de {{pubkey}}: {{content}}"
      parse_mode: "HTML"  # ou "Markdown"
      disable_notification: false
```

---

### Slack

Envoie des messages à Slack via Webhook ou Bot API.

**Fichier de config** : `config/handlers/slack.yml`

```yaml
slack:
  enabled: true
  # Option 1: Webhook (plus simple)
  webhook_url: ${SLACK_WEBHOOK_URL}
  # Option 2: Bot Token (plus de fonctionnalités)
  bot_token: ${SLACK_BOT_TOKEN}
  default_channel: "#notifications"
```

**Variables d'environnement** :
```bash
# Option 1: Webhook
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXX

# Option 2: Bot
SLACK_BOT_TOKEN=xoxb-xxxx-xxxx-xxxx
```

**Configuration Webhook** :
1. Aller sur [api.slack.com/apps](https://api.slack.com/apps)
2. Créer une nouvelle app > "Incoming Webhooks"
3. Activer et ajouter le webhook au channel souhaité

**Exemple de workflow** :

```yaml
actions:
  - type: slack
    params:
      channel: "#alerts"  # Optionnel si default_channel défini
      text: "Nouvel événement Nostr reçu"
      blocks:  # Optionnel, pour rich formatting
        - type: section
          text:
            type: mrkdwn
            text: "*De:* {{pubkey}}\n*Message:* {{content}}"
```

---

### Discord

Envoie des messages à Discord via Webhook ou Bot API.

**Fichier de config** : `config/handlers/discord.yml`

```yaml
discord:
  enabled: true
  # Option 1: Webhook (recommandé)
  webhook_url: ${DISCORD_WEBHOOK_URL}
  # Option 2: Bot
  bot_token: ${DISCORD_BOT_TOKEN}
  default_channel_id: "123456789012345678"
```

**Variables d'environnement** :
```bash
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/xxx/yyy
DISCORD_BOT_TOKEN=xxx.yyy.zzz
```

**Configuration Webhook** :
1. Paramètres du serveur > Intégrations > Webhooks
2. Créer un webhook et copier l'URL

**Exemple de workflow** :

```yaml
actions:
  - type: discord
    params:
      content: "Nouveau message Nostr!"
      username: "PipeliNostr"  # Optionnel
      avatar_url: "https://example.com/avatar.png"  # Optionnel
      embeds:  # Optionnel, pour rich content
        - title: "Nouveau message"
          description: "{{content}}"
          color: 3447003  # Bleu
          fields:
            - name: "De"
              value: "{{pubkey}}"
              inline: true
```

---

### WhatsApp

Envoie des messages via WhatsApp Web.

> ⚠️ **Note** : Nécessite une session authentifiée par QR code. Le daemon démarre uniquement si un workflow l'utilise.

**Fichier de config** : `config/handlers/whatsapp.yml`

```yaml
whatsapp:
  enabled: true
  session_dir: "./data/whatsapp-session"
  headless: true
  puppeteer_args:
    - "--no-sandbox"
    - "--disable-setuid-sandbox"
```

**Première connexion** :
1. Démarrer PipeliNostr avec un workflow utilisant WhatsApp
2. Scanner le QR code affiché dans la console avec WhatsApp mobile
3. La session est persistée pour les prochains démarrages

**Exemple de workflow** :

```yaml
actions:
  - type: whatsapp
    params:
      phone: "33612345678"  # Numéro sans +
      # ou
      group_id: "123456789-987654321@g.us"
      message: "Nouveau message: {{content}}"
```

---

### Signal

Envoie des messages via Signal.

> ⚠️ **Note** : Nécessite `signal-cli` installé et un numéro enregistré.

**Fichier de config** : `config/handlers/signal.yml`

```yaml
signal:
  enabled: true
  phone_number: ${SIGNAL_PHONE_NUMBER}
  signal_cli_bin: "signal-cli"  # ou chemin complet
  config_dir: "./data/signal"
```

**Variables d'environnement** :
```bash
SIGNAL_PHONE_NUMBER=+33612345678
```

**Installation signal-cli** :
```bash
# Linux/macOS
brew install signal-cli  # ou depuis les releases GitHub

# Enregistrement du numéro
signal-cli -u +33612345678 register
signal-cli -u +33612345678 verify CODE_RECU
```

**Exemple de workflow** :

```yaml
actions:
  - type: signal
    params:
      recipient: "+33698765432"
      # ou
      group_id: "base64groupid=="
      message: "Notification: {{content}}"
```

---

### Zulip

Envoie des messages à un serveur Zulip.

**Fichier de config** : `config/handlers/zulip.yml`

```yaml
zulip:
  enabled: true
  site_url: "https://yourorg.zulipchat.com"
  email: "bot-email@yourorg.zulipchat.com"
  api_key: ${ZULIP_API_KEY}
  default_stream: "general"
  default_topic: "Notifications"
```

**Variables d'environnement** :
```bash
ZULIP_API_KEY=votre-api-key
```

**Création du bot** :
1. Settings > Personal settings > Bots
2. "Add a new bot" > Generic bot
3. Copier l'email et l'API key

**Exemple de workflow** :

```yaml
actions:
  - type: zulip
    params:
      stream: "alerts"
      topic: "Nostr Events"
      content: "Nouveau message de {{pubkey}}"
```

---

### Matrix

Envoie des messages à des rooms Matrix.

**Fichier de config** : `config/handlers/matrix.yml`

```yaml
matrix:
  enabled: true
  homeserver_url: "https://matrix.org"
  access_token: ${MATRIX_ACCESS_TOKEN}
  default_room_id: "!abc123:matrix.org"  # Optionnel
```

**Variables d'environnement** :
```bash
MATRIX_ACCESS_TOKEN=syt_xxxxx
```

**Obtenir un access token** :
1. Créer un compte Matrix (matrix.org ou autre)
2. Se connecter via Element
3. Settings > Help & About > Access Token

**Exemple de workflow** :

```yaml
actions:
  - type: matrix
    params:
      room_id: "!roomid:matrix.org"
      body: "Nouveau message: {{content}}"
      msgtype: "m.text"  # ou m.notice
```

---

## Handlers Réseaux Sociaux

### Twitter/X

Publie des tweets sur Twitter/X.

**Fichier de config** : `config/handlers/twitter.yml`

```yaml
twitter:
  enabled: true
  api_key: ${TWITTER_API_KEY}
  api_secret: ${TWITTER_API_SECRET}
  access_token: ${TWITTER_ACCESS_TOKEN}
  access_token_secret: ${TWITTER_ACCESS_TOKEN_SECRET}
```

**Variables d'environnement** :
```bash
TWITTER_API_KEY=xxxxx
TWITTER_API_SECRET=xxxxx
TWITTER_ACCESS_TOKEN=xxxxx
TWITTER_ACCESS_TOKEN_SECRET=xxxxx
```

**Obtenir les credentials** :
1. [Developer Portal](https://developer.twitter.com/en/portal/dashboard)
2. Créer un projet et une app
3. Générer les tokens OAuth 1.0a
4. S'assurer que l'app a les permissions "Read and Write"

> ⚠️ Rate limit : 50 tweets/24h pour le tier gratuit

**Exemple de workflow** :

```yaml
actions:
  - type: twitter
    params:
      text: "{{content}}"
      reply_to: "1234567890"  # Optionnel, pour répondre
```

---

### Mastodon

Publie des statuts sur Mastodon (et autres serveurs ActivityPub compatibles).

**Fichier de config** : `config/handlers/mastodon.yml`

```yaml
mastodon:
  enabled: true
  instance_url: "https://mastodon.social"
  access_token: ${MASTODON_ACCESS_TOKEN}
```

**Variables d'environnement** :
```bash
MASTODON_ACCESS_TOKEN=xxxxx
```

**Obtenir un access token** :
1. Preferences > Development > New Application
2. Scopes requis : `write:statuses`
3. Copier "Your access token"

**Compatible avec** : Mastodon, Pleroma, Misskey, et autres serveurs ActivityPub

**Exemple de workflow** :

```yaml
actions:
  - type: mastodon
    params:
      status: "{{content}}"
      visibility: "public"  # public, unlisted, private, direct
      sensitive: false
      spoiler_text: ""  # Content warning
```

---

### Bluesky

Publie des posts sur Bluesky (protocole AT).

**Fichier de config** : `config/handlers/bluesky.yml`

```yaml
bluesky:
  enabled: true
  service: "https://bsky.social"  # ou autre PDS
  identifier: "your-handle.bsky.social"
  password: ${BLUESKY_APP_PASSWORD}  # App Password recommandé
```

**Variables d'environnement** :
```bash
BLUESKY_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx
```

**Obtenir un App Password** :
1. Aller sur [bsky.app](https://bsky.app)
2. Settings > App Passwords
3. "Add App Password" et copier le mot de passe généré

**Exemple de workflow** :

```yaml
actions:
  # Post simple
  - type: bluesky
    params:
      text: "{{content}}"

  # Post avec liens/mentions détectés automatiquement
  - type: bluesky
    params:
      text: "Check out @someone.bsky.social and https://example.com #nostr"
      # Les facets (mentions, liens, hashtags) sont détectés automatiquement

  # Répondre à un post
  - type: bluesky
    params:
      text: "Ma réponse"
      reply_to: "at://did:plc:xxx/app.bsky.feed.post/yyy"

  # Quote post
  - type: bluesky
    params:
      text: "Intéressant!"
      quote: "at://did:plc:xxx/app.bsky.feed.post/yyy"

  # Désactiver la détection auto des facets
  - type: bluesky
    params:
      text: "Texte brut sans formatage"
      facets: false
```

**Paramètres** :
| Param | Type | Requis | Description |
|-------|------|--------|-------------|
| `text` | string | Oui | Contenu du post (max 300 caractères) |
| `reply_to` | string | Non | URI AT du post parent pour répondre |
| `quote` | string | Non | URI AT du post à citer |
| `facets` | boolean | Non | Activer la détection auto (défaut: true) |

---

### Lemmy

Publie des posts et commentaires sur Lemmy (Reddit décentralisé, Fediverse).

**Fichier de config** : `config/handlers/lemmy.yml`

```yaml
lemmy:
  enabled: true
  instance_url: "https://lemmy.world"
  username: "your_username"
  password: ${LEMMY_PASSWORD}
  default_community: "nostr"  # Optionnel
```

**Variables d'environnement** :
```bash
LEMMY_PASSWORD=xxxxx
```

**Instances Lemmy populaires** :
- `https://lemmy.world` - Généraliste, grande communauté
- `https://lemmy.ml` - Instance officielle Lemmy
- `https://sh.itjust.works` - Généraliste
- `https://programming.dev` - Tech et développement

**Exemple de workflow** :

```yaml
actions:
  # Créer un post
  - type: lemmy
    params:
      action: post
      community: "nostr"  # ou "nostr@lemmy.world" pour fédéré
      title: "Nouveau message Nostr"
      body: "{{content}}"
      nsfw: false

  # Post avec lien externe
  - type: lemmy
    params:
      action: post
      community: "technology"
      title: "Article intéressant"
      url: "https://example.com/article"
      body: "Mon résumé: {{content}}"

  # Commenter un post
  - type: lemmy
    params:
      action: comment
      post_id: 12345
      body: "{{content}}"

  # Répondre à un commentaire
  - type: lemmy
    params:
      action: comment
      post_id: 12345
      parent_id: 67890
      body: "Ma réponse"
```

**Paramètres pour les posts** :
| Param | Type | Requis | Description |
|-------|------|--------|-------------|
| `action` | string | Non | `post` (défaut) ou `comment` |
| `community` | string | Oui | Nom de la communauté |
| `title` | string | Oui | Titre du post |
| `body` | string | Non | Corps du message (Markdown) |
| `url` | string | Non | Lien externe |
| `nsfw` | boolean | Non | Marquer comme NSFW |

**Paramètres pour les commentaires** :
| Param | Type | Requis | Description |
|-------|------|--------|-------------|
| `action` | string | Oui | `comment` |
| `post_id` | number | Oui | ID du post à commenter |
| `parent_id` | number | Non | ID du commentaire parent |
| `body` | string | Oui | Contenu du commentaire |

---

## Handlers HTTP/API

### HTTP (Webhook)

Effectue des appels HTTP vers une API externe.

**Aucune configuration globale requise**. Tout est défini dans le workflow.

**Exemple de workflow** :

```yaml
actions:
  - type: http
    params:
      url: "https://api.example.com/webhook"
      method: "POST"  # GET, POST, PUT, PATCH, DELETE
      headers:
        Authorization: "Bearer {{env.API_TOKEN}}"
        Content-Type: "application/json"
      body:
        event_id: "{{event_id}}"
        pubkey: "{{pubkey}}"
        content: "{{content}}"
      timeout: 30000  # ms
      retry: 3
```

**Paramètres** :
| Param | Type | Requis | Description |
|-------|------|--------|-------------|
| `url` | string | Oui | URL de l'endpoint |
| `method` | string | Non | Méthode HTTP (défaut: POST) |
| `headers` | object | Non | Headers HTTP |
| `body` | object/string | Non | Corps de la requête |
| `query` | object | Non | Query parameters |
| `timeout` | number | Non | Timeout en ms |
| `retry` | number | Non | Nombre de retries |

---

### ntfy

Envoie des notifications push via [ntfy.sh](https://ntfy.sh).

**Fichier de config** : `config/handlers/ntfy.yml`

```yaml
ntfy:
  enabled: true
  server_url: "https://ntfy.sh"  # ou votre instance
  default_topic: "pipelinostr"
  # Authentification (optionnel)
  username: "user"
  password: ${NTFY_PASSWORD}
```

**Exemple de workflow** :

```yaml
actions:
  - type: ntfy
    params:
      topic: "alerts"
      title: "Nouveau message Nostr"
      message: "{{content}}"
      priority: 4  # 1-5, 5 = urgent
      tags: ["nostr", "notification"]
      click: "https://example.com"  # URL à ouvrir
```

---

## Handlers Fichiers

### File

Génère des fichiers localement (text, JSON, CSV).

**Fichier de config** : `config/handlers/file.yml`

```yaml
file:
  enabled: true
  output_dir: "./data/files"
  max_file_size_mb: 10
  allowed_formats:
    - text
    - json
    - csv
    - binary
```

**Variables disponibles dans les noms de fichiers** :
- `{event_id}` : ID de l'événement (8 premiers caractères)
- `{pubkey}` : Pubkey (8 premiers caractères)
- `{kind}` : Kind de l'événement
- `{timestamp}` : Timestamp Unix
- `{date}` : Date ISO (YYYY-MM-DD)
- `{time}` : Heure (HH-MM-SS)
- `{datetime}` : Date et heure complète

**Exemple de workflow** :

```yaml
actions:
  # Fichier JSON
  - type: file
    params:
      filename: "events/{date}/event-{event_id}.json"
      format: json

  # Fichier CSV (append)
  - type: file
    params:
      filename: "logs/events.csv"
      format: csv
      append: true
      csv_headers: ["timestamp", "event_id", "pubkey", "content"]

  # Fichier texte avec template
  - type: file
    params:
      filename: "reports/{datetime}.txt"
      format: text
      template: |
        Événement Nostr
        ===============
        ID: {event_id}
        De: {pubkey}
        Date: {timestamp}

        Contenu:
        {content}
```

---

### FTP

Upload de fichiers via FTP.

**Fichier de config** : `config/handlers/ftp.yml`

```yaml
ftp:
  enabled: true
  host: "ftp.example.com"
  port: 21
  user: "username"
  password: ${FTP_PASSWORD}
  secure: false  # true pour FTPS
  timeout: 30000
```

**Variables d'environnement** :
```bash
FTP_PASSWORD=xxxxx
```

**Exemple de workflow** :

```yaml
actions:
  - type: ftp
    params:
      remote_path: "/uploads/{date}/event-{event_id}.json"
      create_dirs: true
      # content: "..." # Optionnel, sinon utilise transformedContent
```

---

### SFTP

Upload de fichiers via SFTP (SSH).

**Fichier de config** : `config/handlers/sftp.yml`

```yaml
sftp:
  enabled: true
  host: "sftp.example.com"
  port: 22
  username: "user"

  # Option 1: Mot de passe
  password: ${SFTP_PASSWORD}

  # Option 2: Clé privée (recommandé)
  # private_key_path: "/path/to/id_rsa"
  # passphrase: ${SFTP_KEY_PASSPHRASE}

  timeout: 30000
```

**Variables d'environnement** :
```bash
SFTP_PASSWORD=xxxxx
# ou
SFTP_KEY_PASSPHRASE=xxxxx
```

**Exemple de workflow** :

```yaml
actions:
  - type: sftp
    params:
      remote_path: "/home/user/uploads/{date}/event-{event_id}.json"
      create_dirs: true
```

---

## Handlers Cloud Storage

### S3 (Compatible)

Upload de fichiers vers tout stockage compatible S3 (AWS S3, MinIO, Backblaze B2, Wasabi, DigitalOcean Spaces, Cloudflare R2).

**Fichier de config** : `config/handlers/s3.yml`

```yaml
s3:
  enabled: true

  # Credentials (via variables d'environnement)
  access_key_id: ${S3_ACCESS_KEY_ID}
  secret_access_key: ${S3_SECRET_ACCESS_KEY}

  # Bucket par défaut
  bucket: "my-bucket"

  # Configuration endpoint selon le provider
  # AWS S3 (défaut)
  region: "eu-west-1"

  # MinIO / Auto-hébergé
  # endpoint: "http://localhost:9000"
  # force_path_style: true

  # Backblaze B2
  # endpoint: "https://s3.us-west-004.backblazeb2.com"
  # region: "us-west-004"

  # Wasabi
  # endpoint: "https://s3.eu-central-1.wasabisys.com"
  # region: "eu-central-1"

  # DigitalOcean Spaces
  # endpoint: "https://fra1.digitaloceanspaces.com"
  # region: "fra1"

  # Cloudflare R2
  # endpoint: "https://<account_id>.r2.cloudflarestorage.com"
  # region: "auto"
```

**Variables d'environnement** :
```bash
S3_ACCESS_KEY_ID=xxxxx
S3_SECRET_ACCESS_KEY=xxxxx
```

**Variables disponibles dans les clés** :
- `{event_id}` : ID de l'événement (8 premiers caractères)
- `{pubkey}` : Pubkey (8 premiers caractères)
- `{kind}` : Kind de l'événement
- `{timestamp}` : Timestamp Unix
- `{date}` : Date ISO (YYYY-MM-DD)
- `{time}` : Heure (HH-MM-SS)
- `{datetime}` : Date et heure complète

**Exemple de workflow** :

```yaml
actions:
  # Upload simple (auto-génère la clé)
  - type: s3
    params:
      operation: put

  # Upload avec clé personnalisée
  - type: s3
    params:
      operation: put
      key: "events/{date}/{event_id}.json"
      content_type: "application/json"

  # Upload vers un bucket spécifique
  - type: s3
    params:
      operation: put
      bucket: "archive-bucket"
      key: "nostr/events/{datetime}.json"

  # Vérifier si un objet existe
  - type: s3
    params:
      operation: exists
      key: "events/{event_id}.json"

  # Supprimer un objet
  - type: s3
    params:
      operation: delete
      key: "events/{event_id}.json"
```

**Paramètres** :
| Param | Type | Requis | Description |
|-------|------|--------|-------------|
| `operation` | string | Non | `put` (défaut), `delete`, `exists` |
| `bucket` | string | Non | Bucket cible (défaut: config) |
| `key` | string | Non | Chemin de l'objet (auto-généré si absent) |
| `content_type` | string | Non | MIME type (auto-détecté si absent) |

**Providers supportés** :
| Provider | Endpoint | Notes |
|----------|----------|-------|
| AWS S3 | (par défaut) | Utiliser la région AWS |
| MinIO | `http://host:9000` | `force_path_style: true` |
| Backblaze B2 | `s3.REGION.backblazeb2.com` | Compatible S3 |
| Wasabi | `s3.REGION.wasabisys.com` | Pas de frais d'egress |
| DigitalOcean Spaces | `REGION.digitaloceanspaces.com` | CDN inclus |
| Cloudflare R2 | `ACCOUNT.r2.cloudflarestorage.com` | Pas de frais d'egress |

---

## Handlers Base de données

### MongoDB

Stocke les événements dans MongoDB.

**Fichier de config** : `config/handlers/mongodb.yml`

```yaml
mongodb:
  enabled: true
  connection_string: ${MONGODB_URI}
  database: "pipelinostr"
  default_collection: "nostr_events"
```

**Variables d'environnement** :
```bash
MONGODB_URI=mongodb://localhost:27017/pipelinostr
# ou MongoDB Atlas:
MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net/
```

**Exemple de workflow** :

```yaml
actions:
  # Insert simple
  - type: mongodb
    params:
      operation: insert
      collection: "events"

  # Upsert (insert ou update)
  - type: mongodb
    params:
      operation: upsert
      collection: "events"
      upsert_key: "event_id"

  # Update conditionnel
  - type: mongodb
    params:
      operation: update
      collection: "users"
      filter:
        pubkey: "{{pubkey}}"
      update_fields:
        last_seen: "{{timestamp}}"
```

**Structure du document par défaut** :
```json
{
  "event_id": "...",
  "pubkey": "...",
  "kind": 1,
  "created_at": "2024-01-01T00:00:00Z",
  "content": "...",
  "transformed_content": "...",
  "tags": [...],
  "sig": "...",
  "received_at": "2024-01-01T00:00:01Z"
}
```

---

### MySQL

Stocke les événements dans MySQL/MariaDB.

**Fichier de config** : `config/handlers/mysql.yml`

```yaml
mysql:
  enabled: true
  host: "localhost"
  port: 3306
  user: "pipelinostr"
  password: ${MYSQL_PASSWORD}
  database: "pipelinostr"
  connection_limit: 10
  default_table: "nostr_events"
```

**Variables d'environnement** :
```bash
MYSQL_PASSWORD=xxxxx
```

**Structure de table suggérée** :
```sql
CREATE TABLE nostr_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  event_id VARCHAR(64) UNIQUE NOT NULL,
  pubkey VARCHAR(64) NOT NULL,
  kind INT NOT NULL,
  created_at DATETIME NOT NULL,
  content TEXT,
  transformed_content TEXT,
  tags JSON,
  sig VARCHAR(128),
  received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pubkey (pubkey),
  INDEX idx_kind (kind),
  INDEX idx_created_at (created_at)
);
```

**Exemple de workflow** :

```yaml
actions:
  # Insert
  - type: mysql
    params:
      operation: insert
      table: "events"

  # Upsert (ON DUPLICATE KEY UPDATE)
  - type: mysql
    params:
      operation: upsert
      table: "events"

  # Query personnalisée
  - type: mysql
    params:
      operation: query
      query: "SELECT COUNT(*) as count FROM events WHERE pubkey = ?"
      values: ["{{pubkey}}"]
```

---

### PostgreSQL

Stocke les événements dans PostgreSQL.

**Fichier de config** : `config/handlers/postgres.yml`

```yaml
postgres:
  enabled: true
  host: "localhost"
  port: 5432
  user: "pipelinostr"
  password: ${POSTGRES_PASSWORD}
  database: "pipelinostr"
  ssl: false
  max_connections: 10
  default_table: "nostr_events"
```

**Variables d'environnement** :
```bash
POSTGRES_PASSWORD=xxxxx
```

**Structure de table suggérée** :
```sql
CREATE TABLE nostr_events (
  id SERIAL PRIMARY KEY,
  event_id VARCHAR(64) UNIQUE NOT NULL,
  pubkey VARCHAR(64) NOT NULL,
  kind INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL,
  content TEXT,
  transformed_content TEXT,
  tags JSONB,
  sig VARCHAR(128),
  received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_nostr_events_pubkey ON nostr_events(pubkey);
CREATE INDEX idx_nostr_events_kind ON nostr_events(kind);
CREATE INDEX idx_nostr_events_created_at ON nostr_events(created_at);
CREATE INDEX idx_nostr_events_tags ON nostr_events USING GIN(tags);
```

**Exemple de workflow** :

```yaml
actions:
  # Insert avec retour des données
  - type: postgres
    params:
      operation: insert
      table: "events"

  # Upsert avec ON CONFLICT
  - type: postgres
    params:
      operation: upsert
      table: "events"
      conflict_columns: ["event_id"]

  # Query avec paramètres
  - type: postgres
    params:
      operation: query
      query: "SELECT * FROM events WHERE pubkey = $1 ORDER BY created_at DESC LIMIT 10"
      values: ["{{pubkey}}"]
```

---

### Redis

Stocke les données dans Redis (key-value, listes, sets, pub/sub).

**Fichier de config** : `config/handlers/redis.yml`

```yaml
redis:
  enabled: true
  url: "redis://localhost:6379"
  # password: ${REDIS_PASSWORD}  # Optionnel
  database: 0
  key_prefix: "pipelinostr"
```

**Variables disponibles dans les clés** :
- `{event_id}`, `{pubkey}`, `{kind}`, `{timestamp}`

**Exemple de workflow** :

```yaml
actions:
  # Stocker un événement (avec TTL)
  - type: redis
    params:
      operation: set
      key: "event:{event_id}"
      ttl: 86400  # 24h

  # Hash pour données utilisateur
  - type: redis
    params:
      operation: hset
      key: "user:{pubkey}"
      fields:
        last_event: "{{event_id}}"
        last_seen: "{{timestamp}}"

  # Liste (file d'attente)
  - type: redis
    params:
      operation: rpush
      key: "queue:events"

  # Compteur
  - type: redis
    params:
      operation: incr
      key: "count:events:{pubkey}"

  # Sorted set (timeline)
  - type: redis
    params:
      operation: zadd
      key: "timeline:{pubkey}"
      # score = timestamp par défaut

  # Pub/Sub (notifications temps réel)
  - type: redis
    params:
      operation: publish
      channel: "nostr:events:kind1"
```

**Opérations disponibles** :
| Operation | Description |
|-----------|-------------|
| `set` | Stocke une valeur (avec TTL optionnel) |
| `get` | Récupère une valeur |
| `hset` | Stocke dans un hash |
| `lpush` | Ajoute en début de liste |
| `rpush` | Ajoute en fin de liste |
| `sadd` | Ajoute à un set |
| `zadd` | Ajoute à un sorted set |
| `publish` | Publie sur un channel |
| `incr` | Incrémente un compteur |
| `expire` | Définit un TTL |

---

## Handlers DevOps

### GitHub

Interagit avec GitHub : créer des issues, commenter, gérer des fichiers, déclencher des workflows.

**Fichier de config** : `config/handlers/github.yml`

```yaml
github:
  enabled: true
  token: ${GITHUB_TOKEN}
  # default_owner: "username"
  # default_repo: "repository"
  # api_url: "https://github.example.com/api/v3"  # Pour GitHub Enterprise
```

**Variables d'environnement** :
```bash
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**Obtenir un Personal Access Token** :
1. GitHub.com > Settings > Developer settings > Personal access tokens
2. "Generate new token (classic)" ou Fine-grained tokens
3. Scopes requis selon les actions :
   - Issues : `repo` (ou `public_repo` pour repos publics)
   - Fichiers : `repo`
   - Workflows : `workflow`
   - Releases : `repo`

**Exemple de workflow** :

```yaml
actions:
  # Créer une issue
  - type: github
    params:
      action: create_issue
      repo: "owner/repo"
      title: "Nouvel événement Nostr"
      body: "{{content}}"
      labels: ["nostr", "automated"]
      assignees: ["username"]

  # Commenter une issue existante
  - type: github
    params:
      action: comment_issue
      repo: "owner/repo"
      issue_number: 123
      body: "Commentaire: {{content}}"

  # Créer un fichier dans le repo
  - type: github
    params:
      action: create_file
      repo: "owner/archive-repo"
      path: "events/{date}/{event_id}.json"
      message: "Archive event {{event_id}}"
      branch: "main"

  # Mettre à jour un fichier existant
  - type: github
    params:
      action: update_file
      repo: "owner/repo"
      path: "data/latest.json"
      message: "Update latest event"

  # Déclencher un workflow GitHub Actions
  - type: github
    params:
      action: trigger_workflow
      repo: "owner/repo"
      workflow_id: "deploy.yml"
      ref: "main"
      inputs:
        event_id: "{{event_id}}"
        trigger: "nostr"

  # Créer une release
  - type: github
    params:
      action: create_release
      repo: "owner/repo"
      tag_name: "v1.0.0"
      name: "Release v1.0.0"
      body: "{{content}}"
      draft: false
      prerelease: false
```

**Actions disponibles** :
| Action | Description |
|--------|-------------|
| `create_issue` | Crée une nouvelle issue |
| `comment_issue` | Ajoute un commentaire à une issue |
| `create_file` | Crée un fichier dans le repository |
| `update_file` | Met à jour un fichier existant |
| `trigger_workflow` | Déclenche un workflow GitHub Actions |
| `create_release` | Crée une release |

---

### GitLab

Interagit avec GitLab : créer des issues, commenter, gérer des fichiers, déclencher des pipelines.

**Fichier de config** : `config/handlers/gitlab.yml`

```yaml
gitlab:
  enabled: true
  token: ${GITLAB_TOKEN}
  # default_project: "namespace/project"
  # api_url: "https://gitlab.example.com/api/v4"  # Pour GitLab auto-hébergé
```

**Variables d'environnement** :
```bash
GITLAB_TOKEN=glpat-xxxxxxxxxxxxxxxxxxxx
```

**Obtenir un Personal Access Token** :
1. GitLab > User Settings > Access Tokens
2. Créer un token avec le scope "api"
3. Copier le token généré

**Exemple de workflow** :

```yaml
actions:
  # Créer une issue
  - type: gitlab
    params:
      action: create_issue
      project: "namespace/project"
      title: "Nouvel événement Nostr"
      description: "{{content}}"
      labels: "nostr,automated"

  # Commenter une issue existante
  - type: gitlab
    params:
      action: comment_issue
      project: "namespace/project"
      issue_iid: 42
      description: "Commentaire: {{content}}"

  # Créer un fichier dans le repo
  - type: gitlab
    params:
      action: create_file
      project: "namespace/project"
      file_path: "events/{date}/{event_id}.json"
      commit_message: "Archive event {{event_id}}"
      branch: "main"

  # Mettre à jour un fichier existant
  - type: gitlab
    params:
      action: update_file
      project: "namespace/project"
      file_path: "data/latest.json"
      commit_message: "Update latest event"

  # Déclencher un pipeline CI/CD
  - type: gitlab
    params:
      action: trigger_pipeline
      project: "namespace/project"
      ref: "main"
      variables:
        - key: "EVENT_ID"
          value: "{{event_id}}"
        - key: "TRIGGER_SOURCE"
          value: "nostr"

  # Créer une release
  - type: gitlab
    params:
      action: create_release
      project: "namespace/project"
      tag_name: "v1.0.0"
      name: "Release v1.0.0"
      description: "{{content}}"
```

**Actions disponibles** :
| Action | Description |
|--------|-------------|
| `create_issue` | Crée une nouvelle issue |
| `comment_issue` | Ajoute un commentaire (note) à une issue |
| `create_file` | Crée un fichier dans le repository |
| `update_file` | Met à jour un fichier existant |
| `trigger_pipeline` | Déclenche un pipeline CI/CD |
| `create_release` | Crée une release |

**Notes** :
- Le project peut être spécifié par son ID numérique ou son path "namespace/project"
- Les labels sont séparés par des virgules (string, pas tableau)
- `issue_iid` est l'ID interne au projet (pas l'ID global)

---

## Handlers Hardware/IoT

> ⚠️ **Note** : Les handlers hardware nécessitent l'installation de modules optionnels et sont conçus pour fonctionner sur des plateformes supportant le hardware correspondant (Raspberry Pi, SBCs, etc.).

### Serial (RS232/USB)

Communication série avec des équipements RS232 ou USB série (Arduino, équipements industriels, etc.).

**Installation** :
```bash
npm install serialport
```

**Fichier de config** : `config/handlers/serial.yml`

```yaml
serial:
  enabled: true
  port: "/dev/ttyUSB0"  # ou COM3 sous Windows
  baudrate: 9600
  databits: 8
  stopbits: 1
  parity: "none"  # none, even, odd, mark, space
  rtscts: false
  xon: false
  xoff: false
```

**Exemple de workflow** :

```yaml
actions:
  # Envoyer du texte
  - type: serial
    params:
      data: "{{content}}"
      line_ending: "crlf"  # none, lf, crlf, cr

  # Envoyer des données hexadécimales
  - type: serial
    params:
      format: "hex"
      data: "48454C4C4F"  # HELLO

  # Envoyer et attendre une réponse
  - type: serial
    params:
      data: "GET_STATUS"
      line_ending: "crlf"
      wait_response: true
      response_timeout: 5000  # ms
      response_delimiter: "\n"

  # Envoyer un JSON formaté
  - type: serial
    params:
      format: "json"
```

**Paramètres** :
| Param | Type | Requis | Description |
|-------|------|--------|-------------|
| `data` | string | Non | Données à envoyer (défaut: content) |
| `format` | string | Non | `text`, `hex`, `json` |
| `encoding` | string | Non | Encodage (défaut: utf8) |
| `line_ending` | string | Non | Terminateur de ligne |
| `wait_response` | boolean | Non | Attendre une réponse |
| `response_timeout` | number | Non | Timeout en ms (défaut: 5000) |
| `response_delimiter` | string | Non | Délimiteur de réponse |

---

### GPIO

Contrôle des GPIO sur Raspberry Pi et autres SBCs.

**Installation** :
```bash
npm install onoff
```

**Fichier de config** : `config/handlers/gpio.yml`

```yaml
gpio:
  enabled: true
  pins:
    led_rouge: 17
    led_verte: 27
    buzzer: 22
  default_direction: "out"
  active_low: false
```

**Exemple de workflow** :

```yaml
actions:
  # Allumer une LED
  - type: gpio
    params:
      pin: "led_rouge"  # Nom défini dans la config
      action: "set"

  # Éteindre une LED
  - type: gpio
    params:
      pin: 17  # Numéro de pin directement
      action: "clear"

  # Toggle (inverser l'état)
  - type: gpio
    params:
      pin: "led_verte"
      action: "toggle"

  # Pulse (activer pendant X ms)
  - type: gpio
    params:
      pin: "buzzer"
      action: "pulse"
      duration: 500  # ms

  # Lire l'état d'un pin
  - type: gpio
    params:
      pin: 18
      action: "read"

  # PWM logiciel
  - type: gpio
    params:
      pin: "led_rouge"
      action: "pwm"
      duty_cycle: 50  # 0-100%
      pwm_frequency: 100  # Hz
```

**Actions disponibles** :
| Action | Description |
|--------|-------------|
| `set` | Met le pin à HIGH |
| `clear` | Met le pin à LOW |
| `toggle` | Inverse l'état du pin |
| `pulse` | Pulse HIGH pendant `duration` ms |
| `read` | Lit l'état du pin |
| `pwm` | PWM logiciel avec duty cycle |

---

### MQTT

Publication de messages sur un broker MQTT (Home Assistant, Mosquitto, AWS IoT, etc.).

**Installation** :
```bash
npm install mqtt
```

**Fichier de config** : `config/handlers/mqtt.yml`

```yaml
mqtt:
  enabled: true
  broker_url: "mqtt://localhost:1883"  # ou mqtts:// pour TLS
  username: "user"
  password: ${MQTT_PASSWORD}
  client_id: "pipelinostr"
  keepalive: 60
  clean: true
  reconnect_period: 5000
  connect_timeout: 30000
  default_topic: "nostr/events"
  topic_prefix: "home"
```

**Variables d'environnement** :
```bash
MQTT_PASSWORD=xxxxx
```

**Exemple de workflow** :

```yaml
actions:
  # Publication simple
  - type: mqtt
    params:
      topic: "nostr/notifications"
      payload: "{{content}}"

  # Publication JSON
  - type: mqtt
    params:
      topic: "sensors/nostr"
      format: "json"
      qos: 1  # 0, 1, ou 2
      retain: false

  # Avec payload personnalisé
  - type: mqtt
    params:
      topic: "alerts/nostr"
      payload:
        event_id: "{{event_id}}"
        message: "{{content}}"
        timestamp: "{{timestamp}}"
```

**Paramètres** :
| Param | Type | Requis | Description |
|-------|------|--------|-------------|
| `topic` | string | Non | Topic MQTT (défaut: config) |
| `payload` | string/object | Non | Message à publier |
| `format` | string | Non | `text` ou `json` |
| `qos` | number | Non | QoS 0, 1, ou 2 (défaut: 0) |
| `retain` | boolean | Non | Message retenu (défaut: false) |

---

### Bluetooth LE

Communication avec des périphériques Bluetooth Low Energy (beacons, capteurs, wearables).

**Installation** :
```bash
npm install @abandonware/noble
```

> ⚠️ **Note** : Nécessite des permissions Bluetooth sur le système.

**Fichier de config** : `config/handlers/ble.yml`

```yaml
ble:
  enabled: true
  devices:
    capteur_temp:
      address: "aa:bb:cc:dd:ee:ff"
      service_uuid: "180a"
      characteristic_uuid: "2a29"
    led_strip:
      address: "11:22:33:44:55:66"
  scan_timeout: 10000
  connect_timeout: 10000
```

**Exemple de workflow** :

```yaml
actions:
  # Écrire sur une caractéristique
  - type: ble
    params:
      device: "led_strip"
      service_uuid: "ffe0"
      characteristic_uuid: "ffe1"
      action: "write"
      data: "{{content}}"

  # Écrire en hexadécimal
  - type: ble
    params:
      address: "aa:bb:cc:dd:ee:ff"
      service_uuid: "ffe0"
      characteristic_uuid: "ffe1"
      action: "write"
      data: "FF0000"  # Rouge en RGB
      data_format: "hex"

  # Écrire sans réponse (plus rapide)
  - type: ble
    params:
      device: "led_strip"
      service_uuid: "ffe0"
      characteristic_uuid: "ffe1"
      action: "write_without_response"
      data: "00FF00"
      data_format: "hex"

  # Lire une caractéristique
  - type: ble
    params:
      device: "capteur_temp"
      service_uuid: "180a"
      characteristic_uuid: "2a29"
      action: "read"

  # Écouter les notifications
  - type: ble
    params:
      device: "capteur_temp"
      service_uuid: "180f"
      characteristic_uuid: "2a19"
      action: "notify"
      listen_duration: 5000  # ms
```

**Actions disponibles** :
| Action | Description |
|--------|-------------|
| `write` | Écriture avec réponse |
| `write_without_response` | Écriture sans réponse |
| `read` | Lecture de caractéristique |
| `notify` | Écoute des notifications |

---

### USB HID

Communication avec des périphériques USB HID (claviers programmables, contrôleurs, afficheurs).

**Installation** :
```bash
npm install node-hid
```

**Fichier de config** : `config/handlers/usb-hid.yml`

```yaml
usb_hid:
  enabled: true
  devices:
    stream_deck:
      vendor_id: 0x0fd9
      product_id: 0x0060
    macro_pad:
      vendor_id: 0x1234
      product_id: 0x5678
```

**Exemple de workflow** :

```yaml
actions:
  # Écrire sur un device
  - type: usb_hid
    params:
      device: "stream_deck"
      action: "write"
      data: [0x02, 0x01, 0x00, 0x00]  # Tableau d'octets
      report_id: 0

  # Écrire en hexadécimal
  - type: usb_hid
    params:
      vendor_id: 0x0fd9
      product_id: 0x0060
      action: "write"
      data: "02010000"  # String hex

  # Lire depuis le device
  - type: usb_hid
    params:
      device: "macro_pad"
      action: "read"
      read_timeout: 1000  # ms

  # Récupérer un Feature Report
  - type: usb_hid
    params:
      device: "stream_deck"
      action: "get_feature"
      report_id: 5
      read_size: 64

  # Envoyer un Feature Report
  - type: usb_hid
    params:
      device: "stream_deck"
      action: "send_feature"
      report_id: 5
      data: [0x01, 0x02, 0x03]
```

**Actions disponibles** :
| Action | Description |
|--------|-------------|
| `write` | Envoie un rapport HID |
| `read` | Lit un rapport HID |
| `get_feature` | Récupère un Feature Report |
| `send_feature` | Envoie un Feature Report |

---

### I2C

Communication I2C pour capteurs et périphériques sur Raspberry Pi et SBCs.

**Installation** :
```bash
npm install i2c-bus
```

**Fichier de config** : `config/handlers/i2c.yml`

```yaml
i2c:
  enabled: true
  bus_number: 1  # /dev/i2c-1
  devices:
    oled_display:
      address: 0x3c
      description: "SSD1306 OLED"
    temp_sensor:
      address: 0x48
      description: "TMP102"
    eeprom:
      address: 0x50
      description: "AT24C256"
```

**Exemple de workflow** :

```yaml
actions:
  # Scanner le bus I2C
  - type: i2c
    params:
      action: "scan"

  # Écrire des données
  - type: i2c
    params:
      device: "oled_display"
      action: "write"
      data: [0x00, 0xAE]  # Commande OFF

  # Écrire un byte dans un registre
  - type: i2c
    params:
      device: "temp_sensor"
      action: "write_byte"
      register: 0x01
      data: 0x60  # Configuration

  # Lire un byte depuis un registre
  - type: i2c
    params:
      device: "temp_sensor"
      action: "read_byte"
      register: 0x00  # Température

  # Lire un word (16 bits)
  - type: i2c
    params:
      address: 0x48  # Adresse directe
      action: "read_word"
      register: 0x00

  # Écrire un bloc de données
  - type: i2c
    params:
      device: "eeprom"
      action: "write_i2c_block"
      register: 0x00
      data: "48454C4C4F"  # Hex string

  # Lire un bloc de données
  - type: i2c
    params:
      device: "eeprom"
      action: "read_i2c_block"
      register: 0x00
      length: 16
```

**Actions disponibles** :
| Action | Description |
|--------|-------------|
| `scan` | Scanne le bus pour trouver les devices |
| `write` | Écriture brute de données |
| `read` | Lecture brute de données |
| `write_byte` | Écrit un byte dans un registre |
| `read_byte` | Lit un byte depuis un registre |
| `write_word` | Écrit un word (16 bits) dans un registre |
| `read_word` | Lit un word depuis un registre |
| `write_i2c_block` | Écrit un bloc dans un registre |
| `read_i2c_block` | Lit un bloc depuis un registre |

---

## Variables de Template

Toutes les valeurs de paramètres supportent les variables suivantes :

| Variable | Description |
|----------|-------------|
| `{{content}}` | Contenu transformé de l'événement |
| `{{raw_content}}` | Contenu original de l'événement |
| `{{event_id}}` | ID de l'événement |
| `{{pubkey}}` | Pubkey de l'auteur |
| `{{kind}}` | Kind de l'événement |
| `{{timestamp}}` | Timestamp ISO de création |
| `{{created_at}}` | Timestamp Unix de création |
| `{{env.VAR}}` | Variable d'environnement |

---

## Variables d'Environnement

Toutes les valeurs sensibles doivent être stockées dans le fichier `.env` :

```bash
# Copier depuis .env.example
cp .env.example .env

# Éditer avec vos valeurs
nano .env
```

Les variables sont référencées dans les fichiers YAML avec `${VAR_NAME}`.
