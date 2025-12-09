/**
 * USB HID Handler - Communication avec des périphériques USB HID
 * Pour contrôleurs custom, afficheurs, claviers programmables, etc.
 */

import type { Handler, HandlerResult, HandlerConfig } from './handler.interface.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

let HID: any;

interface UsbHidHandlerConfig {
  enabled: boolean;
  devices?: Record<string, {
    vendor_id: number;
    product_id: number;
    usage_page?: number | undefined;
    usage?: number | undefined;
    interface_number?: number | undefined;
  }> | undefined;
}

export interface UsbHidActionConfig extends HandlerConfig {
  device?: string | undefined;
  vendor_id?: number | undefined;
  product_id?: number | undefined;
  action: 'write' | 'read' | 'get_feature' | 'send_feature';
  data?: number[] | string | undefined;
  report_id?: number | undefined;
  read_timeout?: number | undefined;
  read_size?: number | undefined;
}

export class UsbHidHandler implements Handler {
  readonly name = 'USB HID Handler';
  readonly type = 'usb_hid';

  private config: UsbHidHandlerConfig;
  private openDevices: Map<string, any> = new Map();

  constructor(config: UsbHidHandlerConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    try {
      // @ts-expect-error - Optional dependency, may not be installed
      HID = await import('node-hid');
    } catch {
      throw new Error(
        'node-hid module not found. Install it with: npm install node-hid'
      );
    }

    const devices = HID.devices();
    console.log(`[USB-HID] ${devices.length} devices HID détectés`);

    if (this.config.devices) {
      for (const [name, dev] of Object.entries(this.config.devices)) {
        const found = devices.find(
          (d: any) => d.vendorId === dev.vendor_id && d.productId === dev.product_id
        );
        if (found) {
          console.log(`[USB-HID] Device "${name}" trouvé: ${found.product || 'Unknown'}`);
        } else {
          console.warn(`[USB-HID] Device "${name}" non trouvé (VID:${dev.vendor_id.toString(16)} PID:${dev.product_id.toString(16)})`);
        }
      }
    }
  }

  private getDeviceKey(vendorId: number, productId: number): string {
    return `${vendorId}:${productId}`;
  }

  private resolveDevice(params: UsbHidActionConfig): { vendorId: number; productId: number } | undefined {
    if (params.vendor_id !== undefined && params.product_id !== undefined) {
      return { vendorId: params.vendor_id, productId: params.product_id };
    }

    if (params.device) {
      const dev = this.config.devices?.[params.device];
      if (dev) {
        return { vendorId: dev.vendor_id, productId: dev.product_id };
      }
    }

    return undefined;
  }

  private getOrOpenDevice(vendorId: number, productId: number): any {
    const key = this.getDeviceKey(vendorId, productId);
    let device = this.openDevices.get(key);

    if (!device) {
      try {
        device = new HID.HID(vendorId, productId);
        this.openDevices.set(key, device);
        console.log(`[USB-HID] Device ouvert: VID ${vendorId.toString(16)} PID ${productId.toString(16)}`);
      } catch (err) {
        throw new Error(`Impossible d'ouvrir le device HID: ${err}`);
      }
    }

    return device;
  }

  async execute(config: HandlerConfig, context: Record<string, unknown>): Promise<HandlerResult> {
    if (!HID) {
      return { success: false, error: 'USB HID non initialisé' };
    }

    const params = config as UsbHidActionConfig;
    const event = context.event as {
      id: string;
      pubkey: string;
      kind: number;
      created_at: number;
      content: string;
    };
    const transformedContent = (context.transformedContent as string) || event.content;

    try {
      const deviceInfo = this.resolveDevice(params);
      if (!deviceInfo) {
        return { success: false, error: 'Device non spécifié (vendor_id/product_id ou device name)' };
      }

      const device = this.getOrOpenDevice(deviceInfo.vendorId, deviceInfo.productId);

      switch (params.action) {
        case 'write':
          return this.writeToDevice(device, params, transformedContent);
        case 'read':
          return this.readFromDevice(device, params);
        case 'get_feature':
          return this.getFeatureReport(device, params);
        case 'send_feature':
          return this.sendFeatureReport(device, params, transformedContent);
        default:
          return { success: false, error: `Action inconnue: ${params.action}` };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }

  private parseData(params: UsbHidActionConfig, content: string): number[] {
    if (params.data) {
      if (Array.isArray(params.data)) {
        return params.data;
      }
      const hexStr = (params.data as string).replace(/\s/g, '');
      const bytes: number[] = [];
      for (let i = 0; i < hexStr.length; i += 2) {
        bytes.push(parseInt(hexStr.substr(i, 2), 16));
      }
      return bytes;
    }

    return Array.from(Buffer.from(content, 'utf8'));
  }

  private writeToDevice(device: any, params: UsbHidActionConfig, content: string): HandlerResult {
    const data = this.parseData(params, content);
    const reportId = params.report_id || 0;
    const dataWithReportId = [reportId, ...data];

    const bytesWritten = device.write(dataWithReportId);

    console.log(`[USB-HID] Écrit ${bytesWritten} octets`);

    return {
      success: true,
      data: {
        action: 'write',
        bytes_written: bytesWritten,
        report_id: reportId,
      },
    };
  }

  private readFromDevice(device: any, params: UsbHidActionConfig): HandlerResult {
    const timeout = params.read_timeout || 1000;

    device.setNonBlocking(true);

    const startTime = Date.now();
    let data: number[] | undefined;

    while (Date.now() - startTime < timeout) {
      try {
        const result = device.readSync();
        if (result && result.length > 0) {
          data = Array.from(result);
          break;
        }
      } catch {
        // Pas de données disponibles
      }
      const delay = (ms: number) => {
        const end = Date.now() + ms;
        while (Date.now() < end) { /* busy wait */ }
      };
      delay(10);
    }

    device.setNonBlocking(false);

    if (!data || data.length === 0) {
      return {
        success: true,
        data: {
          action: 'read',
          bytes_read: 0,
          value: null,
        },
      };
    }

    console.log(`[USB-HID] Lu ${data.length} octets`);

    return {
      success: true,
      data: {
        action: 'read',
        bytes_read: data.length,
        value: data,
        value_hex: data.map((b: number) => b.toString(16).padStart(2, '0')).join(''),
      },
    };
  }

  private getFeatureReport(device: any, params: UsbHidActionConfig): HandlerResult {
    const reportId = params.report_id || 0;
    const size = params.read_size || 64;

    try {
      const data = device.getFeatureReport(reportId, size);

      console.log(`[USB-HID] Feature report ${reportId}: ${data.length} octets`);

      return {
        success: true,
        data: {
          action: 'get_feature',
          report_id: reportId,
          bytes_read: data.length,
          value: Array.from(data),
          value_hex: (Array.from(data) as number[]).map((b) => b.toString(16).padStart(2, '0')).join(''),
        },
      };
    } catch (err) {
      return {
        success: false,
        error: `Erreur get_feature: ${err}`,
      };
    }
  }

  private sendFeatureReport(device: any, params: UsbHidActionConfig, content: string): HandlerResult {
    const data = this.parseData(params, content);
    const reportId = params.report_id || 0;
    const dataWithReportId = [reportId, ...data];

    try {
      const bytesWritten = device.sendFeatureReport(dataWithReportId);

      console.log(`[USB-HID] Feature report ${reportId} envoyé: ${bytesWritten} octets`);

      return {
        success: true,
        data: {
          action: 'send_feature',
          report_id: reportId,
          bytes_written: bytesWritten,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: `Erreur send_feature: ${err}`,
      };
    }
  }

  async shutdown(): Promise<void> {
    for (const [, device] of this.openDevices) {
      try {
        device.close();
      } catch {
        // Ignorer les erreurs de cleanup
      }
    }
    this.openDevices.clear();

    console.log('[USB-HID] Handler arrêté');
  }
}
