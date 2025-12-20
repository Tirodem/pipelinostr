---
title: "Claude Workflow Explainer (`/explain <id>`)"
priority: "Low"
status: "Proposed"
created: "2025-12-20"
---

### Claude Workflow Explainer (`/explain <id>`)

**Priority:** Low
**Status:** Proposed

#### Description

Ajouter une commande `/explain <id>` au handler Claude pour expliquer un workflow existant en langage naturel.

#### Use Case

L'utilisateur veut comprendre ce que fait un workflow sans lire le YAML :

```
User: /explain zap-to-dispenser

PipeliNostr: 📋 Workflow "zap-to-dispenser"

Ce workflow se déclenche quand vous recevez un zap d'au moins 21 sats.

**Actions :**
1. Active un servo moteur sur GPIO 18 (mouvement 0° → 180° → 0°)
2. Enregistre le zap dans un fichier log
3. Envoie un DM de remerciement à l'expéditeur

**Prérequis :** pigpiod daemon, servo sur GPIO 18
```

#### Implémentation

- Ajouter pattern `/explain` dans `claude-activate.yml` ou créer `claude-explain.yml`
- Lire le fichier workflow demandé depuis `config/workflows/`
- Envoyer le YAML à Claude avec un prompt "explique ce workflow simplement"
- Retourner l'explication en DM

#### Sécurité

- Même restrictions que `/workflow` : Claude ne peut que lire et expliquer
- Ne pas exposer les secrets/tokens présents dans les workflows

---


---
