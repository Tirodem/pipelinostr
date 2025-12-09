import { Relay } from 'nostr-tools/relay';
import { logger } from '../persistence/logger.js';

export interface HealthCheckResult {
  url: string;
  healthy: boolean;
  latencyMs?: number | undefined;
  error?: string | undefined;
}

export class HealthChecker {
  private timeoutMs: number;

  constructor(timeoutMs = 10000) {
    this.timeoutMs = timeoutMs;
  }

  async checkRelay(url: string): Promise<HealthCheckResult> {
    const startTime = Date.now();

    try {
      const relay = await this.connectWithTimeout(url);
      const latencyMs = Date.now() - startTime;

      // Close the connection after check
      relay.close();

      logger.debug({ url, latencyMs }, 'Relay health check passed');

      return {
        url,
        healthy: true,
        latencyMs,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.debug({ url, error: errorMessage }, 'Relay health check failed');

      return {
        url,
        healthy: false,
        error: errorMessage,
      };
    }
  }

  async checkMultipleRelays(urls: string[]): Promise<HealthCheckResult[]> {
    const results = await Promise.all(urls.map((url) => this.checkRelay(url)));
    return results;
  }

  private connectWithTimeout(url: string): Promise<Relay> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Connection timeout after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      Relay.connect(url)
        .then((relay) => {
          clearTimeout(timeout);
          resolve(relay);
        })
        .catch((error) => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }
}
