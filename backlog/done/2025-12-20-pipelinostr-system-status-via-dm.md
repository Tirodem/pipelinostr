---
title: "PipeliNostr System Status via DM"
priority: "Medium"
status: "DONE"
created: "2025-12-20"
completed: "2025-12-20"
---

### PipeliNostr System Status via DM

**Priority:** Medium
**Status:** DONE

#### Description

Ajouter un handler et workflow permettant de consulter l'état système de PipeliNostr via un DM Nostr avec la commande `/pipelinostr status`.

#### Informations retournées

1. **Version** : Commit Git déployé (hash court + branche)
2. **Workflows** : Liste des workflows actifs/inactifs
3. **Handlers** : Liste des handlers enregistrés
4. **Dernières exécutions** : 10 dernières exécutions de workflows
5. **Ressources système** : RAM, CPU, disque
6. **OS** : Type, version, hostname, uptime

#### Implémentation

- **Handler** : `src/outbound/system.handler.ts`
  - Action `status` : retourne toutes les infos formatées
  - Action `health` : health check rapide (database, disk, memory)
- **Workflow** : `examples/workflows/pipelinostr-status.yml.example`
- **Commande** : `/pipelinostr status`

#### Exemple de réponse

```
📊 PipeliNostr Status

🔖 Version: 2b4e277 (main)

📋 Workflows: 12/15 enabled
  ✅ zulip-forward: Forward DMs to Zulip
  ✅ zap-notification: Zap notifications
  ❌ auto-reply: Auto-respond (disabled)

🔌 Handlers: 12
  http, nostr_dm, nostr_note, telegram, zulip, ...

📜 Recent executions (10):
  ✅ zulip-forward
  ✅ zap-notification
  ❌ nostr-to-email (failed)

💻 System: Linux 5.15.0
  Platform: linux/arm64
  Hostname: pipelinostr-rpi
  Uptime: 5d 12h 30m

📊 Resources:
  CPU: 4 cores (Cortex-A72)
  RAM: 512MB / 4096MB (12%)
  Disk: 8GB / 32GB (25%)

🕐 2025-12-20T15:30:00.000Z
```

---


---
