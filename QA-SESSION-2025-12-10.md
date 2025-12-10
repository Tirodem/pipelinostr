# Session QA PipeliNostr - 10 Décembre 2025

## Contexte

Déploiement sur serveur Linux (vmi2769927) pour QA après implémentation de :
- Handlers Hardware/IoT (Serial, GPIO, MQTT, BLE, USB HID, I2C)
- Handlers DevOps (GitHub, GitLab)
- Handlers Inbound (Webhook Server, API Poller, Scheduler)

## Configuration actuelle

### Serveur
- Chemin : `~/pipelinostr`
- Logs : `~/pipelinostr/logs/pipelinostr.log`
- Lancement : `nohup npm start > logs/pipelinostr.log 2>&1 &`

### Handlers activés
- Tous désactivés SAUF Zulip et Nostr (natif)
- Commande utilisée : `sed -i 's/enabled: true/enabled: false/g' config/handlers/*.yml && sed -i 's/enabled: false/enabled: true/g' config/handlers/zulip.yml`

### Zulip Config (`config/handlers/zulip.yml`)
```yaml
zulip:
  enabled: true
  site_url: "https://be-bop.zulipchat.com"
  email: "pipelinostr-bot@be-bop.zulipchat.com"
  api_key: ${ZULIP_API_KEY}
  default_stream: "<à vérifier>"
  default_topic: "<à vérifier>"
```

### Workflows
- `email-forward.yml` : désactivé (enabled: false)
- `zulip-forward.yml` : créé et actif
- Autres workflows : à vérifier, certains avaient une regex invalide `(?i)`

## Problèmes rencontrés

### 1. Regex invalide (RÉSOLU)
```
ERROR: Invalid regex pattern
pattern: "(?i)^(hello|hi|hey|bonjour|salut)\b"
```
- Cause : `(?i)` n'est pas valide en JavaScript regex
- Solution : Désactiver les workflows concernés

### 2. Handler email not found (RÉSOLU)
```
ERROR: Handler not found
actionId: "send_email"
type: "email"
```
- Cause : Workflow email-forward actif mais handler email désactivé
- Solution : Désactiver le workflow

### 3. Erreur SQLite FK constraint (RÉSOLU)
```
ERROR: Failed to log action execution
error: { "code": "SQLITE_CONSTRAINT_FOREIGNKEY" }
```
- **Cause identifiée** : Dans `src/core/workflow-engine.ts` ligne 292, `event_log_id: 0` violait la contrainte FK car l'ID 0 n'existe pas dans `event_log`
- **Solution** :
  - Modifié `WorkflowExecution.event_log_id` pour être optionnel (`number | null | undefined`)
  - Passé `null` au lieu de `0` dans `workflow-engine.ts`
  - Ajouté `?? null` dans `database.ts` pour gérer le cas undefined
- **Fichiers modifiés** :
  - `src/persistence/models/workflow-execution.ts`
  - `src/core/workflow-engine.ts`
  - `src/persistence/database.ts`

## État des logs

Zulip handler bien initialisé :
```
INFO: Zulip handler initialized
    siteUrl: "https://be-bop.zulipchat.com"
    email: "pipelinostr-bot@be-bop.zulipchat.com"
INFO: Zulip handler enabled
```

Mais workflow échoue :
```
INFO: Executing workflow
    workflowId: "zulip-forward"
    workflowName: "Forward DM to Zulip"
ERROR: Failed to log action execution
    error: { "code": "SQLITE_CONSTRAINT_FOREIGNKEY" }
INFO: Workflow completed
    workflowId: "zulip-forward"
    success: false
    executed: 0
    failed: 1
```

## Prochaines étapes

1. ~~Vérifier le contenu de `zulip-forward.yml` (format params vs config)~~ FAIT
2. ~~Chercher l'erreur réelle de l'action (au-delà de l'erreur SQL)~~ FAIT - c'était le bug FK
3. ~~Possiblement un bug dans le code de logging~~ RÉSOLU
4. Déployer la nouvelle version sur le serveur
5. Supprimer la DB pour recréer le schéma proprement
6. Tester le workflow zulip-forward

## Commandes utiles

```bash
# Redémarrer
pkill -9 -f node && cd ~/pipelinostr && nohup npm start > logs/pipelinostr.log 2>&1 &

# Logs temps réel
tail -f ~/pipelinostr/logs/pipelinostr.log

# Filtrer logs
grep -i "zulip" ~/pipelinostr/logs/pipelinostr.log
grep -E "(ERROR|error)" ~/pipelinostr/logs/pipelinostr.log | tail -20

# Vérifier workflows actifs
grep -l "enabled: true" ~/pipelinostr/config/workflows/*.yml

# Contenu workflow
cat ~/pipelinostr/config/workflows/zulip-forward.yml
```

## À demander à l'utilisateur

1. Contenu exact de `zulip-forward.yml`
2. Résultat de : `grep -E "(ERROR|error|fail)" ~/pipelinostr/logs/pipelinostr.log | grep -v "SQLITE_CONSTRAINT" | tail -20`
