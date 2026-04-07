/**
 * System handler (v2)
 *
 * Returns system status info: version, workflows, handlers, disk/memory usage.
 */

import { z } from 'zod';
import os from 'node:os';
import { BaseHandler, type HandlerResult, type ActionContext } from './base.js';

export class SystemHandler extends BaseHandler {
  static type = 'system';
  static configSchema = z.object({ enabled: z.boolean().optional() });

  readonly name = 'System';
  readonly type = 'system';

  async initialize(_config: Record<string, unknown>): Promise<void> {}

  async execute(action: Record<string, unknown>, _context: ActionContext): Promise<HandlerResult> {
    const op = (action.action as string) ?? 'status';

    if (op === 'status') {
      const mem = process.memoryUsage();
      const uptime = process.uptime();

      return {
        success: true,
        data: {
          version: 'v2',
          platform: os.platform(),
          arch: os.arch(),
          node: process.version,
          uptime_seconds: Math.floor(uptime),
          uptime_human: this.formatUptime(uptime),
          memory: {
            rss_mb: Math.round(mem.rss / 1024 / 1024),
            heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
            heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024),
          },
          os: {
            hostname: os.hostname(),
            total_memory_mb: Math.round(os.totalmem() / 1024 / 1024),
            free_memory_mb: Math.round(os.freemem() / 1024 / 1024),
            load_avg: os.loadavg().map((l) => Math.round(l * 100) / 100),
          },
        },
      };
    }

    return { success: false, error: `Unknown system action: ${op}` };
  }

  async shutdown(): Promise<void> {}

  private formatUptime(seconds: number): string {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const parts: string[] = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    parts.push(`${m}m`);
    return parts.join(' ');
  }
}
