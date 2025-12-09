import { logger } from '../persistence/logger.js';

export interface QuarantineThreshold {
  failures: number;
  duration: string;
}

export interface QuarantineConfig {
  enabled: boolean;
  thresholds: QuarantineThreshold[];
  maxQuarantineDuration: string;
  healthCheckInterval: string;
}

const DEFAULT_THRESHOLDS: QuarantineThreshold[] = [
  { failures: 1, duration: '15m' },
  { failures: 2, duration: '2h' },
  { failures: 3, duration: '6h' },
  { failures: 4, duration: '24h' },
  { failures: 5, duration: '2d' },
  { failures: 6, duration: '4d' },
  { failures: 7, duration: '1w' },
  { failures: 8, duration: '2w' },
];

export class QuarantineManager {
  private config: QuarantineConfig;

  constructor(config?: Partial<QuarantineConfig>) {
    this.config = {
      enabled: config?.enabled ?? true,
      thresholds: config?.thresholds ?? DEFAULT_THRESHOLDS,
      maxQuarantineDuration: config?.maxQuarantineDuration ?? '6M',
      healthCheckInterval: config?.healthCheckInterval ?? '30d',
    };
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  calculateQuarantineEnd(consecutiveFailures: number): Date | undefined {
    if (!this.config.enabled) {
      return undefined;
    }

    const threshold = this.config.thresholds.find((t) => t.failures === consecutiveFailures);
    if (!threshold) {
      // Beyond defined thresholds - use max duration
      if (consecutiveFailures > this.config.thresholds.length) {
        return this.addDuration(new Date(), this.config.maxQuarantineDuration);
      }
      return undefined;
    }

    return this.addDuration(new Date(), threshold.duration);
  }

  getQuarantineLevel(consecutiveFailures: number): number {
    return Math.min(consecutiveFailures, this.config.thresholds.length + 1);
  }

  shouldAbandon(consecutiveFailures: number, firstFailureDate: Date): boolean {
    // Abandon after max quarantine duration from first failure
    const maxDurationMs = this.parseDuration(this.config.maxQuarantineDuration);
    const timeSinceFirstFailure = Date.now() - firstFailureDate.getTime();
    return timeSinceFirstFailure > maxDurationMs;
  }

  getHealthCheckInterval(): number {
    return this.parseDuration(this.config.healthCheckInterval);
  }

  private addDuration(date: Date, duration: string): Date {
    const ms = this.parseDuration(duration);
    return new Date(date.getTime() + ms);
  }

  private parseDuration(duration: string): number {
    const match = duration.match(/^(\d+)(s|m|h|d|w|M)$/);
    if (!match) {
      logger.warn({ duration }, 'Invalid duration format, defaulting to 1 hour');
      return 60 * 60 * 1000;
    }

    const value = parseInt(match[1] as string, 10);
    const unit = match[2];

    switch (unit) {
      case 's':
        return value * 1000;
      case 'm':
        return value * 60 * 1000;
      case 'h':
        return value * 60 * 60 * 1000;
      case 'd':
        return value * 24 * 60 * 60 * 1000;
      case 'w':
        return value * 7 * 24 * 60 * 60 * 1000;
      case 'M':
        return value * 30 * 24 * 60 * 60 * 1000;
      default:
        return 60 * 60 * 1000;
    }
  }
}
