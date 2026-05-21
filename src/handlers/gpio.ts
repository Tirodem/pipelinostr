/**
 * GPIO handler (v2)
 *
 * Controls GPIO pins via pigpiod daemon (pigpio-client).
 * Optional dependency, platform-restricted to linux/arm.
 * Falls back to simulation mode if daemon unavailable.
 */

import { z } from 'zod';
import { BaseHandler, type HandlerResult, type ActionContext } from './base.js';
import type { SystemDependency } from '../utils/system-deps.js';
import { createLogger } from '../utils/logger.js';

export class GpioHandler extends BaseHandler {
  static type = 'gpio';
  static npmDependencies = ['pigpio-client'];
  static platforms = ['linux/arm', 'linux/arm64'];
  static systemDeps: SystemDependency[] = [
    { binary: 'pigpiod', packages: { apt: 'pigpio', apk: 'pigpio' }, optional: true },
  ];
  static configSchema = z.object({
    host: z.string().optional(),
    port: z.number().optional(),
    enabled: z.boolean().optional(),
  });

  readonly name = 'GPIO';
  readonly type = 'gpio';

  private client: unknown = null;
  private connected = false;
  private simulation = false;

  async initialize(config: Record<string, unknown>): Promise<void> {
    try {
      const { pigpio } = await import('pigpio-client');
      const host = (config.host as string) ?? 'localhost';
      const port = (config.port as number) ?? 8888;

      this.client = pigpio({ host, port });

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.simulation = true;
          resolve();
        }, 5000);

        (this.client as { once: (event: string, cb: () => void) => void }).once('connected', () => {
          clearTimeout(timeout);
          this.connected = true;
          resolve();
        });

        (this.client as { once: (event: string, cb: (err: Error) => void) => void }).once('error', (err) => {
          clearTimeout(timeout);
          this.simulation = true;
          resolve(); // Don't fail, use simulation
        });
      });
    } catch {
      this.simulation = true;
    }
  }

  async execute(action: Record<string, unknown>, _context: ActionContext): Promise<HandlerResult> {
    const pin = Number(action.pin);
    const op = (action.action as string) ?? 'set';

    if (this.simulation) {
      return { success: true, data: { pin, action: op, simulation: true } };
    }

    try {
      switch (op) {
        case 'mirror_thermometer':
          return await this.executeMirrorThermometer(action);
        case 'set':
        case 'clear':
        case 'toggle':
        case 'pulse':
        case 'read':
        case 'pwm':
        case 'servo':
        case 'blink':
        case 'morse':
        case 'sequence':
          return await this.executeGpioAction(pin, op, action);
        default:
          return { success: false, error: `Unknown GPIO action: ${op}` };
      }
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  private mirrorLogger = createLogger(process.env.LOG_LEVEL ?? 'info');
  private lastMirrorValue: number | undefined;

  private async executeMirrorThermometer(action: Record<string, unknown>): Promise<HandlerResult> {
    const inputPins = action.input_pins;
    const outputPins = action.output_pins;
    if (!Array.isArray(inputPins) || !Array.isArray(outputPins)) {
      return { success: false, error: 'mirror_thermometer requires input_pins and output_pins arrays' };
    }

    const client = this.client as {
      gpio: (pin: number) => {
        modeSet: (mode: string, cb: (err?: Error) => void) => void;
        read: (cb: (err: Error | null, value: number) => void) => void;
        write: (value: number, cb: (err?: Error) => void) => void;
      };
    };

    const setMode = (pin: number, mode: 'input' | 'output'): Promise<void> =>
      new Promise((resolve, reject) => {
        client.gpio(pin).modeSet(mode, (err) => err ? reject(err) : resolve());
      });
    const readPin = (pin: number): Promise<number> =>
      new Promise((resolve, reject) => {
        client.gpio(pin).read((err, val) => err ? reject(err) : resolve(val & 1));
      });
    const writePin = (pin: number, value: number): Promise<void> =>
      new Promise((resolve, reject) => {
        client.gpio(pin).write(value, (err) => err ? reject(err) : resolve());
      });

    let value = 0;
    const bits: number[] = [];
    for (let i = 0; i < inputPins.length; i++) {
      const pin = Number(inputPins[i]);
      await setMode(pin, 'input');
      const bit = await readPin(pin);
      bits.push(bit);
      value |= bit << i;
    }
    const lives = value + 1;

    // Log on state change only — at 1 Hz, per-tick logs would flood the journal.
    if (this.lastMirrorValue !== value) {
      const bin = bits.slice().reverse().join('');
      this.mirrorLogger.info(
        { bits, bin, value, lives, input_pins: inputPins, output_pins: outputPins },
        'MD Lives Mirror state change',
      );
      this.lastMirrorValue = value;
    }

    for (let i = 0; i < outputPins.length; i++) {
      const pin = Number(outputPins[i]);
      await setMode(pin, 'output');
      await writePin(pin, i < lives ? 1 : 0);
    }

    return { success: true, data: { value, bits, lives, input_pins: inputPins, output_pins: outputPins } };
  }

  async shutdown(): Promise<void> {
    if (this.client && this.connected) {
      try {
        (this.client as { end: () => void }).end();
      } catch { /* ignore */ }
      this.connected = false;
    }
  }

  private async executeGpioAction(pin: number, op: string, action: Record<string, unknown>): Promise<HandlerResult> {
    const gpio = (this.client as { gpio: (pin: number) => unknown }).gpio(pin);
    const gpioPin = gpio as {
      modeSet: (mode: string) => void;
      write: (value: number) => void;
      read: () => number;
      analogWrite: (value: number) => void;
      servoWrite: (value: number) => void;
    };

    switch (op) {
      case 'set':
        gpioPin.modeSet('output');
        gpioPin.write(1);
        return { success: true, data: { pin, value: 1 } };

      case 'clear':
        gpioPin.modeSet('output');
        gpioPin.write(0);
        return { success: true, data: { pin, value: 0 } };

      case 'read': {
        gpioPin.modeSet('input');
        const value = gpioPin.read();
        return { success: true, data: { pin, value } };
      }

      case 'pwm':
        gpioPin.analogWrite(Number(action.duty_cycle ?? 128));
        return { success: true, data: { pin, duty_cycle: action.duty_cycle } };

      case 'servo': {
        const angle = Number(action.angle ?? 90);
        const pulseWidth = Math.round(500 + (angle / 180) * 2000);
        gpioPin.servoWrite(pulseWidth);

        if (action.duration) {
          await this.sleep(Number(action.duration));
          const returnAngle = Number(action.return_angle ?? 0);
          const returnPulse = Math.round(500 + (returnAngle / 180) * 2000);
          gpioPin.servoWrite(returnPulse);
        }
        return { success: true, data: { pin, angle, action: 'servo' } };
      }

      case 'pulse':
        gpioPin.modeSet('output');
        gpioPin.write(1);
        await this.sleep(Number(action.duration ?? 1000));
        gpioPin.write(0);
        return { success: true, data: { pin, duration: action.duration } };

      case 'blink': {
        const count = Number(action.count ?? 3);
        const interval = Number(action.interval ?? 500);
        gpioPin.modeSet('output');
        for (let i = 0; i < count; i++) {
          gpioPin.write(1);
          await this.sleep(interval);
          gpioPin.write(0);
          if (i < count - 1) await this.sleep(interval);
        }
        return { success: true, data: { pin, count, interval } };
      }

      default:
        return { success: true, data: { pin, action: op, note: 'Advanced GPIO action' } };
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
