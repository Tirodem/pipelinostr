---
title: "Termux/Android Support"
priority: "High"
status: "DONE"
created: "2025-12-25"
completed: "2025-12-25"
---

### Termux/Android Support

**Priority:** High
**Status:** DONE (2025-12-25)

#### Description

Support complet de PipeliNostr sur Android via Termux.

#### Changements effectues

##### Migration sql.js (pas de compilation native)
- Remplacement de `better-sqlite3` par `sql.js` (pure WASM)
- Plus besoin de Python/node-gyp pour l'installation
- API async avec sauvegarde debounced sur disque

##### Script initialize.sh ameliore
- Detection automatique de la plateforme (Termux, Debian, RedHat, Alpine, macOS)
- Installation de Node.js si manquant
- Installation de sqlite3 CLI (pour monitoring.sh)
- Prompts optionnels pour Audio/TTS et GPIO
- chmod +x automatique sur tous les scripts

##### Corrections monitoring.sh
- Detection du chemin sqlite3 avec fallback pour Termux
- Compatible avec les sous-shells de `watch`

#### Installation sur Termux

```bash
pkg install git
git clone https://github.com/[user]/pipelinostr.git
cd pipelinostr
bash scripts/initialize.sh
```

#### Fichiers modifies

- `package.json` : sql.js au lieu de better-sqlite3
- `src/persistence/database.ts` : reecrit pour sql.js
- `scripts/initialize.sh` : detection plateforme, deps optionnelles
- `scripts/monitoring.sh` : chemin sqlite3 portable
