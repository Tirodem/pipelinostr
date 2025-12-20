---
title: "Performance Monitoring & Logging"
priority: "Medium"
status: "Proposed"
created: "2025-12-20"
---

### Performance Monitoring & Logging

**Priority:** Medium
**Status:** Proposed

#### Description

Ajouter un système de monitoring des performances de PipeliNostr pour suivre la consommation RAM/CPU au repos et pendant l'exécution des workflows.

#### Spécifications

**Stockage (nouvelle table SQLite):**

```sql
CREATE TABLE performance_log (
  id INTEGER PRIMARY KEY,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  type TEXT NOT NULL,  -- 'idle' | 'workflow_start' | 'workflow_end'
  workflow_id TEXT,
  workflow_name TEXT,

  -- Process Node.js
  heap_used_mb REAL,
  heap_total_mb REAL,
  rss_mb REAL,

  -- CPU (temps cumulé)
  cpu_user_ms INTEGER,
  cpu_system_ms INTEGER,

  -- Système
  load_avg_1m REAL,
  system_free_mb REAL,
  system_total_mb REAL
);
```

**Types de mesures:**

| Type | Quand | Données capturées |
|------|-------|-------------------|
| `idle` | Toutes les 5 minutes (configurable) | Mémoire + CPU + load |
| `workflow_start` | Avant exécution workflow | Snapshot avant |
| `workflow_end` | Après exécution workflow | Snapshot après + delta |

**Configuration:**
- Intervalle idle : 5 minutes (configurable dans config.yml)
- Rétention : 100 dernières mesures
- Alertes : mécanisme préparé mais inactif par défaut

**CLI:**

```bash
# Résumé global
./scripts/pipelinostr.sh perf

# Dernière mesure idle
./scripts/pipelinostr.sh perf idle --last

# Moyenne/médiane des 10 dernières mesures idle
./scripts/pipelinostr.sh perf idle --stats

# Consommation par workflow (moyenne)
./scripts/pipelinostr.sh perf workflows

# Détail d'un workflow spécifique
./scripts/pipelinostr.sh perf workflow zulip-forward
```

**Exemple d'output:**

```
=== PipeliNostr Performance ===

Idle (last 10 samples, every 5min):
  Heap: 45MB avg / 42MB median (38-52MB range)
  RSS:  98MB avg / 95MB median
  Load: 0.12 avg

Per-workflow (last 10 executions):
  zulip-forward:     +2.1MB heap, 45ms avg
  zap-notification:  +1.8MB heap, 38ms avg
  pipelinostr-status: +0.5MB heap, 12ms avg
```

#### Tâches d'implémentation

- [ ] Créer table performance_log dans database.ts
- [ ] Créer classe PerformanceMonitor avec capture des métriques
- [ ] Ajouter sampling idle (setInterval 5min)
- [ ] Intégrer avec workflow engine (hooks before/after)
- [ ] Ajouter cleanup rétention (garder 100 dernières)
- [ ] Préparer mécanisme d'alertes (inactif)
- [ ] Ajouter commandes `perf` au CLI pipelinostr.sh

---


---
