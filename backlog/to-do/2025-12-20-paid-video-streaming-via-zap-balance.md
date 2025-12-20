---
title: "Paid Video Streaming via Zap Balance"
priority: "Low"
status: "Proposed"
created: "2025-12-20"
---

### Paid Video Streaming via Zap Balance

**Priority:** Low
**Status:** Proposed

#### Description

Service de streaming vidéo payant basé sur le système de balance SATs par npub.

#### Prérequis

- Système ClaudeDM fonctionnel (workflow_db handler + balance tracking)
- Workflows zap-balance-tracker testés et validés

#### Use Case

1. Utilisateur zappe une npub cible → crédits SATs accumulés
2. Utilisateur demande accès à un stream vidéo via DM
3. PipeliNostr vérifie le solde SATs
4. Si suffisant → génère un token/lien d'accès temporaire
5. Décrémente le solde en fonction de la durée de visionnage

#### Architecture proposée

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│ Zap Balance │────►│ Access Token │────►│ Video CDN   │
│ Check       │     │ Generator    │     │ (HLS/DASH)  │
└─────────────┘     └──────────────┘     └─────────────┘
```

#### Options de streaming

1. **Self-hosted** : Nginx + RTMP module
2. **CDN** : Cloudflare Stream, Bunny.net, AWS CloudFront
3. **Decentralized** : IPFS + HLS

#### Monétisation

- Tarif par minute de visionnage (ex: 10 SATs/min)
- Tarif par accès au stream (ex: 100 SATs/session)
- Abonnement (ex: 1000 SATs/jour)

#### Dépendances

- `workflow_db` handler fonctionnel
- Système de tokens d'accès temporaires
- Intégration CDN ou serveur de streaming

#### Notes

Dépend du succès des workflows ClaudeDM pour valider le système de balance.
