---
title: "Dolibarr ERP Handler"
priority: "Medium"
status: "Proposed"
created: "2025-12-20"
---

### Dolibarr ERP Handler

**Priority:** Medium
**Status:** Proposed

#### Description

Créer un handler pour Dolibarr ERP, similaire au handler Odoo existant, permettant de synchroniser des commandes et autres données vers une instance Dolibarr.

#### Use Cases

- Synchronisation commandes be-BOP → Dolibarr
- Création de tiers (clients) automatique
- Création de factures
- Recherche de produits

#### API Dolibarr

Dolibarr expose une API REST native (depuis v10+) :
- Documentation : https://wiki.dolibarr.org/index.php/Module_API_REST
- Authentification : API Key (DOLAPIKEY header)
- Base URL : `https://instance.dolibarr.org/api/index.php/`

#### Endpoints principaux

| Endpoint | Méthode | Description |
|----------|---------|-------------|
| `/orders` | POST | Créer une commande |
| `/orders/{id}` | GET | Récupérer une commande |
| `/thirdparties` | POST | Créer un tiers |
| `/thirdparties` | GET | Rechercher des tiers |
| `/products` | GET | Rechercher des produits |
| `/invoices` | POST | Créer une facture |

#### Configuration proposée

```yaml
# config/handlers/dolibarr.yml
dolibarr:
  enabled: true
  url: ${DOLIBARR_URL}           # https://instance.dolibarr.org
  api_key: ${DOLIBARR_API_KEY}   # DOLAPIKEY
  default_thirdparty_id: 123     # Optionnel
  default_thirdparty_name: "Ventes be-BOP"
```

#### Actions supportées

```yaml
actions:
  # Créer une commande
  - type: dolibarr
    config:
      action: create_order
      data: "{{ actions.parse_bebop.response }}"

  # Rechercher un tiers
  - type: dolibarr
    config:
      action: search_thirdparty
      filters:
        email: "client@example.com"

  # Créer un tiers
  - type: dolibarr
    config:
      action: create_thirdparty
      data:
        name: "Nouveau Client"
        email: "nouveau@example.com"

  # Rechercher un produit
  - type: dolibarr
    config:
      action: search_product
      filters:
        ref: "PROD001"
```

#### Implémentation

- Fichier : `src/outbound/dolibarr.handler.ts`
- ~250 lignes (plus simple qu'Odoo car API REST native)
- Réutiliser le pattern de `odoo.handler.ts`

#### Différences avec Odoo

| Aspect | Odoo | Dolibarr |
|--------|------|----------|
| API | JSON-RPC | REST |
| Auth | Session cookie | API Key header |
| Modèles | `sale.order`, `res.partner` | `orders`, `thirdparties` |
| Complexité | Plus complexe | Plus simple |

---


---
