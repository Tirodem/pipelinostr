/**
 * SFTP Handler - Upload de fichiers via SFTP (SSH)
 */

import SftpClient from 'ssh2-sftp-client';
import { Readable } from 'stream';
import { readFileSync } from 'fs';
import type { Handler, HandlerResult, HandlerConfig } from './handler.interface.js';

interface SftpHandlerConfig {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  password?: string | undefined;
  private_key_path?: string | undefined;
  passphrase?: string | undefined;
  timeout: number;
}

export interface SftpActionConfig extends HandlerConfig {
  remote_path: string;
  content?: string;
  create_dirs?: boolean;
}

export class SftpHandler implements Handler {
  readonly name = 'SFTP Handler';
  readonly type = 'sftp';

  private config: SftpHandlerConfig;

  constructor(config: SftpHandlerConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    // Test de connexion
    const sftp = new SftpClient();

    try {
      await sftp.connect(this.getConnectionConfig());
      console.log(`[SFTP] Connexion test réussie à ${this.config.host}`);
    } finally {
      await sftp.end();
    }
  }

  private getConnectionConfig(): SftpClient.ConnectOptions {
    const config: SftpClient.ConnectOptions = {
      host: this.config.host,
      port: this.config.port || 22,
      username: this.config.username,
      readyTimeout: this.config.timeout || 30000,
    };

    if (this.config.private_key_path) {
      config.privateKey = readFileSync(this.config.private_key_path);
      if (this.config.passphrase) {
        config.passphrase = this.config.passphrase;
      }
    } else if (this.config.password) {
      config.password = this.config.password;
    }

    return config;
  }

  async execute(config: HandlerConfig, context: Record<string, unknown>): Promise<HandlerResult> {
    const params = config as SftpActionConfig;
    const event = context.event as { id: string; pubkey: string; kind: number; created_at: number; content: string };
    const transformedContent = (context.transformedContent as string) || event.content;

    const sftp = new SftpClient();

    try {
      await sftp.connect(this.getConnectionConfig());

      // Résoudre le chemin distant
      const remotePath = this.resolveRemotePath(params.remote_path, event);

      // Créer les répertoires si nécessaire
      if (params.create_dirs !== false) {
        const remoteDir = remotePath.substring(0, remotePath.lastIndexOf('/'));
        if (remoteDir) {
          await sftp.mkdir(remoteDir, true);
        }
      }

      // Contenu à uploader
      const content = params.content || transformedContent;
      const buffer = Buffer.from(content, 'utf-8');
      const stream = Readable.from(buffer);

      await sftp.put(stream, remotePath);

      console.log(`[SFTP] Fichier uploadé: ${remotePath} (${buffer.length} bytes)`);

      return {
        success: true,
        data: {
          remote_path: remotePath,
          size: buffer.length,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: errorMessage,
      };
    } finally {
      await sftp.end();
    }
  }

  private resolveRemotePath(
    template: string,
    event: { id: string; pubkey: string; kind: number; created_at: number }
  ): string {
    const now = new Date();
    const isoString = now.toISOString();
    const datePart = isoString.split('T')[0] || '';
    const timePart = isoString.split('T')[1] || '';
    const timeFormatted = timePart.replace(/:/g, '-').split('.')[0] || '';
    return template
      .replace(/{event_id}/g, event.id.substring(0, 8))
      .replace(/{pubkey}/g, event.pubkey.substring(0, 8))
      .replace(/{timestamp}/g, event.created_at.toString())
      .replace(/{date}/g, datePart)
      .replace(/{time}/g, timeFormatted)
      .replace(/{datetime}/g, isoString.replace(/:/g, '-').replace(/\./g, '-'))
      .replace(/{kind}/g, event.kind.toString());
  }

  async shutdown(): Promise<void> {
    console.log('[SFTP] Handler arrêté');
  }
}
