/**
 * Morse Audio Handler - Generate Morse code audio files
 * Creates WAV files with sine wave beeps representing Morse code
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { logger } from '../persistence/logger.js';
import type { Handler, HandlerResult, HandlerConfig } from './handler.interface.js';

export interface MorseAudioHandlerOptions {
  outputDir?: string | undefined;
  defaultFrequency?: number | undefined;  // Tone frequency in Hz (default: 700)
  defaultUnitMs?: number | undefined;     // Base unit duration (default: 100ms = ~12 WPM)
  sampleRate?: number | undefined;        // Audio sample rate (default: 44100)
  maxTextLength?: number | undefined;     // Max characters (default: 100)
}

export interface MorseAudioActionConfig extends HandlerConfig {
  text: string;
  unit_ms?: number | undefined;     // Base unit duration in ms
  frequency?: number | undefined;   // Tone frequency in Hz
  format?: 'wav' | 'ogg' | undefined;
}

// International Morse Code dictionary
const MORSE_CODE: Record<string, string> = {
  'A': '.-',    'B': '-...',  'C': '-.-.',  'D': '-..',   'E': '.',
  'F': '..-.',  'G': '--.',   'H': '....',  'I': '..',    'J': '.---',
  'K': '-.-',   'L': '.-..',  'M': '--',    'N': '-.',    'O': '---',
  'P': '.--.',  'Q': '--.-',  'R': '.-.',   'S': '...',   'T': '-',
  'U': '..-',   'V': '...-',  'W': '.--',   'X': '-..-',  'Y': '-.--',
  'Z': '--..',
  '0': '-----', '1': '.----', '2': '..---', '3': '...--', '4': '....-',
  '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.',
  '.': '.-.-.-', ',': '--..--', '?': '..--..', "'": '.----.', '!': '-.-.--',
  '/': '-..-.', '(': '-.--.', ')': '-.--.-', '&': '.-...', ':': '---...',
  ';': '-.-.-.', '=': '-...-', '+': '.-.-.', '-': '-....-', '_': '..--.-',
  '"': '.-..-.', '$': '...-..-', '@': '.--.-.',
};

export class MorseAudioHandler implements Handler {
  readonly name = 'Morse Audio Handler';
  readonly type = 'morse_audio';

  private outputDir: string;
  private defaultFrequency: number;
  private defaultUnitMs: number;
  private sampleRate: number;
  private maxTextLength: number;

  constructor(options: MorseAudioHandlerOptions = {}) {
    this.outputDir = options.outputDir ?? './data/morse-audio';
    this.defaultFrequency = options.defaultFrequency ?? 700;  // 700Hz is classic CW tone
    this.defaultUnitMs = options.defaultUnitMs ?? 100;
    this.sampleRate = options.sampleRate ?? 44100;
    this.maxTextLength = options.maxTextLength ?? 100;  // ~30-60 seconds of audio
  }

  async initialize(): Promise<void> {
    // Ensure output directory exists
    await fs.mkdir(this.outputDir, { recursive: true });
    logger.info({ outputDir: this.outputDir }, 'Morse Audio handler initialized');
  }

  async execute(config: HandlerConfig, _context: Record<string, unknown>): Promise<HandlerResult> {
    const morseConfig = config as MorseAudioActionConfig;

    if (!morseConfig.text) {
      return { success: false, error: 'Missing required field: text' };
    }

    const text = morseConfig.text.trim();
    if (!text) {
      return { success: false, error: 'Text cannot be empty' };
    }

    const unitMs = morseConfig.unit_ms ?? this.defaultUnitMs;
    const frequency = morseConfig.frequency ?? this.defaultFrequency;
    const format = morseConfig.format ?? 'ogg';

    // Split text into chunks if too long
    const chunks = this.splitTextIntoChunks(text, this.maxTextLength);
    const files: Array<{
      file_path: string;
      format: string;
      size: number;
      text: string;
      morse: string;
      chunk_index: number;
      total_chunks: number;
    }> = [];

    try {
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]!;
        const outputId = randomUUID();
        const wavFile = join(this.outputDir, `${outputId}.wav`);
        let finalFile = format === 'wav' ? wavFile : join(this.outputDir, `${outputId}.${format}`);
        let finalFormat = format;

        // Generate Morse audio for this chunk
        const audioData = this.generateMorseAudio(chunk, unitMs, frequency);

        // Write WAV file
        await this.writeWavFile(wavFile, audioData);

        // Convert to OGG if needed (for Telegram voice compatibility)
        if (format === 'ogg') {
          try {
            await this.convertToOgg(wavFile, finalFile);
            await fs.unlink(wavFile);  // Clean up WAV
          } catch (convError) {
            // If conversion fails, keep WAV file
            if (i === 0) {
              logger.warn({ error: convError }, 'OGG conversion failed, using WAV');
            }
            finalFile = wavFile;
            finalFormat = 'wav';
          }
        }

        // Verify file was created
        const stats = await fs.stat(finalFile);
        const morseSequence = this.textToMorse(chunk);

        files.push({
          file_path: finalFile,
          format: finalFormat,
          size: stats.size,
          text: chunk,
          morse: morseSequence,
          chunk_index: i + 1,
          total_chunks: chunks.length,
        });

        logger.info(
          {
            chunk: `${i + 1}/${chunks.length}`,
            text: chunk.substring(0, 30),
            outputFile: finalFile,
            size: stats.size,
            frequency,
            unitMs
          },
          'Morse audio chunk generated'
        );
      }

      // Combine all morse sequences
      const fullMorse = files.map(f => f.morse).join(' / ');

      return {
        success: true,
        data: {
          // Single file compatibility (first file)
          file_path: files[0]!.file_path,
          format: files[0]!.format,
          size: files.reduce((sum, f) => sum + f.size, 0),
          text,
          morse: fullMorse,
          frequency,
          unit_ms: unitMs,
          wpm: Math.round(1200 / unitMs),
          // Multi-file support
          files,
          total_chunks: chunks.length,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ text: text.substring(0, 50), error: errorMessage }, 'Morse audio generation failed');
      return { success: false, error: errorMessage };
    }
  }

  private async fileExists(path: string): Promise<boolean> {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Generate Morse code audio as 16-bit PCM samples
   */
  private generateMorseAudio(text: string, unitMs: number, frequency: number): Int16Array {
    const samples: number[] = [];
    const samplesPerUnit = Math.round((unitMs / 1000) * this.sampleRate);
    const amplitude = 0.8;

    const words = text.toUpperCase().split(/\s+/).filter(w => w.length > 0);

    for (let wordIndex = 0; wordIndex < words.length; wordIndex++) {
      const word = words[wordIndex]!;

      for (let charIndex = 0; charIndex < word.length; charIndex++) {
        const char = word[charIndex]!;
        const morse = MORSE_CODE[char];

        if (morse) {
          for (let symbolIndex = 0; symbolIndex < morse.length; symbolIndex++) {
            const symbol = morse[symbolIndex];

            if (symbol === '.') {
              // Dot: 1 unit tone
              this.addTone(samples, samplesPerUnit, frequency, amplitude);
            } else if (symbol === '-') {
              // Dash: 3 units tone
              this.addTone(samples, samplesPerUnit * 3, frequency, amplitude);
            }

            // Space between symbols: 1 unit silence
            if (symbolIndex < morse.length - 1) {
              this.addSilence(samples, samplesPerUnit);
            }
          }
        }

        // Space between letters: 3 units total
        if (charIndex < word.length - 1) {
          this.addSilence(samples, samplesPerUnit * 3);
        }
      }

      // Space between words: 7 units total
      if (wordIndex < words.length - 1) {
        this.addSilence(samples, samplesPerUnit * 7);
      }
    }

    // Add a small silence at the end
    this.addSilence(samples, samplesPerUnit);

    // Convert to Int16Array
    return new Int16Array(samples.map(s => Math.round(s * 32767)));
  }

  /**
   * Add a sine wave tone to the samples array
   */
  private addTone(samples: number[], numSamples: number, frequency: number, amplitude: number): void {
    // Apply attack/release envelope to avoid clicks
    const attackSamples = Math.min(100, Math.floor(numSamples * 0.1));
    const releaseSamples = Math.min(100, Math.floor(numSamples * 0.1));

    for (let i = 0; i < numSamples; i++) {
      let envelope = 1.0;

      // Attack (fade in)
      if (i < attackSamples) {
        envelope = i / attackSamples;
      }
      // Release (fade out)
      else if (i > numSamples - releaseSamples) {
        envelope = (numSamples - i) / releaseSamples;
      }

      const t = i / this.sampleRate;
      const value = amplitude * envelope * Math.sin(2 * Math.PI * frequency * t);
      samples.push(value);
    }
  }

  /**
   * Add silence to the samples array
   */
  private addSilence(samples: number[], numSamples: number): void {
    for (let i = 0; i < numSamples; i++) {
      samples.push(0);
    }
  }

  /**
   * Write audio data as WAV file
   */
  private async writeWavFile(filePath: string, audioData: Int16Array): Promise<void> {
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = this.sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const dataSize = audioData.length * (bitsPerSample / 8);
    const fileSize = 36 + dataSize;

    // Create WAV header
    const header = Buffer.alloc(44);

    // RIFF chunk
    header.write('RIFF', 0);
    header.writeUInt32LE(fileSize, 4);
    header.write('WAVE', 8);

    // fmt subchunk
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);           // Subchunk size
    header.writeUInt16LE(1, 20);            // Audio format (PCM)
    header.writeUInt16LE(numChannels, 22);  // Number of channels
    header.writeUInt32LE(this.sampleRate, 24);  // Sample rate
    header.writeUInt32LE(byteRate, 28);     // Byte rate
    header.writeUInt16LE(blockAlign, 32);   // Block align
    header.writeUInt16LE(bitsPerSample, 34); // Bits per sample

    // data subchunk
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);

    // Combine header and audio data
    const audioBuffer = Buffer.from(audioData.buffer);
    const wavBuffer = Buffer.concat([header, audioBuffer]);

    await fs.writeFile(filePath, wavBuffer);
  }

  /**
   * Convert WAV to OGG using ffmpeg
   */
  private convertToOgg(inputFile: string, outputFile: string): Promise<void> {
    return new Promise((resolve, reject) => {
      import('child_process').then(({ spawn }) => {
        const args = [
          '-i', inputFile,
          '-c:a', 'libopus',
          '-b:a', '64k',
          '-y',
          outputFile,
        ];

        const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

        let stderr = '';
        proc.stderr?.on('data', (data: Buffer) => {
          stderr += data.toString();
        });

        proc.on('error', () => {
          reject(new Error('ffmpeg not found - install ffmpeg for OGG conversion'));
        });

        proc.on('close', (code: number | null) => {
          if (code === 0) resolve();
          else reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
        });
      }).catch(reject);
    });
  }

  /**
   * Convert text to Morse code string representation
   */
  private textToMorse(text: string): string {
    return text
      .toUpperCase()
      .split('')
      .map(char => {
        if (char === ' ') return '/';
        return MORSE_CODE[char] || '';
      })
      .filter(m => m)
      .join(' ');
  }

  /**
   * Split text into chunks at word boundaries
   */
  private splitTextIntoChunks(text: string, maxLength: number): string[] {
    if (text.length <= maxLength) {
      return [text];
    }

    const chunks: string[] = [];
    const words = text.split(/\s+/);
    let currentChunk = '';

    for (const word of words) {
      // If single word is longer than maxLength, split it
      if (word.length > maxLength) {
        if (currentChunk) {
          chunks.push(currentChunk.trim());
          currentChunk = '';
        }
        // Split long word into pieces
        for (let i = 0; i < word.length; i += maxLength) {
          chunks.push(word.slice(i, i + maxLength));
        }
        continue;
      }

      // Check if adding this word would exceed the limit
      const testChunk = currentChunk ? `${currentChunk} ${word}` : word;
      if (testChunk.length <= maxLength) {
        currentChunk = testChunk;
      } else {
        // Save current chunk and start new one
        if (currentChunk) {
          chunks.push(currentChunk.trim());
        }
        currentChunk = word;
      }
    }

    // Don't forget the last chunk
    if (currentChunk) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  async shutdown(): Promise<void> {
    logger.info('Morse Audio handler shut down');
  }
}
