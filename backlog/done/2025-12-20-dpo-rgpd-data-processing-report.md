---
title: "DPO / RGPD Data Processing Report"
priority: "High"
status: "DONE"
created: "2025-12-20"
completed: "2025-12-20"
---

### DPO / RGPD Data Processing Report

**Priority:** High
**Status:** DONE

#### Description

Générer un rapport Markdown décrivant tous les traitements de données effectués par PipeliNostr, pour conformité RGPD et intégration dans les pages Terms of Use / Privacy d'un be-BOP.

#### Déclencheurs

1. **Script CLI** : `./scripts/DPO.sh` → génère le rapport dans `reports/dpo-report.md`
2. **Commande Nostr** : DM `/dpo` à la npub de PipeliNostr → répond avec le rapport

#### Contenu du rapport (Markdown)

```markdown
# Rapport de traitement des données - PipeliNostr

Généré le : 2025-12-16 14:30:00

## Workflows


---
