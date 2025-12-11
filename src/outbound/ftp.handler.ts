/**
 * FTP Handler - Upload de fichiers via FTP
 */

import { Client } from 'basic-ftp';
import { Readable } from 'stream';
import { createReadStream, existsSync } from 'fs';
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
  operation?: 'upload' | 'append';
  remote_path: string;
  local_path?: string;     // Upload from local file instead of content
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
    const event = context.event as { id: string; pubkey: string; kind: number; created_at: number; content: string } | undefined;
    const transformedContent = (context.transformedContent as string) || event?.content || '';

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
      const remotePath = this.resolveRemotePath(params.remote_path, event || { id: 'unknown', pubkey: 'unknown', kind: 0, created_at: Math.floor(Date.now() / 1000) });

      // Créer les répertoires si nécessaire
      if (params.create_dirs !== false) {
        const remoteDir = remotePath.substring(0, remotePath.lastIndexOf('/'));
        if (remoteDir) {
          await client.ensureDir(remoteDir);
        }
      }

      const operation = params.operation || 'upload';
      let size: number;

      // Upload depuis fichier local ou depuis contenu
      if (params.local_path) {
        // Résoudre le chemin local (peut contenir des variables)
        const localPath = this.resolveRemotePath(params.local_path, event || { id: 'unknown', pubkey: 'unknown', kind: 0, created_at: Math.floor(Date.now() / 1000) });

        if (!existsSync(localPath)) {
          return { success: false, error: `Fichier local non trouvé: ${localPath}` };
        }

        const localStream = createReadStream(localPath);
        if (operation === 'append') {
          await client.appendFrom(localStream, remotePath);
          console.log(`[FTP] Fichier local ajouté à: ${remotePath} (from ${localPath})`);
        } else {
          await client.uploadFrom(localStream, remotePath);
          console.log(`[FTP] Fichier local uploadé: ${remotePath} (from ${localPath})`);
        }
        size = 0; // Could get actual size with fs.stat if needed
      } else {
        // Upload depuis contenu
        const content = params.content || transformedContent;
        const buffer = Buffer.from(content, 'utf-8');
        const stream = Readable.from(buffer);

        if (operation === 'append') {
          await client.appendFrom(stream, remotePath);
          console.log(`[FTP] Contenu ajouté à: ${remotePath} (${buffer.length} bytes)`);
        } else {
          await client.uploadFrom(stream, remotePath);
          console.log(`[FTP] Fichier uploadé: ${remotePath} (${buffer.length} bytes)`);
        }
        size = buffer.length;
      }

      return {
        success: true,
        data: {
          operation,
          remote_path: remotePath,
          local_path: params.local_path,
          size,
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
