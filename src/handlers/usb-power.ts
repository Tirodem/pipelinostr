/**
 * USB Power handler (v2)
 *
 * Controls USB port power on/off via uhubctl.
 * Used for USB-powered dispensers.
 */

import { z } from 'zod';
import { spawn } from 'node:child_process';
import { BaseHandler, type HandlerResult, type ActionContext } from './base.js';
import type { SystemDependency } from '../utils/system-deps.js';

export class UsbPowerHandler extends BaseHandler {
  static type = 'usb_power';
  static configSchema = z.object({
    enabled: z.boolean().optional(),
    auto_install: z.boolean().optional(),
  });
  static systemDeps: SystemDependency[] = [
    { binary: 'uhubctl', packages: { apt: 'uhubctl', apk: 'uhubctl' } },
  ];

  readonly name = 'USB Power';
  readonly type = 'usb_power';

  async initialize(_config: Record<string, unknown>): Promise<void> {}

  async execute(action: Record<string, unknown>, _context: ActionContext): Promise<HandlerResult> {
    const op = (action.action as string) ?? 'on';
    const port = (action.port as string) ?? '1';
    const hub = action.hub as string | undefined;

    try {
      const power = op === 'off' ? '0' : '1';
      const args = ['-a', power, '-p', port];
      if (hub) args.push('-l', hub);

      await this.runCommand('uhubctl', args);

      return {
        success: true,
        data: { port, action: op, hub },
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async shutdown(): Promise<void> {}

  private runCommand(cmd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      proc.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
      proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });
      proc.on('error', (err) => reject(new Error(`${cmd} failed: ${err.message}`)));
      proc.on('close', (code) => {
        if (code === 0) resolve(stdout);
        else reject(new Error(`${cmd} exited ${code}: ${stderr}`));
      });
    });
  }
}
