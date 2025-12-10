/**
 * Traccar SMS Gateway Handler
 * Sends SMS via Traccar SMS Gateway Android app
 * API docs: https://www.traccar.org/sms-gateway/
 */

import { logger } from '../persistence/logger.js';
import type { Handler, HandlerResult, HandlerConfig } from './handler.interface.js';

export interface TraccarSmsHandlerOptions {
  // Gateway URL (from Traccar SMS Gateway app, or https://www.traccar.org/sms/ for cloud)
  gatewayUrl: string;
  // API token or authorization key
  token: string;
  // Optional: default sender ID (if supported by gateway)
  defaultSender?: string | undefined;
}

export interface TraccarSmsActionConfig extends HandlerConfig {
  // Recipient phone number(s) - comma-separated or array
  to: string | string[];
  // Message content
  message: string;
}

export class TraccarSmsHandler implements Handler {
  readonly name = 'Traccar SMS Gateway Handler';
  readonly type = 'traccar_sms';

  private gatewayUrl: string;
  private token: string;
  private defaultSender?: string | undefined;

  constructor(options: TraccarSmsHandlerOptions) {
    this.gatewayUrl = options.gatewayUrl.replace(/\/$/, ''); // Remove trailing slash
    this.token = options.token;
    this.defaultSender = options.defaultSender;
  }

  async initialize(): Promise<void> {
    // Validate configuration
    if (!this.gatewayUrl) {
      throw new Error('Traccar SMS Gateway URL is required');
    }
    if (!this.token) {
      throw new Error('Traccar SMS Gateway token is required');
    }

    logger.info(
      { gatewayUrl: this.gatewayUrl },
      'Traccar SMS handler initialized'
    );
  }

  async execute(config: HandlerConfig, _context: Record<string, unknown>): Promise<HandlerResult> {
    const smsConfig = config as TraccarSmsActionConfig;

    if (!smsConfig.to) {
      return { success: false, error: 'Missing required field: to (phone number)' };
    }

    if (!smsConfig.message) {
      return { success: false, error: 'Missing required field: message' };
    }

    // Parse recipients - support comma-separated string or array
    const recipients = this.parseRecipients(smsConfig.to);

    if (recipients.length === 0) {
      return { success: false, error: 'No valid phone numbers provided' };
    }

    // Send to all recipients
    const results = await Promise.allSettled(
      recipients.map((phone) => this.sendSms(phone, smsConfig.message))
    );

    // Collect results
    const successful: string[] = [];
    const failed: Array<{ phone: string; error: string }> = [];

    results.forEach((result, index) => {
      const phone = recipients[index];
      if (!phone) return;

      if (result.status === 'fulfilled' && result.value.success) {
        successful.push(phone);
      } else {
        const error = result.status === 'rejected'
          ? String(result.reason)
          : result.value.error || 'Unknown error';
        failed.push({ phone, error });
      }
    });

    // Log results
    if (successful.length > 0) {
      logger.info(
        { recipients: successful, count: successful.length },
        'SMS sent successfully'
      );
    }

    if (failed.length > 0) {
      logger.error(
        { failed },
        'Some SMS failed to send'
      );
    }

    // Return overall result
    const allSuccess = failed.length === 0;
    return {
      success: allSuccess,
      error: allSuccess ? undefined : `Failed to send to: ${failed.map(f => f.phone).join(', ')}`,
      data: {
        successful,
        failed,
        totalSent: successful.length,
        totalFailed: failed.length,
      },
    };
  }

  private parseRecipients(to: string | string[]): string[] {
    let phones: string[];

    if (Array.isArray(to)) {
      phones = to;
    } else {
      // Split by comma, semicolon, or space
      phones = to.split(/[,;\s]+/);
    }

    // Clean and validate phone numbers
    return phones
      .map((phone) => phone.trim())
      .filter((phone) => phone.length > 0)
      .map((phone) => this.normalizePhone(phone));
  }

  private normalizePhone(phone: string): string {
    // Remove spaces, dashes, parentheses
    let normalized = phone.replace(/[\s\-\(\)]/g, '');

    // Ensure it starts with + for international format
    if (!normalized.startsWith('+') && !normalized.startsWith('00')) {
      // Assume it needs a + prefix if it looks like an international number
      if (normalized.length > 10) {
        normalized = '+' + normalized;
      }
    }

    return normalized;
  }

  private async sendSms(phone: string, message: string): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(this.gatewayUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': this.token,
        },
        body: JSON.stringify({
          to: phone,
          message: message,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(
          { phone, status: response.status, error: errorText },
          'Traccar SMS API error'
        );
        return { success: false, error: `HTTP ${response.status}: ${errorText}` };
      }

      // Try to parse response
      const contentType = response.headers.get('content-type') || '';
      let responseData: unknown = null;

      if (contentType.includes('application/json')) {
        try {
          responseData = await response.json();
        } catch {
          // Ignore JSON parse errors
        }
      }

      logger.debug(
        { phone, response: responseData },
        'SMS sent to Traccar gateway'
      );

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(
        { phone, error: errorMessage },
        'Failed to send SMS via Traccar'
      );
      return { success: false, error: errorMessage };
    }
  }

  async shutdown(): Promise<void> {
    logger.info('Traccar SMS handler shut down');
  }
}
