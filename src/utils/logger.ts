/**
 * Pino logger setup.
 */

import pino from 'pino';

export function createLogger(level = 'info'): pino.Logger {
  const options: pino.LoggerOptions = { level };

  if (process.stdout.isTTY) {
    return pino(options, pino.transport({ target: 'pino-pretty', options: { colorize: true } }));
  }

  return pino(options);
}
