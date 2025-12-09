/**
 * I2C Handler - Communication I2C pour capteurs et périphériques
 * Pour Raspberry Pi et autres SBCs avec bus I2C
 */

import type { Handler, HandlerResult, HandlerConfig } from './handler.interface.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

let i2c: any;

interface I2cHandlerConfig {
  enabled: boolean;
  bus_number?: number | undefined;
  devices?: Record<string, {
    address: number;
    description?: string | undefined;
  }> | undefined;
}

export interface I2cActionConfig extends HandlerConfig {
  device?: string | undefined;
  address?: number | undefined;
  action: 'write' | 'read' | 'write_byte' | 'read_byte' | 'write_word' | 'read_word' | 'write_i2c_block' | 'read_i2c_block' | 'scan';
  register?: number | undefined;
  data?: number | number[] | string | undefined;
  length?: number | undefined;
}

export class I2cHandler implements Handler {
  readonly name = 'I2C Handler';
  readonly type = 'i2c';

  private config: I2cHandlerConfig;
  private bus: any = null;

  constructor(config: I2cHandlerConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    try {
      // @ts-expect-error - Optional dependency, may not be installed
      i2c = await import('i2c-bus');
    } catch {
      throw new Error(
        'i2c-bus module not found. Install it with: npm install i2c-bus'
      );
    }

    const busNumber = this.config.bus_number ?? 1;

    try {
      this.bus = await this.openBus(busNumber);
      console.log(`[I2C] Bus ${busNumber} ouvert`);

      if (this.config.devices) {
        for (const [name, dev] of Object.entries(this.config.devices)) {
          const present = await this.devicePresent(dev.address);
          if (present) {
            console.log(`[I2C] Device "${name}" trouvé @ 0x${dev.address.toString(16)}`);
          } else {
            console.warn(`[I2C] Device "${name}" non trouvé @ 0x${dev.address.toString(16)}`);
          }
        }
      }
    } catch (err) {
      throw new Error(`Impossible d'ouvrir le bus I2C ${busNumber}: ${err}`);
    }
  }

  private openBus(busNumber: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const bus = i2c.open(busNumber, (err: Error | null) => {
        if (err) {
          reject(err);
        } else {
          resolve(bus);
        }
      });
    });
  }

  private devicePresent(address: number): Promise<boolean> {
    return new Promise((resolve) => {
      this.bus.i2cRead(address, 1, Buffer.alloc(1), (err: Error | null) => {
        resolve(!err);
      });
    });
  }

  private resolveAddress(params: I2cActionConfig): number | undefined {
    if (params.address !== undefined) {
      return params.address;
    }

    if (params.device) {
      const device = this.config.devices?.[params.device];
      if (device) {
        return device.address;
      }
    }

    return undefined;
  }

  async execute(config: HandlerConfig, context: Record<string, unknown>): Promise<HandlerResult> {
    if (!this.bus) {
      return { success: false, error: 'Bus I2C non ouvert' };
    }

    const params = config as I2cActionConfig;

    try {
      if (params.action === 'scan') {
        return this.scanBus();
      }

      const address = this.resolveAddress(params);
      if (address === undefined) {
        return { success: false, error: 'Adresse I2C non spécifiée' };
      }

      switch (params.action) {
        case 'write':
          return this.writeData(address, params);
        case 'read':
          return this.readData(address, params);
        case 'write_byte':
          return this.writeByte(address, params);
        case 'read_byte':
          return this.readByte(address, params);
        case 'write_word':
          return this.writeWord(address, params);
        case 'read_word':
          return this.readWord(address, params);
        case 'write_i2c_block':
          return this.writeBlock(address, params);
        case 'read_i2c_block':
          return this.readBlock(address, params);
        default:
          return { success: false, error: `Action inconnue: ${params.action}` };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }

  private parseData(data: number | number[] | string | undefined): Buffer {
    if (data === undefined) {
      return Buffer.alloc(0);
    }

    if (typeof data === 'number') {
      return Buffer.from([data]);
    }

    if (Array.isArray(data)) {
      return Buffer.from(data);
    }

    const hexStr = data.replace(/\s/g, '');
    const bytes: number[] = [];
    for (let i = 0; i < hexStr.length; i += 2) {
      bytes.push(parseInt(hexStr.substr(i, 2), 16));
    }
    return Buffer.from(bytes);
  }

  private async scanBus(): Promise<HandlerResult> {
    const devices: number[] = [];

    for (let addr = 0x03; addr <= 0x77; addr++) {
      const present = await this.devicePresent(addr);
      if (present) {
        devices.push(addr);
      }
    }

    console.log(`[I2C] Scan: ${devices.length} devices trouvés`);

    return {
      success: true,
      data: {
        action: 'scan',
        devices,
        devices_hex: devices.map((d) => `0x${d.toString(16)}`),
        count: devices.length,
      },
    };
  }

  private writeData(address: number, params: I2cActionConfig): Promise<HandlerResult> {
    return new Promise((resolve) => {
      const data = this.parseData(params.data);

      this.bus.i2cWrite(address, data.length, data, (err: Error | null, bytesWritten: number) => {
        if (err) {
          resolve({ success: false, error: err.message });
        } else {
          console.log(`[I2C] Écrit ${bytesWritten} octets @ 0x${address.toString(16)}`);
          resolve({
            success: true,
            data: {
              action: 'write',
              address,
              bytes_written: bytesWritten,
            },
          });
        }
      });
    });
  }

  private readData(address: number, params: I2cActionConfig): Promise<HandlerResult> {
    return new Promise((resolve) => {
      const length = params.length || 1;
      const buffer = Buffer.alloc(length);

      this.bus.i2cRead(address, length, buffer, (err: Error | null, bytesRead: number, data: Buffer) => {
        if (err) {
          resolve({ success: false, error: err.message });
        } else {
          console.log(`[I2C] Lu ${bytesRead} octets @ 0x${address.toString(16)}`);
          resolve({
            success: true,
            data: {
              action: 'read',
              address,
              bytes_read: bytesRead,
              value: Array.from(data),
              value_hex: Array.from(data).map((b: number) => b.toString(16).padStart(2, '0')).join(''),
            },
          });
        }
      });
    });
  }

  private writeByte(address: number, params: I2cActionConfig): Promise<HandlerResult> {
    return new Promise((resolve) => {
      const register = params.register ?? 0;
      const value = typeof params.data === 'number' ? params.data : 0;

      this.bus.writeByte(address, register, value, (err: Error | null) => {
        if (err) {
          resolve({ success: false, error: err.message });
        } else {
          console.log(`[I2C] WriteByte @ 0x${address.toString(16)} reg 0x${register.toString(16)} = 0x${value.toString(16)}`);
          resolve({
            success: true,
            data: {
              action: 'write_byte',
              address,
              register,
              value,
            },
          });
        }
      });
    });
  }

  private readByte(address: number, params: I2cActionConfig): Promise<HandlerResult> {
    return new Promise((resolve) => {
      const register = params.register ?? 0;

      this.bus.readByte(address, register, (err: Error | null, byte: number) => {
        if (err) {
          resolve({ success: false, error: err.message });
        } else {
          console.log(`[I2C] ReadByte @ 0x${address.toString(16)} reg 0x${register.toString(16)} = 0x${byte.toString(16)}`);
          resolve({
            success: true,
            data: {
              action: 'read_byte',
              address,
              register,
              value: byte,
              value_hex: `0x${byte.toString(16)}`,
            },
          });
        }
      });
    });
  }

  private writeWord(address: number, params: I2cActionConfig): Promise<HandlerResult> {
    return new Promise((resolve) => {
      const register = params.register ?? 0;
      const value = typeof params.data === 'number' ? params.data : 0;

      this.bus.writeWord(address, register, value, (err: Error | null) => {
        if (err) {
          resolve({ success: false, error: err.message });
        } else {
          console.log(`[I2C] WriteWord @ 0x${address.toString(16)} reg 0x${register.toString(16)} = 0x${value.toString(16)}`);
          resolve({
            success: true,
            data: {
              action: 'write_word',
              address,
              register,
              value,
            },
          });
        }
      });
    });
  }

  private readWord(address: number, params: I2cActionConfig): Promise<HandlerResult> {
    return new Promise((resolve) => {
      const register = params.register ?? 0;

      this.bus.readWord(address, register, (err: Error | null, word: number) => {
        if (err) {
          resolve({ success: false, error: err.message });
        } else {
          console.log(`[I2C] ReadWord @ 0x${address.toString(16)} reg 0x${register.toString(16)} = 0x${word.toString(16)}`);
          resolve({
            success: true,
            data: {
              action: 'read_word',
              address,
              register,
              value: word,
              value_hex: `0x${word.toString(16)}`,
            },
          });
        }
      });
    });
  }

  private writeBlock(address: number, params: I2cActionConfig): Promise<HandlerResult> {
    return new Promise((resolve) => {
      const register = params.register ?? 0;
      const data = this.parseData(params.data);

      this.bus.writeI2cBlock(address, register, data.length, data, (err: Error | null, bytesWritten: number) => {
        if (err) {
          resolve({ success: false, error: err.message });
        } else {
          console.log(`[I2C] WriteBlock @ 0x${address.toString(16)} reg 0x${register.toString(16)}: ${bytesWritten} octets`);
          resolve({
            success: true,
            data: {
              action: 'write_i2c_block',
              address,
              register,
              bytes_written: bytesWritten,
            },
          });
        }
      });
    });
  }

  private readBlock(address: number, params: I2cActionConfig): Promise<HandlerResult> {
    return new Promise((resolve) => {
      const register = params.register ?? 0;
      const length = params.length || 1;
      const buffer = Buffer.alloc(length);

      this.bus.readI2cBlock(address, register, length, buffer, (err: Error | null, bytesRead: number, data: Buffer) => {
        if (err) {
          resolve({ success: false, error: err.message });
        } else {
          console.log(`[I2C] ReadBlock @ 0x${address.toString(16)} reg 0x${register.toString(16)}: ${bytesRead} octets`);
          resolve({
            success: true,
            data: {
              action: 'read_i2c_block',
              address,
              register,
              bytes_read: bytesRead,
              value: Array.from(data),
              value_hex: Array.from(data).map((b: number) => b.toString(16).padStart(2, '0')).join(''),
            },
          });
        }
      });
    });
  }

  async shutdown(): Promise<void> {
    if (this.bus) {
      await new Promise<void>((resolve) => {
        this.bus.close(() => resolve());
      });
    }
    console.log('[I2C] Handler arrêté');
  }
}
