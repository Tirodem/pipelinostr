# Nostr Load Balancer - PipeliNostr Federation

## Description

Permettre à plusieurs instances PipeliNostr de collaborer pour distribuer la charge via Nostr. Quand une npub reçoit une requête pour un workflow, elle peut la relayer à d'autres npubs PipeliNostr enregistrées.

## Use Case

1. L'utilisateur envoie `/claudeDM question` à `npub1-primary`
2. `npub1-primary` est surchargé ou indisponible
3. La requête est relayée à `npub2-secondary` ou `npub3-backup`
4. L'utilisateur reçoit la réponse de l'instance qui a traité

## Fonctionnalités

### Enregistrement des instances
- Liste de npubs PipeliNostr "partenaires" en config
- Heartbeat/ping entre instances pour vérifier disponibilité
- Métriques de charge (queue size, latency, etc.)

### Stratégies de load balancing
- **Round-robin** : distribution séquentielle
- **Least-loaded** : instance avec le moins de charge
- **Failover** : backup si primary down
- **Geographic** : basé sur les relays communs

### Communication inter-instances
- Messages NIP-04/NIP-17 entre instances
- Format standardisé pour les requêtes relayées
- Signature pour authentification

### Réponse à l'utilisateur
- L'instance qui traite répond directement
- Ou le primary relaie la réponse (proxy mode)

## Architecture proposée

```
User → npub1-primary → [Load Balancer Logic]
                              ↓
              ┌───────────────┼───────────────┐
              ↓               ↓               ↓
        npub1-primary   npub2-secondary  npub3-backup
              ↓               ↓               ↓
         [Process]       [Process]       [Process]
              ↓               ↓               ↓
              └───────────────┼───────────────┘
                              ↓
                           User ←
```

## Considérations

- **Latence** : Le relai ajoute un hop
- **Billing** : Qui débite les SATs ? L'instance qui traite ou le primary ?
- **Consistance** : Synchronisation des balances entre instances
- **Privacy** : Les requêtes transitent par plusieurs instances

## Priorité

Medium - Feature avancée pour scaling horizontal

## Dépendances

- NIP-17 DM Migration (pour communication sécurisée)
- Workflow state sync (pour balances partagées)
