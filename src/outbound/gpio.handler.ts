/**
 * GPIO Handler - Contrôle des GPIO via pigpiod
 * Compatible Raspberry Pi OS Bookworm et versions antérieures
 * Requiert: sudo apt install pigpio && sudo systemctl enable pigpiod
 */

import type { Handler, HandlerResult, HandlerConfig } from './handler.interface.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/* eslint-disable @typescript-eslint/no-explicit-any */

// pigpio-client types
interface PigpioClient {
  gpio(pin: number): PigpioGpio;
  end(): void;
}

interface PigpioGpio {
  modeSet(mode: string): void;
  write(value: number): void;
  read(): Promise<number>;
  setServoPulsewidth(width: number): void;
}

interface GpioHandlerConfig {
  enabled: boolean;
  pins?: Record<string, number> | undefined;
  default_direction?: 'in' | 'out' | undefined;
  active_low?: boolean | undefined;
  host?: string | undefined;  // pigpiod host (default: localhost)
  port?: number | undefined;  // pigpiod port (default: 8888)
}

// Single GPIO step (used in sequences)
export interface GpioStep {
  pin?: number | string | undefined;  // GPIO pin (required for gpio actions)
  action?: 'set' | 'clear' | 'toggle' | 'pulse' | undefined;  // GPIO action
  duration?: number | undefined;      // For pulse action
  delay?: number | undefined;         // Delay in ms (standalone delay step)
}

export interface GpioActionConfig extends HandlerConfig {
  pin: number | string;
  action: 'set' | 'clear' | 'toggle' | 'pulse' | 'read' | 'pwm' | 'blink' | 'servo' | 'morse' | 'sequence';
  duration?: number | undefined;
  duty_cycle?: number | undefined;
  pwm_frequency?: number | undefined;
  frequency?: number | undefined;  // For blink action (Hz)
  direction?: 'in' | 'out' | undefined;
  // Servo-specific options
  angle?: number | undefined;      // Servo angle 0-180 degrees
  return_angle?: number | undefined; // Angle to return to after duration (default: don't return)
  // Morse-specific options
  text?: string | undefined;       // Text to convert to Morse code
  unit_ms?: number | undefined;    // Base unit duration in ms (default: 100ms)
  tone_freq?: number | undefined;  // Buzzer tone frequency in Hz (for passive buzzer, default: 800)
  // Sequence of GPIO actions with delays (if present, pin/action are ignored)
  sequence?: GpioStep[] | undefined;
}

export class GpioHandler implements Handler {
  readonly name = 'GPIO Handler';
  readonly type = 'gpio';

  private config: GpioHandlerConfig;
  private client: PigpioClient | null = null;
  private connected: boolean = false;

  // International Morse Code dictionary
  private static readonly MORSE_CODE: Record<string, string> = {
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

  constructor(config: GpioHandlerConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    try {
      // Dynamic import of pigpio-client
      const pigpioModule = await import('pigpio-client') as any;
      const pigpio = pigpioModule.pigpio || pigpioModule.default?.pigpio || pigpioModule;

      const host = this.config.host || 'localhost';
      const port = this.config.port || 8888;

      // Connect to pigpiod daemon
      this.client = pigpio({ host, port });

      // Wait for connection
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Timeout connecting to pigpiod'));
        }, 5000);

        (this.client as any).once('connected', () => {
          clearTimeout(timeout);
          this.connected = true;
          console.log(`[GPIO] Connected to pigpiod on ${host}:${port}`);
          resolve();
        });

        (this.client as any).once('error', (err: Error) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[GPIO] Failed to connect to pigpiod: ${msg}`);
      console.warn('[GPIO] Make sure pigpiod is running: sudo systemctl start pigpiod');
      // Don't throw - allow handler to work in simulation mode
    }
  }

  private resolvePin(pin: number | string): number {
    if (typeof pin === 'number') {
      return pin;
    }

    if (this.config.pins && this.config.pins[pin] !== undefined) {
      return this.config.pins[pin];
    }

    const parsed = parseInt(pin, 10);
    if (!isNaN(parsed)) {
      return parsed;
    }

    throw new Error(`Pin inconnu: ${pin}`);
  }

  async execute(config: HandlerConfig, context: Record<string, unknown>): Promise<HandlerResult> {
    if (!this.client || !this.connected) {
      console.warn('[GPIO] Not connected to pigpiod, simulating action');
      return {
        success: true,
        data: { simulated: true, message: 'pigpiod not available' }
      };
    }

    const params = config as GpioActionConfig;

    try {
      // Handle sequence action (multiple steps with delays)
      if (params.action === 'sequence' || params.sequence) {
        return this.executeSequence(params.sequence || []);
      }

      const pinNumber = this.resolvePin(params.pin);

      switch (params.action) {
        case 'set':
          return this.setPin(pinNumber, 1);
        case 'clear':
          return this.setPin(pinNumber, 0);
        case 'toggle':
          return this.togglePin(pinNumber);
        case 'pulse':
          return this.pulsePin(pinNumber, params.duration || 100);
        case 'read':
          return this.readPin(pinNumber);
        case 'pwm':
          return this.softPwm(
            pinNumber,
            params.duty_cycle || 50,
            params.pwm_frequency || 100
          );
        case 'blink':
          return this.blinkPin(
            pinNumber,
            params.frequency || 2,
            params.duration || 1000
          );
        case 'servo':
          return this.servoMove(
            pinNumber,
            params.angle ?? 90,
            params.duration,
            params.return_angle
          );
        case 'morse':
          return this.playMorse(
            pinNumber,
            params.text || '',
            params.unit_ms || 100,
            params.tone_freq ?? 800  // Default 800Hz for passive buzzer, use 0 for active buzzer
          );
        default:
          return { success: false, error: `Action inconnue: ${params.action}` };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Execute a sequence of GPIO actions with delays.
   * Each step can be either a GPIO action (set, clear, toggle, pulse) or a delay.
   */
  private async executeSequence(steps: GpioStep[]): Promise<HandlerResult> {
    if (!steps || steps.length === 0) {
      return { success: false, error: 'Sequence is empty' };
    }

    const results: Array<{ step: number; action: string; pin?: number; duration?: number }> = [];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;

      // Delay step
      if (step.delay !== undefined) {
        console.log(`[GPIO] Sequence step ${i + 1}: delay ${step.delay}ms`);
        await this.delay(step.delay);
        results.push({ step: i + 1, action: 'delay', duration: step.delay });
        continue;
      }

      // GPIO action step
      if (!step.pin || !step.action) {
        return { success: false, error: `Sequence step ${i + 1}: missing pin or action` };
      }

      const pinNumber = this.resolvePin(step.pin);

      switch (step.action) {
        case 'set':
          await this.setPin(pinNumber, 1);
          results.push({ step: i + 1, action: 'set', pin: pinNumber });
          break;
        case 'clear':
          await this.setPin(pinNumber, 0);
          results.push({ step: i + 1, action: 'clear', pin: pinNumber });
          break;
        case 'toggle':
          await this.togglePin(pinNumber);
          results.push({ step: i + 1, action: 'toggle', pin: pinNumber });
          break;
        case 'pulse':
          await this.pulsePin(pinNumber, step.duration || 100);
          results.push({ step: i + 1, action: 'pulse', pin: pinNumber, duration: step.duration || 100 });
          break;
        default:
          return { success: false, error: `Sequence step ${i + 1}: unknown action ${step.action}` };
      }
    }

    console.log(`[GPIO] Sequence complete: ${results.length} steps executed`);

    return {
      success: true,
      data: {
        action: 'sequence',
        steps: results,
      },
    };
  }

  private async setPin(pinNumber: number, value: 0 | 1): Promise<HandlerResult> {
    const gpio = this.client!.gpio(pinNumber);
    gpio.modeSet('output');
    gpio.write(value);

    console.log(`[GPIO] Pin ${pinNumber} -> ${value}`);

    return {
      success: true,
      data: {
        pin: pinNumber,
        action: value === 1 ? 'set' : 'clear',
        value,
      },
    };
  }

  private async togglePin(pinNumber: number): Promise<HandlerResult> {
    const gpio = this.client!.gpio(pinNumber);
    gpio.modeSet('output');

    const currentValue = await gpio.read();
    const newValue = currentValue === 0 ? 1 : 0;
    gpio.write(newValue);

    console.log(`[GPIO] Pin ${pinNumber} toggled -> ${newValue}`);

    return {
      success: true,
      data: {
        pin: pinNumber,
        action: 'toggle',
        previous_value: currentValue,
        value: newValue,
      },
    };
  }

  private async pulsePin(pinNumber: number, duration: number): Promise<HandlerResult> {
    const gpio = this.client!.gpio(pinNumber);
    gpio.modeSet('output');

    gpio.write(1);
    await new Promise((resolve) => setTimeout(resolve, duration));
    gpio.write(0);

    console.log(`[GPIO] Pin ${pinNumber} pulsed for ${duration}ms`);

    return {
      success: true,
      data: {
        pin: pinNumber,
        action: 'pulse',
        duration,
      },
    };
  }

  private async readPin(pinNumber: number): Promise<HandlerResult> {
    const gpio = this.client!.gpio(pinNumber);
    gpio.modeSet('input');
    const value = await gpio.read();

    console.log(`[GPIO] Pin ${pinNumber} read -> ${value}`);

    return {
      success: true,
      data: {
        pin: pinNumber,
        action: 'read',
        value,
      },
    };
  }

  private async softPwm(
    pinNumber: number,
    dutyCycle: number,
    frequency: number
  ): Promise<HandlerResult> {
    const gpio = this.client!.gpio(pinNumber);
    gpio.modeSet('output');

    if (dutyCycle <= 0) {
      gpio.write(0);
      return {
        success: true,
        data: { pin: pinNumber, action: 'pwm', duty_cycle: 0 },
      };
    }
    if (dutyCycle >= 100) {
      gpio.write(1);
      return {
        success: true,
        data: { pin: pinNumber, action: 'pwm', duty_cycle: 100 },
      };
    }

    // Software PWM simulation (limited precision)
    const period = 1000 / frequency;
    const onTime = (period * dutyCycle) / 100;
    const offTime = period - onTime;
    const cycles = 50; // Run for ~50 cycles

    for (let i = 0; i < cycles; i++) {
      gpio.write(1);
      await new Promise((resolve) => setTimeout(resolve, onTime));
      gpio.write(0);
      await new Promise((resolve) => setTimeout(resolve, offTime));
    }

    console.log(`[GPIO] Pin ${pinNumber} PWM @ ${frequency}Hz, ${dutyCycle}% duty`);

    return {
      success: true,
      data: {
        pin: pinNumber,
        action: 'pwm',
        duty_cycle: dutyCycle,
        frequency,
      },
    };
  }

  private async blinkPin(
    pinNumber: number,
    frequency: number,
    duration: number
  ): Promise<HandlerResult> {
    const gpio = this.client!.gpio(pinNumber);
    gpio.modeSet('output');

    // Calculate timing: frequency is blinks per second
    // Each blink = on + off, so half-period = 500/frequency ms
    const halfPeriod = Math.floor(500 / frequency);
    const totalBlinks = Math.floor((duration / 1000) * frequency);

    console.log(`[GPIO] Pin ${pinNumber} blinking @ ${frequency}Hz for ${duration}ms (${totalBlinks} blinks)`);

    // Perform the blinking
    for (let i = 0; i < totalBlinks; i++) {
      gpio.write(1);
      await new Promise((resolve) => setTimeout(resolve, halfPeriod));
      gpio.write(0);
      await new Promise((resolve) => setTimeout(resolve, halfPeriod));
    }

    console.log(`[GPIO] Pin ${pinNumber} blink complete`);

    return {
      success: true,
      data: {
        pin: pinNumber,
        action: 'blink',
        frequency,
        duration,
        total_blinks: totalBlinks,
      },
    };
  }

  /**
   * Control a servo motor (like SG90) using pigpiod hardware PWM.
   *
   * SG90 specs:
   * - 0° = 500µs pulse
   * - 90° = 1500µs pulse
   * - 180° = 2500µs pulse
   */
  private async servoMove(
    pinNumber: number,
    angle: number,
    duration?: number,
    returnAngle?: number
  ): Promise<HandlerResult> {
    const gpio = this.client!.gpio(pinNumber);

    // Clamp angle to 0-180
    const clampedAngle = Math.max(0, Math.min(180, angle));

    // Convert angle to pulse width in microseconds
    // 0° = 500µs, 180° = 2500µs
    const pulseWidth = Math.round(500 + (clampedAngle / 180) * 2000);

    console.log(`[GPIO] Servo pin ${pinNumber} -> ${clampedAngle}° (pulse: ${pulseWidth}µs)`);

    // Set servo position
    gpio.setServoPulsewidth(pulseWidth);

    // Hold position for duration
    const holdTime = duration || 500;
    await new Promise((resolve) => setTimeout(resolve, holdTime));

    // If returnAngle is specified, move back to that position
    if (returnAngle !== undefined) {
      const returnClamped = Math.max(0, Math.min(180, returnAngle));
      const returnPulse = Math.round(500 + (returnClamped / 180) * 2000);

      console.log(`[GPIO] Servo pin ${pinNumber} returning to ${returnClamped}°`);

      gpio.setServoPulsewidth(returnPulse);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // Stop servo signal (servo will hold position)
    gpio.setServoPulsewidth(0);

    console.log(`[GPIO] Servo pin ${pinNumber} move complete`);

    return {
      success: true,
      data: {
        pin: pinNumber,
        action: 'servo',
        angle: clampedAngle,
        pulse_width: pulseWidth,
        return_angle: returnAngle,
        duration: holdTime,
      },
    };
  }

  /**
   * Play Morse code on a buzzer connected to GPIO pin.
   *
   * Morse timing (ITU standard):
   * - Dot (dit): 1 unit
   * - Dash (dah): 3 units
   * - Space between parts of same letter: 1 unit
   * - Space between letters: 3 units
   * - Space between words: 7 units
   *
   * @param pinNumber GPIO pin connected to buzzer
   * @param text Text to convert and play
   * @param unitMs Duration of one unit in milliseconds (default: 100ms = 12 WPM)
   * @param toneFreq Frequency for passive buzzer (0 = active buzzer, default: 800Hz)
   */
  private async playMorse(
    pinNumber: number,
    text: string,
    unitMs: number,
    toneFreq: number = 800
  ): Promise<HandlerResult> {
    if (!text.trim()) {
      return { success: false, error: 'No text provided for Morse code' };
    }

    const gpio = this.client!.gpio(pinNumber);
    gpio.modeSet('output');

    // Convert text to Morse
    const morseSequence = this.textToMorse(text);
    const isPassive = toneFreq > 0;

    console.log(`[GPIO] Playing Morse on pin ${pinNumber}: "${text}"`);
    console.log(`[GPIO] Morse sequence: ${morseSequence}`);
    console.log(`[GPIO] Unit duration: ${unitMs}ms (~${Math.round(1200 / unitMs)} WPM)`);
    console.log(`[GPIO] Buzzer type: ${isPassive ? `passive (${toneFreq}Hz)` : 'active'}`);

    // For passive buzzer, set PWM frequency using pigs command
    if (isPassive) {
      await this.setPwmFrequency(pinNumber, toneFreq);
      console.log(`[GPIO] PWM frequency set to ${toneFreq}Hz on pin ${pinNumber}`);
    }

    // Play the Morse sequence
    const words = text.toUpperCase().split(/\s+/).filter(w => w.length > 0);
    let totalDots = 0;
    let totalDashes = 0;

    for (let wordIndex = 0; wordIndex < words.length; wordIndex++) {
      const word = words[wordIndex]!;

      for (let charIndex = 0; charIndex < word.length; charIndex++) {
        const char = word[charIndex]!;
        const morse = GpioHandler.MORSE_CODE[char];

        if (morse) {
          // Play each symbol in the character
          for (let symbolIndex = 0; symbolIndex < morse.length; symbolIndex++) {
            const symbol = morse[symbolIndex];

            if (symbol === '.') {
              // Dot: 1 unit ON
              if (isPassive) {
                await this.setPwmDutyCycle(pinNumber, 128); // 50% duty cycle for tone
              } else {
                gpio.write(1);
              }
              await this.delay(unitMs);
              if (isPassive) {
                await this.setPwmDutyCycle(pinNumber, 0); // PWM off
              } else {
                gpio.write(0);
              }
              totalDots++;
            } else if (symbol === '-') {
              // Dash: 3 units ON
              if (isPassive) {
                await this.setPwmDutyCycle(pinNumber, 128); // 50% duty cycle for tone
              } else {
                gpio.write(1);
              }
              await this.delay(unitMs * 3);
              if (isPassive) {
                await this.setPwmDutyCycle(pinNumber, 0); // PWM off
              } else {
                gpio.write(0);
              }
              totalDashes++;
            }

            // Space between symbols within letter: 1 unit
            if (symbolIndex < morse.length - 1) {
              await this.delay(unitMs);
            }
          }
        }

        // Space between letters: 3 units (but we already have 1 from symbol spacing)
        if (charIndex < word.length - 1) {
          await this.delay(unitMs * 2); // 2 more = 3 total
        }
      }

      // Space between words: 7 units (but we already have 3 from letter spacing)
      if (wordIndex < words.length - 1) {
        await this.delay(unitMs * 4); // 4 more = 7 total
      }
    }

    // Ensure buzzer is off
    if (isPassive) {
      await this.setPwmDutyCycle(pinNumber, 0); // PWM off
    } else {
      gpio.write(0);
    }

    console.log(`[GPIO] Morse complete: ${totalDots} dots, ${totalDashes} dashes`);

    return {
      success: true,
      data: {
        pin: pinNumber,
        action: 'morse',
        text: text,
        morse: morseSequence,
        unit_ms: unitMs,
        tone_freq: toneFreq,
        buzzer_type: isPassive ? 'passive' : 'active',
        total_dots: totalDots,
        total_dashes: totalDashes,
        wpm: Math.round(1200 / unitMs),
      },
    };
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
        return GpioHandler.MORSE_CODE[char] || '';
      })
      .filter(m => m)
      .join(' ');
  }

  /**
   * Promisified delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Set PWM frequency on a pin using pigs command
   * @param pin GPIO pin number
   * @param freq Frequency in Hz
   */
  private async setPwmFrequency(pin: number, freq: number): Promise<void> {
    try {
      await execAsync(`pigs pfs ${pin} ${freq}`);
    } catch (err) {
      console.warn(`[GPIO] Failed to set PWM frequency via pigs: ${err}`);
    }
  }

  /**
   * Set PWM duty cycle on a pin using pigs command
   * @param pin GPIO pin number
   * @param dutyCycle Duty cycle 0-255
   */
  private async setPwmDutyCycle(pin: number, dutyCycle: number): Promise<void> {
    try {
      await execAsync(`pigs p ${pin} ${dutyCycle}`);
    } catch (err) {
      console.warn(`[GPIO] Failed to set PWM duty cycle via pigs: ${err}`);
    }
  }

  async shutdown(): Promise<void> {
    if (this.client) {
      try {
        this.client.end();
      } catch {
        // Ignore cleanup errors
      }
      this.client = null;
      this.connected = false;
    }

    console.log('[GPIO] Handler arrêté');
  }
}
