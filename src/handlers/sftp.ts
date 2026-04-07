/**
 * SFTP handler (v2)
 *
 * Uploads files via SFTP.
 * Optional dependency: ssh2-sftp-client
 */

import { z } from 'zod';
import { BaseHandler, type HandlerResult, type ActionContext } from './base.js';
import { Secret } from '../config/secrets.js';

export class SftpHandler extends BaseHandler {
  static type = 'sftp';
  static npmDependencies = ['ssh2-sftp-client'];
  static configSchema = z.object({
    host: z.string(),
    port: z.number().optional(),
    username: z.string(),
    password: z.union([z.string(), z.instanceof(Secret)]),
    enabled: z.boolean().optional(),
  });

  readonly name = 'SFTP';
  readonly type = 'sftp';

  private sftpConfig: Record<string, unknown> = {};

  async initialize(config: Record<string, unknown>): Promise<void> {
    const password = config.password instanceof Secret
      ? (config.password as Secret).unwrap()
      : config.password as string;

    this.sftpConfig = {
      host: config.host,
      port: config.port ?? 22,
      username: config.username,
      password,
    };
  }

  async execute(action: Record<string, unknown>, _context: ActionContext): Promise<HandlerResult> {
    const remotePath = action.remote_path as string;
    if (!remotePath) return { success: false, error: 'Missing "remote_path" field' };

    const content = action.content as string;
    const localPath = action.local_path as string | undefined;

    try {
      const SftpClient = (await import('ssh2-sftp-client')).default;
      const sftp = new SftpClient();

      await sftp.connect(this.sftpConfig);

      if (localPath) {
        await sftp.put(localPath, remotePath);
      } else {
        const buffer = Buffer.from(content ?? '');
        await sftp.put(buffer, remotePath);
      }

      await sftp.end();
      return { success: true, data: { remote_path: remotePath } };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async shutdown(): Promise<void> {}
}
