/**
 * FTP handler (v2)
 *
 * Uploads/appends files via FTP.
 * Optional dependency: basic-ftp
 */

import { z } from 'zod';
import { BaseHandler, type HandlerResult, type ActionContext } from './base.js';
import { Secret } from '../config/secrets.js';

export class FtpHandler extends BaseHandler {
  static type = 'ftp';
  static npmDependencies = ['basic-ftp'];
  static configSchema = z.object({
    host: z.string(),
    port: z.number().optional(),
    user: z.string(),
    password: z.union([z.string(), z.instanceof(Secret)]),
    secure: z.boolean().optional(),
    timeout: z.number().optional(),
    enabled: z.boolean().optional(),
  });

  readonly name = 'FTP';
  readonly type = 'ftp';

  private ftpConfig: Record<string, unknown> = {};

  async initialize(config: Record<string, unknown>): Promise<void> {
    const password = config.password instanceof Secret
      ? (config.password as Secret).unwrap()
      : config.password as string;

    this.ftpConfig = {
      host: config.host,
      port: config.port ?? 21,
      user: config.user,
      password,
      secure: config.secure ?? false,
      timeout: config.timeout ?? 30000,
    };
  }

  async execute(action: Record<string, unknown>, _context: ActionContext): Promise<HandlerResult> {
    const remotePath = action.remote_path as string;
    if (!remotePath) return { success: false, error: 'Missing remote_path' };

    const content = action.content as string;
    const operation = (action.operation as string) ?? 'upload';

    try {
      const { Client } = await import('basic-ftp');
      const client = new Client();
      client.ftp.verbose = false;

      await client.access(this.ftpConfig as Parameters<typeof client.access>[0]);

      // Ensure remote directories exist
      if (action.create_dirs !== false) {
        const dir = remotePath.substring(0, remotePath.lastIndexOf('/'));
        if (dir) await client.ensureDir(dir);
      }

      // Upload content as stream
      const { Readable } = await import('node:stream');
      const stream = Readable.from(Buffer.from(content ?? ''));

      if (operation === 'append') {
        await client.appendFrom(stream, remotePath);
      } else {
        await client.uploadFrom(stream, remotePath);
      }

      const size = Buffer.byteLength(content ?? '');
      client.close();

      return { success: true, data: { remote_path: remotePath, size, operation } };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async shutdown(): Promise<void> {}
}
