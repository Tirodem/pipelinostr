---
title: "Claude Smart Reply (Bot conversationnel)"
priority: "Medium"
status: "Proposed"
created: "2025-12-20"
---

### Claude Smart Reply (Bot conversationnel)

**Priority:** Medium
**Status:** Proposed

#### Description

Utiliser Claude pour répondre intelligemment aux DMs Nostr, créant un bot conversationnel personnalisable.

#### Use Case

```
User DM: "Salut, tu peux m'expliquer comment fonctionne le Lightning Network ?"

Bot répond: "Le Lightning Network est une solution de seconde couche pour Bitcoin
qui permet des transactions instantanées et quasi-gratuites..."
```

#### Workflow exemple

```yaml
id: claude-smart-reply
name: Claude Smart Reply Bot
enabled: false

trigger:
  type: nostr_event
  filters:
    kinds: [4, 1059]
    from_whitelist: true
    # Ne pas matcher les commandes existantes
    content_pattern: "^(?!/)"

actions:
  - id: ask_claude
    type: claude
    config:
      action: reply
      system_prompt: |
        Tu es l'assistant personnel de Jean.
        Réponds poliment en français.
        Sois concis (max 500 caractères).
      message: "{{ trigger.content }}"

  - id: send_reply
    type: nostr_dm
    config:
      to: "{{ trigger.pubkey }}"
      content: "{{ actions.ask_claude.response.content }}"
```

#### Configuration handler

Dans `config/handlers/claude.yml` :
```yaml
enabled: true
api_key: ${ANTHROPIC_API_KEY}
model: claude-3-5-haiku-20241022
max_tokens: 1024
```

#### Tâches d'implémentation

- [ ] Ajouter action `reply` au claude.handler.ts
- [ ] Créer workflow exemple `claude-smart-reply.yml.example`
- [ ] Supporter `system_prompt` personnalisable
- [ ] Limiter le coût (max_tokens, rate limiting)

---


---
