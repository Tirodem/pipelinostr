---
title: "Streaming Platform Handlers"
priority: "Low"
status: "Proposed"
created: "2025-12-20"
---

### Streaming Platform Handlers

**Priority:** Low
**Status:** Proposed

#### Description

Add handlers for live streaming platforms to enable Nostr-to-stream interactions.

#### Platforms to Support

| Platform | Handler Type | Use Cases |
|----------|--------------|-----------|
| **Twitch** | `twitch` | Send chat messages, trigger alerts, manage polls |
| **YouTube Live** | `youtube_live` | Send chat messages, manage live stream settings |
| **Kick** | `kick` | Send chat messages |
| **OBS WebSocket** | `obs` | Control scenes, sources, start/stop streaming |
| **StreamElements** | `streamelements` | Trigger alerts, overlays, tip messages |
| **Streamlabs** | `streamlabs` | Trigger alerts, donations display |

#### Example Use Cases

1. **Nostr DM → Twitch Chat**
   - `[twitch] Hello from Nostr!` → Posts in Twitch chat

2. **Nostr DM → Stream Alert**
   - `[alert] Special message!` → Triggers on-screen alert via StreamElements

3. **Nostr DM → OBS Scene Switch**
   - `[obs] scene:Gaming` → Switches OBS to "Gaming" scene

4. **Scheduled → YouTube Live**
   - Cron job to post scheduled messages in YouTube live chat

5. **External Donation → Stream Alert**
   - Webhook receives donation from BTCPay/LNbits → Triggers StreamElements alert
   - `[alert] 🎉 Thanks {donor} for {amount} sats!`

6. **Nostr Zap → Stream Notification**
   - Listen for zap events → Display on stream via OBS browser source

#### Implementation Notes

- Twitch: Uses IRC or Helix API
- YouTube: Uses YouTube Data API v3 (liveChatMessages)
- OBS: Uses obs-websocket protocol
- StreamElements/Streamlabs: REST APIs with OAuth

#### Configuration Example

```yaml
# config/handlers/twitch.yml
twitch:
  enabled: true
  client_id: ${TWITCH_CLIENT_ID}
  client_secret: ${TWITCH_CLIENT_SECRET}
  access_token: ${TWITCH_ACCESS_TOKEN}
  channel: "your_channel"
  bot_username: "PipeliNostrBot"
```

---


---
