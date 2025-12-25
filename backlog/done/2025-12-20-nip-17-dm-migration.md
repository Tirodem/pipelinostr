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

#### Migration progressive

1. **Phase 1** : Ajouter réception NIP-17 (double-écoute)
2. **Phase 2** : Ajouter émission NIP-17 (configurable)
3. **Phase 3** : Deprecate NIP-04 émission (warning logs)
4. **Phase 4** : Retirer NIP-04 (breaking change, major version)

#### Dépendances

- Librairie `nostr-tools` >= 2.x pour NIP-17/NIP-44
- Vérifier support NIP-44 (encryption)

#### Références

- [NIP-17](https://github.com/nostr-protocol/nips/blob/master/17.md)
- [NIP-44](https://github.com/nostr-protocol/nips/blob/master/44.md) (Encryption)
- [NIP-59](https://github.com/nostr-protocol/nips/blob/master/59.md) (Gift Wrap)
