/**
 * Morse Code Listener Service
 *
 * Listens to microphone input, detects Morse code tones,
 * decodes them to text, and triggers workflows.
 *
 * Uses the Goertzel algorithm for efficient single-frequency detection.
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { logger } from '../persistence/logger.js';

// Morse code timing (in milliseconds)
// Based on ~12 WPM (words per minute) - matches morse-audio.handler default
const UNIT_MS = 100;  // Duration of one unit (dot)
const DOT_MAX = UNIT_MS * 2;      // Max duration for a dot
const DASH_MIN = UNIT_MS * 2;     // Min duration for a dash
const DASH_MAX = UNIT_MS * 5;     // Max duration for a dash
const LETTER_GAP = UNIT_MS * 3;   // Gap between letters
const WORD_GAP = UNIT_MS * 7;     // Gap between words
const MESSAGE_TIMEOUT = UNIT_MS * 15;  // Timeout to consider message complete

// Morse code lookup table
const MORSE_TO_CHAR: Record<string, string> = {
  '.-': 'A', '-...': 'B', '-.-.': 'C', '-..': 'D', '.': 'E',
  '..-.': 'F', '--.': 'G', '....': 'H', '..': 'I', '.---': 'J',
  '-.-': 'K', '.-..': 'L', '--': 'M', '-.': 'N', '---': 'O',
  '.--.': 'P', '--.-': 'Q', '.-.': 'R', '...': 'S', '-': 'T',
  '..-': 'U', '...-': 'V', '.--': 'W', '-..-': 'X', '-.--': 'Y',
  '--..': 'Z',
  '-----': '0', '.----': '1', '..---': '2', '...--': '3', '....-': '4',
  '.....': '5', '-....': '6', '--...': '7', '---..': '8', '----.': '9',
  '.-.-.-': '.', '--..--': ',', '..--..': '?', '.----.': "'",
  '-.-.--': '!', '-..-.': '/', '-.--.': '(', '-.--.-': ')',
  '.-...': '&', '---...': ':', '-.-.-.': ';', '-...-': '=',
  '.-.-.': '+', '-....-': '-', '..--.-': '_', '.-..-.': '"',
  '...-..-': '$', '.--.-.': '@',
};

export interface MorseListenerConfig {
  enabled: boolean;
  device?: string;           // ALSA device (e.g., "plughw:3,0")
  frequency?: number;        // Target frequency in Hz (default: 800)
  threshold?: number;        // Detection threshold (0-1, default: 0.3)
  sample_rate?: number;      // Sample rate (default: 44100)
}

export interface MorseDecodedEvent {
  text: string;
  raw: string;  // Raw morse code (dots and dashes)
  timestamp: Date;
}

/**
 * Goertzel algorithm for single-frequency detection
 * More efficient than FFT when detecting only one frequency
 */
class GoertzelFilter {
  private coeff: number;
  private s1: number = 0;
  private s2: number = 0;
  private sampleCount: number = 0;
  private targetSamples: number;

  constructor(targetFreq: number, sampleRate: number, blockSize: number) {
    const k = Math.round((blockSize * targetFreq) / sampleRate);
    const omega = (2 * Math.PI * k) / blockSize;
    this.coeff = 2 * Math.cos(omega);
    this.targetSamples = blockSize;
  }

  /**
   * Process a single sample
   * Returns magnitude when block is complete, null otherwise
   */
  process(sample: number): number | null {
    const s0 = sample + this.coeff * this.s1 - this.s2;
    this.s2 = this.s1;
    this.s1 = s0;
    this.sampleCount++;

    if (this.sampleCount >= this.targetSamples) {
      // Calculate magnitude
      const magnitude = Math.sqrt(
        this.s1 * this.s1 + this.s2 * this.s2 - this.coeff * this.s1 * this.s2
      );
      // Reset for next block
      this.s1 = 0;
      this.s2 = 0;
      this.sampleCount = 0;
      return magnitude;
    }
    return null;
  }

  reset(): void {
    this.s1 = 0;
    this.s2 = 0;
    this.sampleCount = 0;
  }
}

export class MorseListener extends EventEmitter {
  private config: MorseListenerConfig;
  private process: ChildProcess | null = null;
  private goertzel: GoertzelFilter | null = null;
  private running: boolean = false;

  // Tone detection state
  private toneOn: boolean = false;
  private toneStartTime: number = 0;
  private toneEndTime: number = 0;
  private magnitudeBaseline: number = 0;
  private magnitudeSamples: number[] = [];

  // Morse decoding state
  private currentSymbols: string = '';  // Current letter (dots and dashes)
  private currentMessage: string = '';  // Current message (decoded letters)
  private rawMorse: string = '';        // Raw morse for debugging
  private messageTimeout: NodeJS.Timeout | null = null;

  // Auto-restart state
  private restartCount: number = 0;
  private lastRestartTime: number = 0;
  private restartTimeout: NodeJS.Timeout | null = null;
  private static readonly MAX_RESTARTS = 5;
  private static readonly RESTART_WINDOW_MS = 60000;  // Reset restart count after 1 minute of stability
  private static readonly RESTART_DELAY_MS = 2000;    // Wait 2 seconds before restart

  constructor(config: MorseListenerConfig) {
    super();
    this.config = {
      enabled: config.enabled,
      device: config.device || 'plughw:3,0',
      frequency: config.frequency || 800,
      threshold: config.threshold || 0.3,
      sample_rate: config.sample_rate || 44100,
    };
  }

  /**
   * Start listening for Morse code
   */
  async start(): Promise<void> {
    if (!this.config.enabled) {
      logger.info('[MorseListener] Disabled in config');
      return;
    }

    if (this.running) {
      logger.warn('[MorseListener] Already running');
      return;
    }

    const sampleRate = this.config.sample_rate!;
    const blockSize = Math.round(sampleRate / 50);  // 20ms blocks

    this.goertzel = new GoertzelFilter(
      this.config.frequency!,
      sampleRate,
      blockSize
    );

    // Start arecord process
    this.process = spawn('arecord', [
      '-D', this.config.device!,
      '-f', 'S16_LE',
      '-r', sampleRate.toString(),
      '-c', '1',
      '-t', 'raw',
      '-q',  // Quiet mode
    ]);

    this.process.stdout?.on('data', (data: Buffer) => {
      this.processAudioData(data);
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) {
        logger.debug({ error: msg }, '[MorseListener] arecord stderr');
      }
    });

    this.process.on('error', (error) => {
      logger.error({ error: error.message }, '[MorseListener] Process error');
      this.running = false;
    });

    this.process.on('close', (code) => {
      logger.info({ code }, '[MorseListener] Process closed');
      this.running = false;

      // Auto-restart if not intentionally stopped
      if (this.config.enabled) {
        this.scheduleRestart();
      }
    });

    this.running = true;
    logger.info(
      { device: this.config.device, frequency: this.config.frequency },
      '[MorseListener] Started listening'
    );
  }

  /**
   * Stop listening
   */
  stop(): void {
    // Disable auto-restart
    this.config.enabled = false;

    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
      this.restartTimeout = null;
    }
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    if (this.messageTimeout) {
      clearTimeout(this.messageTimeout);
      this.messageTimeout = null;
    }
    this.running = false;
    this.goertzel?.reset();
    logger.info('[MorseListener] Stopped');
  }

  /**
   * Schedule an automatic restart after crash
   */
  private scheduleRestart(): void {
    const now = Date.now();

    // Reset restart count if we've been stable for a while
    if (now - this.lastRestartTime > MorseListener.RESTART_WINDOW_MS) {
      this.restartCount = 0;
    }

    // Check if we've exceeded max restarts
    if (this.restartCount >= MorseListener.MAX_RESTARTS) {
      logger.error(
        { restartCount: this.restartCount, windowMs: MorseListener.RESTART_WINDOW_MS },
        '[MorseListener] Max restarts exceeded, giving up'
      );
      this.emit('error', new Error('Max restarts exceeded'));
      return;
    }

    this.restartCount++;
    this.lastRestartTime = now;

    logger.warn(
      { restartCount: this.restartCount, maxRestarts: MorseListener.MAX_RESTARTS },
      '[MorseListener] Scheduling restart'
    );

    this.restartTimeout = setTimeout(() => {
      this.restartTimeout = null;
      logger.info('[MorseListener] Restarting...');
      this.start().catch((error) => {
        logger.error({ error: error.message }, '[MorseListener] Restart failed');
      });
    }, MorseListener.RESTART_DELAY_MS);
  }

  /**
   * Process raw audio data from arecord
   */
  private processAudioData(data: Buffer): void {
    if (!this.goertzel) return;

    // Convert 16-bit signed samples to normalized floats
    for (let i = 0; i < data.length - 1; i += 2) {
      const sample = data.readInt16LE(i) / 32768;
      const magnitude = this.goertzel.process(sample);

      if (magnitude !== null) {
        this.processMagnitude(magnitude);
      }
    }
  }

  /**
   * Process a magnitude reading from Goertzel
   */
  private processMagnitude(magnitude: number): void {
    // Update baseline (running average of low magnitudes)
    this.magnitudeSamples.push(magnitude);
    if (this.magnitudeSamples.length > 50) {
      this.magnitudeSamples.shift();
    }
    const sorted = [...this.magnitudeSamples].sort((a, b) => a - b);
    this.magnitudeBaseline = sorted[Math.floor(sorted.length * 0.2)] || 0;

    // Detect tone based on threshold above baseline
    const maxMagnitude = sorted[sorted.length - 1] ?? 0;
    const threshold = this.magnitudeBaseline +
      (this.config.threshold! * (maxMagnitude - this.magnitudeBaseline));
    const isToneNow = magnitude > threshold && magnitude > this.magnitudeBaseline * 2;

    const now = Date.now();

    if (isToneNow && !this.toneOn) {
      // Tone started
      this.toneOn = true;
      this.toneStartTime = now;

      // Check gap since last tone
      if (this.toneEndTime > 0) {
        const gap = now - this.toneEndTime;
        this.processGap(gap);
      }

      // Cancel message timeout
      if (this.messageTimeout) {
        clearTimeout(this.messageTimeout);
        this.messageTimeout = null;
      }

    } else if (!isToneNow && this.toneOn) {
      // Tone ended
      this.toneOn = false;
      this.toneEndTime = now;
      const duration = now - this.toneStartTime;

      this.processTone(duration);

      // Set message timeout
      this.messageTimeout = setTimeout(() => {
        this.finalizeMessage();
      }, MESSAGE_TIMEOUT);
    }
  }

  /**
   * Process a detected tone duration
   */
  private processTone(duration: number): void {
    // Ignore very short durations (noise spikes)
    const MIN_DURATION = 50;  // Minimum 50ms to be considered a real tone

    if (duration < MIN_DURATION) {
      // Too short, ignore as noise
      return;
    } else if (duration < DOT_MAX) {
      // Dot
      this.currentSymbols += '.';
      this.rawMorse += '.';
      logger.debug({ duration }, '[MorseListener] Detected DOT');
    } else if (duration >= DASH_MIN && duration < DASH_MAX) {
      // Dash
      this.currentSymbols += '-';
      this.rawMorse += '-';
      logger.debug({ duration }, '[MorseListener] Detected DASH');
    } else {
      // Too long, probably noise
      logger.debug({ duration }, '[MorseListener] Ignored (too long)');
    }
  }

  /**
   * Process a gap between tones
   */
  private processGap(gap: number): void {
    if (gap >= WORD_GAP) {
      // Word gap - finalize current letter and add space
      this.finalizeLetter();
      if (this.currentMessage.length > 0 && !this.currentMessage.endsWith(' ')) {
        this.currentMessage += ' ';
        this.rawMorse += ' / ';
      }
      logger.debug({ gap }, '[MorseListener] Word gap');
    } else if (gap >= LETTER_GAP) {
      // Letter gap - finalize current letter
      this.finalizeLetter();
      this.rawMorse += ' ';
      logger.debug({ gap }, '[MorseListener] Letter gap');
    }
    // Shorter gaps are between dots/dashes of same letter
  }

  /**
   * Convert current symbols to a letter
   */
  private finalizeLetter(): void {
    if (this.currentSymbols.length === 0) return;

    const char = MORSE_TO_CHAR[this.currentSymbols];
    if (char) {
      this.currentMessage += char;
      logger.debug(
        { symbols: this.currentSymbols, char },
        '[MorseListener] Decoded letter'
      );
    } else {
      logger.debug(
        { symbols: this.currentSymbols },
        '[MorseListener] Unknown morse sequence'
      );
      this.currentMessage += '?';
    }
    this.currentSymbols = '';
  }

  /**
   * Finalize and emit the complete message
   */
  private finalizeMessage(): void {
    this.finalizeLetter();

    const message = this.currentMessage.trim();

    if (message.length > 0) {
      // Check if message is garbage (too many unknown characters)
      const unknownCount = (message.match(/\?/g) || []).length;
      const validCount = message.replace(/[\s?]/g, '').length;
      const unknownRatio = unknownCount / (unknownCount + validCount);

      // Check if message contains only dot-letters (E, I, S, H, 5) - likely fan/noise
      const dotOnlyLetters = /^[EISH5\s?]+$/i;
      const hasDash = this.rawMorse.includes('-');

      if (unknownRatio > 0.5 || unknownCount > 5) {
        // Too many unknown characters - probably noise
        logger.info(
          { text: message, unknownCount, validCount, unknownRatio },
          '[MorseListener] Message discarded (too much noise)'
        );
      } else if (dotOnlyLetters.test(message) && !hasDash) {
        // Only dot-based letters with no dashes - likely background noise (fan, etc.)
        logger.info(
          { text: message, raw: this.rawMorse.trim() },
          '[MorseListener] Message discarded (dot-only, likely noise)'
        );
      } else {
        const event: MorseDecodedEvent = {
          text: message,
          raw: this.rawMorse.trim(),
          timestamp: new Date(),
        };

        logger.info(
          { text: event.text, raw: event.raw },
          '[MorseListener] Message decoded'
        );

        this.emit('decoded', event);
      }
    }

    // Reset state
    this.currentMessage = '';
    this.currentSymbols = '';
    this.rawMorse = '';
    this.messageTimeout = null;
  }

  /**
   * Check if listener is running
   */
  isRunning(): boolean {
    return this.running;
  }
}

// Singleton instance
let morseListenerInstance: MorseListener | null = null;

export function getMorseListener(): MorseListener | null {
  return morseListenerInstance;
}

export function createMorseListener(config: MorseListenerConfig): MorseListener {
  if (morseListenerInstance) {
    morseListenerInstance.stop();
  }
  morseListenerInstance = new MorseListener(config);
  return morseListenerInstance;
}
