# Meshtastic Integration

PipeliNostr peut recevoir et envoyer des messages via le réseau mesh LoRa Meshtastic en utilisant un bridge externe.

## Architecture

```
┌──────────────┐    LoRa    ┌──────────────┐   MQTT   ┌────────────┐
│  Meshtastic  │◄─────────►│   Gateway    │────────►│ Nostrastic │
│   Device     │            │  (internet)  │          │  (bridge)  │
│  (offline)   │            │              │          │            │
└──────────────┘            └──────────────┘          └─────┬──────┘
                                                            │
                                                    Nostr Events
                                                            │
                                                            ▼
                                                    ┌──────────────┐
                                                    │    Relays    │
                                                    └───────┬──────┘
                                                            │
                                                            ▼
                                                    ┌──────────────┐
                                                    │ PipeliNostr  │
                                                    └──────────────┘
```

## Prérequis

### Matériel

| Composant | Rôle | Exemple |
|-----------|------|---------|
| Device Meshtastic | Envoi/réception mesh | LILYGO T-Beam, RAK WisBlock, Heltec V3 |
| Gateway Meshtastic | Bridge internet | Même hardware + WiFi/Ethernet |
| Serveur | Héberge Nostrastic + PipeliNostr | Raspberry Pi, VPS, etc. |

### Logiciels

- [Nostrastic](https://github.com/quixotesystems/nostrastic) - Bridge Meshtastic ↔ Nostr
- PipeliNostr (aucune modification requise)

## Installation

### 1. Configurer le Gateway Meshtastic

Sur l'appareil qui servira de gateway (avec accès internet) :

1. Ouvrir l'app Meshtastic (Android/iOS) ou le client web
2. Aller dans **Settings → Channels**
3. Ajouter un canal secondaire :
   - **Name:** `mqtt` (en minuscules)
   - **Role:** Secondary
4. Aller dans **Settings → Module Config → MQTT**
   - **Enabled:** ON
   - **MQTT Server:** `mqtt.meshtastic.org`
   - **Username:** `meshdev`
   - **Password:** `large4cats`
   - **Encryption Enabled:** OFF
   - **JSON Enabled:** ON

### 2. Installer Nostrastic

```bash
# Cloner le repo
git clone https://github.com/quixotesystems/nostrastic.git
cd nostrastic

# Installer les dépendances
pip install -r requirements.txt

# Configurer
cp config.example.json config.json
```

Éditer `config.json` :

```json
{
  "mqtt": {
    "server": "mqtt.meshtastic.org",
    "port": 1883,
    "topic": "msh/+/+/json/#"
  },
  "nostr": {
    "nsec": "nsec1...",
    "relays": [
      "wss://relay.damus.io",
      "wss://nos.lol"
    ]
  }
}
```

Créer `contacts.json` pour les DMs :

```json
{
  "alice": "npub1alice...",
  "bob": "npub1bob..."
}
```

### 3. Lancer Nostrastic

```bash
python nostrastic.py
```

Le bridge est maintenant actif.

### 4. Configurer PipeliNostr

Ajouter la npub du bridge à la whitelist :

```yaml
# config/config.yml
whitelist:
  enabled: true
  npubs:
    - "npub1_votre_npub"
    - "npub1_bridge_nostrastic"  # Ajouter cette ligne
```

## Utilisation

### Depuis Meshtastic → Nostr → PipeliNostr

Sur l'appareil Meshtastic (via l'app ou clavier physique) :

```
# Publier une note publique
(post) Hello from the mesh!

# Envoyer un DM à un contact
(alice) Salut depuis le mesh!

# Envoyer une commande PipeliNostr
(pipelinostr) gpio:green
```

### Depuis PipeliNostr → Nostr → Meshtastic

PipeliNostr répond via DM Nostr standard. Nostrastic relaie automatiquement vers le mesh.

## Workflows exemples

### Relayer les messages mesh vers Zulip

```yaml
# config/workflows/meshtastic-to-zulip.yml
id: meshtastic-to-zulip
name: Forward Meshtastic to Zulip
enabled: true

trigger:
  type: nostr_event
  filters:
    kinds: [4]
    from_npubs:
      - "npub1_bridge_nostrastic"

actions:
  - type: zulip
    config:
      type: stream
      to: "meshtastic"
      topic: "messages"
      content: |
        **Message Meshtastic reçu**
        {{ trigger.content }}
```

### Contrôle GPIO via mesh

```yaml
# config/workflows/meshtastic-gpio.yml
id: meshtastic-gpio
name: GPIO control from Meshtastic
enabled: true

trigger:
  type: nostr_event
  filters:
    kinds: [4]
    from_npubs:
      - "npub1_bridge_nostrastic"
    content_pattern: "^gpio:(?<action>\\w+)"

actions:
  - id: led_green
    type: gpio
    when: "match.action === 'green'"
    config:
      pin: 17
      action: "on"
      duration_ms: 2000

  - type: nostr_dm
    config:
      to: "npub1_bridge_nostrastic"
      content: "LED {{ match.action }} activée"
```

### Alerte mesh sur zap reçu

```yaml
# config/workflows/zap-to-meshtastic.yml
id: zap-to-meshtastic
name: Notify mesh on zap received
enabled: true

trigger:
  type: nostr_event
  filters:
    kinds: [9735]
    zap_min_amount: 100

actions:
  - type: nostr_dm
    config:
      to: "npub1_bridge_nostrastic"
      content: "Zap recu: {{ trigger.zap.amount }} sats de {{ trigger.zap.sender }}"
```

## Commandes disponibles via mesh

Une fois configuré, tous les workflows PipeliNostr sont accessibles depuis Meshtastic :

| Commande mesh | Action |
|---------------|--------|
| `(pipelinostr) gpio:green` | Allume LED verte |
| `(pipelinostr) /dpo` | Génère rapport DPO |
| `(pipelinostr) mempool: <txid>` | Lookup transaction Bitcoin |
| `(pipelinostr) Send SMS to +33...: msg` | Envoie SMS |

## Limitations

| Aspect | Limitation |
|--------|------------|
| **Bande passante** | LoRa ~200 bytes/message, messages longs tronqués |
| **Latence** | 5-30 secondes selon le mesh |
| **Portée** | Dépend du terrain, typiquement 1-10 km |
| **Débit** | ~1 message/minute recommandé (fair use) |
| **Chiffrement** | DMs Nostr chiffrés, mais MQTT en clair sur le bridge |

## Dépannage

### Les messages n'arrivent pas

1. Vérifier que le gateway a bien internet
2. Vérifier la config MQTT (JSON enabled, encryption disabled)
3. Vérifier que Nostrastic tourne et log les messages
4. Vérifier que la npub du bridge est dans la whitelist PipeliNostr

### Messages tronqués

LoRa limite à ~200 bytes. Pour les longs messages :
- Utiliser des commandes courtes
- Éviter les réponses longues vers le mesh

### Latence élevée

Normal pour LoRa mesh. Le message traverse :
1. Device → Gateway (LoRa)
2. Gateway → MQTT broker (internet)
3. Nostrastic → Relay Nostr (internet)
4. PipeliNostr (processing)
5. Retour inverse

## Alternatives

| Solution | Description | Lien |
|----------|-------------|------|
| **Nostrastic** | Bridge MQTT (recommandé) | [GitHub](https://github.com/quixotesystems/nostrastic) |
| **Noshtastic** | Réseau Nostr autonome sur mesh | [GitHub](https://github.com/ksedgwic/noshtastic) |
| **Meshtastic-bridge** | Bridge générique avec plugin Nostr | [GitHub](https://github.com/geoffwhittington/meshtastic-bridge) |

## Ressources

- [Meshtastic Documentation](https://meshtastic.org/docs/)
- [Meshtastic MQTT Integration](https://meshtastic.org/docs/software/integrations/mqtt/)
- [Nostrastic GitHub](https://github.com/quixotesystems/nostrastic)
- [Appareils Meshtastic supportés](https://meshtastic.org/docs/hardware/devices/)
