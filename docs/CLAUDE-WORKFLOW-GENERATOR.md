# Claude Workflow Generator

Permet de générer des workflows PipeliNostr via l'API Claude (Anthropic).

## Fonctionnalités

- `/workflow <description>` - Génère un workflow à partir d'une description en langage naturel
- `/activate <id>` - Active et enregistre un workflow généré
- `/cancel [id]` - Annule un workflow en attente
- `/pending` - Liste les workflows en attente d'activation
- `/explain <id>` - Explique un workflow existant (à venir)

## Prérequis

1. **Clé API Anthropic**
   - Créer un compte sur [console.anthropic.com](https://console.anthropic.com)
   - Générer une clé API

2. **Configuration**
   ```bash
   # Ajouter dans .env
   ANTHROPIC_API_KEY=sk-ant-api03-...

   # Copier et configurer le handler
   cp config/handlers/claude.yml.example config/handlers/claude.yml
   ```

3. **Activer les workflows**
   ```bash
   cp examples/workflows/claude-workflow-generator.yml config/workflows/
   cp examples/workflows/claude-activate.yml config/workflows/
   ```

## Configuration

**config/handlers/claude.yml**
```yaml
claude:
  enabled: true
  api_key: ${ANTHROPIC_API_KEY}

  # Modèle à utiliser
  # - claude-3-5-haiku-20241022: Rapide et économique (~$0.001/requête)
  # - claude-3-5-sonnet-20241022: Plus capable (~$0.01/requête)
  model: claude-3-5-haiku-20241022

  # Handlers autorisés dans les workflows générés
  allowed_handlers:
    - nostr_dm
    - nostr_note
    - email
    - telegram
    - zulip
    # - gpio  # Décommenter pour autoriser le contrôle hardware
```

## Utilisation

### Générer un workflow

```
User: /workflow envoie un email quand je reçois un zap de plus de 1000 sats

PipeliNostr: Workflow généré: zap-email-alert

  Ce workflow écoute les zap receipts et envoie un email
  quand le montant dépasse 1000 sats.

  ```yaml
  id: zap-email-alert
  name: Alerte email gros zap
  enabled: false
  trigger:
    type: nostr_event
    filters:
      kinds: [9735]
      zap_min_amount: 1000
  actions:
    - type: email
      config:
        to: "alerts@example.com"
        subject: "Gros zap reçu!"
        body: "Zap de {{ trigger.zap.amount }} sats"
  ```

  Pour activer: /activate zap-email-alert
  Pour annuler: /cancel zap-email-alert

  Expire dans 10 minutes.
```

### Activer un workflow

```
User: /activate zap-email-alert

PipeliNostr: Workflow activé!

  Fichier créé: config/workflows/zap-email-alert.yml
  Le workflow est maintenant opérationnel.
```

### Lister les workflows en attente

```
User: /pending

PipeliNostr: 2 workflow(s) en attente d'activation

  - zap-email-alert (expire dans 8 minutes)
  - dm-forward-telegram (expire dans 3 minutes)
```

### Annuler un workflow

```
User: /cancel zap-email-alert

PipeliNostr: Workflow "zap-email-alert" annulé
```

## Sécurité

### Claude ne peut PAS :
- Exécuter des commandes système
- Lire des fichiers (y compris .env)
- Accéder au réseau local
- Modifier des fichiers existants

### Protections en place :
1. **System prompt restrictif** - Claude ne génère que des workflows YAML
2. **Validation YAML** - Le workflow doit être syntaxiquement valide
3. **Handler whitelist** - Seuls les handlers autorisés peuvent être utilisés
4. **enabled: false** - Les workflows générés sont désactivés par défaut
5. **Review obligatoire** - L'utilisateur doit explicitement activer avec `/activate`
6. **Expiration** - Les workflows en attente expirent après 10 minutes

### Flux de données

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ DM Nostr    │────▶│ PipeliNostr │────▶│ API Claude  │
│ /workflow   │     │             │     │ (Anthropic) │
└─────────────┘     └─────────────┘     └─────────────┘
                           │                   │
                           │                   │
                    Prompt utilisateur    Texte YAML
                    (aucun secret)        (workflow)
                           │                   │
                           ▼                   ▼
                    ┌─────────────┐     ┌─────────────┐
                    │ Validation  │◀────│ Réponse     │
                    │ YAML        │     │             │
                    └─────────────┘     └─────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │ Stockage    │
                    │ temporaire  │
                    │ (10 min)    │
                    └─────────────┘
                           │
                    /activate
                           │
                           ▼
                    ┌─────────────┐
                    │ Écriture    │
                    │ fichier     │
                    │ .yml        │
                    └─────────────┘
```

## Coûts estimés

| Modèle | Prix / workflow généré |
|--------|------------------------|
| Claude Haiku | ~$0.001 (< 1 centime) |
| Claude Sonnet | ~$0.01 |

## Limitations

- Les workflows complexes peuvent nécessiter des ajustements manuels
- Claude ne connaît pas vos configurations spécifiques (noms de streams Zulip, etc.)
- Maximum 10 minutes pour activer un workflow généré
- Un seul workflow en attente par ID

## Troubleshooting

### "Handler non autorisé"
Le workflow généré utilise un handler non listé dans `allowed_handlers`.
Ajoutez-le dans `config/handlers/claude.yml` ou modifiez votre demande.

### "Workflow expiré"
Le délai de 10 minutes est dépassé. Regénérez le workflow avec `/workflow`.

### "YAML invalide"
Claude a généré un workflow mal formé. Reformulez votre demande ou signalez le problème.

### "API error 401"
Vérifiez votre clé API dans `.env` et `config/handlers/claude.yml`.
