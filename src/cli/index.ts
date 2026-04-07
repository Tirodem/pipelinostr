/**
 * PipeliNostr v2 CLI
 *
 * Commands: workflow, handler, queue, db, audit
 * Entry point for scripts/pipelinostr.sh
 */

import '../bootstrap.js'; // Load .env + ensure directories — must be first
import path from 'node:path';
import fs from 'node:fs';
import YAML from 'yaml';
import { createLogger } from '../utils/logger.js';
import { SqliteStorage } from '../storage/sqlite.storage.js';
import { WorkflowLoader } from '../core/workflow-loader.js';
import { WorkflowAuditor } from '../core/auditor.js';
import { HandlerRegistry } from '../handlers/registry.js';
import {
  WORKFLOWS_DIR, WORKFLOWS_EXAMPLES_DIR, HANDLERS_CONFIG_DIR,
  DB_PATH, MIGRATIONS_DIR, HANDLERS_DIR,
} from '../utils/paths.js';

const logger = createLogger('warn');

// --- Main ---

const [,, command, subcommand, ...args] = process.argv;

async function main(): Promise<void> {
  switch (command) {
    case 'setup': {
      const { runSetup } = await import('./setup.js');
      await runSetup();
      break;
    }
    case 'validate': case '--validate': case '--dry-run': {
      const { runValidate } = await import('./validate.js');
      await runValidate();
      break;
    }
    case 'workflow': await handleWorkflow(subcommand, args); break;
    case 'handler': await handleHandler(subcommand, args); break;
    case 'queue': await handleQueue(subcommand, args); break;
    case 'db': await handleDb(subcommand, args); break;
    case 'audit': await handleAudit(); break;
    case 'help': case '--help': case '-h': case undefined: printUsage(); break;
    default: console.error(`Unknown command: ${command}`); printUsage(); process.exit(1);
  }
}

// --- Workflow commands ---

async function handleWorkflow(sub: string | undefined, args: string[]): Promise<void> {
  switch (sub) {
    case 'list': return workflowList(args[0] as string | undefined);
    case 'enable': return workflowToggle(args, true);
    case 'disable': return workflowToggle(args, false);
    case 'show': return workflowShow(args[0] ?? '');
    case 'refresh': return workflowRefresh(args);
    case 'load-missing': return workflowLoadMissing();
    case 'clean': return workflowClean(args.includes('--purge'));
    case 'audit': return handleAudit();
    default: console.error(`Unknown workflow command: ${sub}`); process.exit(1);
  }
}

function workflowList(filter?: string): void {
  const files = getWorkflowFiles();
  const lines: string[] = [];

  for (const file of files) {
    const wf = loadYaml(file);
    if (!wf) continue;

    const enabled = wf.enabled !== false;
    if (filter === 'enabled' && !enabled) continue;
    if (filter === 'disabled' && enabled) continue;

    const status = enabled ? '\x1b[32m[ON]\x1b[0m ' : '\x1b[31m[OFF]\x1b[0m';
    const trigger = wf.trigger as Record<string, unknown> | undefined;
    const source = trigger?.source ?? 'unknown';
    lines.push(`  ${status} ${wf.id ?? path.basename(file)}  (${source})`);
  }

  const label = filter ?? 'all';
  console.log(`\n  Workflows — ${label} (${lines.length}):\n`);
  for (const line of lines) console.log(line);
  console.log('');
}

function workflowToggle(args: string[], enable: boolean): void {
  const ids = parseIds(args);
  const files = getWorkflowFiles();
  let count = 0;

  for (const file of files) {
    const wf = loadYaml(file);
    if (!wf) continue;
    if (!matchesIds(wf.id as string | undefined, ids)) continue;

    wf.enabled = enable;
    fs.writeFileSync(file, YAML.stringify(wf, { lineWidth: 0 }));
    console.log(`  ${enable ? 'Enabled' : 'Disabled'}: ${wf.id}`);
    count++;
  }

  if (count === 0) console.log('  No matching workflows found.');
}

function workflowShow(id: string): void {
  const file = findWorkflowFile(id);
  if (!file) { console.error(`  Workflow not found: ${id}`); return; }
  console.log(fs.readFileSync(file, 'utf-8'));
}

function workflowRefresh(args: string[]): void {
  const ids = parseIds(args);
  let count = 0;

  const examples = fs.readdirSync(WORKFLOWS_EXAMPLES_DIR)
    .filter((f) => f.endsWith('.yml.example'));

  for (const example of examples) {
    const id = example.replace('.yml.example', '');
    if (!matchesIds(id, ids)) continue;

    const src = path.join(WORKFLOWS_EXAMPLES_DIR, example);
    const dst = path.join(WORKFLOWS_DIR, `${id}.yml`);

    fs.copyFileSync(src, dst);

    // System workflows (pipelinostr-*) keep their template enabled state
    // User workflows are disabled by default after refresh
    const wf = loadYaml(dst);
    if (wf && !id.startsWith('pipelinostr-')) {
      wf.enabled = false;
      fs.writeFileSync(dst, YAML.stringify(wf, { lineWidth: 0 }));
    }

    const status = wf?.enabled !== false ? 'enabled' : 'disabled';
    console.log(`  Refreshed: ${id} (${status})`);
    count++;
  }

  if (count === 0) console.log('  No matching examples found.');
  else console.log(`\n  Refreshed ${count} workflows. Use 'workflow enable <id>' to activate.`);
}

function workflowLoadMissing(): void {
  const existing = new Set(
    getWorkflowFiles().map((f) => {
      const wf = loadYaml(f);
      return wf?.id;
    }).filter(Boolean)
  );

  const examples = fs.readdirSync(WORKFLOWS_EXAMPLES_DIR)
    .filter((f) => f.endsWith('.yml.example'));

  let count = 0;
  for (const example of examples) {
    const id = example.replace('.yml.example', '');
    if (existing.has(id)) continue;

    const src = path.join(WORKFLOWS_EXAMPLES_DIR, example);
    const dst = path.join(WORKFLOWS_DIR, `${id}.yml`);

    fs.copyFileSync(src, dst);

    // System workflows (pipelinostr-*) keep their template enabled state
    const wf = loadYaml(dst);
    if (wf && !id.startsWith('pipelinostr-')) {
      wf.enabled = false;
      fs.writeFileSync(dst, YAML.stringify(wf, { lineWidth: 0 }));
    }

    const status = wf?.enabled !== false ? 'enabled' : 'disabled';
    console.log(`  Deployed: ${id} (${status})`);
    count++;
  }

  console.log(`\n  Deployed ${count} new workflows.`);
}

function workflowClean(purge: boolean): void {
  const exampleIds = new Set(
    fs.readdirSync(WORKFLOWS_EXAMPLES_DIR)
      .filter((f) => f.endsWith('.yml.example'))
      .map((f) => f.replace('.yml.example', ''))
  );

  const files = getWorkflowFiles();
  let count = 0;

  for (const file of files) {
    const wf = loadYaml(file);
    const wfId = wf?.id as string | undefined;
    if (!wfId) continue;
    if (exampleIds.has(wfId)) continue;

    if (purge) {
      fs.unlinkSync(file);
      console.log(`  Deleted: ${wfId}`);
    } else {
      fs.renameSync(file, file + '.old');
      console.log(`  Archived: ${wfId} → .old`);
    }
    count++;
  }

  console.log(`\n  Cleaned ${count} orphan workflows.`);
}

// --- Handler commands ---

async function handleHandler(sub: string | undefined, args: string[]): Promise<void> {
  switch (sub) {
    case 'list': return handlerList(args[0] as string | undefined);
    case 'enable': return handlerToggle(args, true);
    case 'disable': return handlerToggle(args, false);
    case 'show': return handlerShow(args[0] ?? '');
    case 'refresh': return handlerRefresh(args);
    case 'load-missing': return handlerLoadMissing();
    case 'clean': return handlerClean(args.includes('--purge'));
    default: console.error(`Unknown handler command: ${sub}`); process.exit(1);
  }
}

function handlerList(filter?: string): void {
  const files = getHandlerFiles();
  const lines: string[] = [];

  for (const file of files) {
    const cfg = loadYaml(file);
    if (!cfg) continue;

    const name = path.basename(file, '.yml');
    const enabled = cfg.enabled !== false;
    if (filter === 'enabled' && !enabled) continue;
    if (filter === 'disabled' && enabled) continue;

    const status = enabled ? '\x1b[32m[ON]\x1b[0m ' : '\x1b[31m[OFF]\x1b[0m';
    lines.push(`  ${status} ${name}`);
  }

  const label = filter ?? 'all';
  console.log(`\n  Handlers — ${label} (${lines.length}):\n`);
  for (const line of lines) console.log(line);
  console.log('');
}

function handlerToggle(args: string[], enable: boolean): void {
  const ids = parseIds(args);
  const files = getHandlerFiles();
  let count = 0;

  for (const file of files) {
    const name = path.basename(file, '.yml');
    if (!matchesIds(name, ids)) continue;

    const cfg = loadYaml(file);
    if (!cfg) continue;

    cfg.enabled = enable;
    fs.writeFileSync(file, YAML.stringify(cfg, { lineWidth: 0 }));
    console.log(`  ${enable ? 'Enabled' : 'Disabled'}: ${name}`);
    count++;
  }

  if (count === 0) console.log('  No matching handlers found.');
}

function handlerShow(name: string): void {
  const file = path.join(HANDLERS_CONFIG_DIR, `${name}.yml`);
  if (!fs.existsSync(file)) { console.error(`  Handler not found: ${name}`); return; }
  console.log(fs.readFileSync(file, 'utf-8'));
}

function handlerRefresh(args: string[]): void {
  const ids = parseIds(args);
  const examplesDir = HANDLERS_CONFIG_DIR;
  const examples = fs.readdirSync(examplesDir).filter((f) => f.endsWith('.yml.example'));
  let count = 0;

  for (const example of examples) {
    const name = example.replace('.yml.example', '');
    if (!matchesIds(name, ids)) continue;

    const src = path.join(examplesDir, example);
    const dst = path.join(HANDLERS_CONFIG_DIR, `${name}.yml`);
    fs.copyFileSync(src, dst);

    const cfg = loadYaml(dst);
    if (cfg) {
      cfg.enabled = false;
      fs.writeFileSync(dst, YAML.stringify(cfg, { lineWidth: 0 }));
    }

    console.log(`  Refreshed: ${name} (disabled)`);
    count++;
  }

  if (count === 0) console.log('  No matching examples found.');
}

function handlerLoadMissing(): void {
  const existing = new Set(getHandlerFiles().map((f) => path.basename(f, '.yml')));
  const examplesDir = HANDLERS_CONFIG_DIR;
  const examples = fs.readdirSync(examplesDir).filter((f) => f.endsWith('.yml.example'));
  let count = 0;

  for (const example of examples) {
    const name = example.replace('.yml.example', '');
    if (existing.has(name)) continue;

    const src = path.join(examplesDir, example);
    const dst = path.join(HANDLERS_CONFIG_DIR, `${name}.yml`);
    fs.copyFileSync(src, dst);

    const cfg = loadYaml(dst);
    if (cfg) {
      cfg.enabled = false;
      fs.writeFileSync(dst, YAML.stringify(cfg, { lineWidth: 0 }));
    }

    console.log(`  Deployed: ${name} (disabled)`);
    count++;
  }

  console.log(`\n  Deployed ${count} new handlers.`);
}

function handlerClean(purge: boolean): void {
  const examplesDir = HANDLERS_CONFIG_DIR;
  const exampleNames = new Set(
    fs.readdirSync(examplesDir)
      .filter((f) => f.endsWith('.yml.example'))
      .map((f) => f.replace('.yml.example', ''))
  );

  const files = getHandlerFiles();
  let count = 0;

  for (const file of files) {
    const name = path.basename(file, '.yml');
    if (exampleNames.has(name)) continue;

    if (purge) {
      fs.unlinkSync(file);
      console.log(`  Deleted: ${name}`);
    } else {
      fs.renameSync(file, file + '.old');
      console.log(`  Archived: ${name} → .old`);
    }
    count++;
  }

  console.log(`\n  Cleaned ${count} orphan handlers.`);
}

// --- Queue commands ---

async function handleQueue(sub: string | undefined, args: string[]): Promise<void> {
  const storage = openStorage();

  switch (sub) {
    case 'status': {
      const pending = storage.queue.getRetryable(new Date().toISOString());
      console.log('\n  Queue status:');
      console.log(`  Retryable items: ${pending.length}`);
      break;
    }
    case 'replay': {
      const id = Number(args[0]);
      if (isNaN(id)) {
        // Replay all dead events
        const rows = (storage as unknown as { db: { prepare: (sql: string) => { all: () => Array<{ id: number }> } } }).db
          ? [] : [];
        console.log('  Use: queue replay <event-id>');
      } else {
        const newId = storage.queue.replayEvent(id);
        console.log(`  Replayed queue entry ${id} → new entry ${newId}`);
      }
      break;
    }
    default:
      console.error(`Unknown queue command: ${sub}`);
      process.exit(1);
  }

  storage.close();
}

// --- DB commands ---

async function handleDb(sub: string | undefined, _args: string[]): Promise<void> {
  const storage = openStorage();

  switch (sub) {
    case 'clean': {
      const tables = storage.workflowTables.listWorkflowTables();
      if (tables.length === 0) {
        console.log('  No workflow tables found.');
        break;
      }

      // Check which tables are referenced by active workflows
      const activeWorkflows = new Set<string>();
      const files = getWorkflowFiles();
      for (const file of files) {
        const wf = loadYaml(file);
        const storage = wf?.storage as { table?: string } | undefined;
        if (storage?.table) activeWorkflows.add(storage.table);
      }

      const orphans = tables.filter((t) => !activeWorkflows.has(t));
      if (orphans.length === 0) {
        console.log('  No orphan workflow tables found.');
        break;
      }

      console.log(`\n  Orphan workflow tables (${orphans.length}):`);
      for (const table of orphans) {
        console.log(`    wf_${table}`);
      }
      console.log('\n  Run with confirmation to drop these tables.');
      // In interactive mode, would prompt. For now, just list.
      break;
    }
    default:
      console.error(`Unknown db command: ${sub}`);
      process.exit(1);
  }

  storage.close();
}

// --- Audit command ---

async function handleAudit(): Promise<void> {
  const loader = new WorkflowLoader(logger);
  loader.loadFromDirectory(WORKFLOWS_DIR);

  const registry = new HandlerRegistry(logger);
  await registry.discoverHandlers(HANDLERS_DIR);

  const auditor = new WorkflowAuditor(logger);
  const results = auditor.audit(loader.getAll(), registry);

  if (results.size === 0) {
    console.log('\n  All workflows passed audit.\n');
    return;
  }

  console.log(`\n  Audit results (${results.size} workflows with issues):\n`);
  for (const [workflowId, issues] of results) {
    const errors = issues.filter((r) => r.severity === 'error');
    const warns = issues.filter((r) => r.severity === 'warn');
    console.log(`  ${workflowId}: ${errors.length} errors, ${warns.length} warnings`);
    for (const issue of issues) {
      const icon = issue.severity === 'error' ? '\x1b[31mERROR\x1b[0m' : '\x1b[33mWARN\x1b[0m ';
      console.log(`    ${icon} ${issue.ruleId}: ${issue.message}`);
    }
  }
  console.log('');
}

// --- Helpers ---

function getWorkflowFiles(): string[] {
  if (!fs.existsSync(WORKFLOWS_DIR)) return [];
  return fs.readdirSync(WORKFLOWS_DIR)
    .filter((f) => f.endsWith('.yml') && !f.endsWith('.example') && !f.endsWith('.old'))
    .map((f) => path.join(WORKFLOWS_DIR, f))
    .sort();
}

function getHandlerFiles(): string[] {
  if (!fs.existsSync(HANDLERS_CONFIG_DIR)) return [];
  return fs.readdirSync(HANDLERS_CONFIG_DIR)
    .filter((f) => f.endsWith('.yml') && !f.endsWith('.example') && !f.endsWith('.old'))
    .map((f) => path.join(HANDLERS_CONFIG_DIR, f))
    .sort();
}

function findWorkflowFile(id: string): string | null {
  const files = getWorkflowFiles();
  for (const file of files) {
    const wf = loadYaml(file);
    if (wf?.id === id) return file;
  }
  return null;
}

function loadYaml(file: string): Record<string, unknown> | null {
  try {
    return YAML.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseIds(args: string[]): string[] {
  return args.flatMap((a) => a.split(',').map((s) => s.trim())).filter(Boolean);
}

function matchesIds(name: string | undefined, ids: string[]): boolean {
  if (!name) return false;
  if (ids.length === 0 || ids.includes('all')) return true;
  return ids.some((id) => {
    if (id.includes('*') || id.includes('?')) {
      const regex = new RegExp('^' + id.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
      return regex.test(name);
    }
    return id === name;
  });
}

function openStorage(): SqliteStorage {
  return new SqliteStorage(DB_PATH, MIGRATIONS_DIR);
}

function printUsage(): void {
  console.log(`
PipeliNostr v2 CLI

Usage: pipelinostr <command> [options]

Commands:
  setup                                   Interactive first-run wizard
  validate                                Validate config, handlers, workflows (dry-run)

  workflow list [all|enabled|disabled]    List workflows
  workflow enable <id|pattern|all>        Enable workflow(s)
  workflow disable <id|pattern|all>       Disable workflow(s)
  workflow show <id>                      Show workflow YAML
  workflow refresh <id|pattern|id1,id2>   Refresh from examples
  workflow load-missing                   Deploy missing workflows
  workflow clean [--purge]                Archive orphan workflows
  workflow audit                          Run workflow auditor

  handler list [all|enabled|disabled]     List handlers
  handler enable <name|pattern|all>       Enable handler(s)
  handler disable <name|pattern|all>      Disable handler(s)
  handler show <name>                     Show handler config
  handler refresh <name|pattern>          Refresh from examples
  handler load-missing                    Deploy missing handlers
  handler clean [--purge]                 Archive orphan handlers

  queue status                            Show queue status
  queue replay <id>                       Replay a dead event

  db clean                                List orphan workflow tables

  audit                                   Run workflow auditor on all workflows

  help                                    Show this help

Wildcards: * matches any characters, ? matches one character
Multiple IDs: separate with commas (id1,id2,id3)
`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
