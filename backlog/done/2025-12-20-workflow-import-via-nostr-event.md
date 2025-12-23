---
title: "Workflow Import via Nostr Event"
priority: "Medium"
status: "Proposed"
created: "2025-12-20"
---

### Workflow Import via Nostr Event

**Priority:** Medium
**Status:** Proposed

#### Description

Permettre l'import de workflows publiés sur Nostr par d'autres utilisateurs.

#### Use Case

1. Un utilisateur Nostr publie un workflow YAML dans un message public (kind 1)
2. L'utilisateur de PipeliNostr envoie un DM avec l'event ID : `/import <event_id>`
3. PipeliNostr récupère l'event via les relays
4. Extrait le code YAML du contenu
5. Valide la syntaxe et la sécurité du workflow
6. Crée le workflow (désactivé par défaut)

#### Sécurité

- Whitelist obligatoire pour la npub qui peut importer
- Validation stricte du YAML
- Blacklist de handlers sensibles (ex: `file`, `system`) sauf si explicitement autorisé
- Workflow créé avec `enabled: false` par défaut
- Log de l'import avec source (event_id, author npub)

#### Format du message Nostr

```
---workflow---
id: my-workflow
name: My Shared Workflow
triggers:
  - type: dm
actions:
  - type: nostr_dm
    ...
---end---
```

Ou simplement un code block markdown avec le YAML.

#### Workflow d'import

```yaml
id: workflow-importer
triggers:
  - type: dm
    content_match: "^/import\\s+([a-f0-9]{64})$"
    from_whitelist:
      - "<admin_npub>"
actions:
  - id: fetch_event
    type: http
    method: GET
    url: "https://api.nostr.watch/v1/event/{{match.1}}"
  - id: validate
    type: internal
    action: validate_workflow_yaml
  - id: create
    type: internal
    action: create_workflow
    enabled: false
```

#### Dépendances

- Handler ou action `internal` pour validation/création
- Accès API relay ou nostr.watch pour fetch event
