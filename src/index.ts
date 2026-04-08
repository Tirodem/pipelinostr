/**
 * PipeliNostr v2 — Entry point
 *
 * Wiring: load config → init storage → init handlers →
 *         load workflows → start nostr listener → start queue worker.
 */

import './bootstrap.js'; // Load .env + ensure directories — must be first
import fs from 'node:fs';
import { createLogger } from './utils/logger.js';
import { loadConfig, loadHandlerConfigs } from './config/loader.js';
import { SqliteStorage } from './storage/sqlite.storage.js';
import { HandlerRegistry } from './handlers/registry.js';
import { WorkflowLoader } from './core/workflow-loader.js';
import { WorkflowEngine } from './core/engine.js';
import { QueueWorker } from './queue/worker.js';
import { NostrInboundListener } from './inbound/nostr.js';
import { Secret } from './config/secrets.js';
import { WorkflowAuditor } from './core/auditor.js';
import { WebhookInboundServer } from './inbound/webhook.js';
import {
  CONFIG_PATH, DB_PATH, MIGRATIONS_DIR, HANDLERS_DIR,
  HANDLERS_CONFIG_DIR, WORKFLOWS_DIR, WORKFLOWS_EXAMPLES_DIR,
} from './utils/paths.js';

// --- Bootstrap ---

const logger = createLogger(process.env.LOG_LEVEL ?? 'info');
logger.info('PipeliNostr v2 starting...');

// 1. Load config
const config = loadConfig(CONFIG_PATH, logger);

// Apply config log level (pino supports runtime level change)
if (config.log_level) {
  logger.level = config.log_level as string;
}

// 2. Init storage (ADR-002, ADR-003, ADR-005)
const dbPath = config.database?.path ? String(config.database.path) : DB_PATH;
const storage = new SqliteStorage(dbPath, MIGRATIONS_DIR);
logger.info({ dbPath }, 'Database initialized');

// 3. Init handler registry (ADR-010)
const registry = new HandlerRegistry(logger);
await registry.discoverHandlers(HANDLERS_DIR);

// Load handler configs
const handlerConfigs = loadHandlerConfigs(HANDLERS_CONFIG_DIR, logger);

// 4. Load workflows (ADR-009 flat format)
const workflowLoader = new WorkflowLoader(logger, storage.workflowTables);
workflowLoader.loadFromDirectory(WORKFLOWS_DIR);

if (fs.existsSync(WORKFLOWS_EXAMPLES_DIR)) {
  workflowLoader.loadFromDirectory(WORKFLOWS_EXAMPLES_DIR);
}

// 5. Init workflow engine
const engine = new WorkflowEngine(registry, logger, {
  maxHookDepth: config.max_hook_depth ?? 10,
});
engine.setWorkflows(workflowLoader.getAll());

// 6. Init queue worker
const queueWorker = new QueueWorker(storage, engine, workflowLoader, logger, {
  pollIntervalMs: config.queue?.poll_interval_ms ?? 1000,
  maxRetries: config.queue?.max_retries ?? 3,
});

// 7. Start Nostr listener (ADR-012)
const nostrListener = new NostrInboundListener({
  privateKey: config.nostr.private_key as string | Secret,
  relays: config.nostr.relays,
  whitelist: config.nostr.whitelist ?? [],
  zapRecipients: [],
  eventStorage: storage.events,
}, logger);

// Inject shared resources into handler configs
const sharedNostr = {
  _crypto: nostrListener.getCrypto(),
  _relays: config.nostr.relays,
};

for (const key of ['nostr_dm', 'nostr-dm', 'nostr_note', 'nostr-note']) {
  if (handlerConfigs[key]) {
    handlerConfigs[key] = { ...handlerConfigs[key], ...sharedNostr };
  }
}

if (handlerConfigs.workflow_db || handlerConfigs['workflow-db']) {
  const key = handlerConfigs.workflow_db ? 'workflow_db' : 'workflow-db';
  handlerConfigs[key] = { ...handlerConfigs[key], _stateStorage: storage.state };
}

// Initialize handlers
const unavailable = await registry.initializeAll(handlerConfigs);
if (unavailable.length > 0) {
  logger.warn({ unavailable }, 'Some handlers are unavailable');
}

// 8. Audit workflows (ADR-008)
const auditor = new WorkflowAuditor(logger);
const disabledByAudit = auditor.auditAndDisable(workflowLoader.getAll(), registry);
if (disabledByAudit.length > 0) {
  logger.warn({ disabled: disabledByAudit }, 'Workflows disabled by auditor');
}

// Wire: nostr events → workflow engine
nostrListener.onEvent(async (event) => {
  if (config.queue?.enabled) {
    queueWorker.enqueue(event, nostrListener.getWhitelist());
  } else {
    await queueWorker.processEvent(event, nostrListener.getWhitelist());
  }
});

// 9. Start webhook server if configured
let webhookServer: WebhookInboundServer | undefined;
if (config.webhook?.enabled) {
  webhookServer = new WebhookInboundServer({
    port: config.webhook.port ?? 3000,
    host: config.webhook.host,
    secret: config.webhook.secret as string | Secret | undefined,
  }, logger);

  webhookServer.onEvent(async (event) => {
    if (config.queue?.enabled) {
      queueWorker.enqueue(event);
    } else {
      await queueWorker.processEvent(event);
    }
  });

  await webhookServer.start();
}

// 10. Start services
await nostrListener.start();
if (config.queue?.enabled) {
  queueWorker.start();
}

logger.info({
  publicKey: nostrListener.getPublicKeyNpub(),
  workflows: workflowLoader.getAll().size,
  handlers: Array.from(registry.listAll().entries())
    .filter(([, h]) => h.status === 'available')
    .map(([type]) => type),
}, 'PipeliNostr v2 ready');

// --- Shutdown (ADR-014) ---

let shuttingDown = false;
const SHUTDOWN_TIMEOUT = config.shutdown_timeout_ms ?? 15000;
const HANDLER_TIMEOUT = config.handler_shutdown_timeout_ms ?? 5000;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down...');

  try {
    if (webhookServer) await webhookServer.stop();
    await nostrListener.stop();
    await queueWorker.stop();
    await registry.shutdownAll(HANDLER_TIMEOUT);
    storage.close();
    logger.info('Shutdown complete');
  } catch (err) {
    logger.error({ error: (err as Error).message }, 'Error during shutdown');
  }

  process.exit(0);
}

let forceExitTimer: ReturnType<typeof setTimeout> | null = null;

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    if (shuttingDown) {
      if (!forceExitTimer) {
        logger.warn('Received second signal, forcing exit in 10s...');
        forceExitTimer = setTimeout(() => process.exit(1), 10000);
      }
      return;
    }
    shutdown(signal);
  });
}

process.on('uncaughtException', (err) => {
  logger.fatal({ error: err.message }, 'Uncaught exception');
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Unhandled rejection');
  shutdown('unhandledRejection');
});
