---
title: "NIP-17 DM Migration (from NIP-04)"
priority: "High"
status: "DONE"
created: "2025-12-20"
completed: "2025-12-25"
---

### NIP-17 DM Migration (from NIP-04)

**Priority:** High
**Status:** DONE (2025-12-25)

#### Description

Migrer les DMs Nostr de NIP-04 (deprecated) vers NIP-17 (nouveau standard).

#### Contexte

- **NIP-04** : Ancien format de DMs, deprecated, utilise kind 4
- **NIP-17** : Nouveau standard (Private Direct Messages), utilise kind 14 wrappé dans kind 1059 (Gift Wrap)
- NIP-17 offre une meilleure confidentialité (metadata cachée)

#### Objectifs

1. Supporter NIP-17 en réception (kind 1059 → unwrap → kind 14)
2. Supporter NIP-17 en émission (handler `nostr_dm`)
3. **Double-écoute** : Écouter NIP-04 ET NIP-17 simultanément pendant la transition
4. Option de configuration pour choisir le format d'émission

#### Implémentation

##### Réception (Listener)

```typescript
// Écouter les deux kinds
const filters = [
  { kinds: [4], "#p": [pubkey] },    // NIP-04
  { kinds: [1059], "#p": [pubkey] }  // NIP-17 Gift Wrap
];

// Unwrap NIP-17
if (event.kind === 1059) {
  const seal = nip44.decrypt(event.content, sharedSecret);
  const rumor = JSON.parse(seal.content); // kind 14
  // Process rumor.content as DM
}
```

##### Émission (Handler)

```yaml
# config/handlers/nostr.yml
nostr:
  dm_format: "nip17"  # ou "nip04" pour compatibilité
  # ou "both" pour envoyer aux deux formats ?
```

#### Implémentation finale (2025-12-25)

##### Réception
- Kind 4 (NIP-04) : déchiffrement NIP-04
- Kind 1059 (Gift Wrap) : unwrap complet via `nip59.unwrapEvent()`
- Extraction du vrai sender depuis le rumor (pas le wrapper)
- Nettoyage du préfixe Amethyst `[//]: # (nip18)\n`

##### Émission
- `nip17.wrapEvent()` pour NIP-17
- Format configurable via `nostr.dm_format`

##### Réponse dynamique
- `dm_reply_match_format: true` : répond dans le même format que reçu
- Détection du préfixe NIP-18 d'Amethyst → réponse en NIP-17

##### Comportement final
| Message reçu | encryptionType | hasNip18Prefix | Réponse |
|--------------|----------------|----------------|---------|
| Primal NIP-04 | nip04 | false | NIP-04 |
| Amethyst NIP-04 + préfixe | nip04 | true | NIP-17 |
| Amethyst NIP-17 (Gift Wrap) | nip44 | - | NIP-17 |

##### Fichiers modifiés
- `src/utils/crypto.ts` : `unwrapGiftWrap()`, `cleanAmethystPrefix()`, `hasNip18Prefix`
- `src/inbound/nostr-listener.ts` : gestion kind 1059, extraction sender
- `src/outbound/nostr.handler.ts` : `sendDmNip17()`, format matching
- `src/core/workflow-matcher.ts` : détection `dm_format` depuis event
- `src/config/schema.ts` : options `dm_format`, `dm_reply_match_format`

#### Références

- [NIP-17](https://github.com/nostr-protocol/nips/blob/master/17.md)
- [NIP-44](https://github.com/nostr-protocol/nips/blob/master/44.md) (Encryption)
- [NIP-59](https://github.com/nostr-protocol/nips/blob/master/59.md) (Gift Wrap)
