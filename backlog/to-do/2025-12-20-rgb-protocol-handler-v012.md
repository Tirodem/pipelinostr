---
title: "RGB Protocol Handler (v0.12)"
priority: "Medium"
status: "Proposed"
created: "2025-12-20"
---

### RGB Protocol Handler (v0.12)

**Priority:** Medium
**Status:** Proposed

#### Description

Intégrer le protocole RGB (smart contracts Bitcoin) pour permettre l'émission, le transfert et la vérification de tokens (RGB20) et NFTs (RGB21) via workflows PipeliNostr.

#### Use Cases

1. **Token-Gating** : Conditionner l'accès à des commandes selon la possession de tokens
2. **Mint NFT à la demande** : `/mint "titre" <url>` → Crée un NFT RGB21
3. **Récompenses automatiques** : Zap reçu → Envoie token de fidélité
4. **Escrow P2P** : Créer des escrows avec libération conditionnelle
5. **Crowdfunding** : Collecter des fonds avec distribution de tokens aux backers

#### Prérequis

| Composant | Requis | Notes |
|-----------|--------|-------|
| Bitcoin Node | Oui | bitcoind ou Electrum |
| RGB Node | Oui | Self-hosted (v0.12) |
| Lightning | Optionnel | Pour transferts LN-RGB |
| BitMask SDK | Recommandé | API JavaScript |

#### Configuration

```yaml
# config/handlers/rgb.yml
rgb:
  enabled: true
  node_url: ${RGB_NODE_URL}  # http://localhost:63963

  # Wallet (pour signer)
  mnemonic: ${RGB_MNEMONIC}  # 12 mots
  # ou
  xpriv: ${RGB_XPRIV}

  # Contrats pré-déployés
  contracts:
    loyalty_token: "rgb:..."  # RGB20 fidélité
    nft_collection: "rgb:..."  # RGB21 collection
```

#### Actions supportées

```yaml
# Vérifier possession de token
- type: rgb
  config:
    operation: check_balance
    contract_id: "{{ config.contracts.loyalty_token }}"
    owner: "{{ trigger.from }}"

# Transférer tokens
- type: rgb
  config:
    operation: transfer
    contract_id: "rgb:..."
    amount: 100
    to: "{{ trigger.from }}"

# Mint NFT
- type: rgb
  config:
    operation: mint_nft
    contract_id: "rgb:..."
    metadata:
      name: "{{ match.title }}"
      image: "{{ match.url }}"
    to: "{{ trigger.from }}"
```

#### Trigger inbound (surveillance)

```yaml
trigger:
  type: rgb_transfer
  filters:
    contract_id: "rgb:..."
    min_amount: 1
```

#### Complexité

- **Installation** : Élevée (Bitcoin Node + RGB Node)
- **Développement** : ~3-5 jours
- **Maintenance** : Moyenne (mises à jour RGB Node)

#### Ressources

- [RGB Integration Guide](https://rgb.tech/integrate/)
- [RGB v0.12 Release](https://rgb.tech/blog/release-v0-12-consensus/)
- [BitMask SDK](https://github.com/nicbus/bitmask-core)

---


---
