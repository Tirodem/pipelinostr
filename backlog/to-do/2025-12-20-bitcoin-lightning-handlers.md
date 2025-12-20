---
title: "Bitcoin & Lightning Handlers"
priority: "Medium"
status: "Proposed"
created: "2025-12-20"
---

### Bitcoin & Lightning Handlers

**Priority:** Medium
**Status:** Proposed

#### Description

Ajouter des handlers pour gérer les paiements Bitcoin on-chain et Lightning, permettant de surveiller les dons entrants et de générer des invoices.

#### 1. Handler Mempool xpub (Inbound - On-chain)

Surveiller une xpub pour détecter les nouvelles transactions entrantes sur les adresses dérivées.

```yaml
# config/handlers/mempool-xpub.yml
mempool_xpub:
  enabled: true
  xpub: ${BITCOIN_XPUB}
  # ou zpub pour SegWit natif
  # zpub: ${BITCOIN_ZPUB}

  poll_interval_seconds: 60  # Toutes les minutes
  api_url: "https://mempool.space/api"  # ou instance locale

  # Dérivation
  derivation_gap: 20         # Nombre d'adresses à surveiller
  address_type: "bech32"     # legacy, p2sh-segwit, bech32
```

**Trigger workflow :**
```yaml
id: onchain-donation-alert
trigger:
  type: mempool_xpub
  filters:
    min_amount_sats: 1000    # Ignorer dust

actions:
  - id: notify
    type: zulip
    config:
      content: |
        ⛓️ Don on-chain reçu!
        Montant: {{ trigger.amount_sats }} sats
        Adresse: {{ trigger.address }}
        TX: {{ trigger.txid }}
        Confirmations: {{ trigger.confirmations }}
```

**Variables trigger disponibles :**
- `trigger.txid` : ID de la transaction
- `trigger.address` : Adresse de réception
- `trigger.address_index` : Index de dérivation
- `trigger.amount_sats` : Montant en satoshis
- `trigger.confirmations` : Nombre de confirmations
- `trigger.block_height` : Hauteur du bloc (si confirmé)
- `trigger.sender_addresses` : Adresses d'envoi

#### 2. Handler Phoenixd (Inbound - Lightning)

Intégrer phoenixd (daemon Phoenix Wallet) pour gérer les paiements Lightning.

**Installation phoenixd :**
```bash
# Télécharger phoenixd
curl -L https://github.com/ACINQ/phoenixd/releases/latest/download/phoenixd-linux-x64.zip -o phoenixd.zip
unzip phoenixd.zip

# Lancer le daemon
./phoenixd --agree-to-terms-of-service

# API disponible sur http://localhost:9740
```

**Configuration handler :**
```yaml
# config/handlers/phoenixd.yml
phoenixd:
  enabled: true
  api_url: "http://localhost:9740"
  api_password: ${PHOENIXD_API_PASSWORD}  # Généré au premier lancement

  # Mode écoute (inbound)
  webhook_mode: true
  listen_port: 9741  # Pour recevoir les webhooks phoenixd
```

**Trigger workflow (paiement reçu) :**
```yaml
id: lightning-donation-alert
trigger:
  type: phoenixd_payment
  filters:
    min_amount_sats: 100

actions:
  - id: notify
    type: telegram
    config:
      text: |
        ⚡ Don Lightning reçu!
        Montant: {{ trigger.amount_sats }} sats
        Description: {{ trigger.description }}
        Payment hash: {{ trigger.payment_hash | truncate:16 }}
```

**Variables trigger disponibles :**
- `trigger.payment_hash` : Hash du paiement
- `trigger.amount_sats` : Montant reçu
- `trigger.description` : Description de l'invoice
- `trigger.created_at` : Timestamp de réception
- `trigger.preimage` : Preimage du paiement

#### 3. Handler Phoenixd (Outbound - Génération d'invoices)

Générer des invoices Lightning ou des adresses on-chain à la demande.

**Workflow génération invoice Lightning :**
```yaml
id: generate-lightning-invoice
trigger:
  type: nostr_event
  filters:
    kinds: [4]
    from_whitelist: true
    content_pattern: "^invoice\\s+(?<amount>\\d+)\\s*(?<description>.*)?"

actions:
  - id: create_invoice
    type: phoenixd
    config:
      operation: create_invoice
      amount_sats: "{{ match.amount }}"
      description: "{{ match.description | default: 'Don via PipeliNostr' }}"
      expiry_seconds: 3600

  - id: reply
    type: nostr_dm
    config:
      to: "{{ trigger.from }}"
      content: |
        ⚡ Invoice Lightning créée:

        Montant: {{ match.amount }} sats

        {{ actions.create_invoice.response.bolt11 }}

        Expire dans 1 heure.
```

**Workflow génération adresse on-chain :**
```yaml
id: generate-onchain-address
trigger:
  type: nostr_event
  filters:
    kinds: [4]
    from_whitelist: true
    content_pattern: "^address$"

actions:
  - id: derive_address
    type: bitcoin_xpub
    config:
      operation: derive_next
      xpub: ${BITCOIN_XPUB}

  - id: reply
    type: nostr_dm
    config:
      to: "{{ trigger.from }}"
      content: |
        ⛓️ Adresse Bitcoin:

        {{ actions.derive_address.response.address }}

        Index: {{ actions.derive_address.response.index }}
```

#### 4. Workflow Unifié : Don Multi-Rail

```yaml
id: donation-request
trigger:
  type: nostr_event
  filters:
    kinds: [4]
    from_whitelist: true
    content_pattern: "^don(?:ate)?\\s+(?<amount>\\d+)(?:\\s+(?<rail>ln|btc))?"

actions:
  # Lightning par défaut
  - id: ln_invoice
    type: phoenixd
    when: "match.rail !== 'btc'"
    config:
      operation: create_invoice
      amount_sats: "{{ match.amount }}"
      description: "Don PipeliNostr"

  # On-chain si demandé
  - id: btc_address
    type: bitcoin_xpub
    when: "match.rail === 'btc'"
    config:
      operation: derive_next

  - id: reply_ln
    type: nostr_dm
    when: "match.rail !== 'btc'"
    config:
      to: "{{ trigger.from }}"
      content: |
        ⚡ Invoice Lightning ({{ match.amount }} sats):
        {{ actions.ln_invoice.response.bolt11 }}

  - id: reply_btc
    type: nostr_dm
    when: "match.rail === 'btc'"
    config:
      to: "{{ trigger.from }}"
      content: |
        ⛓️ Adresse Bitcoin ({{ match.amount }} sats attendus):
        {{ actions.btc_address.response.address }}
```

**Usage :**
```
donate 1000        → Invoice Lightning 1000 sats
donate 1000 ln     → Invoice Lightning 1000 sats
donate 50000 btc   → Adresse on-chain
```

#### Architecture Complète

```
┌─────────────────────────────────────────────────────────────────┐
│                     PipeliNostr + Bitcoin                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  INBOUND (Surveillance)                                         │
│  ┌─────────────────┐     ┌─────────────────┐                   │
│  │ Mempool API     │     │ Phoenixd        │                   │
│  │ (poll xpub)     │     │ (webhook)       │                   │
│  │ ⛓️ On-chain     │     │ ⚡ Lightning    │                   │
│  └────────┬────────┘     └────────┬────────┘                   │
│           │                       │                             │
│           └───────────┬───────────┘                             │
│                       ▼                                         │
│              ┌─────────────────┐                                │
│              │ Workflow Engine │                                │
│              └────────┬────────┘                                │
│                       │                                         │
│  OUTBOUND (Génération)│                                         │
│           ┌───────────┴───────────┐                             │
│           ▼                       ▼                             │
│  ┌─────────────────┐     ┌─────────────────┐                   │
│  │ bitcoin_xpub    │     │ phoenixd        │                   │
│  │ derive_next     │     │ create_invoice  │                   │
│  │ ⛓️ Adresse     │     │ ⚡ BOLT11       │                   │
│  └─────────────────┘     └─────────────────┘                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

#### Prérequis

**On-chain :**
- xpub/zpub d'un wallet HD (Electrum, Sparrow, etc.)
- Accès API mempool.space (public ou self-hosted)

**Lightning :**
- phoenixd installé et synchronisé
- ~100k sats pour la liquidité initiale (auto-gérée par Phoenix)

#### Considérations

- **Privacy xpub** : Ne jamais exposer la xpub publiquement
- **Gap limit** : Surveiller suffisamment d'adresses pour ne pas manquer de paiements
- **Phoenixd liquidity** : Phoenix gère automatiquement les canaux mais prend des frais
- **Confirmations** : Configurer le nombre de confirmations requises selon le montant
- **Rate limiting** : Mempool.space API a des limites (self-host recommandé pour usage intensif)

#### Alternatives à Phoenixd

| Solution | Type | Complexité | Notes |
|----------|------|------------|-------|
| **Phoenixd** | Non-custodial | Faible | Recommandé, auto-gestion liquidité |
| **LND** | Non-custodial | Élevée | Plus de contrôle, plus complexe |
| **Core Lightning** | Non-custodial | Élevée | Léger, plugins extensibles |
| **LNbits** | Semi-custodial | Moyenne | API simple, multi-wallet |
| **Alby Hub** | Non-custodial | Faible | Interface web, NWC support |

---


---
