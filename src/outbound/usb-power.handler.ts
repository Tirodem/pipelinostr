/**
 * USB Power Handler - Contrôle de l'alimentation des ports USB via uhubctl
 * Compatible avec les hubs USB supportant per-port power switching (ppps)
 * Requiert: sudo apt install uhubctl
 */

import type { Handler, HandlerResult, HandlerConfig } from './handler.interface.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface UsbPowerHandlerConfig {
  enabled: boolean;
  default_hub?: string | undefined;  // Default hub location (e.g., "1", "1-1", "2")
  ports?: Record<string, { hub: string; port: number }> | undefined;  // Named port mapping
}

export interface UsbPowerActionConfig extends HandlerConfig {
  port: number | string;  // Port number, named port, or "all"/-1 for all ports
  action: 'on' | 'off' | 'toggle' | 'cycle' | 'pulse' | 'status';
  hub?: string | undefined;  // Hub location (overrides default)
  delay?: number | undefined;  // Delay in ms for cycle/pulse actions (default: 2000)
}

export class UsbPowerHandler implements Handler {
  readonly name = 'USB Power Handler';
  readonly type = 'usb_power';

  private config: UsbPowerHandlerConfig;
  private uhubctlAvailable: boolean = false;

  constructor(config: UsbPowerHandlerConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    try {
      // Check if uhubctl is available
      await execAsync('which uhubctl');
      this.uhubctlAvailable = true;
      console.log('[USB Power] uhubctl found');
    } catch {
      console.warn('[USB Power] uhubctl not found. Install with: sudo apt install uhubctl');
      // Don't throw - allow handler to work in simulation mode
    }
  }

  private resolvePort(port: number | string): { hub: string; port: number | 'all' } {
    // Check for "all ports" mode: port = "all" or -1
    if (port === 'all' || port === -1 || port === '-1') {
      if (!this.config.default_hub) {
        throw new Error(`No hub specified and no default_hub configured`);
      }
      return { hub: this.config.default_hub, port: 'all' };
    }

    // If it's a named port, look it up
    if (typeof port === 'string' && this.config.ports && this.config.ports[port]) {
      return this.config.ports[port];
    }

    // If it's a number or numeric string, use default hub
    const portNum = typeof port === 'number' ? port : parseInt(port, 10);
    if (isNaN(portNum)) {
      throw new Error(`Invalid port: ${port}`);
    }

    if (!this.config.default_hub) {
      throw new Error(`No hub specified and no default_hub configured`);
    }

    return { hub: this.config.default_hub, port: portNum };
  }

  async execute(config: HandlerConfig, context: Record<string, unknown>): Promise<HandlerResult> {
    const params = config as UsbPowerActionConfig;

    if (!this.uhubctlAvailable) {
      console.warn('[USB Power] uhubctl not available, simulating action');
      return {
        success: true,
        data: { simulated: true, message: 'uhubctl not available' }
      };
    }

    try {
      // Resolve port (named or direct)
      const resolved = this.resolvePort(params.port);
      const hub = params.hub || resolved.hub;
      const port = resolved.port;

      switch (params.action) {
        case 'on':
          return this.setPower(hub, port, 'on');
        case 'off':
          return this.setPower(hub, port, 'off');
        case 'toggle':
          return this.togglePower(hub, port);
        case 'cycle':
          return this.cyclePower(hub, port, params.delay || 2000);
        case 'pulse':
          return this.pulsePower(hub, port, params.delay || 2000);
        case 'status':
          return this.getStatus(hub, port);
        default:
          return { success: false, error: `Unknown action: ${params.action}` };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }

  private async setPower(hub: string, port: number | 'all', action: 'on' | 'off'): Promise<HandlerResult> {
    // If port is 'all', omit -p flag to affect all ports
    const portFlag = port === 'all' ? '' : `-p ${port}`;
    const cmd = `sudo uhubctl -l ${hub} -a ${action} ${portFlag}`.trim();
    console.log(`[USB Power] Executing: ${cmd}`);

    try {
      const { stdout, stderr } = await execAsync(cmd);

      // Check if command succeeded
      if (stderr && stderr.includes('Error')) {
        return { success: false, error: stderr };
      }

      const portLabel = port === 'all' ? 'all ports' : `port ${port}`;
      console.log(`[USB Power] Hub ${hub} ${portLabel} -> ${action}`);

      return {
        success: true,
        data: {
          hub,
          port,
          action,
          state: action,
          output: stdout.trim(),
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }

  private async togglePower(hub: string, port: number | 'all'): Promise<HandlerResult> {
    // First get current status
    const statusResult = await this.getStatus(hub, port);
    if (!statusResult.success) {
      return statusResult;
    }

    const currentState = (statusResult.data as { state?: string })?.state;
    const newAction = currentState === 'on' ? 'off' : 'on';

    return this.setPower(hub, port, newAction);
  }

  private async cyclePower(hub: string, port: number | 'all', delayMs: number): Promise<HandlerResult> {
    const portLabel = port === 'all' ? 'all ports' : `port ${port}`;
    console.log(`[USB Power] Cycling hub ${hub} ${portLabel} (delay: ${delayMs}ms)`);

    // Turn off
    const offResult = await this.setPower(hub, port, 'off');
    if (!offResult.success) {
      return offResult;
    }

    // Wait
    await new Promise(resolve => setTimeout(resolve, delayMs));

    // Turn on
    const onResult = await this.setPower(hub, port, 'on');
    if (!onResult.success) {
      return onResult;
    }

    return {
      success: true,
      data: {
        hub,
        port,
        action: 'cycle',
        delay: delayMs,
        state: 'on',
      },
    };
  }

  private async pulsePower(hub: string, port: number | 'all', delayMs: number): Promise<HandlerResult> {
    const portLabel = port === 'all' ? 'all ports' : `port ${port}`;
    console.log(`[USB Power] Pulsing hub ${hub} ${portLabel} (delay: ${delayMs}ms)`);

    // Turn on
    const onResult = await this.setPower(hub, port, 'on');
    if (!onResult.success) {
      return onResult;
    }

    // Wait
    await new Promise(resolve => setTimeout(resolve, delayMs));

    // Turn off
    const offResult = await this.setPower(hub, port, 'off');
    if (!offResult.success) {
      return offResult;
    }

    return {
      success: true,
      data: {
        hub,
        port,
        action: 'pulse',
        delay: delayMs,
        state: 'off',
      },
    };
  }

  private async getStatus(hub: string, port: number | 'all'): Promise<HandlerResult> {
    // If port is 'all', omit -p flag
    const portFlag = port === 'all' ? '' : `-p ${port}`;
    const cmd = `sudo uhubctl -l ${hub} ${portFlag}`.trim();
    console.log(`[USB Power] Executing: ${cmd}`);

    try {
      const { stdout } = await execAsync(cmd);

      let state: string;
      if (port === 'all') {
        // For all ports, check if any port has power
        state = stdout.includes('power') ? 'on' : 'off';
      } else {
        // Parse output to determine power state
        // Example: "Port 3: 0100 power"
        const portPattern = new RegExp(`Port ${port}:.*?(power|off)`, 'i');
        const match = stdout.match(portPattern);
        state = match && match[1]?.toLowerCase() === 'power' ? 'on' : 'off';
      }

      return {
        success: true,
        data: {
          hub,
          port,
          action: 'status',
          state,
          output: stdout.trim(),
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }

  async shutdown(): Promise<void> {
    console.log('[USB Power] Handler arrêté');
  }
}
