---
title: "Dynamic Relay Discovery from nostr.watch"
priority: "Low"
status: "DONE"
created: "2025-12-20"
completed: "2025-12-20"
---

### Dynamic Relay Discovery from nostr.watch

**Priority:** Low
**Status:** DONE

#### Description

Add a system to dynamically discover and add relays from external sources, with nostr.watch as the default provider.

#### Use Case

Currently, relays are statically configured in `config/config.yml`. Users need to manually update this list to add new relays. A dynamic discovery system would:

- Automatically fetch available relays from nostr.watch/relays (or similar sources)
- Filter relays based on criteria (uptime, latency, geographic location, etc.)
- Add/remove relays at runtime without restart
- Optionally persist discovered relays

#### Proposed Implementation

1. **Relay Discovery Service** (`src/core/relay-discovery.ts`)
   - Fetch relay list from configurable sources (default: `https://api.nostr.watch/v1/public`)
   - Parse and validate relay URLs
   - Filter based on configurable criteria

2. **Configuration Options** (`config/config.yml`)
   ```yaml
   nostr:
     relays:
       static:
         - wss://relay.damus.io
       discovery:
         enabled: true
         sources:
           - url: "https://api.nostr.watch/v1/public"
             type: nostr_watch
         refresh_interval: 3600 # seconds
         max_relays: 10
         filters:
           min_uptime: 0.95
           max_latency_ms: 500
   ```

3. **API Endpoints**
   - `GET /api/relays` - List all connected relays
   - `POST /api/relays/refresh` - Trigger relay discovery
   - `POST /api/relays` - Manually add a relay

#### References

- nostr.watch API: https://api.nostr.watch/v1/public
- NIP-65 (Relay List Metadata): https://github.com/nostr-protocol/nips/blob/master/65.md

---


---
