---
title: "SMS Gateway for Android (capcom6)"
priority: "Medium"
status: "Proposed"
created: "2025-12-20"
---

### SMS Gateway for Android (capcom6)

**Priority:** Medium
**Status:** Proposed

#### Description

Intégrer **SMS Gateway for Android** comme alternative open source à Traccar SMS Gateway pour l'envoi et la réception de SMS.

#### Source

- Repo: https://github.com/capcom6/android-sms-gateway
- Docs: https://docs.sms-gate.app
- Licence: Apache-2.0

#### Pourquoi ce choix

| Avantage | Description |
|----------|-------------|
| Open source | Apache-2.0, code auditable |
| Self-hosted | Mode Local = aucun tiers externe |
| Bidirectionnel | Envoi ET réception de SMS |
| Webhooks natifs | Notification automatique des SMS entrants |
| Multi-SIM | Choix de la SIM pour l'envoi |
| Android 5.0+ | Compatible anciens téléphones |

#### Architecture d'intégration

**SMS → Nostr (réception) :**
```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ SMS entrant │────►│ SMS Gateway │────►│ PipeliNostr │
│ (téléphone) │     │ (webhook)   │     │ (kind 14?)  │
└─────────────┘     └─────────────┘     └─────────────┘
```

1. SMS Gateway reçoit un SMS sur le téléphone Android
2. Webhook POST vers PipeliNostr :
```json
{
  "event": "sms:received",
  "payload": {
    "message": "contenu du SMS",
    "phoneNumber": "+33612345678",
    "receivedAt": "2024-12-19T10:00:00Z"
  }
}
```
3. PipeliNostr transforme en event Nostr (kind configurable)

**Nostr → SMS (envoi) :**
```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ Nostr DM    │────►│ PipeliNostr │────►│ SMS Gateway │
│ "sms:+33..."│     │ (handler)   │     │ (API REST)  │
└─────────────┘     └─────────────┘     └─────────────┘
```

1. PipeliNostr reçoit un event Nostr (ex: kind 4 DM)
2. POST vers l'API locale du téléphone :
```bash
POST http://<phone-ip>:8080/message
Authorization: Basic <base64>
{
  "phoneNumbers": ["+33612345678"],
  "message": "contenu"
}
```

#### Configuration handler

```yaml
# config/handlers/sms-gateway.yml
sms_gateway:
  enabled: true
  mode: local  # local | cloud | private

  # API du téléphone Android
  host: "192.168.1.50"
  port: 8080
  credentials:
    username: ${SMS_GATEWAY_USER}
    password: ${SMS_GATEWAY_PASS}

  # Réception SMS (inbound)
  webhook:
    enabled: true
    path: "/webhooks/sms-gateway"
    events: ["sms:received"]

  # Mapping Nostr
  mapping:
    inbound:
      kind: 14           # Kind Nostr pour SMS reçus (ou custom)
      tagPhone: true     # Ajouter tag ["phone", "+33..."]
    outbound:
      triggerKinds: [4, 14]    # Kinds qui déclenchent l'envoi
      phoneFromTag: "phone"    # Extraire le numéro du tag

  # Options d'envoi
  sim_number: 1  # 1 ou 2 pour dual-SIM
  with_delivery_report: true
```

#### Workflow exemple (envoi)

```yaml
id: nostr-to-sms-gateway
name: Send SMS via SMS Gateway
enabled: true

trigger:
  type: nostr_event
  filters:
    kinds: [4]
    from_whitelist: true
    content_pattern: "^sms:\\s*(?<phone>\\+?[0-9]+)\\s+(?<message>.+)$"

actions:
  - id: send_sms
    type: sms_gateway
    config:
      to: "{{ match.phone }}"
      message: "{{ match.message }}"

  - id: confirm
    type: nostr_dm
    config:
      to: "{{ trigger.from }}"
      content: "SMS envoyé à {{ match.phone }}"
```

#### Workflow exemple (réception)

```yaml
id: sms-to-nostr-dm
name: Forward received SMS to Nostr DM
enabled: true

trigger:
  type: sms_gateway_webhook
  filters:
    events: ["sms:received"]

actions:
  - id: forward_dm
    type: nostr_dm
    config:
      to: "npub1_admin..."
      content: |
        SMS reçu de {{ trigger.phoneNumber }}:
        {{ trigger.message }}
```

#### Comparaison avec Traccar SMS

| Aspect | Traccar SMS | SMS Gateway |
|--------|-------------|-------------|
| Envoi SMS | Oui | Oui |
| Réception SMS | Non | Oui (webhook) |
| Open source | Non | Oui (Apache-2.0) |
| Mode cloud | Non | Oui (optionnel) |
| Multi-SIM | Non | Oui |
| API | REST simple | REST + webhooks |

#### Implémentation

- Fichier : `src/outbound/sms-gateway.handler.ts`
- Fichier : `src/inbound/sms-gateway-webhook.ts` (pour réception)
- Complexité : ~200-300 lignes
- Tests : Téléphone Android avec l'app installée

#### Prérequis

1. Téléphone Android 5.0+ avec carte SIM
2. App SMS Gateway installée : [Play Store](https://play.google.com/store/apps/details?id=me.capcom.smsgateway)
3. Téléphone et PipeliNostr sur le même réseau (mode local)

#### Tâches d'implémentation

- [ ] Créer le module handler `sms-gateway.handler.ts`
- [ ] Implémenter le client HTTP pour l'API d'envoi
- [ ] Implémenter le endpoint webhook pour la réception
- [ ] Gestion des credentials et retry logic
- [ ] Tests avec téléphone Android
- [ ] Documentation dans `docs/SMS-GATEWAY-SETUP.md`

---


---
