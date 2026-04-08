# Cheat Sheet - Formats DM Nostr pour Tests

Guide rapide des formats de DM à envoyer pour tester les workflows PipeliNostr.

> **Note** : Tous les DM doivent être envoyés depuis un npub présent dans la whitelist.

---

## Messaging / Social

### Telegram
```
[telegram] Votre message ici
```
*Workflow : `nostr-to-telegram.yml`*
*Prérequis : Bot Telegram configuré*

---

### Zulip (forward simple)
```
N'importe quel message
```
*Workflow : `zulip-forward.yml` - Forward TOUS les DM vers Zulip*
*Prérequis : Handler Zulip configuré*

---

### Mastodon
```
Mastodon: Votre message public ici
```
*Workflow : `dm-to-mastodon.yml`*
*Prérequis : App Mastodon avec scope write:statuses*

Exemple :
```
Mastodon: Hello world from Nostr! 🚀
```

---

### Bluesky
```
Bluesky: Votre message ici (max 300 caractères)
```
*Workflow : `dm-to-bluesky.yml`*
*Prérequis : App Password Bluesky*

Exemple :
```
Bluesky: Test depuis Nostr via PipeliNostr 🦋
```

---

## Communication

### Email
```
Send email to destinataire@example.com: Votre message
```
*Workflow : `nostr-to-email.yml`*
*Prérequis : SMTP configuré*

Exemples :
```
Send email to alice@example.com: Bonjour Alice!
Send email to bob@test.com, charlie@test.com: Message multi-destinataires
```

---

### SMS (via Traccar)
```
Send SMS to +33612345678: Votre message
```
*Workflow : `nostr-to-sms.yml`*
*Prérequis : Traccar SMS Gateway sur téléphone Android*

Exemples :
```
Send SMS to +33612345678: RDV confirmé pour demain
Send SMS to +33611111111, +33622222222: Alerte groupe
```

---

### Calendar (Invitation iCal)
```
Invite email@example.com: Titre réunion @ 2025-12-15 14:00 (1h) @ Lieu
```
*Workflow : `nostr-to-calendar.yml`*
*Prérequis : SMTP configuré*

Format :
```
Invite <emails>: <titre> @ <YYYY-MM-DD HH:MM> (<durée>) @ <lieu optionnel>
```

Durées : `30m`, `1h`, `1h30m`, `2h`

Exemples :
```
Invite alice@example.com: Weekly sync @ 2025-12-20 09:00 (30m)
Invite bob@company.com: Project review @ 2025-12-15 14:00 (1h30m) @ Salle B12
Invite a@x.com, b@x.com: Standup @ 2025-12-16 10:00 (15m) @ https://meet.google.com/xxx
```

---

## Storage / Data

### FTP (append log)
```
ftp: Votre message à logger
```
*Workflow : `dm-to-ftp.yml`*
*Prérequis : Serveur FTP configuré*

Exemple :
```
ftp: Événement important survenu
```
→ Append dans `/logs/nostr-dm-2025-12-11.log`

---

### MongoDB
```
mongo: Vos données à stocker
mongo:category: Données avec catégorie
```
*Workflow : `dm-to-mongodb.yml`*
*Prérequis : MongoDB Atlas ou local*

Exemples :
```
mongo: User clicked button X
mongo:error: API timeout on /users
mongo:metric: response_time=250ms
```

---

## Utilities

### Mempool.space (Bitcoin TX Lookup)
```
mempool: <txid 64 caractères hex>
```
*Workflow : `mempool-tx-lookup.yml`*
*Prérequis : Aucun (API publique)*

Exemple :
```
mempool: 15e10745f15593a899cef391191bdd3d7c12412cc4696b7bcb669d0feadc8521
```

→ Répond avec détails : montant, frais, statut, bloc...

---

## API Webhook (Entrante)

### Via curl (pas un DM)
```bash
curl -X POST http://localhost:3000/api/notify \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello from API", "priority": "high"}'
```
*Workflow : `api-to-nostr-dm.yml`*
*Prérequis : Webhook server activé sur port 3000*

---

## Résumé Rapide

| Préfixe | Destination | Exemple |
|---------|-------------|---------|
| `[telegram]` | Telegram | `[telegram] Hello` |
| `Mastodon:` | Mastodon | `Mastodon: Hello` |
| `Bluesky:` | Bluesky | `Bluesky: Hello` |
| `Send email to X:` | Email | `Send email to a@b.com: Hello` |
| `Send SMS to X:` | SMS | `Send SMS to +336...: Hello` |
| `Invite X:` | Calendar | `Invite a@b.com: Meeting @ 2025-12-15 14:00 (1h)` |
| `ftp:` | FTP Log | `ftp: Event logged` |
| `mongo:` | MongoDB | `mongo: Data to store` |
| `mempool:` | Bitcoin TX | `mempool: <txid>` |
| *(tout DM)* | Zulip | Forward automatique |

---

## GPIO (à venir - session RPi)

```
[gpio] on
[gpio] off
[gpio] on pin:27
[gpio] toggle
```
*Workflow : `nostr-to-gpio.yml` (à créer)*

---

## Notes

- **Case insensitive** : `Mastodon:`, `mastodon:`, `MASTODON:` fonctionnent tous
- **Espaces** : Les espaces après `:` sont optionnels
- **Whitelist** : Seuls les npubs dans `config/config.yml > whitelist.npubs` peuvent déclencher les workflows
- **Monitoring** : Voir les exécutions avec `./scripts/monitoring.sh`
