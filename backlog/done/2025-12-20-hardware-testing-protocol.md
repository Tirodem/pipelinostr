---
title: "Hardware Testing Protocol"
priority: "High"
status: "DONE"
created: "2025-12-20"
completed: "2025-12-20"
---

### Hardware Testing Protocol

**Priority:** High
**Status:** DONE

#### Description

Define a testing protocol to validate PipeliNostr with hardware handlers.

#### Recommended Test Setup

**Option 1: Raspberry Pi + Arduino (Most Complete)**

| Handler | Hardware | Test Case |
|---------|----------|-----------|
| GPIO | Raspberry Pi 4/5 | Toggle LED via DM: `[gpio] pin:17 state:high` |
| I2C | RPi + BME280 sensor | Read temp/humidity, send to Nostr |
| Serial | Arduino Uno (USB) | Send command, receive response |
| MQTT | Mosquitto on RPi | Pub/sub test with local broker |
| BLE | RPi + BLE device | Scan and send characteristic |

**Option 2: ESP32 Only (Minimal)**

| Handler | Hardware | Test Case |
|---------|----------|-----------|
| Serial | ESP32 via USB | Bidirectional serial communication |
| MQTT | ESP32 + WiFi | Connect to public broker (test.mosquitto.org) |
| BLE | ESP32 built-in | Advertise/scan BLE services |

**Option 3: Software Simulation (No Hardware)**

| Handler | Tool | Test Case |
|---------|------|-----------|
| Serial | `socat` virtual ports | `socat -d -d pty,raw,echo=0 pty,raw,echo=0` |
| MQTT | Mosquitto Docker | `docker run -p 1883:1883 eclipse-mosquitto` |
| GPIO | `gpio-mock` npm package | Simulated GPIO for testing |

#### Test Scenarios

1. **Nostr DM → GPIO LED**
   - Send: `[gpio] on`
   - Expected: LED turns on, confirmation sent back

2. **Nostr DM → Serial → Arduino**
   - Send: `[serial] PING`
   - Expected: Arduino responds `PONG`, forwarded to Zulip

3. **MQTT Sensor → Nostr Note**
   - Publish temp reading to MQTT topic
   - Expected: PipeliNostr publishes Nostr note with reading

4. **Scheduled I2C Read**
   - Cron: every 5 minutes
   - Expected: Read BME280, store in database

#### Recommended Hardware Shopping List

**Budget (~50€):**
- Raspberry Pi Zero 2 W (~20€)
- BME280 sensor module (~5€)
- LED + resistors (~2€)
- Breadboard + wires (~5€)

**Full Setup (~100€):**
- Raspberry Pi 4 2GB (~50€)
- Arduino Nano (~10€)
- BME280 + other I2C sensors (~15€)
- ESP32 DevKit (~10€)
- LED, relay module, breadboard (~15€)

---


---
