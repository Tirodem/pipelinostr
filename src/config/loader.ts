import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { config as loadDotenv } from 'dotenv';
import { PipelinostrConfig, validateConfig } from './schema.js';
import { logger } from '../persistence/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..');

interface LoaderOptions {
  configPath?: string;
  envPath?: string;
}

function resolveEnvVariables(obj: unknown): unknown {
  if (typeof obj === 'string') {
    // Replace ${VAR_NAME} with environment variable value
    return obj.replace(/\$\{([^}]+)\}/g, (_, varName: string) => {
      const value = process.env[varName];
      if (value === undefined) {
        logger.warn({ variable: varName }, 'Environment variable not found');
        return '';
      }
      return value;
    });
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => resolveEnvVariables(item));
  }

  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = resolveEnvVariables(value);
    }
    return result;
  }

  return obj;
}

async function loadYamlFile(filePath: string): Promise<unknown> {
  const content = await readFile(filePath, 'utf-8');
  return parseYaml(content);
}

function findConfigFile(): string {
  // Priority order:
  // 1. Environment variable PIPELINOSTR_CONFIG
  // 2. ./config/config.yml (relative to project)
  // 3. ~/.pipelinostr/config.yml
  // 4. /etc/pipelinostr/config.yml

  if (process.env['PIPELINOSTR_CONFIG']) {
    return process.env['PIPELINOSTR_CONFIG'];
  }

  const localConfig = join(PROJECT_ROOT, 'config', 'config.yml');
  if (existsSync(localConfig)) {
    return localConfig;
  }

  const homeDir = process.env['HOME'] ?? process.env['USERPROFILE'] ?? '';
  const userConfig = join(homeDir, '.pipelinostr', 'config.yml');
  if (existsSync(userConfig)) {
    return userConfig;
  }

  const systemConfig = '/etc/pipelinostr/config.yml';
  if (existsSync(systemConfig)) {
    return systemConfig;
  }

  throw new Error('No configuration file found');
}

function findEnvFile(): string | undefined {
  // Priority order:
  // 1. Environment variable PIPELINOSTR_ENV
  // 2. ./.env (relative to project)
  // 3. Same directory as config file
  // 4. ~/.pipelinostr/.env
  // 5. /etc/pipelinostr/.env

  if (process.env['PIPELINOSTR_ENV']) {
    return process.env['PIPELINOSTR_ENV'];
  }

  const localEnv = join(PROJECT_ROOT, '.env');
  if (existsSync(localEnv)) {
    return localEnv;
  }

  const homeDir = process.env['HOME'] ?? process.env['USERPROFILE'] ?? '';
  const userEnv = join(homeDir, '.pipelinostr', '.env');
  if (existsSync(userEnv)) {
    return userEnv;
  }

  const systemEnv = '/etc/pipelinostr/.env';
  if (existsSync(systemEnv)) {
    return systemEnv;
  }

  return undefined;
}

export async function loadConfig(options: LoaderOptions = {}): Promise<PipelinostrConfig> {
  // Load .env file first
  const envPath = options.envPath ?? findEnvFile();
  if (envPath) {
    logger.debug({ path: envPath }, 'Loading environment file');
    loadDotenv({ path: envPath });
  } else {
    logger.debug('No .env file found, using existing environment variables');
  }

  // Find and load config file
  const configPath = options.configPath ?? findConfigFile();
  logger.debug({ path: configPath }, 'Loading configuration file');

  const rawConfig = await loadYamlFile(configPath);

  // Resolve environment variables in config
  const resolvedConfig = resolveEnvVariables(rawConfig);

  // Validate configuration
  const config = validateConfig(resolvedConfig);

  return config;
}

export async function loadHandlerConfig<T = unknown>(handlerName: string): Promise<T | null> {
  const configDir = join(PROJECT_ROOT, 'config', 'handlers');
  const handlerFile = join(configDir, `${handlerName}.yml`);

  if (!existsSync(handlerFile)) {
    return null;
  }

  const rawConfig = await loadYamlFile(handlerFile);
  return resolveEnvVariables(rawConfig) as T;
}

export async function loadWorkflowConfigs(): Promise<unknown[]> {
  const workflowDir = join(PROJECT_ROOT, 'config', 'workflows');

  if (!existsSync(workflowDir)) {
    return [];
  }

  const { readdir } = await import('node:fs/promises');
  const files = await readdir(workflowDir);
  const workflows: unknown[] = [];

  for (const file of files) {
    if (file.endsWith('.yml') || file.endsWith('.yaml')) {
      const filePath = join(workflowDir, file);
      const rawWorkflow = await loadYamlFile(filePath);
      const resolvedWorkflow = resolveEnvVariables(rawWorkflow);
      workflows.push(resolvedWorkflow);
    }
  }

  return workflows;
}
