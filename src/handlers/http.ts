/**
 * HTTP handler (v2)
 *
 * Makes REST API calls with template-rendered URLs, headers, body.
 */

import { z } from 'zod';
import { BaseHandler, type HandlerResult, type ActionContext } from './base.js';

export class HttpHandler extends BaseHandler {
  static type = 'http';
  static configSchema = z.object({
    enabled: z.boolean().optional(),
  });

  readonly name = 'HTTP';
  readonly type = 'http';

  async initialize(_config: Record<string, unknown>): Promise<void> {}

  async execute(action: Record<string, unknown>, _context: ActionContext): Promise<HandlerResult> {
    const url = action.url as string;
    if (!url) return { success: false, error: 'Missing "url" field' };

    const method = ((action.method as string) ?? 'GET').toUpperCase();

    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(action.headers as Record<string, string> ?? {}),
    };

    // Build body
    const fetchInit: RequestInit = { method, headers };

    if (action.body !== undefined && method !== 'GET') {
      fetchInit.body = typeof action.body === 'string'
        ? action.body
        : JSON.stringify(action.body);
    }

    try {
      const response = await fetch(url, fetchInit);

      const responseText = await response.text();
      let responseData: unknown;
      try {
        responseData = JSON.parse(responseText);
      } catch {
        responseData = responseText;
      }

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${responseText.slice(0, 200)}`,
          data: {
            status: response.status,
            response: responseData,
          },
        };
      }

      return {
        success: true,
        data: {
          status: response.status,
          response: responseData,
        },
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async shutdown(): Promise<void> {}
}
