# FAQ - Foire Aux Questions

Questions fréquentes sur PipeliNostr et leurs réponses.

---

## Débogage & Tests

### Comment forcer l'échec d'un workflow pour tester les retries ?

Plusieurs méthodes :

1. **Désactiver un handler requis** dans sa config
2. **Configurer une URL invalide** pour le handler HTTP
3. **Utiliser un token/credential invalide**
4. **Simuler une panne réseau** (couper la connexion)

Exemple avec le handler Zulip :
```yaml
# config/handlers/zulip.yml
zulip:
  enabled: true
  base_url: "https://invalid.zulip.example.com"  # URL invalide
```

### Comment voir le contenu de la table event_queue ?

```bash
# Vue simple des 20 derniers événements
sqlite3 -header -column ./data/pipelinostr.db \
  "SELECT id, event_type, status, retry_count, workflow_id, error_message
   FROM event_queue ORDER BY created_at DESC LIMIT 20;"

# Statistiques par statut
sqlite3 ./data/pipelinostr.db \
  "SELECT status, COUNT(*) as count FROM event_queue GROUP BY status;"

# Événements en erreur
sqlite3 -header -column ./data/pipelinostr.db \
  "SELECT * FROM event_queue WHERE status IN ('failed', 'dead');"
```

### Comment vérifier sur quel port le webhook server écoute ?

```bash
# Vérifier les ports en écoute par Node.js
netstat -tlnp | grep node

# Ou avec lsof
lsof -i -P -n | grep node | grep LISTEN

# Ou vérifier dans les logs au démarrage
grep -i "webhook.*listening\|port" ./logs/pipelinostr.log
```

Le port est configuré dans `config/handlers/webhook.yml` :
```yaml
webhook:
  port: 3000  # Par défaut
```

### Comment rejouer un événement échoué ?

```bash
# Via SQLite - remettre en pending
sqlite3 ./data/pipelinostr.db \
  "UPDATE event_queue SET status = 'pending', retry_count = 0 WHERE id = <ID>;"

# Rejouer tous les événements failed
sqlite3 ./data/pipelinostr.db \
  "UPDATE event_queue SET status = 'pending' WHERE status = 'failed';"
```

---

## Configuration

### Quelle est la différence entre `from_whitelist` et `from_npubs` ?

| Filtre | Description |
|--------|-------------|
| `from_whitelist: true` | Accepte tous les npubs listés dans `config.yml` > `whitelist.npubs` |
| `from_npubs: [npub1..., npub2...]` | Accepte uniquement ces npubs spécifiques |

`from_whitelist` est pratique pour une whitelist globale partagée entre workflows.
`from_npubs` permet un contrôle fin par workflow.

### Comment utiliser les variables d'environnement dans les configs ?

```yaml
# Dans config.yml ou tout fichier YAML
nostr:
  private_key: ${NOSTR_PRIVATE_KEY}

# Dans le handler
zulip:
  api_key: ${ZULIP_API_KEY}
  email: ${ZULIP_EMAIL}
```

Les variables sont résolues au chargement depuis le fichier `.env` ou l'environnement système.

### Puis-je avoir plusieurs workflows qui matchent le même événement ?

Oui. Tous les workflows dont le trigger matche seront exécutés.

Ordre d'exécution :
1. Par priorité (si définie)
2. Par ordre alphabétique du fichier

---

## Architecture

### Quelle est la différence entre les handlers "inbound" et "outbound" ?

**Inbound (entrée)** - Sources d'événements :
- `NostrListener` : Écoute les événements Nostr (DM, notes, zaps)
- `WebhookServer` : Reçoit les requêtes HTTP POST
- `ApiPoller` : Poll des APIs externes
- `Scheduler` : Déclenche sur cron

**Outbound (sortie)** - Actions/destinations :
- `nostr_dm`, `nostr_note` : Envoie sur Nostr
- `email`, `telegram`, `zulip`, etc. : Messagerie
- `http` : Appels API
- `file`, `ftp`, `s3`, etc. : Stockage
- `gpio`, `mqtt`, `serial`, etc. : IoT

### Comment fonctionne la queue d'événements ?

```
┌─────────────┐
│ Event reçu  │
└──────┬──────┘
       │ enqueue
       ▼
┌─────────────┐
│   PENDING   │ ← Stocké en SQLite
└──────┬──────┘
       │ worker poll
       ▼
┌─────────────┐
│ PROCESSING  │ ← Verrouillé pour traitement
└──────┬──────┘
       │
   ┌───┴───┐
   ▼       ▼
COMPLETED  FAILED
           │
           │ retry (si < max_retries)
           ▼
        PENDING (avec délai backoff)
           │
           │ après max_retries
           ▼
         DEAD
```

### Les hooks passent-ils par la queue ?

Non. Les hooks (on_start, on_complete, on_fail) sont :
1. Exécutés directement par le WorkflowEngine
2. Enregistrés dans la queue avec leur statut final (pour l'historique/monitoring)

Cela évite un double traitement tout en gardant la traçabilité.

---

## Monitoring

### Comment surveiller la queue en temps réel ?

```bash
# Script de monitoring fourni
./scripts/monitoring.sh

# Ou manuellement avec watch
watch -n 2 "sqlite3 -header -column ./data/pipelinostr.db \
  'SELECT id, event_type, status, workflow_id FROM event_queue
   ORDER BY created_at DESC LIMIT 15;'"
```

### Que signifient les différents statuts de la queue ?

| Statut | Signification |
|--------|---------------|
| `pending` | En attente de traitement |
| `processing` | En cours de traitement |
| `completed` | Traitement réussi |
| `failed` | Échec (sera réessayé) |
| `dead` | Échec définitif (max retries atteint) |
| `no_match` | Aucun workflow n'a matché l'événement |
| `skipped_disabled` | Workflow(s) trouvé(s) mais désactivé(s) |

---

## Déploiement

### VPS ou self-hosted ?

| Critère | VPS (5€/mois) | Raspberry Pi |
|---------|---------------|--------------|
| Simplicité | ✅ Plus simple | ❌ Config réseau |
| IP fixe | ✅ Incluse | ❌ DDNS requis |
| GPIO/IoT | ❌ Non | ✅ Oui |
| Coût long terme | 60€/an | ~7€/an (électricité) |

**Recommandation :**
- Nostr only → VPS
- Avec hardware IoT → Raspberry Pi

Voir [Self-Hosted Hardware Guide](self-hosted-hardware.md) pour plus de détails.

### Comment configurer un service systemd ?

```bash
sudo nano /etc/systemd/system/pipelinostr.service
```

```ini
[Unit]
Description=PipeliNostr
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/pipelinostr
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable pipelinostr
sudo systemctl start pipelinostr
```

---

## Nostr Spécifique

### Comment trouver mon npub depuis ma clé privée ?

```bash
# Avec nak (CLI Nostr)
nak key public <nsec1...>

# Ou dans Node.js
import { getPublicKey, nip19 } from 'nostr-tools';
const pubkey = getPublicKey(privateKeyHex);
const npub = nip19.npubEncode(pubkey);
```

### Quels kinds Nostr sont supportés ?

Tous les kinds peuvent être écoutés. Les plus courants :

| Kind | Type | Description |
|------|------|-------------|
| 1 | Note | Post public |
| 4 | DM (NIP-04) | Message privé chiffré |
| 7 | Reaction | Like/réaction |
| 9735 | Zap Receipt | Notification de zap |
| 20000+ | Custom | Événements personnalisés (webhooks) |

### Comment répondre à l'expéditeur d'un DM ?

```yaml
actions:
  - id: reply
    type: nostr_dm
    config:
      to: "{{ trigger.from }}"  # npub de l'expéditeur
      content: "Message reçu !"
```

---

## Erreurs Courantes

### "Handler not found: xxx"

Le handler n'est pas enregistré. Vérifier :
1. Le handler est activé dans `config/handlers/<handler>.yml`
2. Le type dans l'action correspond (ex: `zulip`, pas `Zulip`)

### "No workflow matched"

L'événement ne correspond à aucun workflow. Vérifier :
1. Au moins un workflow est `enabled: true`
2. Les filtres du trigger correspondent (kind, from_whitelist, pattern)
3. Le regex `content_pattern` est correct

### "Event stuck in processing"

Un événement reste bloqué en `processing`. Causes possibles :
- Crash pendant le traitement
- Timeout non géré

Solution :
```bash
# Reset manuel
sqlite3 ./data/pipelinostr.db \
  "UPDATE event_queue SET status = 'pending' WHERE status = 'processing';"

# Ou attendre le cleanup automatique (toutes les 100 polls)
```
