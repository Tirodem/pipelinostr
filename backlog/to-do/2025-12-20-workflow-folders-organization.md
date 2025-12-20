---
title: "Workflow Folders Organization"
priority: "Medium"
status: "Proposed"
created: "2025-12-20"
---

### Workflow Folders Organization

**Priority:** Medium
**Status:** Proposed

#### Description

Permettre d'organiser les workflows dans des sous-dossiers au lieu d'avoir tout à plat dans `config/workflows/`.

#### Use Case

Quand on a beaucoup de workflows, il devient difficile de s'y retrouver. Exemple d'organisation souhaitée :

```
config/workflows/
├── claudeDM/
│   ├── entry.yml
│   ├── insufficient-balance.yml
│   └── error-response.yml
├── notifications/
│   ├── zap-notification.yml
│   ├── dm-to-telegram.yml
│   └── dm-to-email.yml
├── gpio/
│   ├── led-control.yml
│   └── servo-control.yml
├── system/
│   ├── status.yml
│   └── dpo-command.yml
└── standalone.yml
```

#### Implémentation

1. Modifier `loadWorkflows()` pour scanner récursivement
2. L'ID du workflow reste unique (défini dans le YAML, pas par le chemin)
3. CLI `workflow list` affiche le chemin relatif
4. CLI `workflow load-missing` scanne récursivement

#### Considérations

- Les workflows existants à la racine continuent de fonctionner
- Pas de convention de nommage imposée
- Le dossier n'affecte pas l'ID du workflow
- Documentation à mettre à jour

#### Dépendances

Aucune
