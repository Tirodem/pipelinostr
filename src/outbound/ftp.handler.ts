/**
 * FTP Handler - Upload de fichiers via FTP
 */

import { Client } from 'basic-ftp';
import { Readable } from 'stream';
import type { Handler, HandlerResult, HandlerConfig } from './handler.interface.js';

interface FtpHandlerConfig {
  enabled: boolean;
  host: string;
  port: number;
  user: string;
  password: string;
  secure: boolean;
  timeout: number;
}

export interface FtpActionConfig extends HandlerConfig {
  remote_path: string;
  content?: string;
  create_dirs?: boolean;
}

export class FtpHandler implements Handler {
  readonly name = 'FTP Handler';
  readonly type = 'ftp';

  private config: FtpHandlerConfig;

  constructor(config: FtpHandlerConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    // Test de connexion
    const client = new Client();
    client.ftp.verbose = false;

    try {
      await client.access({
        host: this.config.host,
        port: this.config.port || 21,
        user: this.config.user,
        password: this.config.password,
        secure: this.config.secure || false,
      });
      console.log(`[FTP] Connexion test réussie à ${this.config.host}`);
    } finally {
      client.close();
    }
  }

  async execute(config: HandlerConfig, context: Record<string, unknown>): Promise<HandlerResult> {
    const params = config as FtpActionConfig;
    const event = context.event as { id: string; pubkey: string; kind: number; created_at: number; content: string };
    const transformedContent = (context.transformedContent as string) || event.content;

    const client = new Client();
    client.ftp.verbose = false;

    try {
      await client.access({
        host: this.config.host,
        port: this.config.port || 21,
        user: this.config.user,
        password: this.config.password,
        secure: this.config.secure || false,
      });

      // Résoudre le chemin distant
      const remotePath = this.resolveRemotePath(params.remote_path, event);

      // Créer les répertoires si nécessaire
      if (params.create_dirs !== false) {
        const remoteDir = remotePath.substring(0, remotePath.lastIndexOf('/'));
        if (remoteDir) {
          await client.ensureDir(remoteDir);
        }
      }

      // Contenu à uploader
      const content = params.content || transformedContent;
      const buffer = Buffer.from(content, 'utf-8');
      const stream = Readable.from(buffer);

      // Upload
      await client.uploadFrom(stream, remotePath);

      console.log(`[FTP] Fichier uploadé: ${remotePath} (${buffer.length} bytes)`);

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
      client.close();
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
    console.log('[FTP] Handler arrêté');
  }
}
