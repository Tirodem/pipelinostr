# QA Session - 2025-12-11

## Résumé

Session focalisée sur la finalisation de l'intégration queue/hooks et la documentation hardware.

## Travail Effectué

### 1. Correction Hook Queue Integration

**Problème initial :**
Les événements hook étaient enqueués mais échouaient au traitement avec l'erreur :
```
Unsupported event type: hook
```

**Cause :**
Le `QueueWorker.processQueuedEvent()` ne gérait pas le cas `hookEvent` - il cherchait `nostrEvent` ou `manualEvent`.

**Solution initiale tentée :**
- Ajout de `executeWorkflowById()` dans WorkflowEngine
- Ajout de `processHookEvent()` dans QueueWorker

**Solution finale (après feedback utilisateur) :**
L'utilisateur a clarifié qu'il voulait les hooks **historisés** dans la queue, pas **traités** par la queue.

Refactoring :
- `HookEnqueueFn` → `HookRecordFn` (appelé après exécution, pas avant)
- Ajout de `recordHookExecution()` dans database.ts
- Les hooks s'exécutent directement puis sont enregistrés avec leur statut final

**Fichiers modifiés :**
- `src/core/workflow-engine.ts` - HookRecordFn, setHookRecorder()
- `src/persistence/database.ts` - recordHookExecution()
- `src/queue/queue-worker.ts` - Nettoyage code inutilisé
- `src/index.ts` - Configuration du recorder

**Commits :**
- `732c6ea` - feat: route hook-triggered workflows through queue
- `db3f57e` - refactor: hooks recorded after execution instead of queued

### 2. Diagramme Architecture

Création d'un schéma ASCII complet montrant :
- Sources (Nostr DM, Note, Webhook, API Poller)
- Event Queue avec statuts
- Workflow Engine (Trigger → Matcher → Actions → Hooks)
- Tous les handlers par catégorie (Messaging, Social, Storage, IoT)
- Flux de données complet (exemple API → DM → Hook)

### 3. Documentation Self-Hosted Hardware

**Évaluation du point backlog "Minimal Self-Hosted Hardware"**

Création de `docs/self-hosted-hardware.md` contenant :
- Prérequis techniques (CPU, RAM, Node.js)
- Options matérielles par tier de prix :
  - Budget (20-40€) : RPi Zero 2 W, Orange Pi Zero 3
  - Recommandé (50-80€) : RPi 4, RPi 5, Orange Pi 5
  - Mini PC (100-150€) : Intel N100, HP T620
- Coûts électriques annuels
- Comparaison VPS vs Self-Hosted
- Guide installation Raspberry Pi complet
- Configuration systemd
- Options accès distant (DDNS, Tailscale, Cloudflare Tunnel)
- Tableau de décision par usage

**Fichiers créés/modifiés :**
- `docs/self-hosted-hardware.md` (nouveau)
- `README.md` - Section Documentation ajoutée
- `BACKLOG.md` - Status → DONE

**Commit :**
- `d133da3` - docs: add self-hosted hardware guide

## Tests Effectués

### Hook Recording
```
Webhook POST /api/notify
  → api-to-nostr-dm (completed)
    → on_complete hook
      → zulip-workflow-notification (executed + recorded)

Monitoring shows:
id  event_type   status     workflow
8   api_webhook  completed  api-to-nostr-dm
11  hook         completed  zulip-workflow-notification
```

### Build Verification
- `npm run build` : OK après chaque modification

## Statuts Queue Supportés

| Status | Description |
|--------|-------------|
| `pending` | En attente |
| `processing` | En cours |
| `completed` | Succès |
| `failed` | Échec (retry possible) |
| `dead` | Échec définitif |
| `no_match` | Aucun workflow correspondant |
| `skipped_disabled` | Workflow(s) désactivé(s) |

## Points Techniques Notables

### Différence Enqueue vs Record

**Enqueue (webhooks, nostr events) :**
```
Event → Queue (pending) → Worker polls → Process → Update status
```

**Record (hooks) :**
```
Parent workflow → Execute hook directly → Record result in queue (completed/failed)
```

Avantage : Pas de double traitement, juste historisation pour monitoring.

### Architecture Queue Finale

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ Nostr Event │     │   Webhook   │     │    Hook     │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       │ enqueue           │ enqueue           │ record (after exec)
       ▼                   ▼                   ▼
┌─────────────────────────────────────────────────────┐
│                    EVENT_QUEUE                       │
│  - pending (nostr, webhook)                         │
│  - completed (all types including hooks)            │
└─────────────────────────────────────────────────────┘
```

## Problèmes Résolus

1. **Hook "Unsupported event type"** → Refactoré pour record au lieu de process
2. **Hooks non visibles dans monitoring** → Maintenant enregistrés après exécution

## Améliorations Futures Identifiées

- Dashboard web pour visualiser la queue (backlog existant)
- API REST pour replay/gestion queue (backlog existant)

## Commits du Jour

| Hash | Message |
|------|---------|
| `732c6ea` | feat: route hook-triggered workflows through queue |
| `db3f57e` | refactor: hooks recorded after execution instead of queued |
| `d133da3` | docs: add self-hosted hardware guide |

## Fichiers Modifiés

```
src/core/workflow-engine.ts      # HookRecordFn, setHookRecorder
src/persistence/database.ts      # recordHookExecution()
src/queue/queue-worker.ts        # Cleanup unused code
src/index.ts                     # Hook recorder configuration
docs/self-hosted-hardware.md     # New documentation
README.md                        # Documentation section
BACKLOG.md                       # Status update
```
