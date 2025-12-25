# PipeliNostr - Contexte Claude Code

> **Objectif :** Fichier lu automatiquement par Claude Code pour restaurer le contexte entre sessions.
> **Dernière mise à jour :** 2025-12-25
> **Dernier commit :** 82dd891 - feat: add NIP-17 DM support (Gift Wrap) with NIP-04 backwards compatibility

## Projet en bref

**PipeliNostr** = "Le n8n de Nostr" - Routeur d'événements Nostr vers services externes.
- Stack : TypeScript / Node.js 20+ / SQLite
- Repo : `C:\Users\tirod\Documents\pipelinostr`

## État actuel

- **Workflows testés :** 20/28 fonctionnels
- **Workflows non testés :** publish-note, auto-reply, command-handler, email-forward, claude-workflow-generator, claude-activate, nostr-to-morse, morse-to-telegram
- **Dernier commit :** feat: auto-split long Morse messages into chunks

## Fichiers clés à lire si besoin de contexte détaillé

| Fichier | Contenu | Quand le lire |
|---------|---------|---------------|
| `BACKLOG.md` | Features proposées, en cours, terminées | Avant d'implémenter une feature |
| `specifications.md` | Architecture technique détaillée | Pour comprendre l'architecture |
| `docs/HARDWARE.md` | Guide matériel complet (Orange Pi, RPi, Android) | Pour choix/setup hardware |
| `docs/qa-sessions/*.md` | Historique des sessions de dev | Pour contexte historique |
| `examples/workflows/README.md` | Variables, filtres, hooks disponibles | Pour écrire des workflows |
| `README.md` | Vue d'ensemble, installation, usage | Pour vue globale |

## Décisions d'architecture établies

1. **Handlers** : Un fichier par handler dans `src/outbound/`, config YAML dans `config/handlers/`
2. **Workflows** : YAML dans `config/workflows/`, exemples dans `examples/workflows/`
3. **Queue** : SQLite `event_queue` table, statuts: pending → processing → completed/failed/dead
4. **Hooks** : `on_start`, `on_complete`, `on_fail` pour chaîner workflows (voir section dédiée)
5. **GPIO Bookworm** : Utiliser `pigpio` (pas `onoff`) pour Raspberry Pi OS Bookworm
6. **Templates** : Handlebars avec filtres custom (`trim`, `sats_to_btc`, `date`, etc.)
7. **Variables** : Définies par workflow, accessibles via `{{ variables.xxx }}` et `{{ parent.variables.xxx }}`
8. **Config schema** : TOUJOURS mettre à jour les DEUX endroits dans `src/config/schema.ts` :
   - L'interface TypeScript (`PipelinostrConfig`)
   - Le schéma JSON Ajv (`configSchema`) - sinon erreur "must NOT have additional properties"

## Logique des Hooks (IMPORTANT)

Les workflows peuvent chaîner d'autres workflows via des hooks. Chaque type a un usage spécifique :

### Types de hooks

| Hook | Quand | Usage | Bloquant |
|------|-------|-------|----------|
| `on_start` | Au début du workflow | Lancer des workflows parallèles (indépendants) | Non (fire & forget) |
| `on_complete` | Quand le workflow réussit | Chaîner séquentiellement (workflow A → workflow B) | Oui |
| `on_fail` | Quand le workflow échoue | Gérer les erreurs, envoyer notifications | Oui |

### Hook action-level `on_fail`

Les actions peuvent aussi avoir un `on_fail` qui :
1. Déclenche un workflow d'erreur
2. **Stoppe les actions restantes** du workflow courant
3. Le workflow parent échoue (pas de `on_complete`)

### Pattern de chaînage recommandé

```
workflow-gate (entry point, définit les variables/seuils)
│ variables: { threshold: 40, ... }
│
├─ action: check (vérifie condition)
│     └─ on_fail → workflow-error (envoie message erreur)
│                   Accède aux variables via {{ parent.variables.xxx }}
│
└─ hooks:
     on_complete → workflow-process (traitement principal)
                   Accède aux variables via {{ parent.variables.xxx }}
```

### Règle d'or

**Le workflow qui définit une valeur (seuil, config) doit être celui qui l'utilise ou la transmet.**

Exemple ClaudeDM :
- `claudeDM-balance-gate` définit `min_balance_sats: 40` et fait le check
- `claudeDM-insufficient-balance` affiche `{{ parent.variables.min_balance_sats }}`

## Conventions de code

- **Handlers** : Implémenter `ActionHandler` interface
- **Workflows** : ID en kebab-case, `enabled: true/false`
- **Logs** : Pino logger, niveaux debug/info/warn/error
- **Tests** : Vitest dans `src/__tests__/`
- **Build** : `npm run build` avant `npm start`
- **Secrets** : JAMAIS dans les fichiers YAML, toujours dans `.env` avec syntaxe `${VAR_NAME}`

## Convention secrets / .env

**Les secrets (API keys, mots de passe, tokens) ne doivent JAMAIS être dans les fichiers de config.**

Format dans les handlers YAML :
```yaml
claude:
  enabled: true
  api_key: ${ANTHROPIC_API_KEY}  # Référence à .env
```

Format dans `.env` :
```
ANTHROPIC_API_KEY=sk-ant-api03-...
```

Cette convention s'applique à TOUS les handlers (telegram, email, etc.).

## Permissions Claude Code

Fichier `.claude/settings.local.json` contient les autorisations :
- `Edit`, `Write` : Autorisés (pas de confirmation)
- `Bash(npm ...)`, `Bash(git ...)` : Autorisés
- `WebFetch` : Domaines spécifiques autorisés

## Procédure de reprise de session

Quand l'utilisateur dit "continue" ou demande de reprendre :

1. **Lire ce fichier** (automatique)
2. **Si contexte insuffisant**, lire dans cet ordre :
   - `BACKLOG.md` (pour savoir quoi faire)
   - Dernière session QA dans `docs/qa-sessions/`
3. **Demander** ce que l'utilisateur veut faire si pas clair

## Historique des décisions récentes

### 2025-12-25
- **Migration NIP-17 DMs** : support complet réception et émission
  - Réception : unwrap Gift Wrap (kind 1059 → Seal → Rumor kind 14)
  - Émission : configurable via `nostr.dm_format` ('nip04' ou 'nip17')
  - Nettoyage automatique préfixe Amethyst `[//]: # (nip18)`
- Config `nostr.dm_format` ajouté à `config.yml` et schéma
- Testé avec Amethyst : `/dpo` fonctionne

### 2025-12-20
- Ajout handler `system` pour `/pipelinostr status` via DM
- Workflow pipelinostr-status.yml.example créé
- Infos retournées : commit, workflows, handlers, 10 dernières exécutions, RAM/CPU/disk, OS
- Fix workflow : `actions.*.response` (pas `data`), `from_whitelist` (pas `require_whitelist`)
- Ajout `/claude status` : action status dans claude.handler.ts (workflow supprimé, action gardée)
- CLI : `workflow load-missing`, `handler load-missing`, `handler refresh`
- CLI : `workflow clean [--purge]`, `handler clean [--purge]`
- load-missing désactive par défaut les éléments déployés
- Backlog : ajout Claude Smart Reply + Intent Classifier, annulation Claude API Status
- Split BACKLOG.md → backlog-old.md (archives) + script `split-backlog.cjs`
- **Handler `workflow_db`** : persistence état workflows (balances, compteurs, flags)
- **Workflows ClaudeDM** : zap-balance-tracker, claudeDM-entry, error handlers
- Backlog : NIP-17 migration, workflow import via Nostr, paid video streaming
- **Support variables workflow** : `{{ variables.xxx }}` et `{{ parent.variables.xxx }}`
- **Action-level on_fail** : hook sur action qui stoppe le workflow et déclenche erreur
- **Refactor ClaudeDM** : balance-gate → process → insufficient-balance (chaînage propre)
- **Wildcards CLI** : `workflow enable claudeDM-*` avec patterns `*` et `?`

### 2025-12-19
- Ajout backlog : SMS Gateway for Android (capcom6)
- Ajout backlog : GPIO Bouton Poussoir de Secours
- Ajout backlog : Afficheur Digital GPIO (LCD/OLED)
- Ajout backlog : PipeliNostr sur Téléphone (Termux)
- Permissions Edit/Write ajoutées à settings.local.json
- Création `docs/HARDWARE.md` : guide complet des plateformes
- Recommandation hardware budget : **Orange Pi Zero 2W 4GB (~24€)**
- Évaluation smartphones : Crosscall X3/X5, Nothing 3a, DOOGEE T30 Ultra

### 2025-12-15
- GPIO servo SG90 implémenté
- Workflow zap-to-dispenser créé
- Problème GPIO Bookworm identifié → pigpio recommandé
- Correction regex PCRE `(?i)` → flags JS

### 2025-12-11
- Queue/hooks integration finalisée
- Documentation hardware self-hosted créée

### 2025-12-10
- Déploiement serveur Linux
- Bug FK SQLite corrigé
- Handler Zulip testé et fonctionnel

## Backlog prioritaire actuel

| Priorité | Item | Status |
|----------|------|--------|
| High | Tester workflows Morse (2) | Pending |
| Medium | SMS Gateway for Android | Proposed |
| Medium | GPIO Bouton Poussoir | Proposed |
| Medium | Afficheur LCD/OLED | Proposed |
| Medium | Bitcoin/Lightning handlers | Proposed |
| Low | PipeliNostr sur téléphone | Research |

## Handlers implémentés

### Messaging / Social
| Handler | Fichier | Status | Notes |
|---------|---------|--------|-------|
| `email` | `email.handler.ts` | Testé | SMTP via nodemailer |
| `nostr_dm` | `nostr.handler.ts` | Testé | NIP-04/NIP-44 |
| `nostr_note` | `nostr.handler.ts` | Non testé | Kind 1 |
| `telegram` | `telegram.handler.ts` | Testé | Bot API |
| `zulip` | `zulip.handler.ts` | Testé | Stream/DM |
| `mastodon` | `mastodon.handler.ts` | Testé | Toot |
| `bluesky` | `bluesky.handler.ts` | Testé | AT Protocol |

### Storage / Data
| Handler | Fichier | Status | Notes |
|---------|---------|--------|-------|
| `http` | `http.handler.ts` | Testé | REST calls |
| `ftp` | `ftp.handler.ts` | Testé | Upload/append |
| `mongodb` | `mongodb.handler.ts` | Testé | Insert docs |
| `file` | `file.handler.ts` | Testé | Local filesystem |

### Hardware / IoT
| Handler | Fichier | Status | Notes |
|---------|---------|--------|-------|
| `gpio` | `gpio.handler.ts` | Testé | LED, servo (pigpio) |
| `morse_audio` | `morse-audio.handler.ts` | Non testé | TTS Morse → OGG |

### Integration
| Handler | Fichier | Status | Notes |
|---------|---------|--------|-------|
| `traccar_sms` | `traccar-sms.handler.ts` | Testé | SMS via Traccar |
| `calendar` | `calendar.handler.ts` | Testé | iCal invites |
| `bebop` | `bebop.handler.ts` | Testé | be-BOP → Odoo sync |
| `odoo` | `odoo.handler.ts` | Testé | JSON-RPC |
| `claude` | `claude.handler.ts` | Non testé | Workflow generator |
| `system` | `system.handler.ts` | Non testé | System status /pipelinostr status |
| `workflow_db` | `workflow-db.handler.ts` | Non testé | Persistent state for workflows (balances, counters) |

## Workflows par catégorie

### Testés et fonctionnels (20)
```
nostr-to-gpio.yml          gpio:green, gpio:red, gpio:servo
zap-to-dispenser.yml       Zap >= 21 sats → servo
dm-to-voice-telegram.yml   Send vocal to TG: <msg>
zulip-forward.yml          Tous DMs → Zulip
zap-notification.yml       Tous zaps → notification
nostr-to-telegram.yml      Tous DMs → Telegram
nostr-to-email.yml         Send email to x@y.com: <msg>
nostr-to-calendar.yml      Invite x@y.com: Titre @ date
nostr-to-sms.yml           Send SMS to +33...: <msg>
dm-to-mastodon.yml         Mastodon: <msg>
dm-to-bluesky.yml          Bluesky: <msg>
dm-to-mongodb.yml          mongo: <data>
dm-to-ftp.yml              ftp: <msg>
dm-to-ftp-with-local-storage.yml
mempool-tx-lookup.yml      mempool: <txid>
zulip-workflow-notification.yml
api-to-nostr-dm.yml        POST /api/notify
webhook-notifier.yml       Forward DMs → webhook
bebop-order-sync.yml       Payment for order #...
dpo-command.yml            /dpo
```

### Non testés (9)
```
publish-note.yml           /publish <content>
auto-reply.yml             hello, bonjour, etc.
command-handler.yml        /ping, /help, /status
email-forward.yml          Tous DMs → email
claude-workflow-generator.yml   /workflow <desc>
claude-activate.yml        /activate, /cancel, /pending
nostr-to-morse.yml         morse: <text> → buzzer
morse-to-telegram.yml      morse:tg: <text> → audio TG
pipelinostr-status.yml     /pipelinostr status → system info
```

## Architecture simplifiée

```
┌─────────────────────────────────────────────────────────────┐
│                       PipeliNostr                            │
├─────────────────────────────────────────────────────────────┤
│  INBOUND                CORE                 OUTBOUND       │
│  ┌──────────┐     ┌──────────────┐     ┌──────────────┐   │
│  │ Nostr    │────►│ Event Queue  │────►│ Handlers     │   │
│  │ Listener │     │ (SQLite)     │     │ (email, tg,  │   │
│  ├──────────┤     ├──────────────┤     │  gpio, etc.) │   │
│  │ Webhook  │────►│ Workflow     │     └──────────────┘   │
│  │ Server   │     │ Engine       │                         │
│  └──────────┘     └──────────────┘                         │
└─────────────────────────────────────────────────────────────┘
```

## Backlog par catégorie

### Done
- DPO/RGPD Report, Relay Discovery, Meta-Workflows, Hardware Testing
- Zap Listener, Event Queue, Calendar, Hardware Self-Hosted Guide

### Proposed - Hardware/GPIO
- Bouton poussoir de secours (zap-to-dispenser fallback)
- Afficheur LCD/OLED pour pseudonyme Nostr
- Morse Code Listener (micro → texte → DM)

### Proposed - Integrations
- SMS Gateway for Android (capcom6) - bidirectionnel
- Dolibarr ERP Handler
- Bitcoin/Lightning handlers (mempool xpub, phoenixd)

### Proposed - Platform
- PipeliNostr sur téléphone (Termux)
- Web Dashboard monitoring

### Proposed - AI/Voice
- LLM Agent (langage naturel)
- Voice Handlers (STT/TTS)
- Claude Workflow Explainer (/explain)

## Conventions de nommage

### Workflows
- ID : `kebab-case` (ex: `zap-to-dispenser`)
- Fichier : `{id}.yml`
- Commande DM : Préfixe descriptif (ex: `morse:`, `gpio:`, `Send email to`)

### Handlers
- Fichier : `{type}.handler.ts` (ex: `telegram.handler.ts`)
- Config : `config/handlers/{type}.yml`
- Type dans workflow : `type: {type}` (ex: `type: telegram`)

### Variables template
- `trigger.*` : Données de l'événement déclencheur (héritées du parent via hooks)
- `match.*` : Groupes capturés par regex (hérités du parent via hooks)
- `actions.{id}.response.*` : Résultats des actions précédentes (contient directement `data` du handler)
  - `actions.{id}.success` : boolean (succès de l'action)
  - `actions.{id}.response.*` : données retournées par le handler (ex: `.response.morse`, `.response.files`)
  - `actions.{id}.response.found` : pour workflow_db get
- `variables.*` : Variables définies dans le workflow courant
- `parent.*` : Métadonnées du workflow parent (hooks uniquement)
  - `parent.id`, `parent.name` : Identifiants du parent
  - `parent.success`, `parent.error` : Résultat du parent
  - `parent.variables.*` : Variables définies par le parent

**IMPORTANT:**
- Dans les workflows enfants (hooks), `trigger.*` et `match.*` sont directement accessibles (pas via `parent.*`). Seules les `variables` du parent nécessitent le préfixe `parent.`.
- Le chemin pour les données d'action est `actions.*.response.value` (PAS `actions.*.response.data.value`).

## Problèmes connus

1. **GPIO sur Bookworm** : `onoff` ne fonctionne pas, utiliser `pigpio`
2. **Regex PCRE** : `(?i)` converti automatiquement en flags JS
3. **Claude handler** : Non testé, nécessite API key Anthropic

## Notes pour Claude

- L'utilisateur parle français
- Préférer les réponses concises
- Utiliser TodoWrite pour tâches complexes (3+ étapes)

### RÈGLE ABSOLUE : Demander confirmation avant les choix

**Quand plusieurs options sont possibles (ex: librairie A vs B, approche X vs Y) :**
1. Présenter les options avec leurs avantages/inconvénients
2. **ATTENDRE la confirmation de l'utilisateur** avant d'agir
3. Ne JAMAIS commencer une implémentation sans aval explicite

**Violation = perte de temps et frustration.**

### RÈGLE ABSOLUE : Vérifier avant d'affirmer

**AVANT de mentionner un fichier, une commande ou un chemin :**
1. **Fichiers** : Utiliser `Glob` ou `Read` pour vérifier l'existence
2. **Commandes CLI** : Vérifier dans `scripts/` ou `package.json`
3. **Config** : Le fichier principal est `config/config.yml` (PAS `pipelinostr.yml`)
4. **Chemins** : Ne JAMAIS inventer un chemin sans l'avoir vérifié

**Fichiers de config connus :**
- Config principale : `config/config.yml`
- Handlers : `config/handlers/*.yml`
- Workflows : `config/workflows/*.yml`
- Exemples workflows : `examples/workflows/*.yml.example`

**Si incertain :** Utiliser Glob/Grep pour trouver le bon fichier AVANT de répondre.

### RÈGLE ABSOLUE : Distinguer repo local vs serveur de production

**Le repo local contient des TEMPLATES. Le serveur de production a sa propre config.**

1. **Ne JAMAIS conclure** sur l'état du serveur en lisant les fichiers du repo
2. **Les fichiers `config/*.yml` dans le repo** sont des templates/exemples
3. **Pour connaître l'état réel du serveur** : demander à l'utilisateur ou lui donner une commande à exécuter
4. **Ne JAMAIS dire "X n'est pas activé"** en se basant sur le repo local

**Exemple d'erreur à NE PAS reproduire :**
- ❌ Lire `config/config.yml` du repo → conclure "la queue n'est pas activée"
- ✅ Demander : "Peux-tu vérifier sur le serveur avec `grep queue config/config.yml` ?"

**Violation = conclusions fausses et perte de temps.**
- **PipeliNostr n'est PAS un service systemd** : Ne JAMAIS utiliser `systemctl` ou `journalctl`. L'utilisateur lance le processus manuellement.
- **COMMIT AUTOMATIQUE** : Quand une tâche est terminée, faire `git add`, `git commit` et `git push` automatiquement avant d'annoncer la fin
- **APRÈS PUSH** : Toujours donner les commandes serveur complètes :
  ```bash
  ./scripts/rebuild.sh  # fait git pull + npm install + build (PAS BESOIN de git pull séparé !)
  ./scripts/pipelinostr.sh workflow refresh <ids>  # si workflow .example créé/modifié
  ./scripts/pipelinostr.sh workflow enable <ids>   # OBLIGATOIRE après refresh (désactivé par défaut)
  ./scripts/pipelinostr.sh handler refresh <ids>   # si handler .example créé/modifié
  ./scripts/pipelinostr.sh handler enable <ids>    # OBLIGATOIRE après refresh
  ```
  **NE JAMAIS OUBLIER** les commandes `enable` après `refresh` !

  **SI UN .yml.example EST SUPPRIMÉ** : Toujours le signaler à l'utilisateur pour qu'il lance :
  ```bash
  ./scripts/pipelinostr.sh workflow clean  # supprime les workflows orphelins de la DB
  ```

  **ATTENTION CLI** : Les IDs multiples sont séparés par des **VIRGULES**, pas des espaces !
  - ✅ `./scripts/pipelinostr.sh workflow refresh wallet-address,wallet-bill,wallet-check`
  - ❌ `./scripts/pipelinostr.sh workflow refresh wallet-address wallet-bill wallet-check`
  - Alternative avec wildcard : `./scripts/pipelinostr.sh workflow refresh "wallet-*"`
- **VÉRIFICATION** : Ne jamais demander "as-tu fait X ?". Toujours donner une commande de vérification :
  ```bash
  # Vérifier schéma DB
  sqlite3 data/pipelinostr.db ".schema workflow_state"
  # Vérifier données
  sqlite3 data/pipelinostr.db "SELECT * FROM workflow_state WHERE namespace='balances';"
  # Vérifier workflow actif
  ./scripts/pipelinostr.sh workflow list | grep <id>
  ```
- **DEBUG** : Ne JAMAIS retirer les logs de debug tant que l'utilisateur n'a pas confirmé que tout fonctionne
- Le projet tourne sur Windows (dev) et Linux (prod/RPi)
- Permissions Edit/Write dans `.claude/settings.local.json`

## Historique des prompts (OBLIGATOIRE)

**Dossier :** `prompt_history/` - Un fichier par jour `YYYY-MM-DD.md`

**À chaque session :**
1. Lire le dernier fichier pour contexte
2. Ajouter les prompts utilisateur au fil de l'eau
3. Format : résumé concis de la demande + décisions prises

**À enregistrer :**
- Demandes fonctionnelles (features, bugs, refactoring)
- Décisions d'architecture
- Choix techniques validés

**À NE PAS enregistrer :**
- Logs copiés-collés
- Messages de debug/diagnostic
- Questions techniques ponctuelles sans impact

**Ce dossier est public** - ne contient que les intentions, pas de données sensibles.

## Procédure de mise à jour de ce fichier

Après chaque session significative :
1. Mettre à jour "Dernière mise à jour" en haut
2. Ajouter entrée dans "Historique des décisions récentes"
3. Mettre à jour "Backlog prioritaire actuel" si changé
4. Mettre à jour les listes de handlers/workflows si ajoutés
