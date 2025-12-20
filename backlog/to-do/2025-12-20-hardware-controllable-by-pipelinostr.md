---
title: "Hardware Controllable by PipeliNostr"
priority: "Medium"
status: "Proposed"
created: "2025-12-20"
---

### Hardware Controllable by PipeliNostr

**Priority:** Medium
**Status:** Proposed

#### Description

Identify hardware devices that can be controlled via PipeliNostr workflows.

#### Categories

**1. GPIO / Digital I/O**
| Device | Connection | Handler | Use Case |
|--------|------------|---------|----------|
| LED | Raspberry Pi GPIO | `gpio` | Visual notifications |
| Relay module | RPi/Arduino GPIO | `gpio` | Switch appliances on/off |
| Servo motor | RPi/Arduino PWM | `gpio` | Physical movement |
| Buzzer | GPIO | `gpio` | Audio alerts |

**2. Serial / USB Devices**
| Device | Connection | Handler | Use Case |
|--------|------------|---------|----------|
| Arduino | USB Serial | `serial` | Custom microcontroller commands |
| ESP32/ESP8266 | USB Serial | `serial` | WiFi-enabled MCU |
| 3D Printer | USB Serial | `serial` | Send GCode commands |
| USB Relay | USB Serial | `serial` | Industrial relay control |

**3. Network / IoT**
| Device | Protocol | Handler | Use Case |
|--------|----------|---------|----------|
| Smart bulbs (Philips Hue, LIFX) | HTTP API | `http` | Lighting control |
| Smart plugs (TP-Link, Tasmota) | HTTP/MQTT | `http`/`mqtt` | Power control |
| Shelly devices | HTTP/MQTT | `http`/`mqtt` | Home automation |
| Home Assistant | REST API | `http` | Hub for all devices |
| Node-RED | HTTP | `http` | Flow automation |

**4. MQTT Devices**
| Device | Topic Structure | Handler | Use Case |
|--------|-----------------|---------|----------|
| Zigbee2MQTT bridge | `zigbee2mqtt/+/set` | `mqtt` | Zigbee device control |
| Tasmota devices | `cmnd/+/POWER` | `mqtt` | Sonoff/ESP devices |
| ESPHome devices | `esphome/+/command` | `mqtt` | Custom ESP firmware |

**5. Display / Output**
| Device | Connection | Handler | Use Case |
|--------|------------|---------|----------|
| E-ink display | SPI/I2C | `spi`/`i2c` | Low-power status display |
| LCD/OLED | I2C | `i2c` | Real-time info display |
| LED Matrix | SPI | `spi` | Scrolling text |
| Thermal printer | Serial/USB | `serial` | Print notifications |

**6. Audio**
| Device | Method | Handler | Use Case |
|--------|--------|---------|----------|
| Speaker (local) | `aplay`/`mpg123` | `exec` | Text-to-speech, alerts |
| Sonos | HTTP API | `http` | Multi-room audio |
| Chromecast | Cast protocol | TBD | Cast audio/video |

#### Implementation Priority

1. **Phase 1:** HTTP-based (smart plugs, Home Assistant, APIs)
2. **Phase 2:** MQTT (IoT ecosystem)
3. **Phase 3:** Serial (Arduino, ESP32)
4. **Phase 4:** GPIO (Raspberry Pi native)

---


---
