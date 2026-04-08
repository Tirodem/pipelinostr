/**
 * File handler (v2)
 *
 * Local filesystem write/append. No external dependencies.
 */

import { z } from 'zod';
import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { BaseHandler, type HandlerResult, type ActionContext } from './base.js';

export class FileHandler extends BaseHandler {
  static type = 'file';
  static configSchema = z.object({
    output_dir: z.string().optional(),
    max_file_size_mb: z.number().optional(),
    enabled: z.boolean().optional(),
  });

  readonly name = 'File';
  readonly type = 'file';

  private outputDir = './data/files';
  private maxSizeBytes = 10 * 1024 * 1024; // 10MB default

  async initialize(config: Record<string, unknown>): Promise<void> {
    this.outputDir = (config.output_dir as string) ?? './data/files';
    this.maxSizeBytes = ((config.max_file_size_mb as number) ?? 10) * 1024 * 1024;
    await fs.mkdir(this.outputDir, { recursive: true });
  }

  async execute(action: Record<string, unknown>, _context: ActionContext): Promise<HandlerResult> {
    const path = action.path as string ?? action.filename as string;
    if (!path) return { success: false, error: 'Missing path or filename' };

    const content = action.content as string ?? '';
    const append = action.append as boolean ?? false;

    try {
      // Resolve path — if absolute, use as-is; if relative, join with outputDir
      const filepath = path.startsWith('/') || path.startsWith('./')
        ? path
        : join(this.outputDir, path);

      // Ensure parent directory
      await fs.mkdir(dirname(filepath), { recursive: true });

      // Size check
      const buffer = Buffer.from(content);
      if (buffer.length > this.maxSizeBytes) {
        return { success: false, error: `File too large: ${buffer.length} bytes (max: ${this.maxSizeBytes})` };
      }

      // Write
      if (append) {
        await fs.appendFile(filepath, content);
      } else {
        await fs.writeFile(filepath, content);
      }

      const stats = await fs.stat(filepath);

      return {
        success: true,
        data: { filepath, size: stats.size },
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async shutdown(): Promise<void> {}
}
