---
title: "Bitcoin Wallet Commands (/wallet)"
priority: "High"
status: "DONE"
created: "2025-12-25"
completed: "2025-12-25"
---

### Bitcoin Wallet Commands (/wallet)

**Priority:** High
**Status:** DONE (2025-12-25)

**Note:** Le monitoring automatique apres /wallet bill n'est pas implemente. Utiliser /wallet check pour verifier manuellement.

#### Description

Commandes pour gerer un portefeuille Bitcoin watch-only via xpub.

#### Configuration

```env
# .env
BITCOIN_XPUB=xpub6...
```

```yaml
# config.yml ou handler
wallet:
  xpub: ${BITCOIN_XPUB}
  mempool_api: "https://mempool.space/api"
  rate_limit_seconds: 10           # Min entre appels mempool.space
  confirmations_notify: 3          # Nombre de confirmations a notifier
  poll_interval_minutes: 10        # Intervalle de polling pour monitoring
```

#### Commandes

##### /wallet address x y

Affiche les adresses et leurs soldes.

- `x` : index de la premiere adresse (0-based)
- `y` : nombre d'adresses a afficher

**Exemple:**
```
/wallet address 0 3
```

**Reponse:**
```
Address #0: bc1q...abc
  Balance: 0.00150000 BTC (150,000 sats)

Address #1: bc1q...def
  Balance: 0.00000000 BTC (0 sats)

Address #2: bc1q...ghi
  Balance: 0.00021000 BTC (21,000 sats)
```

##### /wallet bill x amount currency

Genere une facture avec QR code.

- `x` : index de l'adresse
- `amount` : montant
- `currency` : EUR, USD, CHF, SAT, BTC

**Exemple:**
```
/wallet bill 5 50.00 EUR
```

**Reponse:**
- Image QR code de l'adresse Bitcoin
- Texte: "Address: bc1q...xyz"
- Texte: "Amount: 50.00 EUR (~85,000 sats)"

**Conversion:** API Coinbase pour EUR/USD/CHF -> BTC -> SAT

##### Monitoring automatique apres /wallet bill

Apres creation d'une facture, un workflow de monitoring demarre :

1. **Check immediat** : Verifie mempool.space
2. **Polling** : Toutes les 10 minutes (configurable)
3. **Notifications DM** :
   - "Transaction detectee dans le mempool: txid..."
   - "1 confirmation (block #XXX)"
   - "2 confirmations"
   - "3 confirmations - Paiement confirme!"

#### Implementation technique

##### Dependances npm
- `bitcoinjs-lib` : Derivation d'adresses depuis xpub
- `qrcode` : Generation d'images QR (pas terminal)
- API mempool.space : Soldes et transactions
- API Coinbase : Taux de change

##### Upload d'images
- **V1 (implementation initiale)** : nostr.build API (gratuit, sans config)
- **V2 (backlog)** : Option FTP/SFTP via handler existant
- **V2 (backlog)** : Option S3/compatible via handler existant

##### Nouveau handler : wallet.handler.ts

Actions:
- `derive_address` : Derive adresse depuis xpub + index
- `get_balance` : Solde via mempool.space
- `generate_qr` : QR code image
- `convert_currency` : Conversion via Coinbase
- `check_transaction` : Verifier txid/confirmations

##### Rate limiting

Cache des appels mempool.space avec TTL configurable pour eviter le spam.

##### Workflows

- `wallet-address.yml` : /wallet address x y
- `wallet-bill.yml` : /wallet bill x amount currency
- `wallet-monitor.yml` : Monitoring des confirmations (trigger interne)

#### References

- mempool.space API: https://mempool.space/docs/api
- Coinbase API: https://api.coinbase.com/v2/prices/BTC-EUR/spot
- bitcoinjs-lib: https://github.com/bitcoinjs/bitcoinjs-lib
