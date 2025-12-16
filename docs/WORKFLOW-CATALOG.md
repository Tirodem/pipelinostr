# PipeliNostr Workflow Catalog

Complete list of available workflows with testing status.

## Testing Status Legend

- Tested: Workflow has been tested and works
- Untested: Workflow created but not yet tested
- Partial: Some features tested, others pending

---

## GPIO & Hardware

### 1. GPIO LED Control (`nostr-to-gpio`)
| Status | **Tested** |
|--------|-----------|
| **Trigger** | DM Nostr |
| **Command** | `gpio:green`, `gpio:red`, `gpio:servo` |
| **Action** | Control GPIO pins on Raspberry Pi |
| **Output** | LED on/blink, servo movement |
| **Confirmation** | None |
| **Prerequisites** | pigpiod daemon, GPIO handler enabled |

### 2. Zap Dispenser (`zap-to-dispenser`)
| Status | **Tested** |
|--------|-----------|
| **Trigger** | Zap receipt (kind 9735) |
| **Command** | Zap >= 21 sats (configurable) |
| **Action** | Activate servo dispenser |
| **Output** | Servo moves 0->180->0, log to file |
| **Confirmation** | DM "Merci pour votre zap!" |
| **Prerequisites** | pigpiod daemon, servo on GPIO 18 |

### 3. Morse Code Buzzer (`nostr-to-morse`)
| Status | **Untested** |
|--------|-------------|
| **Trigger** | DM Nostr |
| **Command** | `morse: <text>`, `morse:slow: <text>`, `morse:fast: <text>` |
| **Action** | Convert text to Morse code, play on buzzer, generate audio |
| **Output** | Buzzer plays Morse sequence + voice message on Telegram |
| **Confirmation** | DM with Morse code representation |
| **Prerequisites** | pigpiod daemon, active buzzer on GPIO 27, Telegram bot (optional), ffmpeg (for OGG) |

---

## Communication Nostr

### 3. Publish Note (`publish-note`)
| Status | **Untested** |
|--------|-----------|
| **Trigger** | DM Nostr |
| **Command** | `/publish <content>` |
| **Action** | Publish public note to Nostr |
| **Output** | Note on relays |
| **Confirmation** | DM with event ID |

### 4. Auto Reply (`auto-reply`)
| Status | **Untested** |
|--------|-----------|
| **Trigger** | DM Nostr |
| **Command** | `hello`, `hi`, `bonjour`, `salut` |
| **Action** | Send automated greeting |
| **Output** | DM response |

### 5. Command Handler (`command-handler`)
| Status | **Untested** |
|--------|-----------|
| **Trigger** | DM Nostr |
| **Command** | `/ping`, `/help`, `/status`, `/echo <text>` |
| **Action** | Respond to slash commands |
| **Output** | DM response |

---

## Messaging & Social

### 6. DM to Voice Telegram (`dm-to-voice-telegram`)
| Status | **Tested** |
|--------|-----------|
| **Trigger** | DM Nostr |
| **Command** | `Send vocal to TG: <message>` |
| **Action** | Convert text to speech, send to Telegram |
| **Output** | Voice message on Telegram |
| **Confirmation** | DM confirmation |
| **Prerequisites** | espeak-ng, Telegram bot configured |

### 7. Nostr to Telegram (`nostr-to-telegram`)
| Status | **Tested** |
|--------|-----------|
| **Trigger** | All DMs |
| **Command** | Any DM |
| **Action** | Forward to Telegram chat |
| **Output** | Text message on Telegram |
| **Prerequisites** | Telegram bot configured |

### 8. DM to Bluesky (`dm-to-bluesky`)
| Status | **Tested** |
|--------|-----------|
| **Trigger** | DM Nostr |
| **Command** | `Bluesky: <message>` |
| **Action** | Post to Bluesky |
| **Output** | Public post on Bluesky |
| **Prerequisites** | Bluesky app password |

### 9. DM to Mastodon (`dm-to-mastodon`)
| Status | **Tested** |
|--------|-----------|
| **Trigger** | DM Nostr |
| **Command** | `Mastodon: <message>` |
| **Action** | Post to Mastodon |
| **Output** | Public toot on Mastodon |
| **Prerequisites** | Mastodon access token |

### 10. Send SMS (`nostr-to-sms`)
| Status | **Tested** |
|--------|-----------|
| **Trigger** | DM Nostr |
| **Command** | `Send SMS to +33...: <message>` |
| **Action** | Send SMS via Traccar Gateway |
| **Output** | SMS on recipient phone |
| **Prerequisites** | Traccar SMS Gateway app |

### 11. Send Email (`nostr-to-email`)
| Status | **Tested** |
|--------|-----------|
| **Trigger** | DM Nostr |
| **Command** | `Send email to x@y.com: <message>` |
| **Action** | Send email via SMTP |
| **Output** | Email to recipient |
| **Prerequisites** | SMTP server configured |

### 12. Email Forward (`email-forward`)
| Status | **Untested** |
|--------|-----------|
| **Trigger** | All DMs |
| **Command** | Any DM |
| **Action** | Forward to email address |
| **Output** | Email with DM content |
| **Prerequisites** | SMTP server configured |

### 13. Morse Audio to Telegram (`morse-to-telegram`)
| Status | **Untested** |
|--------|-------------|
| **Trigger** | DM Nostr |
| **Command** | `morse:tg: <text>`, `morse:tg:slow: <text>`, `morse:tg:fast: <text>` |
| **Action** | Generate Morse code audio, send to Telegram |
| **Output** | Voice message with Morse beeps on Telegram |
| **Confirmation** | DM with Morse code representation |
| **Prerequisites** | Telegram bot configured, ffmpeg (for OGG) |

---

## Zulip Integration

### 13. Zulip Forward (`zulip-forward`)
| Status | **Tested** |
|--------|-----------|
| **Trigger** | All DMs |
| **Command** | Any DM |
| **Action** | Forward to Zulip stream |
| **Output** | Message on Zulip |
| **Prerequisites** | Zulip bot configured |

### 14. Zap Notification (`zap-notification`)
| Status | **Tested** |
|--------|-----------|
| **Trigger** | Zap receipt |
| **Command** | Any zap received |
| **Action** | Post notification to Zulip |
| **Output** | Zap details on Zulip stream |
| **Prerequisites** | Zulip bot configured |

### 15. Zulip Workflow Notification (`zulip-workflow-notification`)
| Status | **Tested** |
|--------|-----------|
| **Trigger** | Workflow hooks |
| **Command** | Via `on_complete`/`on_fail` hooks |
| **Action** | Post workflow status to Zulip |
| **Output** | Success/failure notification |
| **Prerequisites** | Zulip bot configured |

---

## Storage & Archiving

### 16. DM to FTP (`dm-to-ftp`)
| Status | **Tested** |
|--------|-----------|
| **Trigger** | DM Nostr |
| **Command** | `ftp: <message>` |
| **Action** | Append to FTP log file |
| **Output** | Log entry on FTP server |
| **Prerequisites** | FTP server configured |

### 17. DM to FTP with Local (`dm-to-ftp-with-local-storage`)
| Status | **Tested** |
|--------|-----------|
| **Trigger** | DM Nostr |
| **Command** | `ftp: <message>` |
| **Action** | Save local + upload to FTP |
| **Output** | Local file + FTP file |
| **Prerequisites** | FTP server configured |

### 18. DM to MongoDB (`dm-to-mongodb`)
| Status | **Tested** |
|--------|-----------|
| **Trigger** | DM Nostr |
| **Command** | `mongo: <data>` or `mongo:category: <data>` |
| **Action** | Insert document to MongoDB |
| **Output** | Document in collection |
| **Prerequisites** | MongoDB connection |

---

## APIs & Webhooks

### 19. API to Nostr DM (`api-to-nostr-dm`)
| Status | **Tested** |
|--------|-----------|
| **Trigger** | HTTP POST to `/api/notify` |
| **Command** | JSON body |
| **Action** | Send DM to configured recipient |
| **Output** | DM on Nostr |
| **Prerequisites** | Webhook server enabled |

### 20. Webhook Notifier (`webhook-notifier`)
| Status | **Tested** |
|--------|-----------|
| **Trigger** | All DMs |
| **Command** | Any DM |
| **Action** | Forward to external webhook |
| **Output** | HTTP POST to webhook URL |

### 21. Mempool TX Lookup (`mempool-tx-lookup`)
| Status | **Tested** |
|--------|-----------|
| **Trigger** | DM Nostr |
| **Command** | `mempool: <txid>` (64 hex chars) |
| **Action** | Query mempool.space API |
| **Output** | DM with TX details (amount, fees, status) |

---

## Calendar & ERP

### 22. Calendar Invite (`nostr-to-calendar`)
| Status | **Tested** |
|--------|-----------|
| **Trigger** | DM Nostr |
| **Command** | `Invite x@y.com: Title @ 2025-12-15 14:00 (1h) @ Location` |
| **Action** | Send iCal invitation |
| **Output** | Calendar invite email |
| **Prerequisites** | Calendar handler + SMTP |

### 23. be-BOP Order Sync (`bebop-order-sync`)
| Status | **Tested** |
|--------|-----------|
| **Trigger** | DM Nostr |
| **Command** | `Payment for order #123 is paid, see https://...` |
| **Action** | Fetch order, parse, create in Odoo |
| **Output** | Sale order in Odoo ERP |
| **Prerequisites** | Odoo API configured |

---

## System & Administration

### 24. DPO Report (`dpo-command`)
| Status | **Tested** |
|--------|------------|
| **Trigger** | DM Nostr |
| **Command** | `/dpo` |
| **Action** | Generate GDPR data processing report |
| **Output** | DM with Markdown report |
| **Prerequisites** | None |

### 25. Claude Workflow Generator (`claude-workflow-generator`)
| Status | **Untested** |
|--------|--------------|
| **Trigger** | DM Nostr |
| **Command** | `/workflow <description>` |
| **Action** | Generate workflow YAML via Claude AI |
| **Output** | DM with generated workflow |
| **Prerequisites** | Anthropic API key |

### 26. Claude Activate (`claude-activate`)
| Status | **Untested** |
|--------|--------------|
| **Trigger** | DM Nostr |
| **Command** | `/activate <id>`, `/cancel [id]`, `/pending` |
| **Action** | Activate, cancel or list pending workflows |
| **Output** | DM confirmation |
| **Prerequisites** | claude-workflow-generator active |

---

## Summary

| Category | Total | Tested | Untested |
|----------|-------|--------|----------|
| GPIO & Hardware | 3 | 2 | 1 |
| Communication Nostr | 3 | 0 | 3 |
| Messaging & Social | 8 | 6 | 2 |
| Zulip Integration | 3 | 3 | 0 |
| Storage & Archiving | 3 | 3 | 0 |
| APIs & Webhooks | 3 | 3 | 0 |
| Calendar & ERP | 2 | 2 | 0 |
| System & Administration | 3 | 1 | 2 |
| **Total** | **28** | **20** | **8** |

---

*Last updated: 2025-12-16*
