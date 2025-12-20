# Workflow Session Mode - Begin/End Context

## Description

Permettre à un utilisateur de "verrouiller" ses messages sur un workflow spécifique pendant une session. Tous les messages envoyés entre `begin` et `end` seront routés vers ce workflow sans avoir besoin du préfixe/pattern habituel.

## Use Case

```
User: begin claudeDM
Bot: Session ClaudeDM démarrée. Tapez vos questions directement.

User: Quelle est la capitale de la France ?
Bot: Paris est la capitale... (réponse Claude)

User: Et celle de l'Allemagne ?
Bot: Berlin est la capitale... (réponse Claude)

User: end claudeDM
Bot: Session ClaudeDM terminée. 2 requêtes, 45 SATs consommés.
```

## Fonctionnalités

### Commandes
- `begin <workflow_id>` : Démarre une session
- `end <workflow_id>` ou `end` : Termine la session active
- `status` : Affiche la session en cours (si applicable)

### Stockage session
- Table `workflow_sessions` ou état en mémoire
- Clé : npub de l'utilisateur
- Valeur : workflow_id actif, timestamp début, compteurs

### Routing
- Si session active pour npub → bypass du pattern matching normal
- Message envoyé directement au workflow avec `trigger.content` = message brut
- Le workflow doit supporter le mode session (flag `supports_session: true` ?)

### Timeout
- Session expire après X minutes d'inactivité (configurable)
- Notification à l'utilisateur avant expiration ?

### Résumé de fin
- Nombre de requêtes
- Coût total (si applicable)
- Durée de la session

## Architecture

```yaml
# Nouveau système workflow ou extension du trigger
id: claudeDM-session
supports_session: true
session_config:
  timeout_minutes: 30
  max_messages: 100
  summary_on_end: true
```

## Considérations

- **Multi-workflow** : Un user peut-il avoir plusieurs sessions actives ?
- **Concurrence** : Que se passe-t-il si le user envoie un message pendant le traitement ?
- **Erreurs** : Si le workflow échoue, la session continue ?
- **Nested** : `begin A` puis `begin B` → remplace ou empile ?

## Priorité

Medium - Amélioration UX pour workflows conversationnels

## Dépendances

- Workflow state system (déjà implémenté)
