# QA Session 2025-12-20

## Objectif
Implémentation et debug du système ClaudeDM avec balance tracking via zaps.

## Travail effectué

### 1. Fix schéma workflow_state
**Problème :** Deux entrées de balance pour la même npub à cause de `UNIQUE(workflow_id, namespace, state_key)`.

**Solution :**
- Changé contrainte UNIQUE en `(namespace, state_key)`
- `workflow_id` devient metadata (dernier workflow à avoir modifié)
- Mise à jour de toutes les méthodes DB (getState, setState, deleteState, listStates)

**Fichiers modifiés :**
- `src/persistence/database.ts`

**Migration SQL :** `tmp/migrate-workflow-state.sql`

### 2. Workflows ClaudeDM créés

| Workflow | Description |
|----------|-------------|
| `zap-balance-tracker` | Incrémente le solde quand un zap est reçu |
| `zap-balance-tracker-notification` | Envoie DM de confirmation après zap |
| `claudeDM-check-balance` | Commande `/claudeDM: solde` pour voir son solde |
| `claudeDM-balance-gate` | Point d'entrée avec vérification de solde |

### 3. Fix rebuild.sh
**Problème :** `git pull` ne récupérait pas toujours les derniers commits.

**Solution :** Ajout `git fetch origin` explicite avant `git pull`.

### 4. Fix chemins template Handlebars
**Problème :** `actions.*.response.data.value` ne fonctionnait pas.

**Solution :** Le chemin correct est `actions.*.response.value` (sans `.data`).

**Debug effectué :** Template de test avec tous les chemins possibles pour identifier le bon format.

## Bugs découverts et corrigés

| Bug | Cause | Fix |
|-----|-------|-----|
| Doublons de balance | UNIQUE incluait workflow_id | UNIQUE(namespace, state_key) |
| rebuild.sh incomplet | git pull sans fetch | Ajout git fetch origin |
| Template vide | Mauvais chemin `.response.data.value` | Chemin `.response.value` |
| Notification sans valeurs | `parent.trigger.*` au lieu de `trigger.*` | Accès direct à `trigger.*` |

## Conventions établies

### Chemins template pour actions
```yaml
# CORRECT
{{ actions.get_balance.response.value }}
{{ actions.get_balance.response.found }}

# INCORRECT (ne fonctionne pas)
{{ actions.get_balance.response.data.value }}
```

### Accès au contexte parent (hooks)
```yaml
# trigger et match sont directement accessibles
{{ trigger.zap.sender }}
{{ match.question }}

# Seules les variables nécessitent parent.*
{{ parent.variables.min_balance_sats }}
```

## Commandes de déploiement
```bash
./scripts/rebuild.sh
./scripts/pipelinostr.sh workflow refresh <ids>
./scripts/pipelinostr.sh workflow enable <ids>
```

## Tests effectués

| Test | Résultat |
|------|----------|
| `/claudeDM: solde` | OK - Affiche le solde correct |
| Zap reçu | OK - Balance incrémentée + notification DM |
| Migration DB | OK - Doublons fusionnés |

## Notes
- Le debug logging a été conservé dans workflow-db.handler.ts pour faciliter le diagnostic futur
- La documentation CLAUDE.md a été mise à jour avec les règles de vérification post-push
