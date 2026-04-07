/**
 * Shared path constants.
 *
 * PROJECT_ROOT is resolved from the dist/ output directory at runtime.
 * dist/ is one level below the project root.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// dist/utils/paths.js → dist/ → project root
export const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

export const CONFIG_DIR = path.join(PROJECT_ROOT, 'config');
export const HANDLERS_CONFIG_DIR = path.join(CONFIG_DIR, 'handlers');
export const WORKFLOWS_DIR = path.join(CONFIG_DIR, 'workflows');
export const WORKFLOWS_EXAMPLES_DIR = path.join(PROJECT_ROOT, 'workflows');
export const DATA_DIR = path.join(PROJECT_ROOT, 'data');
export const DB_PATH = path.join(DATA_DIR, 'pipelinostr.db');
export const CONFIG_PATH = path.join(CONFIG_DIR, 'config.yml');
export const ENV_PATH = path.join(PROJECT_ROOT, '.env');
export const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations');
export const HANDLERS_DIR = path.join(__dirname, '..', 'handlers');
