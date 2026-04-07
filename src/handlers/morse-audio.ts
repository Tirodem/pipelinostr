/**
 * Morse audio handler (v2)
 *
 * Converts text to Morse code and generates a WAV file.
 * No external dependencies — generates raw PCM WAV.
 */

import { z } from 'zod';
import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import { BaseHandler, type HandlerResult, type ActionContext } from './base.js';

const MORSE_MAP: Record<string, string> = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.',
  G: '--.', H: '....', I: '..', J: '.---', K: '-.-', L: '.-..',
  M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.',
  S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-',
  Y: '-.--', Z: '--..', '0': '-----', '1': '.----', '2': '..---',
  '3': '...--', '4': '....-', '5': '.....', '6': '-....', '7': '--...',
  '8': '---..', '9': '----.', '.': '.-.-.-', ',': '--..--', '?': '..--..',
};

function textToMorse(text: string): string {
  return text.toUpperCase().split('').map(c =>
    c === ' ' ? '/' : (MORSE_MAP[c] ?? '')
  ).filter(Boolean).join(' ');
}

function generateWav(morse: string, frequency: number, sampleRate: number): Buffer {
  const dotDuration = 0.06; // seconds
  const dashDuration = dotDuration * 3;
  const symbolGap = dotDuration;
  const letterGap = dotDuration * 3;
  const wordGap = dotDuration * 7;

  const samples: number[] = [];
  const addTone = (duration: number) => {
    const count = Math.floor(sampleRate * duration);
    for (let i = 0; i < count; i++) {
      samples.push(Math.sin(2 * Math.PI * frequency * i / sampleRate) * 0.8);
    }
  };
  const addSilence = (duration: number) => {
    const count = Math.floor(sampleRate * duration);
    for (let i = 0; i < count; i++) samples.push(0);
  };

  for (const token of morse.split(' ')) {
    if (token === '/') { addSilence(wordGap); continue; }
    for (let i = 0; i < token.length; i++) {
      addTone(token[i] === '-' ? dashDuration : dotDuration);
      if (i < token.length - 1) addSilence(symbolGap);
    }
    addSilence(letterGap);
  }

  // 16-bit PCM WAV
  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);       // PCM
  buffer.writeUInt16LE(1, 22);       // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < samples.length; i++) {
    buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i]! * 32767))), 44 + i * 2);
  }
  return buffer;
}

export class MorseAudioHandler extends BaseHandler {
  static type = 'morse_audio';
  static configSchema = z.object({
    output_dir: z.string().optional(),
    default_frequency: z.number().optional(),
    enabled: z.boolean().optional(),
  });

  readonly name = 'Morse Audio';
  readonly type = 'morse_audio';

  private outputDir = '/tmp/pipelinostr/morse';
  private defaultFrequency = 700;

  async initialize(config: Record<string, unknown>): Promise<void> {
    if (config.output_dir) this.outputDir = config.output_dir as string;
    if (config.default_frequency) this.defaultFrequency = config.default_frequency as number;
    await fs.mkdir(this.outputDir, { recursive: true });
  }

  async execute(action: Record<string, unknown>, _context: ActionContext): Promise<HandlerResult> {
    const text = action.text as string;
    if (!text) return { success: false, error: 'Missing "text" field' };

    const frequency = (action.frequency as number) ?? this.defaultFrequency;
    const morse = textToMorse(text);
    const wav = generateWav(morse, frequency, 22050);

    const filename = `morse_${Date.now()}.wav`;
    const filePath = join(this.outputDir, filename);
    await fs.writeFile(filePath, wav);

    return { success: true, data: { file_path: filePath, morse, length: wav.length } };
  }

  async shutdown(): Promise<void> {}
}
