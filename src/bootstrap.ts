/**
 * Shared bootstrap — runs before anything else.
 *
 * Loads .env, ensures directories exist.
 * Imported by both index.ts and cli/index.ts.
 */

import fs from 'node:fs';
import dotenv from 'dotenv';
import { DATA_DIR, LOGS_DIR } from './utils/paths.js';

// Load .env
dotenv.config();

// Ensure runtime directories exist
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(LOGS_DIR, { recursive: true });
