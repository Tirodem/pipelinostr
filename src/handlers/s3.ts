/**
 * S3 handler (v2)
 *
 * Uploads objects to S3-compatible storage (AWS, MinIO, etc.).
 * Optional dependency: @aws-sdk/client-s3
 */

import { z } from 'zod';
import { BaseHandler, type HandlerResult, type ActionContext } from './base.js';
import { Secret } from '../config/secrets.js';

export class S3Handler extends BaseHandler {
  static type = 's3';
  static configSchema = z.object({
    endpoint: z.string().optional(),
    region: z.string().optional(),
    access_key_id: z.union([z.string(), z.instanceof(Secret)]),
    secret_access_key: z.union([z.string(), z.instanceof(Secret)]),
    bucket: z.string(),
    enabled: z.boolean().optional(),
  });

  readonly name = 'S3';
  readonly type = 's3';

  private s3Client: unknown = null;
  private bucket = '';

  async initialize(config: Record<string, unknown>): Promise<void> {
    const { S3Client } = await import('@aws-sdk/client-s3');

    const accessKeyId = config.access_key_id instanceof Secret
      ? (config.access_key_id as Secret).unwrap()
      : config.access_key_id as string;
    const secretAccessKey = config.secret_access_key instanceof Secret
      ? (config.secret_access_key as Secret).unwrap()
      : config.secret_access_key as string;

    const options: Record<string, unknown> = {
      region: (config.region as string) ?? 'us-east-1',
      credentials: { accessKeyId, secretAccessKey },
    };
    if (config.endpoint) {
      options.endpoint = config.endpoint;
      options.forcePathStyle = true;
    }

    this.s3Client = new S3Client(options);
    this.bucket = config.bucket as string;
  }

  async execute(action: Record<string, unknown>, _context: ActionContext): Promise<HandlerResult> {
    if (!this.s3Client) return { success: false, error: 'S3 not initialized' };

    const key = action.key as string;
    if (!key) return { success: false, error: 'Missing "key" field' };

    const content = action.content as string ?? '';
    const contentType = (action.content_type as string) ?? 'text/plain';
    const bucket = (action.bucket as string) ?? this.bucket;

    try {
      const { PutObjectCommand } = await import('@aws-sdk/client-s3');
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: content,
        ContentType: contentType,
      });

      const client = this.s3Client as { send: (cmd: unknown) => Promise<unknown> };
      await client.send(command);
      return { success: true, data: { bucket, key, content_type: contentType } };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async shutdown(): Promise<void> {
    if (this.s3Client) {
      (this.s3Client as { destroy: () => void }).destroy();
      this.s3Client = null;
    }
  }
}
