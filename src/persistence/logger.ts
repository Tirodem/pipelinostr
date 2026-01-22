import pino from 'pino';

export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  },
});

/**
 * Set the logger level dynamically (called after config is loaded)
 */
export function setLogLevel(level: 'debug' | 'info' | 'warn' | 'error'): void {
  logger.level = level;
}

export type Logger = typeof logger;
