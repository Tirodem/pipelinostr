/**
 * PipeliNostr --dry-run / --validate mode
 *
 * Boots the app without connecting to relays or starting services.
 * Validates: config, secrets, handlers, workflows, templates.
 * Exits 0 if everything is valid, 1 if errors found.
 */

import '../bootstrap.js';
import fs from 'node:fs';
import YAML from 'yaml';
import { createLogger } from '../utils/logger.js';
import { loadConfig, loadHandlerConfigs } from '../config/loader.js';
import { SqliteStorage } from '../storage/sqlite.storage.js';
import { HandlerRegistry } from '../handlers/registry.js';
import { WorkflowLoader } from '../core/workflow-loader.js';
import { WorkflowAuditor } from '../core/auditor.js';
import { TemplateEngine } from '../core/template.js';
import { matchTrigger } from '../core/matcher.js';
import type { WorkflowDefinition, NormalizedEvent, WorkflowContext, TriggerContext } from '../core/types.js';
import {
  CONFIG_PATH, DB_PATH, MIGRATIONS_DIR, HANDLERS_DIR,
  HANDLERS_CONFIG_DIR, WORKFLOWS_DIR, WORKFLOWS_EXAMPLES_DIR,
} from '../utils/paths.js';

const logger = createLogger('warn');
let errors = 0;
let warnings = 0;

function fail(msg: string): void {
  console.log(`  \x1b[31mERROR\x1b[0m ${msg}`);
  errors++;
}

function warn(msg: string): void {
  console.log(`  \x1b[33mWARN\x1b[0m  ${msg}`);
  warnings++;
}

function ok(msg: string): void {
  console.log(`  \x1b[32mOK\x1b[0m    ${msg}`);
}

export async function runValidate(): Promise<void> {
  console.log('\n\x1b[36m  PipeliNostr v2 — Validation\x1b[0m\n');

  // --- 1. Config ---
  console.log('  \x1b[33m[Config]\x1b[0m');
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig(CONFIG_PATH, logger);
    ok('config.yml loaded and secrets resolved');
  } catch (err) {
    fail(`config.yml: ${(err as Error).message}`);
    console.log(`\n  ${errors} errors. Cannot continue without config.\n`);
    process.exit(1);
  }

  // --- 2. Database ---
  console.log('\n  \x1b[33m[Database]\x1b[0m');
  let storage: SqliteStorage;
  try {
    const dbPath = config.database?.path ? String(config.database.path) : DB_PATH;
    storage = new SqliteStorage(dbPath, MIGRATIONS_DIR);
    ok(`Database initialized (${dbPath})`);
  } catch (err) {
    fail(`Database: ${(err as Error).message}`);
    console.log(`\n  ${errors} errors. Cannot continue without database.\n`);
    process.exit(1);
  }

  // --- 3. Handlers ---
  console.log('\n  \x1b[33m[Handlers]\x1b[0m');
  const registry = new HandlerRegistry(logger);
  await registry.discoverHandlers(HANDLERS_DIR);

  const handlerConfigs = loadHandlerConfigs(HANDLERS_CONFIG_DIR, logger);
  const unavailable = await registry.initializeAll(handlerConfigs);

  const allHandlers = registry.listAll();
  const available = Array.from(allHandlers.entries()).filter(([, h]) => h.status === 'available');
  const disabled = Array.from(allHandlers.entries()).filter(([, h]) => h.status === 'disabled');

  ok(`${available.length} handlers available: ${available.map(([t]) => t).join(', ')}`);

  if (unavailable.length > 0) {
    for (const type of unavailable) {
      const status = registry.getStatus(type);
      warn(`Handler "${type}" unavailable: ${status?.error ?? 'unknown'}`);
    }
  }

  if (disabled.length > 0) {
    // This is fine — just informational
    console.log(`  \x1b[90mINFO\x1b[0m  ${disabled.length} handlers discovered but not configured (normal)`);
  }

  // --- 4. Workflows ---
  console.log('\n  \x1b[33m[Workflows]\x1b[0m');
  const workflowLoader = new WorkflowLoader(logger, storage.workflowTables);
  workflowLoader.loadFromDirectory(WORKFLOWS_DIR);
  if (fs.existsSync(WORKFLOWS_EXAMPLES_DIR)) {
    workflowLoader.loadFromDirectory(WORKFLOWS_EXAMPLES_DIR);
  }

  const workflows = workflowLoader.getAll();
  ok(`${workflows.size} workflows loaded`);

  // --- 5. Workflow auditor ---
  console.log('\n  \x1b[33m[Audit]\x1b[0m');
  const auditor = new WorkflowAuditor(logger);
  const auditResults = auditor.audit(workflows, registry);

  if (auditResults.size === 0) {
    ok('All workflows passed audit');
  } else {
    for (const [wfId, issues] of auditResults) {
      for (const issue of issues) {
        if (issue.severity === 'error') {
          fail(`${wfId}: ${issue.ruleId} — ${issue.message}`);
        } else {
          warn(`${wfId}: ${issue.ruleId} — ${issue.message}`);
        }
      }
    }
  }

  // --- 6. Template rendering dry-run ---
  console.log('\n  \x1b[33m[Templates]\x1b[0m');
  const templateEngine = new TemplateEngine();

  const mockEvent: NormalizedEvent = {
    source: 'nostr.dm',
    origin: 'nostr',
    type: 'dm',
    sender: 'npub1test',
    content: 'hello test',
    timestamp: Math.floor(Date.now() / 1000),
    metadata: { id: 'test123', kind: 4, relay: 'wss://test', dm_format: 'nip04', sender_pubkey: 'abc123' },
    raw: {},
  };

  const mockTrigger: TriggerContext = {
    source: 'nostr.dm',
    origin: 'nostr',
    type: 'dm',
    sender: 'npub1test',
    content: 'hello test',
    timestamp: Math.floor(Date.now() / 1000),
    from: 'npub1test',
    dm_format: 'nip04',
    zap: { amount: 1000, sender: 'npub1zapper', sender_pubkey: 'def456', recipient: 'npub1me', recipient_pubkey: 'ghi789', message: 'test zap', bolt11: 'lnbc...' },
  };

  let templateErrors = 0;
  for (const wf of workflows.values()) {
    if (!wf.enabled) continue;

    // Test trigger matching
    const match = matchTrigger(mockEvent, wf.trigger);

    // Build mock context
    const mockContext: WorkflowContext = {
      trigger: mockTrigger,
      match: match.groups,
      actions: {},
      variables: { ...(wf.variables ?? {}) },
    };

    // Mock previous action results
    for (const action of wf.actions) {
      mockContext.actions[action.id] = {
        success: true,
        response: { formatted: 'mock response', file_path: '/tmp/mock.wav', report: 'mock report' },
      };
    }

    // Try rendering all templates in all actions
    for (const action of wf.actions) {
      const { id: _id, type: _type, when: _when, on_fail: _onFail, retry: _retry, idempotent: _idem, ...params } = action;

      for (const [key, value] of Object.entries(params)) {
        if (typeof value !== 'string' || !value.includes('{{')) continue;

        try {
          const rendered = templateEngine.render(value, mockContext);
          if (rendered.includes('undefined') || rendered.includes('[object Object]')) {
            warn(`${wf.id}/${action.id}.${key}: renders to suspicious value: "${rendered.slice(0, 80)}"`);
          }
        } catch (err) {
          fail(`${wf.id}/${action.id}.${key}: template error: ${(err as Error).message}`);
          templateErrors++;
        }
      }
    }

    // Check handler availability for each action
    for (const action of wf.actions) {
      const handler = registry.get(action.type);
      const status = registry.getStatus(action.type);
      if (!handler && status?.status === 'unavailable') {
        warn(`${wf.id}/${action.id}: handler "${action.type}" unavailable (${status.error})`);
      }
    }
  }

  if (templateErrors === 0) {
    ok('All enabled workflow templates render without errors');
  }

  // --- 7. Dependency check ---
  console.log('\n  \x1b[33m[Dependencies]\x1b[0m');
  for (const [type, registered] of allHandlers) {
    if (registered.status !== 'unavailable') continue;
    if (registered.error?.includes('Missing packages')) {
      fail(`${type}: ${registered.error}`);
    }
  }

  const depIssues = Array.from(allHandlers.entries()).filter(([, h]) => h.error?.includes('Missing packages'));
  if (depIssues.length === 0) {
    ok('All configured handler dependencies installed');
  }

  // --- Summary ---
  storage.close();

  console.log(`\n  \x1b[36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m`);
  console.log(`  Handlers: ${available.length} available, ${unavailable.length} unavailable`);
  console.log(`  Workflows: ${workflows.size} loaded`);
  console.log(`  Errors: ${errors}, Warnings: ${warnings}`);

  if (errors > 0) {
    console.log(`\n  \x1b[31mValidation FAILED with ${errors} error(s).\x1b[0m\n`);
    process.exit(1);
  } else if (warnings > 0) {
    console.log(`\n  \x1b[33mValidation passed with ${warnings} warning(s).\x1b[0m\n`);
    process.exit(0);
  } else {
    console.log(`\n  \x1b[32mValidation passed.\x1b[0m\n`);
    process.exit(0);
  }
}

// Exported only — called by cli/index.ts via import + explicit call.
// No self-executing code here.
