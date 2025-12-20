---
title: "VPN Tunnel for Local Hardware Access"
priority: "Low"
status: "Proposed"
created: "2025-12-20"
---

### VPN Tunnel for Local Hardware Access

**Priority:** Low
**Status:** Proposed

#### Description

Enable VPS-hosted PipeliNostr to communicate with local network devices (smartphones, IoT, Raspberry Pi) via VPN tunnel.

#### Use Case

When PipeliNostr runs on a VPS but needs to reach local services:
- Traccar SMS Gateway on smartphone (local mode)
- Home automation devices (MQTT broker, GPIO)
- Local databases or APIs

#### Solutions to Explore

| Solution | Complexity | Notes |
|----------|------------|-------|
| **Tailscale** | Low | Zero-config mesh VPN, free tier available |
| **WireGuard** | Medium | Lightweight, high performance, manual setup |
| **Cloudflare Tunnel** | Low | Expose local services via Cloudflare, no open ports |
| **ngrok** | Low | Quick tunnels, free tier limited |
| **ZeroTier** | Low | Similar to Tailscale, P2P mesh network |

#### Recommended: Tailscale

1. Install Tailscale on VPS and smartphone/local device
2. Both devices get a `100.x.x.x` Tailscale IP
3. Configure handler to use Tailscale IP instead of public URL

```yaml
# config/handlers/traccar-sms.yml (local mode via Tailscale)
traccar_sms:
  enabled: true
  gateway_url: "http://100.64.0.2:8082/"  # Tailscale IP of phone
  token: ${TRACCAR_SMS_TOKEN}
```

#### Documentation to Add

- Setup guide for Tailscale with PipeliNostr
- Configuration examples for local handlers
- Troubleshooting connectivity issues

---


---
