---
title: "Minimal Hardware for Self-Hosted PipeliNostr"
priority: "Medium"
status: "DONE"
created: "2025-12-20"
completed: "2025-12-20"
---

### Minimal Hardware for Self-Hosted PipeliNostr

**Priority:** Medium
**Status:** DONE

#### Description

Identify economical hardware configurations to run PipeliNostr locally (not on VPS).

#### Requirements

- Node.js 20+ support
- 512MB+ RAM (1GB recommended)
- Network connectivity (Ethernet or WiFi)
- Low power consumption for 24/7 operation
- Optional: GPIO for direct hardware control

#### Hardware Options

**Budget Tier (~20-40€)**

| Device | RAM | Storage | Power | Notes |
|--------|-----|---------|-------|-------|
| **Raspberry Pi Zero 2 W** | 512MB | microSD | 1W | WiFi, compact, limited RAM |
| **Orange Pi Zero 3** | 1GB | microSD | 2W | Good value, H618 SoC |
| **Libre Computer Le Potato** | 2GB | microSD | 3W | RPi alternative |

**Recommended Tier (~50-80€)**

| Device | RAM | Storage | Power | Notes |
|--------|-----|---------|-------|-------|
| **Raspberry Pi 4 Model B 2GB** | 2GB | microSD/SSD | 3-6W | Best ecosystem, GPIO |
| **Raspberry Pi 5 2GB** | 2GB | microSD/NVMe | 4-8W | Faster, PCIe support |
| **Orange Pi 5** | 4GB | eMMC/NVMe | 5W | RK3588S, great perf |
| **Odroid N2+** | 4GB | eMMC | 5W | Reliable, good cooling |

**Mini PC Tier (~100-150€)**

| Device | RAM | Storage | Power | Notes |
|--------|-----|---------|-------|-------|
| **Intel N100 Mini PC** | 8GB | 256GB SSD | 10-15W | x86, runs anything |
| **Beelink Mini S12** | 8GB | 256GB | 15W | Compact, silent |
| **Used Thin Client (HP T620/T630)** | 4-8GB | SSD | 10W | Very cheap used (~30€) |

**Repurposed Hardware**

| Device | Notes |
|--------|-------|
| Old Android phone | Termux + Node.js, free, has battery backup |
| Old laptop | Already have it, overkill but works |
| NAS (Synology/QNAP) | Docker support, always on |

#### Recommended Setup

**Best Value:** Raspberry Pi 4 2GB (~50€) + 32GB microSD (~10€)
- Proven ecosystem
- GPIO for hardware control
- Large community support
- Runs PipeliNostr comfortably

**Most Economical:** Raspberry Pi Zero 2 W (~20€) + 16GB microSD (~5€)
- Tight on RAM but functional
- WiFi built-in
- Ultra-low power (~1W)

**Best Performance:** Intel N100 Mini PC (~100€)
- x86 compatibility
- 8GB RAM, SSD storage
- Can run other services alongside

#### Power Consumption Comparison

| Device | Idle | Load | Monthly Cost (0.20€/kWh) |
|--------|------|------|--------------------------|
| RPi Zero 2 W | 0.5W | 1.5W | ~0.20€ |
| RPi 4 2GB | 2.5W | 6W | ~1.00€ |
| RPi 5 2GB | 3W | 8W | ~1.30€ |
| N100 Mini PC | 6W | 15W | ~2.50€ |

---


---
