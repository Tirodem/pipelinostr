---
title: "LLM Agent for Natural Language Processing"
priority: "Very Low (Future Vision)"
status: "Proposed"
created: "2025-12-20"
---

### LLM Agent for Natural Language Processing

**Priority:** Very Low (Future Vision)
**Status:** Proposed

#### Description

Connecter PipeliNostr à un agent LLM pour interpréter le langage naturel et le convertir en commandes compatibles avec les workflows, sans se limiter aux regex.

#### Use Case

Au lieu de :
```
[gpio] on pin:17
[telegram] Salut tout le monde
/email to:alice@example.com subject:Test body:Hello
```

L'utilisateur pourrait écrire :
```
Allume la lumière du salon
Envoie un message sur Telegram pour dire bonjour à tout le monde
Envoie un email à Alice pour lui dire bonjour
```

Le LLM analyserait l'intention et mapperait vers le workflow approprié avec les bons paramètres.

#### Architecture Proposée

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Nostr DM       │     │   LLM Agent     │     │  Workflow       │
│  (langage       │────►│  (intent +      │────►│  Engine         │
│   naturel)      │     │   extraction)   │     │  (exécution)    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

#### Fonctionnalités Envisagées

1. **Intent Detection** : Identifier le workflow cible
   - "allume la lumière" → `nostr-to-gpio`
   - "envoie sur Telegram" → `nostr-to-telegram`

2. **Entity Extraction** : Extraire les paramètres
   - "lumière du salon" → `pin: 17` (mapping configuré)
   - "à Alice" → `to: alice@example.com`

3. **Confirmation optionnelle** : Demander validation avant exécution
   - "Je vais allumer GPIO 17. Confirmer ?"

4. **Apprentissage contextuel** : Mémoriser les préférences
   - "la lumière" = toujours GPIO 17 pour cet utilisateur

#### Options d'Implémentation

| Option | Avantages | Inconvénients |
|--------|-----------|---------------|
| **OpenAI API** | Puissant, facile | Coût, dépendance externe, privacy |
| **Claude API** | Très capable | Coût, dépendance externe |
| **Ollama (local)** | Gratuit, privé | Ressources, qualité variable |
| **LLaMA.cpp** | Local, léger | Setup complexe |
| **LLM Embarqué** | Zero dépendance, offline | Taille binaire, RAM requise |

#### Option LLM Auto-Embarqué (Vision Long Terme)

Intégrer un petit modèle directement dans PipeliNostr, sans service externe :

```
┌─────────────────────────────────────────────┐
│              PipeliNostr                     │
│  ┌─────────────────────────────────────┐    │
│  │  LLM Embarqué (TinyLlama, Phi-2)    │    │
│  │  - Intent detection                  │    │
│  │  - Entity extraction                 │    │
│  │  - ~2GB RAM, ~1GB disk              │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

**Technologies candidates :**
- **node-llama-cpp** : Bindings Node.js pour llama.cpp
- **transformers.js** : Hugging Face en JS (WebGPU/WASM)
- **ONNX Runtime** : Modèles optimisés cross-platform

**Modèles légers adaptés :**
| Modèle | Taille | RAM | Cas d'usage |
|--------|--------|-----|-------------|
| TinyLlama 1.1B | 600MB | 1.5GB | Intent basique |
| Phi-2 2.7B | 1.5GB | 3GB | Meilleure compréhension |
| Mistral 7B Q4 | 4GB | 6GB | Qualité optimale |

**Avantages :**
- Fonctionne offline (RPi, bateau, bunker...)
- Pas de coût API
- Privacy totale
- Latence prévisible

**Inconvénients :**
- Taille binaire augmentée
- RAM requise (min 2GB pour petit modèle)
- Qualité inférieure aux gros modèles cloud
- Temps de chargement au démarrage

#### Cas d'Usage LLM Embarqué

**1. Routage en langage naturel** (runtime)
```
DM: "Allume la lumière du salon"
 → LLM détecte intent: gpio, params: {pin: 17, state: high}
 → Exécute workflow nostr-to-gpio
```

**2. Assistant rédaction de workflows** (dev time)
```
User: "Je veux recevoir un SMS quand quelqu'un me zap plus de 1000 sats"

LLM génère:
┌─────────────────────────────────────────────┐
│ id: zap-sms-alert                           │
│ name: Zap SMS Alert                         │
│ trigger:                                    │
│   type: nostr_event                         │
│   filters:                                  │
│     kinds: [9735]                           │
│     zap_min_amount: 1000                    │
│ actions:                                    │
│   - id: send_sms                            │
│     type: traccar_sms                       │
│     config:                                 │
│       to: "+33612345678"                    │
│       message: "Zap reçu: {{ trigger... }}" │
└─────────────────────────────────────────────┘
```

**3. Validation et suggestions** (dev time)
```
User: workflow avec erreur de syntaxe ou config manquante

LLM: "Il manque le champ 'to' dans l'action email.
      Voulez-vous utiliser l'email par défaut de config/handlers/email.yml ?"
```

**4. Documentation interactive** (runtime)
```
DM: "Comment envoyer un fichier sur FTP ?"

LLM: "Utilisez le handler 'ftp' avec cette syntaxe:
      [ftp] path:/data/file.txt content:Mon contenu
      Ou créez un workflow avec trigger sur content_pattern..."
```

#### Configuration Envisagée

```yaml
# config/config.yml
llm:
  enabled: true
  provider: "ollama"  # ou "openai", "anthropic"
  model: "mistral:7b"
  endpoint: "http://localhost:11434"

  # Mapping intentions → workflows
  intents:
    - patterns: ["lumière", "lampe", "éclairage", "led"]
      workflow: "nostr-to-gpio"
      defaults:
        pin: 17
    - patterns: ["telegram", "tg", "message telegram"]
      workflow: "nostr-to-telegram"
    - patterns: ["email", "mail", "courriel"]
      workflow: "nostr-to-email"

  # Mode de fonctionnement
  mode: "auto"  # auto, confirm, suggest
  fallback: "regex"  # Si LLM échoue, utiliser regex classique
```

#### Workflow Exemple avec LLM

```yaml
id: llm-router
name: LLM Natural Language Router
enabled: true

trigger:
  type: nostr_event
  filters:
    kinds: [4]
    from_whitelist: true
    # Pas de content_pattern - le LLM analyse tout

actions:
  - id: analyze
    type: llm_analyze
    config:
      prompt: |
        Analyse ce message et identifie:
        1. L'action souhaitée (workflow)
        2. Les paramètres nécessaires
        Message: {{ trigger.content }}

  - id: route
    type: workflow_call
    config:
      workflow_id: "{{ actions.analyze.response.workflow }}"
      params: "{{ actions.analyze.response.params }}"
```

#### Prérequis

- Handler `llm` à créer
- Action `llm_analyze` pour extraction d'intentions
- Action `workflow_call` pour appel dynamique de workflows
- Système de mapping intent → workflow

#### Considérations

- **Latence** : Appel LLM ajoute 0.5-2s de délai
- **Coût** : APIs payantes (OpenAI ~$0.002/requête)
- **Privacy** : Préférer solutions locales (Ollama) pour données sensibles
- **Fiabilité** : LLM peut mal interpréter → mode confirmation recommandé
- **Fallback** : Toujours garder les regex comme backup

#### Roadmap Suggérée

1. **Phase 1** : Handler LLM basique (appel API, réponse texte)
2. **Phase 2** : Intent detection simple (mapping keywords)
3. **Phase 3** : Entity extraction avec prompts structurés
4. **Phase 4** : Mode conversation (clarification si ambigu)
5. **Phase 5** : Fine-tuning ou RAG avec historique utilisateur

---


---
