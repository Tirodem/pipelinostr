import { logger } from '../persistence/logger.js';

export interface RetryConfig {
  maxAttempts: number;
  backoff: {
    type: 'exponential' | 'linear' | 'fixed';
    initialDelayMs: number;
    multiplier?: number | undefined;
    maxDelayMs: number;
  };
}

export const defaultRetryConfig: RetryConfig = {
  maxAttempts: 5,
  backoff: {
    type: 'exponential',
    initialDelayMs: 1000,
    multiplier: 2,
    maxDelayMs: 60000,
  },
};

function calculateDelay(attempt: number, config: RetryConfig['backoff']): number {
  let delay: number;

  switch (config.type) {
    case 'exponential':
      delay = config.initialDelayMs * Math.pow(config.multiplier ?? 2, attempt - 1);
      break;
    case 'linear':
      delay = config.initialDelayMs * attempt;
      break;
    case 'fixed':
    default:
      delay = config.initialDelayMs;
  }

  return Math.min(delay, config.maxDelayMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = defaultRetryConfig,
  operationName = 'operation'
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === config.maxAttempts) {
        logger.error(
          { error: lastError.message, attempt, maxAttempts: config.maxAttempts },
          `${operationName} failed after all retry attempts`
        );
        throw lastError;
      }

      const delay = calculateDelay(attempt, config.backoff);
      logger.warn(
        { error: lastError.message, attempt, nextRetryMs: delay },
        `${operationName} failed, retrying...`
      );

      await sleep(delay);
    }
  }

  throw lastError;
}
