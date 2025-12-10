/**
 * Webhook Server - Serveur HTTP pour recevoir des webhooks entrants
 * Permet de déclencher des workflows via des requêtes HTTP externes
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';
import { parse as parseUrl } from 'url';
import { logger } from '../persistence/logger.js';

export interface WebhookEvent {
  // Metadata
  id: string;
  source: 'webhook';
  timestamp: number;

  // Request info
  method: string;
  path: string;
  query: Record<string, string | string[] | undefined>;
  headers: Record<string, string | string[] | undefined>;

  // Body
  body: unknown;
  rawBody: string;

  // Webhook specific
  webhookId: string;
  secret?: string | undefined;
}

export type WebhookCallback = (event: WebhookEvent) => void | Promise<void>;

export interface WebhookConfig {
  id: string;
  path: string;
  methods?: string[] | undefined;
  secret?: string | undefined;
  description?: string | undefined;
}

export interface WebhookServerConfig {
  enabled: boolean;
  port?: number | undefined;
  host?: string | undefined;
  webhooks?: WebhookConfig[] | undefined;
  cors?: {
    enabled?: boolean | undefined;
    origins?: string[] | undefined;
  } | undefined;
  max_body_size?: number | undefined;
}

export class WebhookServer {
  private config: WebhookServerConfig;
  private server: Server | null = null;
  private webhooks: Map<string, WebhookConfig> = new Map();
  private callbacks: WebhookCallback[] = [];
  private eventCounter = 0;

  constructor(config: WebhookServerConfig) {
    this.config = config;

    // Index webhooks by path
    if (config.webhooks) {
      for (const webhook of config.webhooks) {
        this.webhooks.set(webhook.path, webhook);
      }
    }
  }

  onWebhook(callback: WebhookCallback): void {
    this.callbacks.push(callback);
  }

  async start(): Promise<void> {
    if (!this.config.enabled) {
      logger.debug('Webhook server disabled');
      return;
    }

    const port = this.config.port || 3000;
    const host = this.config.host || '0.0.0.0';

    this.server = createServer((req, res) => {
      this.handleRequest(req, res);
    });

    return new Promise((resolve, reject) => {
      this.server!.listen(port, host, () => {
        logger.info({ port, host, webhooks: this.webhooks.size }, '[Webhook] Server started');
        resolve();
      });

      this.server!.on('error', (err) => {
        logger.error({ error: err.message }, '[Webhook] Server error');
        reject(err);
      });
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // CORS preflight
    if (this.config.cors?.enabled && req.method === 'OPTIONS') {
      this.setCorsHeaders(res);
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = parseUrl(req.url || '/', true);
    const path = parsedUrl.pathname || '/';
    const method = req.method || 'GET';

    // Find matching webhook
    const webhook = this.findWebhook(path);

    if (!webhook) {
      this.sendError(res, 404, 'Webhook not found');
      return;
    }

    // Check method
    if (webhook.methods && !webhook.methods.includes(method)) {
      this.sendError(res, 405, 'Method not allowed');
      return;
    }

    // Read body
    let rawBody = '';
    const maxSize = this.config.max_body_size || 1024 * 1024; // 1MB default

    try {
      rawBody = await this.readBody(req, maxSize);
    } catch (err) {
      this.sendError(res, 413, 'Request body too large');
      return;
    }

    // Parse body
    let body: unknown = rawBody;
    const contentType = req.headers['content-type'] || '';

    if (contentType.includes('application/json')) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        this.sendError(res, 400, 'Invalid JSON body');
        return;
      }
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      body = Object.fromEntries(new URLSearchParams(rawBody));
    }

    // Validate secret if configured
    if (webhook.secret) {
      const providedSecret = this.extractSecret(req, rawBody);
      if (providedSecret !== webhook.secret) {
        this.sendError(res, 401, 'Invalid webhook secret');
        return;
      }
    }

    // Build event
    const event: WebhookEvent = {
      id: `webhook_${Date.now()}_${++this.eventCounter}`,
      source: 'webhook',
      timestamp: Date.now(),
      method,
      path,
      query: parsedUrl.query as Record<string, string | string[] | undefined>,
      headers: req.headers as Record<string, string | string[] | undefined>,
      body,
      rawBody,
      webhookId: webhook.id,
      secret: webhook.secret,
    };

    // Process callbacks
    try {
      for (const callback of this.callbacks) {
        await callback(event);
      }

      // Set CORS headers
      if (this.config.cors?.enabled) {
        this.setCorsHeaders(res);
      }

      // Success response
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        id: event.id,
        received_at: new Date().toISOString(),
      }));

      logger.info(
        { webhookId: webhook.id, eventId: event.id, method, path },
        '[Webhook] Event received'
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage, webhookId: webhook.id }, '[Webhook] Processing error');
      this.sendError(res, 500, 'Internal server error');
    }
  }

  private findWebhook(path: string): WebhookConfig | undefined {
    // Exact match
    if (this.webhooks.has(path)) {
      return this.webhooks.get(path);
    }

    // Wildcard match
    for (const [webhookPath, webhook] of this.webhooks) {
      if (webhookPath.endsWith('/*')) {
        const prefix = webhookPath.slice(0, -1);
        if (path.startsWith(prefix)) {
          return webhook;
        }
      }
    }

    // Default webhook for any path (if defined)
    if (this.webhooks.has('/*')) {
      return this.webhooks.get('/*');
    }

    return undefined;
  }

  private readBody(req: IncomingMessage, maxSize: number): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = '';
      let size = 0;

      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxSize) {
          req.destroy();
          reject(new Error('Body too large'));
          return;
        }
        body += chunk.toString();
      });

      req.on('end', () => resolve(body));
      req.on('error', reject);
    });
  }

  private extractSecret(req: IncomingMessage, body: string): string | undefined {
    // Check X-Webhook-Secret header
    const headerSecret = req.headers['x-webhook-secret'];
    if (headerSecret) {
      return Array.isArray(headerSecret) ? headerSecret[0] : headerSecret;
    }

    // Check Authorization header (Bearer token)
    const auth = req.headers['authorization'];
    if (auth && typeof auth === 'string' && auth.startsWith('Bearer ')) {
      return auth.slice(7);
    }

    // Check X-Hub-Signature-256 (GitHub style)
    const hubSignature = req.headers['x-hub-signature-256'];
    if (hubSignature) {
      // For GitHub, we'd need to verify HMAC - for now return the signature
      return Array.isArray(hubSignature) ? hubSignature[0] : hubSignature;
    }

    return undefined;
  }

  private setCorsHeaders(res: ServerResponse): void {
    const origins = this.config.cors?.origins || ['*'];
    res.setHeader('Access-Control-Allow-Origin', origins.join(', '));
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Webhook-Secret');
    res.setHeader('Access-Control-Max-Age', '86400');
  }

  private sendError(res: ServerResponse, status: number, message: string): void {
    if (this.config.cors?.enabled) {
      this.setCorsHeaders(res);
    }
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: message }));
  }

  getWebhooks(): WebhookConfig[] {
    return Array.from(this.webhooks.values());
  }

  async shutdown(): Promise<void> {
    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => {
          logger.info('[Webhook] Server stopped');
          resolve();
        });
      });
    }
  }
}
