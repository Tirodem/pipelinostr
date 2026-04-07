/**
 * Webhook inbound server (ADR-012, ADR-013)
 *
 * HTTP server that receives webhooks and converts them to NormalizedEvent.
 * Fixed HMAC validation with crypto.timingSafeEqual (devB feedback).
 * Secrets never leak into event objects (devB feedback).
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import crypto from 'node:crypto';
import type { Logger } from 'pino';
import type { NormalizedEvent } from '../core/types.js';
import { Secret } from '../config/secrets.js';

export type WebhookEventHandler = (event: NormalizedEvent) => void | Promise<void>;

export interface WebhookServerConfig {
  port: number;
  host?: string | undefined;
  secret?: string | Secret | undefined;
  cors_origin?: string | undefined;
}

export class WebhookInboundServer {
  private server: ReturnType<typeof createServer> | null = null;
  private handlers: WebhookEventHandler[] = [];
  private secret: string | null;
  private corsOrigin: string;

  constructor(
    private config: WebhookServerConfig,
    private logger: Logger,
  ) {
    this.secret = config.secret
      ? (config.secret instanceof Secret ? config.secret.unwrap() : config.secret)
      : null;
    // CORS: single origin or *, not comma-separated (devB feedback)
    this.corsOrigin = config.cors_origin ?? '*';
  }

  onEvent(handler: WebhookEventHandler): void {
    this.handlers.push(handler);
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      this.handleRequest(req, res);
    });

    const host = this.config.host ?? '0.0.0.0';
    const port = this.config.port;

    return new Promise((resolve) => {
      this.server!.listen(port, host, () => {
        this.logger.info({ host, port }, 'Webhook server started');
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    return new Promise((resolve) => {
      this.server!.close(() => {
        this.logger.info('Webhook server stopped');
        resolve();
      });
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // CORS headers (single origin, per spec — devB feedback)
    res.setHeader('Access-Control-Allow-Origin', this.corsOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Hub-Signature-256');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    // Read body
    const body = await this.readBody(req);

    // HMAC validation (devB feedback: proper hash comparison, not ===)
    if (this.secret) {
      const signature = req.headers['x-hub-signature-256'] as string | undefined;
      if (!this.verifyHmac(body, signature)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid signature' }));
        return;
      }
    }

    // Parse body
    let data: unknown;
    try {
      data = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }

    // Build NormalizedEvent — secret NEVER included (devB feedback)
    const event: NormalizedEvent = {
      source: 'webhook.post',
      origin: 'webhook',
      type: 'post',
      sender: req.headers['x-forwarded-for'] as string ?? req.socket.remoteAddress ?? 'unknown',
      content: typeof data === 'object' && data !== null && 'content' in data
        ? String((data as Record<string, unknown>).content)
        : body,
      timestamp: Math.floor(Date.now() / 1000),
      metadata: {
        path: req.url,
        method: req.method,
        headers: this.sanitizeHeaders(req.headers),
        body: data,
        secretVerified: this.secret !== null, // Boolean only, never the secret itself
      },
      raw: data,
    };

    // Respond immediately
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));

    // Process asynchronously
    for (const handler of this.handlers) {
      try { await handler(event); }
      catch (err) { this.logger.error({ error: (err as Error).message }, 'Webhook handler error'); }
    }
  }

  /**
   * HMAC verification — fixed per devB feedback.
   * Uses crypto.timingSafeEqual to prevent timing side-channel attacks.
   */
  private verifyHmac(body: string, signature: string | undefined): boolean {
    if (!signature || !this.secret) return false;

    // Signature format: sha256=<hex>
    const parts = signature.split('=');
    if (parts.length !== 2 || parts[0] !== 'sha256') return false;

    const expected = crypto
      .createHmac('sha256', this.secret)
      .update(body)
      .digest('hex');

    const provided = parts[1]!;

    // Timing-safe comparison (devB feedback: prevents length leak)
    if (expected.length !== provided.length) return false;
    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(provided),
    );
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks).toString()));
      req.on('error', reject);
    });
  }

  private sanitizeHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
    const safe: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      // Skip auth/secret headers
      if (key.toLowerCase().includes('authorization') || key.toLowerCase().includes('secret')) continue;
      safe[key] = Array.isArray(value) ? value.join(', ') : (value ?? '');
    }
    return safe;
  }
}
