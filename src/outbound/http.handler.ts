import { logger } from '../persistence/logger.js';
import type { Handler, HandlerResult, HandlerConfig } from './handler.interface.js';

export interface HttpActionConfig extends HandlerConfig {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: string | Record<string, unknown>;
  timeout_ms?: number;
}

export class HttpHandler implements Handler {
  readonly name = 'HTTP Handler';
  readonly type = 'http';

  private defaultTimeout: number;

  constructor(options: { defaultTimeout?: number } = {}) {
    this.defaultTimeout = options.defaultTimeout ?? 30000;
  }

  async initialize(): Promise<void> {
    logger.info('HTTP handler initialized');
  }

  async execute(config: HandlerConfig, _context: Record<string, unknown>): Promise<HandlerResult> {
    const httpConfig = config as HttpActionConfig;

    if (!httpConfig.url) {
      return { success: false, error: 'Missing required field: url' };
    }

    const method = httpConfig.method ?? 'GET';
    const timeout = httpConfig.timeout_ms ?? this.defaultTimeout;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const headers: Record<string, string> = {
        'User-Agent': 'PipeliNostr/0.1.0',
        ...httpConfig.headers,
      };

      let body: string | undefined;
      if (httpConfig.body && method !== 'GET') {
        if (typeof httpConfig.body === 'object') {
          body = JSON.stringify(httpConfig.body);
          if (!headers['Content-Type']) {
            headers['Content-Type'] = 'application/json';
          }
        } else {
          body = httpConfig.body;
        }
      }

      const fetchOptions: RequestInit = {
        method,
        headers,
        signal: controller.signal,
      };

      if (body !== undefined) {
        fetchOptions.body = body;
      }

      const response = await fetch(httpConfig.url, fetchOptions);

      clearTimeout(timeoutId);

      // Read response body
      const contentType = response.headers.get('content-type') ?? '';
      let responseBody: unknown;

      if (contentType.includes('application/json')) {
        responseBody = await response.json();
      } else {
        responseBody = await response.text();
      }

      const success = response.ok;

      if (success) {
        logger.info(
          { url: httpConfig.url, method, status: response.status },
          'HTTP request successful'
        );
      } else {
        logger.warn(
          { url: httpConfig.url, method, status: response.status },
          'HTTP request failed'
        );
      }

      return {
        success,
        data: {
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          body: responseBody,
        },
        error: success ? undefined : `HTTP ${response.status}: ${response.statusText}`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.includes('abort')) {
        logger.error({ url: httpConfig.url, timeout }, 'HTTP request timed out');
        return { success: false, error: `Request timed out after ${timeout}ms` };
      }

      logger.error({ url: httpConfig.url, error: errorMessage }, 'HTTP request failed');
      return { success: false, error: errorMessage };
    }
  }

  async shutdown(): Promise<void> {
    logger.info('HTTP handler shut down');
  }
}
