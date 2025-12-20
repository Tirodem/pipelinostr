---
title: "Voice Handlers (STT/TTS)"
priority: "Very Low (Future Vision)"
status: "Proposed"
created: "2025-12-20"
---

### Voice Handlers (STT/TTS)

**Priority:** Very Low (Future Vision)
**Status:** Proposed

#### Description

Ajouter des handlers pour la synthèse et reconnaissance vocale, permettant des interactions audio avec PipeliNostr.

#### Handlers Proposés

**1. Speech-to-Text (STT)** - Reconnaissance vocale
```yaml
type: speech_to_text
config:
  audio_source: "{{ trigger.audio_url }}"  # URL fichier audio
  language: "fr-FR"
  provider: "whisper"  # ou google, azure, embedded
```

**2. Text-to-Speech (TTS)** - Synthèse vocale
```yaml
type: text_to_speech
config:
  text: "{{ trigger.content }}"
  voice: "fr-FR-Standard-A"
  output: "file"  # ou "stream", "nostr_upload"
  provider: "piper"  # ou google, azure, elevenlabs
```

**3. Voice Input** - Écoute micro en continu
```yaml
# Inbound handler (comme webhook)
voice_input:
  enabled: true
  device: "default"  # ou "hw:1,0"
  wake_word: "hey pipelinostr"
  language: "fr-FR"
```

#### Use Cases

**1. Commande vocale → Action**
```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ Micro RPi   │────►│ STT (Whisper)│────►│ LLM Intent  │
│ "Allume     │     │ → texte     │     │ → workflow  │
│  la lumière"│     └─────────────┘     └──────┬──────┘
└─────────────┘                                │
                                               ▼
                                        ┌─────────────┐
                                        │ GPIO ON     │
                                        └─────────────┘
```

**2. Notification vocale**
```yaml
id: zap-voice-notification
trigger:
  type: nostr_event
  filters:
    kinds: [9735]
    zap_min_amount: 500

actions:
  - id: speak
    type: text_to_speech
    config:
      text: "Vous avez reçu un zap de {{ trigger.zap.amount }} sats"
      output: "speaker"
```

**3. Message vocal Nostr → Transcription**
```yaml
id: voice-dm-transcribe
trigger:
  type: nostr_event
  filters:
    kinds: [4]
    has_audio: true

actions:
  - id: transcribe
    type: speech_to_text
    config:
      audio_source: "{{ trigger.audio_url }}"

  - id: forward
    type: telegram
    config:
      message: "Message vocal de {{ trigger.from }}: {{ actions.transcribe.response.text }}"
```

#### Options d'Implémentation

| Composant | Cloud | Local/Embarqué |
|-----------|-------|----------------|
| **STT** | Google Speech, Azure, Deepgram | Whisper.cpp, Vosk |
| **TTS** | Google TTS, Azure, ElevenLabs | Piper, espeak-ng, Coqui |
| **Wake Word** | - | Porcupine, openWakeWord |

#### Option Embarquée (Offline)

```
┌─────────────────────────────────────────────────┐
│              PipeliNostr + Voice                 │
│  ┌──────────────┐  ┌──────────────┐             │
│  │ Whisper.cpp  │  │ Piper TTS    │             │
│  │ (STT, ~1GB)  │  │ (~100MB)     │             │
│  └──────────────┘  └──────────────┘             │
│  ┌──────────────┐                               │
│  │ openWakeWord │ "Hey Pipelinostr"             │
│  │ (~50MB)      │                               │
│  └──────────────┘                               │
└─────────────────────────────────────────────────┘
```

**Modèles Whisper :**
| Modèle | Taille | RAM | Qualité |
|--------|--------|-----|---------|
| tiny | 75MB | 1GB | Basique |
| base | 150MB | 1.5GB | Correct |
| small | 500MB | 2GB | Bon |
| medium | 1.5GB | 4GB | Très bon |

**Voix Piper (TTS français) :**
- `fr_FR-siwis-medium` (~100MB, qualité naturelle)
- `fr_FR-upmc-medium` (~100MB, voix masculine)

#### Hardware Requis

| Config | STT | TTS | Wake Word |
|--------|-----|-----|-----------|
| RPi 4 2GB | Whisper tiny | Piper | openWakeWord |
| RPi 4 4GB | Whisper base | Piper | openWakeWord |
| Mini PC 8GB | Whisper small | Piper | openWakeWord |
| Avec GPU | Whisper medium+ | - | - |

#### Flux Complet Voice-First

```
         ┌─────────────────────────────────────────┐
         │           PipeliNostr Voice              │
         │                                          │
Micro ──►│ Wake Word ──► STT ──► LLM ──► Workflow  │
         │     │                            │       │
         │     └────────── TTS ◄────────────┘       │
         │                  │                       │
Speaker◄─┤──────────────────┘                       │
         └─────────────────────────────────────────┘

"Hey Pipelinostr, allume la lumière du salon"
→ [Wake] → [STT] → [LLM: intent=gpio, pin=17] → [GPIO ON]
→ [TTS] → "La lumière du salon est allumée"
```

#### Considérations

- **Latence** : STT local ~1-3s selon modèle et hardware
- **Bruit** : Filtrage nécessaire en environnement bruyant
- **Multi-langue** : Whisper supporte 99 langues
- **Privacy** : Solution locale recommandée pour commandes sensibles

---


---
