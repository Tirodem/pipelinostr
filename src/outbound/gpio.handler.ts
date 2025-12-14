/**
 * GPIO Handler - Contrôle des GPIO (Raspberry Pi, etc.)
 * Compatible avec les SBCs utilisant sysfs ou gpiod
 */

import type { Handler, HandlerResult, HandlerConfig } from './handler.interface.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Variable pour le module onoff (chargé dynamiquement)
let Gpio: any;

interface GpioHandlerConfig {
  enabled: boolean;
  pins?: Record<string, number> | undefined;
  default_direction?: 'in' | 'out' | undefined;
  active_low?: boolean | undefined;
}

export interface GpioActionConfig extends HandlerConfig {
  pin: number | string;
  action: 'set' | 'clear' | 'toggle' | 'pulse' | 'read' | 'pwm' | 'blink';
  duration?: number | undefined;
  duty_cycle?: number | undefined;
  pwm_frequency?: number | undefined;
  frequency?: number | undefined;  // For blink action (Hz)
  direction?: 'in' | 'out' | undefined;
}

interface GpioPin {
  gpio: any;
  direction: 'in' | 'out';
}

export class GpioHandler implements Handler {
  readonly name = 'GPIO Handler';
  readonly type = 'gpio';

  private config: GpioHandlerConfig;
  private pins: Map<number, GpioPin> = new Map();
  private pwmIntervals: Map<number, NodeJS.Timeout> = new Map();

  constructor(config: GpioHandlerConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    try {
      // @ts-ignore - Optional dependency, may not be installed on all platforms
      const onoffModule = await import('onoff') as any;
      Gpio = onoffModule.Gpio;
    } catch {
      throw new Error(
        'onoff module not found. Install it with: npm install onoff'
      );
    }

    if (!Gpio.accessible) {
      console.warn('[GPIO] GPIO non accessible sur cette plateforme (simulation mode)');
    } else {
      console.log('[GPIO] GPIO accessible, handler initialisé');
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

  private getOrCreatePin(pinNumber: number, direction: 'in' | 'out'): GpioPin {
    let pinObj = this.pins.get(pinNumber);

    if (pinObj) {
      if (pinObj.direction !== direction) {
        pinObj.gpio.unexport();
        pinObj = undefined;
      }
    }

    if (!pinObj) {
      const gpio = new Gpio(pinNumber, direction, 'both', {
        activeLow: this.config.active_low || false,
      });
      pinObj = { gpio, direction };
      this.pins.set(pinNumber, pinObj);
    }

    return pinObj;
  }

  async execute(config: HandlerConfig, context: Record<string, unknown>): Promise<HandlerResult> {
    if (!Gpio) {
      return { success: false, error: 'GPIO non initialisé' };
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
        default:
          return { success: false, error: `Action inconnue: ${params.action}` };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }

  private async setPin(pinNumber: number, value: 0 | 1): Promise<HandlerResult> {
    const pinObj = this.getOrCreatePin(pinNumber, 'out');
    await pinObj.gpio.write(value);

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
    const pinObj = this.getOrCreatePin(pinNumber, 'out');
    const currentValue = await pinObj.gpio.read();
    const newValue = currentValue === 0 ? 1 : 0;
    await pinObj.gpio.write(newValue);

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
    const pinObj = this.getOrCreatePin(pinNumber, 'out');

    await pinObj.gpio.write(1);
    await new Promise((resolve) => setTimeout(resolve, duration));
    await pinObj.gpio.write(0);

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
    const pinObj = this.getOrCreatePin(pinNumber, 'in');
    const value = await pinObj.gpio.read();

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
    const pinObj = this.getOrCreatePin(pinNumber, 'out');

    const existingInterval = this.pwmIntervals.get(pinNumber);
    if (existingInterval) {
      clearInterval(existingInterval);
      this.pwmIntervals.delete(pinNumber);
    }

    if (dutyCycle <= 0) {
      await pinObj.gpio.write(0);
      return {
        success: true,
        data: { pin: pinNumber, action: 'pwm', duty_cycle: 0 },
      };
    }
    if (dutyCycle >= 100) {
      await pinObj.gpio.write(1);
      return {
        success: true,
        data: { pin: pinNumber, action: 'pwm', duty_cycle: 100 },
      };
    }

    const period = 1000 / frequency;
    const onTime = (period * dutyCycle) / 100;
    const offTime = period - onTime;

    let isOn = true;
    await pinObj.gpio.write(1);

    const toggle = async () => {
      if (isOn) {
        await pinObj.gpio.write(0);
        isOn = false;
        setTimeout(toggle, offTime);
      } else {
        await pinObj.gpio.write(1);
        isOn = true;
        setTimeout(toggle, onTime);
      }
    };

    setTimeout(toggle, onTime);

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
    const pinObj = this.getOrCreatePin(pinNumber, 'out');

    // Calculate timing: frequency is blinks per second
    // Each blink = on + off, so half-period = 500/frequency ms
    const halfPeriod = Math.floor(500 / frequency);
    const totalBlinks = Math.floor((duration / 1000) * frequency);

    console.log(`[GPIO] Pin ${pinNumber} blinking @ ${frequency}Hz for ${duration}ms (${totalBlinks} blinks)`);

    // Perform the blinking
    for (let i = 0; i < totalBlinks; i++) {
      await pinObj.gpio.write(1);
      await new Promise((resolve) => setTimeout(resolve, halfPeriod));
      await pinObj.gpio.write(0);
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

  async shutdown(): Promise<void> {
    for (const [, interval] of this.pwmIntervals) {
      clearInterval(interval);
    }
    this.pwmIntervals.clear();

    for (const [, pinObj] of this.pins) {
      try {
        pinObj.gpio.unexport();
      } catch {
        // Ignorer les erreurs de cleanup
      }
    }
    this.pins.clear();

    console.log('[GPIO] Handler arrêté');
  }
}
