# TTS + Telegram Voice Setup Guide

Convert Nostr DM to audio and send via Telegram bot.

## Architecture

```
DM Nostr → TTS Handler (Piper) → Telegram Handler → Voice Message
```

## Prerequisites

- Raspberry Pi 4 (2GB+ RAM recommended)
- PipeliNostr running
- Internet connection (for Telegram)

## Installation

### 1. Install Piper TTS

```bash
# Option A: Via pip (recommended)
pip install piper-tts

# Option B: Download binary
# https://github.com/rhasspy/piper/releases
```

### 2. Download Voice Model

```bash
# French voice (first run auto-downloads, or manually):
piper --download-model fr_FR-siwis-medium

# Test TTS
echo "Bonjour, ceci est un test" | piper --model fr_FR-siwis-medium --output_file test.wav
aplay test.wav  # or use any audio player
```

### 3. Install ffmpeg (for OGG conversion)

```bash
sudo apt install ffmpeg
```

### 4. Create Telegram Bot

1. Open Telegram, search for `@BotFather`
2. Send `/newbot` and follow instructions
3. Copy the bot token (format: `123456789:ABCdef...`)
4. Add the bot to your target group/channel

### 5. Get Chat ID

```bash
# Replace <TOKEN> with your bot token
curl "https://api.telegram.org/bot<TOKEN>/getUpdates"

# Send a message in your group first, then check the response
# Look for "chat":{"id":-1001234567890,...}
```

## Configuration

### config/handlers/telegram.yml

```yaml
telegram:
  enabled: true
  bot_token: "123456789:ABCdefGHI..."
  default_chat_id: "-1001234567890"  # Optional
```

### config/handlers/tts.yml

```yaml
tts:
  enabled: true
  engine: piper
  piper_model: fr_FR-siwis-medium
  output_dir: ./data/tts
```

### Environment Variables (alternative)

```bash
export TELEGRAM_BOT_TOKEN="123456789:ABCdef..."
export TELEGRAM_CHAT_ID="-1001234567890"
```

## Workflow Setup

Copy the example workflow:

```bash
cp examples/workflows/dm-to-voice-telegram.yml config/workflows/
```

Edit and enable:

```yaml
enabled: true
```

## Usage

Send a DM to your PipeliNostr npub:

```
Send vocal to TG: Bonjour, ceci est un message vocal
```

The bot will:
1. Convert text to audio using Piper TTS
2. Send as voice message to Telegram
3. Confirm via DM

## Available Voices

| Language | Model | Description |
|----------|-------|-------------|
| French | `fr_FR-siwis-medium` | Female, natural |
| French | `fr_FR-upmc-medium` | Male |
| English US | `en_US-lessac-medium` | Female |
| English UK | `en_GB-alba-medium` | Female, British |
| German | `de_DE-thorsten-medium` | Male |
| Spanish | `es_ES-davefx-medium` | Male |

Full list: https://rhasspy.github.io/piper-samples/

## Resource Usage

| Component | RAM | CPU |
|-----------|-----|-----|
| Piper (generation) | 150-300 MB | 50-100% burst |
| PipeliNostr | ~150 MB | <5% idle |

Generation time for ~10 words:
- Pi 4: ~0.5-1 second
- Pi 3: ~2-3 seconds

## Troubleshooting

### Piper not found

```bash
which piper
# If empty, add to PATH or set piper_path in config
```

### ffmpeg conversion failed

```bash
sudo apt install ffmpeg
ffmpeg -version
```

### Telegram "Bad Request: chat not found"

- Ensure bot is added to the group
- Use correct chat_id (negative for groups)
- Send a message in the group and retry getUpdates

### Voice message not playing

Telegram requires OGG Opus format for voice messages. Ensure ffmpeg is installed for automatic conversion.

## Alternative: espeak (lightweight)

For minimal resource usage (robotic voice):

```yaml
# config/handlers/tts.yml
tts:
  enabled: true
  engine: espeak
  espeak_voice: fr
```

Install: `sudo apt install espeak-ng`
