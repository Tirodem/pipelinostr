/**
 * Config loader (ADR-013)
 *
 * Loads config.yml, resolves secrets via SecretResolver.
 * No shell expansion. Explicit env: and file: prefixes only.
 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { SecretResolver } from './secrets.js';
import type { Logger } from 'pino';

export interface PipelinostrConfig {
  nostr: {
    private_key: unknown; // Secret after resolution
    relays: string[];
    dm_format?: 'nip04' | 'nip17';
    whitelist?: string[];
  };
  database: {
    path: string;
  };
  queue?: {
    enabled?: boolean;
    poll_interval_ms?: number;
    max_retries?: number;
  };
  retention?: {
    max_age_days?: number;
    max_rows?: number;
    max_size_mb?: number;
  };
  webhook?: {
    enabled?: boolean;
    port?: number;
    host?: string;
  };
  log_level?: string;
  max_hook_depth?: number;
  shutdown_timeout_ms?: number;
  handler_shutdown_timeout_ms?: number;
}

export function loadConfig(configPath: string, logger: Logger): PipelinostrConfig {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const raw = fs.readFileSync(configPath, 'utf-8');
  const parsed = YAML.parse(raw) as Record<string, unknown>;

  // Resolve secrets
  const resolver = new SecretResolver({
    baseDir: path.dirname(configPath),
  });

  const resolved = resolver.resolveAll(parsed) as PipelinostrConfig;

  logger.debug('Config loaded and secrets resolved');
  return resolved;
}

/**
 * Load handler configs from a directory of YAML files.
 */
export function loadHandlerConfigs(handlersConfigDir: string, logger: Logger): Record<string, Record<string, unknown>> {
  const configs: Record<string, Record<string, unknown>> = {};

  if (!fs.existsSync(handlersConfigDir)) {
    logger.debug({ dir: handlersConfigDir }, 'No handler config directory found');
    return configs;
  }

  const files = fs.readdirSync(handlersConfigDir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .filter((f) => !f.endsWith('.example'));

  const resolver = new SecretResolver({
    baseDir: handlersConfigDir,
  });

  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(handlersConfigDir, file), 'utf-8');
      const parsed = YAML.parse(raw) as Record<string, unknown>;
      const resolved = resolver.resolveAll(parsed) as Record<string, unknown>;

      // Use filename without extension as handler type
      const type = path.basename(file, path.extname(file));
      if (resolved.enabled !== false) {
        configs[type] = resolved;
      }
    } catch (err) {
      logger.warn({ file, error: (err as Error).message }, 'Failed to load handler config');
    }
  }

  return configs;
}
