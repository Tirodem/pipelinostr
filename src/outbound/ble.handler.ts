/**
 * Bluetooth LE Handler - Communication avec des périphériques BLE
 * Pour beacons, capteurs, wearables, etc.
 */

import type { Handler, HandlerResult, HandlerConfig } from './handler.interface.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

let noble: any;

interface BleHandlerConfig {
  enabled: boolean;
  devices?: Record<string, {
    address?: string | undefined;
    service_uuid?: string | undefined;
    characteristic_uuid?: string | undefined;
  }> | undefined;
  scan_timeout?: number | undefined;
  connect_timeout?: number | undefined;
}

export interface BleActionConfig extends HandlerConfig {
  device?: string | undefined;
  address?: string | undefined;
  service_uuid: string;
  characteristic_uuid: string;
  action: 'write' | 'write_without_response' | 'read' | 'notify';
  data?: string | undefined;
  data_format?: 'text' | 'hex' | 'json' | undefined;
  listen_duration?: number | undefined;
}

interface CachedPeripheral {
  peripheral: any;
  characteristics: Map<string, any>;
  lastUsed: number;
}

export class BleHandler implements Handler {
  readonly name = 'Bluetooth LE Handler';
  readonly type = 'ble';

  private config: BleHandlerConfig;
  private peripheralCache: Map<string, CachedPeripheral> = new Map();
  private isScanning = false;

  constructor(config: BleHandlerConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    try {
      // @ts-expect-error - Optional dependency, may not be installed
      const nobleModule = await import('@abandonware/noble') as any;
      noble = nobleModule.default || nobleModule;
    } catch {
      throw new Error(
        '@abandonware/noble module not found. Install it with: npm install @abandonware/noble'
      );
    }

    await this.waitForBluetooth();
    console.log('[BLE] Bluetooth initialisé');
  }

  private waitForBluetooth(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Bluetooth initialization timeout'));
      }, 10000);

      if (noble.state === 'poweredOn') {
        clearTimeout(timeout);
        resolve();
        return;
      }

      noble.on('stateChange', (state: string) => {
        if (state === 'poweredOn') {
          clearTimeout(timeout);
          resolve();
        } else if (state === 'poweredOff' || state === 'unauthorized') {
          clearTimeout(timeout);
          reject(new Error(`Bluetooth ${state}`));
        }
      });
    });
  }

  async execute(config: HandlerConfig, context: Record<string, unknown>): Promise<HandlerResult> {
    if (!noble) {
      return { success: false, error: 'BLE non initialisé' };
    }

    const params = config as BleActionConfig;
    const event = context.event as {
      id: string;
      pubkey: string;
      kind: number;
      created_at: number;
      content: string;
    };
    const transformedContent = (context.transformedContent as string) || event.content;

    try {
      const address = this.resolveDeviceAddress(params);
      if (!address) {
        return { success: false, error: 'Adresse du device non spécifiée' };
      }

      const cached = await this.getOrConnectPeripheral(address);

      const charKey = `${params.service_uuid}:${params.characteristic_uuid}`;
      let characteristic = cached.characteristics.get(charKey);

      if (!characteristic) {
        characteristic = await this.discoverCharacteristic(
          cached.peripheral,
          params.service_uuid,
          params.characteristic_uuid
        );
        cached.characteristics.set(charKey, characteristic);
      }

      switch (params.action) {
        case 'write':
          return this.writeCharacteristic(characteristic, params, transformedContent, true);
        case 'write_without_response':
          return this.writeCharacteristic(characteristic, params, transformedContent, false);
        case 'read':
          return this.readCharacteristic(characteristic);
        case 'notify':
          return this.listenNotifications(characteristic, params.listen_duration || 5000);
        default:
          return { success: false, error: `Action inconnue: ${params.action}` };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }

  private resolveDeviceAddress(params: BleActionConfig): string | undefined {
    if (params.address) {
      return params.address.toLowerCase();
    }

    if (params.device) {
      const device = this.config.devices?.[params.device];
      if (device) {
        return device.address?.toLowerCase();
      }
    }

    return undefined;
  }

  private async getOrConnectPeripheral(address: string): Promise<CachedPeripheral> {
    const cached = this.peripheralCache.get(address);
    if (cached && cached.peripheral.state === 'connected') {
      cached.lastUsed = Date.now();
      return cached;
    }

    const peripheral = await this.scanForDevice(address);
    await this.connectToPeripheral(peripheral);

    const newCached: CachedPeripheral = {
      peripheral,
      characteristics: new Map(),
      lastUsed: Date.now(),
    };
    this.peripheralCache.set(address, newCached);

    return newCached;
  }

  private scanForDevice(address: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        noble.stopScanning();
        this.isScanning = false;
        reject(new Error(`Device ${address} non trouvé`));
      }, this.config.scan_timeout || 10000);

      const onDiscover = (peripheral: any) => {
        if (peripheral.address?.toLowerCase() === address) {
          clearTimeout(timeout);
          noble.stopScanning();
          this.isScanning = false;
          noble.removeListener('discover', onDiscover);
          resolve(peripheral);
        }
      };

      noble.on('discover', onDiscover);

      if (!this.isScanning) {
        this.isScanning = true;
        noble.startScanning([], true);
      }
    });
  }

  private connectToPeripheral(peripheral: any): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, this.config.connect_timeout || 10000);

      peripheral.connect((err: Error | null) => {
        clearTimeout(timeout);
        if (err) {
          reject(err);
        } else {
          console.log(`[BLE] Connecté à ${peripheral.address}`);
          resolve();
        }
      });
    });
  }

  private discoverCharacteristic(
    peripheral: any,
    serviceUuid: string,
    characteristicUuid: string
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      peripheral.discoverSomeServicesAndCharacteristics(
        [serviceUuid.replace(/-/g, '')],
        [characteristicUuid.replace(/-/g, '')],
        (err: Error | null, services: any[], characteristics: any[]) => {
          if (err) {
            reject(err);
          } else if (characteristics && characteristics.length > 0) {
            resolve(characteristics[0]);
          } else {
            reject(new Error(`Characteristic ${characteristicUuid} non trouvée`));
          }
        }
      );
    });
  }

  private async writeCharacteristic(
    characteristic: any,
    params: BleActionConfig,
    content: string,
    withResponse: boolean
  ): Promise<HandlerResult> {
    const dataStr = params.data || content;
    let buffer: Buffer;

    if (params.data_format === 'hex') {
      buffer = Buffer.from(dataStr.replace(/\s/g, ''), 'hex');
    } else if (params.data_format === 'json') {
      buffer = Buffer.from(JSON.stringify(JSON.parse(dataStr)));
    } else {
      buffer = Buffer.from(dataStr, 'utf8');
    }

    return new Promise((resolve) => {
      characteristic.write(buffer, !withResponse, (err: Error | null) => {
        if (err) {
          resolve({ success: false, error: err.message });
        } else {
          console.log(`[BLE] Écrit ${buffer.length} octets`);
          resolve({
            success: true,
            data: {
              action: withResponse ? 'write' : 'write_without_response',
              bytes_written: buffer.length,
            },
          });
        }
      });
    });
  }

  private readCharacteristic(characteristic: any): Promise<HandlerResult> {
    return new Promise((resolve) => {
      characteristic.read((err: Error | null, data: Buffer) => {
        if (err) {
          resolve({ success: false, error: err.message });
        } else {
          console.log(`[BLE] Lu ${data?.length || 0} octets`);
          resolve({
            success: true,
            data: {
              action: 'read',
              value: data?.toString('hex'),
              value_string: data?.toString('utf8'),
              bytes_read: data?.length || 0,
            },
          });
        }
      });
    });
  }

  private listenNotifications(characteristic: any, duration: number): Promise<HandlerResult> {
    return new Promise((resolve) => {
      const notifications: string[] = [];

      const onData = (data: Buffer) => {
        notifications.push(data.toString('hex'));
      };

      characteristic.on('data', onData);
      characteristic.subscribe((err: Error | null) => {
        if (err) {
          resolve({ success: false, error: err.message });
          return;
        }

        setTimeout(() => {
          characteristic.unsubscribe();
          characteristic.removeListener('data', onData);

          console.log(`[BLE] Reçu ${notifications.length} notifications`);
          resolve({
            success: true,
            data: {
              action: 'notify',
              notifications,
              count: notifications.length,
            },
          });
        }, duration);
      });
    });
  }

  async shutdown(): Promise<void> {
    for (const [, cached] of this.peripheralCache) {
      try {
        if (cached.peripheral.state === 'connected') {
          cached.peripheral.disconnect();
        }
      } catch {
        // Ignorer les erreurs de cleanup
      }
    }
    this.peripheralCache.clear();

    if (this.isScanning && noble) {
      noble.stopScanning();
    }

    console.log('[BLE] Handler arrêté');
  }
}
