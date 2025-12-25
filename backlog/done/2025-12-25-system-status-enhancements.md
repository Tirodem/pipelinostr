---
title: "System Status Enhancements (/pipelinostr status)"
priority: "Medium"
status: "DONE"
created: "2025-12-25"
completed: "2025-12-25"
---

### System Status Enhancements

**Priority:** Medium
**Status:** DONE (2025-12-25)

#### Description

Amelioration de la commande `/pipelinostr status` pour afficher plus d'informations systeme, notamment sur Android.

#### Changements effectues

##### Detection CPU Android
- Fallback vers `/proc/cpuinfo` si `os.cpus()` retourne des donnees incompletes
- Lecture du champ `Hardware` (Android)
- Lecture de `model name` (x86/x64)
- Lecture de `CPU implementer` + `CPU part` (ARM)

##### Affichage Load Average
- Ajout de la charge CPU (1/5/15 minutes)
- Format : `Load: 0.50 / 0.45 / 0.40 (1/5/15 min)`

##### RAM PipeliNostr
- Ajout de `process.memoryUsage()` pour la RAM du processus Node.js
- Affichage : `PipeliNostr RAM: XXmb (heap: YY/ZZmb)`
- RSS = memoire totale du processus
- heapUsed/heapTotal = memoire JavaScript

##### Queue activee par defaut
- `config.yml.example` : `queue.enabled: true` (recommande)

#### Exemple de sortie

```
📊 Resources:
  CPU: 8 cores (Qualcomm SM8150)
  Load: 0.50 / 0.45 / 0.40 (1/5/15 min)
  RAM: 6915MB / 11437MB (60%)
  PipeliNostr RAM: 180MB (heap: 55/91MB)
  Disk: 50GB / 128GB (39%)
```

#### Fichiers modifies

- `src/outbound/system.handler.ts` : detection CPU, load avg, process memory
- `config/config.yml.example` : queue enabled par defaut
