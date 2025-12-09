import { logger } from '../persistence/logger.js';
import type { Handler, HandlerResult, HandlerConfig } from './handler.interface.js';

export interface NtfyHandlerOptions {
  // Default ntfy server (default: https://ntfy.sh)
  serverUrl?: string | undefined;
  // Default topic
  defaultTopic?: string | undefined;
  // Default auth token (if using private topics)
  authToken?: string | undefined;
}

export interface NtfyActionConfig extends HandlerConfig {
  // Topic to publish to (required if no default)
  topic?: string | undefined;
  // Message content
  message: string;
  // Optional title
  title?: string | undefined;
  // Priority: 1=min, 2=low, 3=default, 4=high, 5=urgent
  priority?: 1 | 2 | 3 | 4 | 5 | undefined;
  // Tags (emoji shortcodes)
  tags?: string[] | undefined;
  // Click URL
  click?: string | undefined;
  // Attachment URL
  attach?: string | undefined;
  // Actions (buttons)
  actions?: Array<{
    action: 'view' | 'broadcast' | 'http';
    label: string;
    url?: string | undefined;
    clear?: boolean | undefined;
  }> | undefined;
}

export class NtfyHandler implements Handler {
  readonly name = 'Ntfy Handler';
  readonly type = 'ntfy';

  private serverUrl: string;
  private defaultTopic?: string | undefined;
  private authToken?: string | undefined;

  constructor(options: NtfyHandlerOptions = {}) {
    this.serverUrl = (options.serverUrl ?? 'https://ntfy.sh').replace(/\/$/, '');
    this.defaultTopic = options.defaultTopic;
    this.authToken = options.authToken;
  }

  async initialize(): Promise<void> {
    logger.info({ serverUrl: this.serverUrl }, 'Ntfy handler initialized');
  }

  async execute(config: HandlerConfig, _context: Record<string, unknown>): Promise<HandlerResult> {
    const ntfyConfig = config as NtfyActionConfig;

    const topic = ntfyConfig.topic ?? this.defaultTopic;
    if (!topic) {
      return { success: false, error: 'Missing required field: topic' };
    }

    if (!ntfyConfig.message) {
      return { success: false, error: 'Missing required field: message' };
    }

    try {
      const headers: Record<string, string> = {};

      if (ntfyConfig.title) {
        headers['Title'] = ntfyConfig.title;
      }

      if (ntfyConfig.priority) {
        headers['Priority'] = String(ntfyConfig.priority);
      }

      if (ntfyConfig.tags && ntfyConfig.tags.length > 0) {
        headers['Tags'] = ntfyConfig.tags.join(',');
      }

      if (ntfyConfig.click) {
        headers['Click'] = ntfyConfig.click;
      }

      if (ntfyConfig.attach) {
        headers['Attach'] = ntfyConfig.attach;
      }

      if (ntfyConfig.actions && ntfyConfig.actions.length > 0) {
        const actionsStr = ntfyConfig.actions
          .map((a) => {
            let str = `${a.action}, ${a.label}`;
            if (a.url) str += `, ${a.url}`;
            if (a.clear) str += ', clear=true';
            return str;
          })
          .join('; ');
        headers['Actions'] = actionsStr;
      }

      if (this.authToken) {
        headers['Authorization'] = `Bearer ${this.authToken}`;
      }

      const response = await fetch(`${this.serverUrl}/${topic}`, {
        method: 'POST',
        headers,
        body: ntfyConfig.message,
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error({ topic, status: response.status, error: errorText }, 'Failed to send ntfy notification');
        return { success: false, error: `HTTP ${response.status}: ${errorText}` };
      }

      const result = await response.json() as { id?: string };

      logger.info({ topic, messageId: result.id }, 'Ntfy notification sent successfully');

      return {
        success: true,
        data: {
          id: result.id,
          topic,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ topic, error: errorMessage }, 'Failed to send ntfy notification');
      return { success: false, error: errorMessage };
    }
  }

  async shutdown(): Promise<void> {
    logger.info('Ntfy handler shut down');
  }
}
