---
title: "Optional System Dependencies in initialize.sh"
priority: "Low"
status: "TO-DO"
created: "2025-12-25"
---

### Optional System Dependencies in initialize.sh

**Priority:** Low
**Status:** TO-DO

#### Description

Ajouter des prompts dans `initialize.sh` pour installer les dépendances système optionnelles selon les handlers utilisés.

#### Dépendances à ajouter (par groupe)

##### Groupe: Signal CLI
- `signal-cli` : Nécessite Java, installation manuelle
- Usage : Signal handler pour envoyer/recevoir des messages Signal

##### Groupe: Bluetooth LE
- `bluetooth`, `bluez`, `libbluetooth-dev` : Stack Bluetooth Linux
- Usage : BLE handler pour communiquer avec des périphériques Bluetooth LE

##### Groupe: USB HID
- `libusb-1.0-0-dev` : Bibliothèque USB
- `node-hid` (npm) : Package Node.js pour USB HID
- Usage : USB HID handler pour communiquer avec des périphériques USB

##### Groupe: Serial Port
- `serialport` (npm) : Peut nécessiter compilation native
- Usage : Serial handler pour communication RS232/USB série

#### Implémentation

Ajouter dans `initialize.sh` un prompt interactif :
```bash
read -p "Installer les dépendances Signal CLI ? (y/N) " -n 1 -r
if [[ $REPLY =~ ^[Yy]$ ]]; then
    # Install signal-cli dependencies
fi
```

#### Références

- Signal CLI : https://github.com/AsamK/signal-cli
- Noble (BLE) : https://github.com/abandonware/noble
- node-hid : https://github.com/node-hid/node-hid
- serialport : https://serialport.io/
