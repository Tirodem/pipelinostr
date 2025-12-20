---
title: "PipeliNostr sur Téléphone (Android/iOS)"
priority: "Low"
status: "Research"
created: "2025-12-20"
---

### PipeliNostr sur Téléphone (Android/iOS)

**Priority:** Low
**Status:** Research

#### Description

Évaluer les possibilités de faire tourner PipeliNostr sur un téléphone Android ou iOS, avec ou sans portage du code.

#### Options d'exécution

| Option | Platform | Effort | Limitations |
|--------|----------|--------|-------------|
| **Termux + Node.js** | Android | Faible | Pas de GPIO, background limité |
| **UserLAnd** | Android | Faible | Linux complet, mêmes limites |
| **iSH** | iOS | Faible | Alpine Linux émulé, lent |
| **React Native port** | Android/iOS | Très élevé | Réécriture majeure |
| **Expo + Node backend** | Android/iOS | Élevé | App native + serveur local |
| **PWA + Service Worker** | Web | Moyen | Pas de WebSocket stable en background |

#### Option 1 : Termux (Android) - Recommandé

**Installation :**
```bash
# Installer Termux depuis F-Droid (pas Play Store)
pkg update && pkg upgrade
pkg install nodejs-lts git

# Cloner PipeliNostr
git clone https://github.com/user/pipelinostr
cd pipelinostr
npm install
npm run build
npm start
```

**Avantages :**
- Code identique, aucune modification
- Node.js 20+ disponible
- Accès réseau complet

**Limitations :**
- Pas d'accès GPIO (pas de hardware control)
- Background execution limitée (Android tue les apps)
- Batterie : consommation significative
- Pas de notifications natives

**Solutions background :**
- `termux-wake-lock` : Empêche la mise en veille
- `termux-services` : Gestion services style init.d
- Notification persistante : Garde l'app en foreground

```bash
# Garder Termux actif
termux-wake-lock

# Lancer comme service
mkdir -p ~/.termux/boot
echo "cd ~/pipelinostr && npm start" > ~/.termux/boot/pipelinostr.sh
chmod +x ~/.termux/boot/pipelinostr.sh
```

#### Option 2 : UserLAnd (Android)

Distribution Linux complète dans une app Android.

```bash
# Installer UserLAnd, choisir Ubuntu/Debian
# Puis même process que serveur Linux classique
sudo apt update
sudo apt install nodejs npm
# ...
```

**Avantages :** Environnement Linux complet
**Inconvénients :** Plus lourd, même limitations background

#### Option 3 : iSH (iOS)

Émulateur Alpine Linux pour iOS (App Store).

```bash
apk add nodejs npm git
# ...
```

**Limitations :** Très lent (émulation x86), pas de background

#### Option 4 : PWA avec Backend Local

Architecture hybride :

```
┌─────────────────────────────────────────────────┐
│                  TÉLÉPHONE                       │
│  ┌───────────────┐     ┌───────────────────┐   │
│  │ PWA (UI)      │◄───►│ PipeliNostr       │   │
│  │ - Dashboard   │     │ (Termux/Service)  │   │
│  │ - Config      │     │ - Core engine     │   │
│  │ - Logs        │     │ - Handlers        │   │
│  └───────────────┘     └───────────────────┘   │
└─────────────────────────────────────────────────┘
```

#### Option 5 : Portage React Native (Non recommandé)

Effort très important :
- Réécrire en React Native / Expo
- Remplacer toutes les deps Node.js par équivalents RN
- Gérer WebSocket différemment
- Pas de filesystem standard

**Estimation :** 3-6 mois de développement

#### Cas d'usage sur téléphone

| Use Case | Faisabilité | Notes |
|----------|-------------|-------|
| Recevoir DMs et notifier | Possible | Via Termux + notification |
| Envoyer SMS via SMS Gateway | Excellent | Même téléphone = latence minimale |
| Relayer vers Telegram | Possible | Requiert background stable |
| Contrôle GPIO | Impossible | Pas d'accès hardware |
| Dashboard monitoring | Possible | PWA locale |

#### Recommandation

**Pour usage réel :** Termux sur Android avec `termux-wake-lock`
- Idéal pour : SMS Gateway (même device), bridge messaging
- Éviter pour : Workloads 24/7 critiques, GPIO

**Pour production :** Raspberry Pi ou VPS reste préférable
- Stabilité, background garanti, GPIO possible

#### Tâches de recherche

- [ ] Tester PipeliNostr sur Termux (Android)
- [ ] Documenter les workarounds background
- [ ] Évaluer consommation batterie
- [ ] Tester combo SMS Gateway + PipeliNostr même device
- [ ] Explorer PWA dashboard option

---


---
