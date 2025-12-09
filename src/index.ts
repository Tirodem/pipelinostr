import { loadConfig } from './config/loader.js';
import { logger } from './persistence/logger.js';

async function main(): Promise<void> {
  logger.info('Starting PipeliNostr...');

  try {
    const config = await loadConfig();
    logger.info({ name: config.pipelinostr.name }, 'Configuration loaded');

    // TODO: Initialize components
    // - Database
    // - Relay manager
    // - Nostr listener
    // - Workflow engine
    // - API server (if enabled)

    logger.info('PipeliNostr started successfully');
  } catch (error) {
    logger.fatal({ error }, 'Failed to start PipeliNostr');
    process.exit(1);
  }
}

main();
