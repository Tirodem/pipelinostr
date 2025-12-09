import { createHmac, randomBytes } from 'node:crypto';
import { logger } from '../persistence/logger.js';
import type { Handler, HandlerResult, HandlerConfig } from './handler.interface.js';

export interface TwitterHandlerOptions {
  // OAuth 1.0a credentials
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

export interface TwitterActionConfig extends HandlerConfig {
  // Tweet text (max 280 characters)
  text: string;
  // Reply to tweet ID (optional)
  reply_to?: string | undefined;
  // Quote tweet ID (optional)
  quote_tweet_id?: string | undefined;
}

export class TwitterHandler implements Handler {
  readonly name = 'Twitter/X Handler';
  readonly type = 'twitter';

  private apiKey: string;
  private apiSecret: string;
  private accessToken: string;
  private accessTokenSecret: string;

  constructor(options: TwitterHandlerOptions) {
    this.apiKey = options.apiKey;
    this.apiSecret = options.apiSecret;
    this.accessToken = options.accessToken;
    this.accessTokenSecret = options.accessTokenSecret;
  }

  async initialize(): Promise<void> {
    // Verify credentials by fetching user info
    try {
      const response = await this.makeRequest(
        'GET',
        'https://api.twitter.com/2/users/me',
        {}
      );

      if (!response.ok) {
        throw new Error('Invalid Twitter credentials');
      }

      const data = await response.json() as { data?: { username?: string } };
      logger.info({ username: data.data?.username }, 'Twitter handler initialized');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage }, 'Failed to initialize Twitter handler');
      throw error;
    }
  }

  async execute(config: HandlerConfig, _context: Record<string, unknown>): Promise<HandlerResult> {
    const twitterConfig = config as TwitterActionConfig;

    if (!twitterConfig.text) {
      return { success: false, error: 'Missing required field: text' };
    }

    if (twitterConfig.text.length > 280) {
      return { success: false, error: 'Tweet text exceeds 280 characters' };
    }

    try {
      const payload: Record<string, unknown> = {
        text: twitterConfig.text,
      };

      if (twitterConfig.reply_to) {
        payload.reply = { in_reply_to_tweet_id: twitterConfig.reply_to };
      }

      if (twitterConfig.quote_tweet_id) {
        payload.quote_tweet_id = twitterConfig.quote_tweet_id;
      }

      const response = await this.makeRequest(
        'POST',
        'https://api.twitter.com/2/tweets',
        payload
      );

      if (!response.ok) {
        const errorData = await response.json() as { detail?: string; errors?: Array<{ message: string }> };
        const errorMsg = errorData.detail ?? errorData.errors?.[0]?.message ?? 'Unknown error';
        logger.error({ error: errorMsg }, 'Failed to post tweet');
        return { success: false, error: errorMsg };
      }

      const result = await response.json() as { data?: { id?: string; text?: string } };

      logger.info({ tweetId: result.data?.id }, 'Tweet posted successfully');

      return {
        success: true,
        data: {
          tweet_id: result.data?.id,
          text: result.data?.text,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage }, 'Failed to post tweet');
      return { success: false, error: errorMessage };
    }
  }

  private async makeRequest(
    method: string,
    url: string,
    body: Record<string, unknown>
  ): Promise<Response> {
    const oauthParams = this.generateOAuthParams(method, url);

    const headers: Record<string, string> = {
      Authorization: this.buildAuthHeader(oauthParams),
      'Content-Type': 'application/json',
    };

    const fetchOptions: RequestInit = {
      method,
      headers,
    };

    if (method !== 'GET' && Object.keys(body).length > 0) {
      fetchOptions.body = JSON.stringify(body);
    }

    return fetch(url, fetchOptions);
  }

  private generateOAuthParams(method: string, url: string): Record<string, string> {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = randomBytes(16).toString('hex');

    const oauthParams: Record<string, string> = {
      oauth_consumer_key: this.apiKey,
      oauth_token: this.accessToken,
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: timestamp,
      oauth_nonce: nonce,
      oauth_version: '1.0',
    };

    // Generate signature
    const signature = this.generateSignature(method, url, oauthParams);
    oauthParams.oauth_signature = signature;

    return oauthParams;
  }

  private generateSignature(
    method: string,
    url: string,
    oauthParams: Record<string, string>
  ): string {
    // Sort and encode parameters
    const sortedParams = Object.keys(oauthParams)
      .sort()
      .map((key) => `${this.percentEncode(key)}=${this.percentEncode(oauthParams[key] as string)}`)
      .join('&');

    // Create signature base string
    const signatureBase = [
      method.toUpperCase(),
      this.percentEncode(url),
      this.percentEncode(sortedParams),
    ].join('&');

    // Create signing key
    const signingKey = `${this.percentEncode(this.apiSecret)}&${this.percentEncode(this.accessTokenSecret)}`;

    // Generate HMAC-SHA1 signature
    const hmac = createHmac('sha1', signingKey);
    hmac.update(signatureBase);
    return hmac.digest('base64');
  }

  private buildAuthHeader(oauthParams: Record<string, string>): string {
    const headerParams = Object.keys(oauthParams)
      .sort()
      .map((key) => `${this.percentEncode(key)}="${this.percentEncode(oauthParams[key] as string)}"`)
      .join(', ');

    return `OAuth ${headerParams}`;
  }

  private percentEncode(str: string): string {
    return encodeURIComponent(str)
      .replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  }

  async shutdown(): Promise<void> {
    logger.info('Twitter handler shut down');
  }
}
