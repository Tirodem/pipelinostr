/**
 * GPIO Handler - Contrôle des GPIO via pigpiod
 * Compatible Raspberry Pi OS Bookworm et versions antérieures
 * Requiert: sudo apt install pigpio && sudo systemctl enable pigpiod
 */

import type { Handler, HandlerResult, HandlerConfig } from './handler.interface.js';

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

export interface GpioActionConfig extends HandlerConfig {
  pin: number | string;
  action: 'set' | 'clear' | 'toggle' | 'pulse' | 'read' | 'pwm' | 'blink' | 'servo';
  duration?: number | undefined;
  duty_cycle?: number | undefined;
  pwm_frequency?: number | undefined;
  frequency?: number | undefined;  // For blink action (Hz)
  direction?: 'in' | 'out' | undefined;
  // Servo-specific options
  angle?: number | undefined;      // Servo angle 0-180 degrees
  return_angle?: number | undefined; // Angle to return to after duration (default: don't return)
}

export class GpioHandler implements Handler {
  readonly name = 'GPIO Handler';
  readonly type = 'gpio';

  private config: GpioHandlerConfig;
  private client: PigpioClient | null = null;
  private connected: boolean = false;

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
        default:
          return { success: false, error: `Action inconnue: ${params.action}` };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
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
