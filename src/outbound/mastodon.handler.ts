import { logger } from '../persistence/logger.js';
import type { Handler, HandlerResult, HandlerConfig } from './handler.interface.js';

export interface MastodonHandlerOptions {
  // Instance URL (e.g., https://mastodon.social)
  instanceUrl: string;
  // Access token (OAuth2)
  accessToken: string;
}

export interface MastodonActionConfig extends HandlerConfig {
  // Status text (max 500 characters on most instances)
  status: string;
  // Visibility: public, unlisted, private, direct
  visibility?: 'public' | 'unlisted' | 'private' | 'direct' | undefined;
  // Content warning / spoiler text
  spoiler_text?: string | undefined;
  // Reply to status ID
  in_reply_to_id?: string | undefined;
  // Language code (ISO 639-1)
  language?: string | undefined;
  // Sensitive content flag
  sensitive?: boolean | undefined;
}

export class MastodonHandler implements Handler {
  readonly name = 'Mastodon Handler';
  readonly type = 'mastodon';

  private instanceUrl: string;
  private accessToken: string;

  constructor(options: MastodonHandlerOptions) {
    this.instanceUrl = options.instanceUrl.replace(/\/$/, '');
    this.accessToken = options.accessToken;
  }

  async initialize(): Promise<void> {
    // Verify credentials by fetching account info
    try {
      const response = await fetch(
        `${this.instanceUrl}/api/v1/accounts/verify_credentials`,
        {
          headers: { Authorization: `Bearer ${this.accessToken}` },
        }
      );

      if (!response.ok) {
        throw new Error('Invalid Mastodon access token');
      }

      const data = await response.json() as { username?: string; acct?: string };
      logger.info(
        { username: data.username, acct: data.acct, instance: this.instanceUrl },
        'Mastodon handler initialized'
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage }, 'Failed to initialize Mastodon handler');
      throw error;
    }
  }

  async execute(config: HandlerConfig, _context: Record<string, unknown>): Promise<HandlerResult> {
    const mastodonConfig = config as MastodonActionConfig;

    if (!mastodonConfig.status) {
      return { success: false, error: 'Missing required field: status' };
    }

    try {
      const formData = new URLSearchParams();
      formData.append('status', mastodonConfig.status);

      if (mastodonConfig.visibility) {
        formData.append('visibility', mastodonConfig.visibility);
      }

      if (mastodonConfig.spoiler_text) {
        formData.append('spoiler_text', mastodonConfig.spoiler_text);
      }

      if (mastodonConfig.in_reply_to_id) {
        formData.append('in_reply_to_id', mastodonConfig.in_reply_to_id);
      }

      if (mastodonConfig.language) {
        formData.append('language', mastodonConfig.language);
      }

      if (mastodonConfig.sensitive !== undefined) {
        formData.append('sensitive', String(mastodonConfig.sensitive));
      }

      const response = await fetch(`${this.instanceUrl}/api/v1/statuses`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
      });

      if (!response.ok) {
        const errorData = await response.json() as { error?: string };
        const errorMsg = errorData.error ?? 'Unknown error';
        logger.error({ error: errorMsg }, 'Failed to post Mastodon status');
        return { success: false, error: errorMsg };
      }

      const result = await response.json() as { id?: string; uri?: string; url?: string };

      logger.info({ statusId: result.id, url: result.url }, 'Mastodon status posted successfully');

      return {
        success: true,
        data: {
          status_id: result.id,
          uri: result.uri,
          url: result.url,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage }, 'Failed to post Mastodon status');
      return { success: false, error: errorMessage };
    }
  }

  async shutdown(): Promise<void> {
    logger.info('Mastodon handler shut down');
  }
}
