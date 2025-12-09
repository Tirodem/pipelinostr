/**
 * S3 Handler - Upload de fichiers vers tout service S3-compatible
 * Compatible: AWS S3, MinIO, Backblaze B2, Wasabi, DigitalOcean Spaces, etc.
 */

import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import type { Handler, HandlerResult, HandlerConfig } from './handler.interface.js';

interface S3HandlerConfig {
  enabled: boolean;
  endpoint?: string | undefined; // Pour services non-AWS (MinIO, etc.)
  region: string;
  access_key_id: string;
  secret_access_key: string;
  bucket: string;
  force_path_style?: boolean | undefined; // true pour MinIO
  public_url_base?: string | undefined; // URL publique personnalisée
}

export interface S3ActionConfig extends HandlerConfig {
  operation?: 'put' | 'delete' | 'exists';
  key: string; // Chemin dans le bucket
  content?: string;
  content_type?: string;
  acl?: 'private' | 'public-read' | 'public-read-write' | 'authenticated-read';
  metadata?: Record<string, string>;
  cache_control?: string;
}

export class S3Handler implements Handler {
  readonly name = 'S3 Handler';
  readonly type = 's3';

  private config: S3HandlerConfig;
  private client: S3Client;

  constructor(config: S3HandlerConfig) {
    this.config = config;

    const clientConfig: {
      region: string;
      credentials: { accessKeyId: string; secretAccessKey: string };
      endpoint?: string;
      forcePathStyle?: boolean;
    } = {
      region: config.region || 'us-east-1',
      credentials: {
        accessKeyId: config.access_key_id,
        secretAccessKey: config.secret_access_key,
      },
    };

    // Pour les services S3-compatibles (MinIO, Backblaze, etc.)
    if (config.endpoint) {
      clientConfig.endpoint = config.endpoint;
    }

    if (config.force_path_style) {
      clientConfig.forcePathStyle = true;
    }

    this.client = new S3Client(clientConfig);
  }

  async initialize(): Promise<void> {
    // Test de connexion en vérifiant si le bucket existe
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.config.bucket,
          Key: '.pipelinostr-test',
        })
      );
    } catch (error) {
      // NotFound est OK, ça veut dire que le bucket est accessible
      const err = error as { name?: string };
      if (err.name !== 'NotFound' && err.name !== '404') {
        // Vérifier si c'est une vraie erreur d'accès
        if (err.name === 'AccessDenied' || err.name === 'NoSuchBucket') {
          throw error;
        }
      }
    }
    console.log(`[S3] Handler initialisé - Bucket: ${this.config.bucket}`);
  }

  async execute(config: HandlerConfig, context: Record<string, unknown>): Promise<HandlerResult> {
    const params = config as S3ActionConfig;
    const event = context.event as {
      id: string;
      pubkey: string;
      kind: number;
      created_at: number;
      content: string;
    };
    const transformedContent = (context.transformedContent as string) || event.content;

    const operation = params.operation || 'put';
    const key = this.resolveKey(params.key, event);

    try {
      switch (operation) {
        case 'put':
          return this.putObject(key, transformedContent, params);
        case 'delete':
          return this.deleteObject(key);
        case 'exists':
          return this.checkExists(key);
        default:
          return { success: false, error: `Opération inconnue: ${operation}` };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }

  private async putObject(
    key: string,
    content: string,
    params: S3ActionConfig
  ): Promise<HandlerResult> {
    const buffer = Buffer.from(content, 'utf-8');

    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      Body: buffer,
      ContentType: params.content_type || this.guessContentType(key),
      ACL: params.acl,
      Metadata: params.metadata,
      CacheControl: params.cache_control,
    });

    await this.client.send(command);

    // Construire l'URL publique
    let publicUrl: string;
    if (this.config.public_url_base) {
      publicUrl = `${this.config.public_url_base}/${key}`;
    } else if (this.config.endpoint) {
      publicUrl = `${this.config.endpoint}/${this.config.bucket}/${key}`;
    } else {
      publicUrl = `https://${this.config.bucket}.s3.${this.config.region}.amazonaws.com/${key}`;
    }

    console.log(`[S3] Fichier uploadé: ${key} (${buffer.length} bytes)`);

    return {
      success: true,
      data: {
        operation: 'put',
        bucket: this.config.bucket,
        key,
        size: buffer.length,
        url: publicUrl,
      },
    };
  }

  private async deleteObject(key: string): Promise<HandlerResult> {
    const command = new DeleteObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
    });

    await this.client.send(command);

    console.log(`[S3] Fichier supprimé: ${key}`);

    return {
      success: true,
      data: {
        operation: 'delete',
        bucket: this.config.bucket,
        key,
      },
    };
  }

  private async checkExists(key: string): Promise<HandlerResult> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
        })
      );

      return {
        success: true,
        data: {
          operation: 'exists',
          bucket: this.config.bucket,
          key,
          exists: true,
        },
      };
    } catch (error) {
      const err = error as { name?: string };
      if (err.name === 'NotFound' || err.name === '404') {
        return {
          success: true,
          data: {
            operation: 'exists',
            bucket: this.config.bucket,
            key,
            exists: false,
          },
        };
      }
      throw error;
    }
  }

  private resolveKey(
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
      .replace(/{kind}/g, event.kind.toString())
      .replace(/{year}/g, now.getFullYear().toString())
      .replace(/{month}/g, (now.getMonth() + 1).toString().padStart(2, '0'))
      .replace(/{day}/g, now.getDate().toString().padStart(2, '0'));
  }

  private guessContentType(key: string): string {
    const ext = key.split('.').pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      json: 'application/json',
      txt: 'text/plain',
      html: 'text/html',
      css: 'text/css',
      js: 'application/javascript',
      xml: 'application/xml',
      csv: 'text/csv',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      svg: 'image/svg+xml',
      pdf: 'application/pdf',
      zip: 'application/zip',
    };
    return mimeTypes[ext || ''] || 'application/octet-stream';
  }

  async shutdown(): Promise<void> {
    this.client.destroy();
    console.log('[S3] Handler arrêté');
  }
}
