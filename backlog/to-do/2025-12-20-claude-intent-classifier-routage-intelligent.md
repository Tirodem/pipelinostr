---
title: "Claude Intent Classifier (Routage intelligent)"
priority: "Medium"
status: "Proposed"
created: "2025-12-20"
---

### Claude Intent Classifier (Routage intelligent)

**Priority:** Medium
**Status:** Proposed

#### Description

Utiliser Claude pour classifier l'intention d'un message et router vers le workflow approprié, sans regex complexes.

#### Use Case

```
User: "Allume la lumière du salon"
→ Claude classifie: intent=gpio, device=salon, action=on
→ Route vers workflow nostr-to-gpio

User: "Envoie un message sur Telegram pour dire bonjour"
→ Claude classifie: intent=telegram, message="bonjour"
→ Route vers workflow nostr-to-telegram
```

#### Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  DM entrant     │────►│ Claude classify │────►│ Workflow ciblé  │
│  (texte libre)  │     │ (intent+params) │     │ (exécution)     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

#### Workflow exemple

```yaml
id: claude-intent-router
name: Claude Intent Router
enabled: false

trigger:
  type: nostr_event
  filters:
    kinds: [4, 1059]
    from_whitelist: true

actions:
  - id: classify
    type: claude
    config:
      action: classify
      intents:
        - id: gpio
          description: "Contrôler un appareil domotique (lumière, etc.)"
          params: ["device", "action"]
        - id: telegram
          description: "Envoyer un message sur Telegram"
          params: ["message"]
        - id: email
          description: "Envoyer un email"
          params: ["to", "subject", "body"]
        - id: unknown
          description: "Intention non reconnue"
      message: "{{ trigger.content }}"

  # Exécuter le workflow correspondant selon l'intent
  - id: route_gpio
    type: workflow_trigger
    when: "actions.classify.response.intent == 'gpio'"
    config:
      workflow_id: nostr-to-gpio
      params:
        device: "{{ actions.classify.response.params.device }}"
        action: "{{ actions.classify.response.params.action }}"

  - id: route_telegram
    type: workflow_trigger
    when: "actions.classify.response.intent == 'telegram'"
    config:
      workflow_id: nostr-to-telegram
      params:
        message: "{{ actions.classify.response.params.message }}"
```

#### Tâches d'implémentation

- [ ] Ajouter action `classify` au claude.handler.ts
- [ ] Définir format de réponse structuré (JSON)
- [ ] Créer workflow exemple
- [ ] Ajouter action `workflow_trigger` pour chaînage dynamique

---


---
