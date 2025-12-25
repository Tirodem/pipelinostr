import { execSync } from 'node:child_process';
import * as os from 'node:os';
import { statSync, readdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { nip19 } from 'nostr-tools';
import { logger } from '../persistence/logger.js';
import { getDatabase } from '../persistence/database.js';
import type { Handler, HandlerResult, HandlerConfig } from './handler.interface.js';

export interface SystemActionConfig extends HandlerConfig {
  action: 'status' | 'health' | 'workflow_fetch' | 'workflow_enable' | 'workflow_disable' | 'workflow_list' | 'workflow_delete';
  workflows_dir?: string;
  recent_executions_limit?: number;
  // For workflow_fetch
  event_id?: string;           // nevent1..., note1..., or hex event ID
  relay_urls?: string[];       // Relays to fetch from
  // For workflow_enable/disable/delete
  workflow_id?: string;        // Workflow ID to enable/disable/delete
}

interface WorkflowInfo {
  id: string;
  name: string;
  enabled: boolean;
  triggers: string[];
}

interface RecentExecution {
  id: number;
  received_at: string;
  workflow_id: string | null;
  workflow_name: string | null;
  status: string;
  source_type: string;
}

interface SystemStatus {
  version: {
    commit: string;
    commit_short: string;
    branch: string;
  };
  workflows: {
    total: number;
    enabled: number;
    disabled: number;
    list: WorkflowInfo[];
  };
  handlers: string[];
  recent_executions: RecentExecution[];
  system: {
    os: string;
    platform: string;
    arch: string;
    hostname: string;
    uptime_seconds: number;
    uptime_human: string;
  };
  resources: {
    cpu: {
      model: string;
      cores: number;
      load_avg: number[];
    };
    memory: {
      total_mb: number;
      free_mb: number;
      used_mb: number;
      usage_percent: number;
    };
    process_memory: {
      rss_mb: number;
      heap_used_mb: number;
      heap_total_mb: number;
    };
    disk: {
      path: string;
      total_gb: number;
      free_gb: number;
      used_gb: number;
      usage_percent: number;
    } | null;
  };
  timestamp: string;
}

export class SystemHandler implements Handler {
  readonly name = 'System Handler';
  readonly type = 'system';

  private workflowsDir: string;
  private registeredHandlers: string[] = [];

  constructor(options: { workflowsDir?: string } = {}) {
    this.workflowsDir = options.workflowsDir ?? './config/workflows';
  }

  async initialize(): Promise<void> {
    logger.info('System handler initialized');
  }

  setRegisteredHandlers(handlers: string[]): void {
    this.registeredHandlers = handlers;
  }

  async execute(config: HandlerConfig, _context: Record<string, unknown>): Promise<HandlerResult> {
    const systemConfig = config as SystemActionConfig;
    const action = systemConfig.action ?? 'status';

    try {
      if (action === 'status') {
        logger.debug('System handler: getting status');
        const status = await this.getSystemStatus(systemConfig);
        logger.debug({ status }, 'System handler: status retrieved');
        const formatted = this.formatStatus(status);
        logger.debug('System handler: status formatted');
        return {
          success: true,
          data: {
            status,
            formatted,
          },
        };
      } else if (action === 'health') {
        const health = await this.getHealthCheck();
        return {
          success: true,
          data: health,
        };
      } else if (action === 'workflow_fetch') {
        return await this.workflowFetch(systemConfig);
      } else if (action === 'workflow_enable') {
        return await this.workflowSetEnabled(systemConfig, true);
      } else if (action === 'workflow_disable') {
        return await this.workflowSetEnabled(systemConfig, false);
      } else if (action === 'workflow_list') {
        return await this.workflowList(systemConfig);
      } else if (action === 'workflow_delete') {
        return await this.workflowDelete(systemConfig);
      }

      return {
        success: false,
        error: `Unknown action: ${action}`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error
        ? `${error.name}: ${error.message}`
        : (error ? String(error) : 'Unknown error');
      const errorStack = error instanceof Error ? error.stack : undefined;
      logger.error({ error: errorMessage, stack: errorStack }, 'System handler failed');
      return {
        success: false,
        error: errorMessage || 'System handler failed with unknown error',
      };
    }
  }

  private async getSystemStatus(config: SystemActionConfig): Promise<SystemStatus> {
    const workflowsDir = config.workflows_dir ?? this.workflowsDir;
    const recentLimit = config.recent_executions_limit ?? 10;

    // Get git info
    const gitInfo = this.getGitInfo();

    // Get workflows
    const workflows = this.getWorkflows(workflowsDir);

    // Get recent executions from database
    const recentExecutions = this.getRecentExecutions(recentLimit);

    // Get system info
    const systemInfo = this.getSystemInfo();

    // Get resource usage
    const resources = this.getResourceUsage();

    return {
      version: gitInfo,
      workflows: {
        total: workflows.length,
        enabled: workflows.filter((w) => w.enabled).length,
        disabled: workflows.filter((w) => !w.enabled).length,
        list: workflows,
      },
      handlers: this.registeredHandlers,
      recent_executions: recentExecutions,
      system: systemInfo,
      resources,
      timestamp: new Date().toISOString(),
    };
  }

  private getGitInfo(): { commit: string; commit_short: string; branch: string } {
    try {
      const commit = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
      const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
      return {
        commit,
        commit_short: commit.substring(0, 7),
        branch,
      };
    } catch {
      return {
        commit: 'unknown',
        commit_short: 'unknown',
        branch: 'unknown',
      };
    }
  }

  private getWorkflows(workflowsDir: string): WorkflowInfo[] {
    try {
      const files = readdirSync(workflowsDir).filter(
        (f) => f.endsWith('.yml') || f.endsWith('.yaml')
      );

      const workflows: WorkflowInfo[] = [];

      for (const file of files) {
        try {
          const filePath = join(workflowsDir, file);
          const content = readFileSync(filePath, 'utf-8');
          const parsed = yaml.load(content) as Record<string, unknown>;

          workflows.push({
            id: (parsed.id as string) ?? file.replace(/\.ya?ml$/, ''),
            name: (parsed.name as string) ?? file,
            enabled: parsed.enabled !== false,
            triggers: this.extractTriggers(parsed),
          });
        } catch (err) {
          logger.debug({ file, error: err }, 'Failed to parse workflow file');
        }
      }

      return workflows;
    } catch {
      return [];
    }
  }

  private extractTriggers(workflow: Record<string, unknown>): string[] {
    const triggers: string[] = [];
    const trigger = workflow.trigger as Record<string, unknown> | undefined;

    if (trigger) {
      if (trigger.type) {
        triggers.push(trigger.type as string);
      }
      const filters = trigger.filters as Record<string, unknown> | undefined;
      if (filters?.kinds) {
        triggers.push(`kinds:${JSON.stringify(filters.kinds)}`);
      }
      if (filters?.content_pattern) {
        triggers.push(`pattern:${filters.content_pattern}`);
      }
    }

    return triggers;
  }

  private getRecentExecutions(limit: number): RecentExecution[] {
    try {
      const db = getDatabase();
      const logs = db.getRecentEventLogs(limit, 0);

      return logs.map((log) => {
        let receivedAt = '';
        if (log.received_at) {
          // Handle both Date objects and ISO strings from SQLite
          receivedAt = log.received_at instanceof Date
            ? log.received_at.toISOString()
            : String(log.received_at);
        }
        return {
          id: log.id ?? 0,
          received_at: receivedAt,
          workflow_id: log.workflow_id ?? null,
          workflow_name: log.workflow_name ?? null,
          status: log.status,
          source_type: log.source_type,
        };
      });
    } catch (err) {
      logger.debug({ error: err }, 'Failed to get recent executions');
      return [];
    }
  }

  private getSystemInfo(): SystemStatus['system'] {
    const uptimeSeconds = os.uptime();

    return {
      os: `${os.type()} ${os.release()}`,
      platform: os.platform(),
      arch: os.arch(),
      hostname: os.hostname(),
      uptime_seconds: uptimeSeconds,
      uptime_human: this.formatUptime(uptimeSeconds),
    };
  }

  private formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    const parts: string[] = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (parts.length === 0) parts.push(`${Math.floor(seconds)}s`);

    return parts.join(' ');
  }

  private getResourceUsage(): SystemStatus['resources'] {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    // Get CPU info with fallback for Android/Termux
    let cpuModel = cpus[0]?.model?.trim() || 'Unknown';
    let cpuCores = cpus.length;

    // Try /proc/cpuinfo if cores=0 or model is unknown/empty
    if (cpuCores === 0 || cpuModel === 'Unknown' || cpuModel === '') {
      try {
        const cpuinfo = readFileSync('/proc/cpuinfo', 'utf-8');

        // Count processors if needed
        if (cpuCores === 0) {
          const processorMatches = cpuinfo.match(/^processor\s*:/gm);
          if (processorMatches) {
            cpuCores = processorMatches.length;
          }
        }

        // Get model name (try multiple fields for different architectures)
        if (cpuModel === 'Unknown' || cpuModel === '') {
          // Try Hardware first (common on Android)
          const hardwareMatch = cpuinfo.match(/^Hardware\s*:\s*(.+)$/m);
          if (hardwareMatch && hardwareMatch[1]) {
            cpuModel = hardwareMatch[1].trim();
          } else {
            // Try model name (x86/x64)
            const modelMatch = cpuinfo.match(/^model name\s*:\s*(.+)$/m);
            if (modelMatch && modelMatch[1]) {
              cpuModel = modelMatch[1].trim();
            } else {
              // Try CPU implementer + part (ARM)
              const implMatch = cpuinfo.match(/^CPU implementer\s*:\s*(.+)$/m);
              const partMatch = cpuinfo.match(/^CPU part\s*:\s*(.+)$/m);
              if (implMatch?.[1] && partMatch?.[1]) {
                cpuModel = `ARM ${implMatch[1].trim()}/${partMatch[1].trim()}`;
              }
            }
          }
        }
      } catch {
        // /proc/cpuinfo not available
      }
    }

    // Get load average (1min, 5min, 15min)
    const loadAvg = os.loadavg();

    // Get process memory usage (PipeliNostr specific)
    const processMemory = process.memoryUsage();

    // Get disk usage (cross-platform approach)
    let disk: SystemStatus['resources']['disk'] = null;
    try {
      if (os.platform() === 'win32') {
        // Windows: use wmic or PowerShell
        const result = execSync(
          'powershell -Command "Get-PSDrive C | Select-Object Used,Free | ConvertTo-Json"',
          { encoding: 'utf-8' }
        );
        const parsed = JSON.parse(result);
        const usedBytes = parsed.Used;
        const freeBytes = parsed.Free;
        const totalBytes = usedBytes + freeBytes;

        disk = {
          path: 'C:',
          total_gb: Math.round((totalBytes / 1073741824) * 10) / 10,
          free_gb: Math.round((freeBytes / 1073741824) * 10) / 10,
          used_gb: Math.round((usedBytes / 1073741824) * 10) / 10,
          usage_percent: Math.round((usedBytes / totalBytes) * 100),
        };
      } else {
        // Unix: use df command
        const result = execSync('df -B1 /', { encoding: 'utf-8' });
        const lines = result.trim().split('\n');
        const secondLine = lines[1];
        if (lines.length >= 2 && secondLine) {
          const parts = secondLine.split(/\s+/);
          const totalBytesStr = parts[1];
          const usedBytesStr = parts[2];
          const freeBytesStr = parts[3];

          if (totalBytesStr && usedBytesStr && freeBytesStr) {
            const totalBytes = parseInt(totalBytesStr, 10);
            const usedBytes = parseInt(usedBytesStr, 10);
            const freeBytes = parseInt(freeBytesStr, 10);

            disk = {
              path: '/',
              total_gb: Math.round((totalBytes / 1073741824) * 10) / 10,
              free_gb: Math.round((freeBytes / 1073741824) * 10) / 10,
              used_gb: Math.round((usedBytes / 1073741824) * 10) / 10,
              usage_percent: Math.round((usedBytes / totalBytes) * 100),
            };
          }
        }
      }
    } catch {
      // Disk info not available
    }

    return {
      cpu: {
        model: cpuModel,
        cores: cpuCores,
        load_avg: os.loadavg(),
      },
      memory: {
        total_mb: Math.round(totalMem / 1048576),
        free_mb: Math.round(freeMem / 1048576),
        used_mb: Math.round(usedMem / 1048576),
        usage_percent: Math.round((usedMem / totalMem) * 100),
      },
      process_memory: {
        rss_mb: Math.round(processMemory.rss / 1048576),
        heap_used_mb: Math.round(processMemory.heapUsed / 1048576),
        heap_total_mb: Math.round(processMemory.heapTotal / 1048576),
      },
      disk,
    };
  }

  private formatStatus(status: SystemStatus): string {
    const lines: string[] = [
      '📊 PipeliNostr Status',
      '',
      `🔖 Version: ${status.version.commit_short} (${status.version.branch})`,
      '',
      `📋 Workflows: ${status.workflows.enabled}/${status.workflows.total} enabled`,
      ...status.workflows.list.map(
        (w) => `  ${w.enabled ? '✅' : '❌'} ${w.id}: ${w.name}`
      ),
      '',
      `🔌 Handlers: ${status.handlers.length}`,
      `  ${status.handlers.join(', ')}`,
      '',
      `📜 Recent executions (${status.recent_executions.length}):`,
      ...status.recent_executions.slice(0, 5).map(
        (e) =>
          `  ${e.status === 'completed' ? '✅' : e.status === 'failed' ? '❌' : '⏳'} ${e.workflow_name ?? e.workflow_id ?? 'unknown'}`
      ),
      '',
      `💻 System: ${status.system.os}`,
      `  Platform: ${status.system.platform}/${status.system.arch}`,
      `  Hostname: ${status.system.hostname}`,
      `  Uptime: ${status.system.uptime_human}`,
      '',
      `📊 Resources:`,
      `  CPU: ${status.resources.cpu.cores} cores (${status.resources.cpu.model.substring(0, 30)})`,
      `  Load: ${status.resources.cpu.load_avg.map(l => l.toFixed(2)).join(' / ')} (1/5/15 min)`,
      `  RAM: ${status.resources.memory.used_mb}MB / ${status.resources.memory.total_mb}MB (${status.resources.memory.usage_percent}%)`,
      `  PipeliNostr RAM: ${status.resources.process_memory.rss_mb}MB (heap: ${status.resources.process_memory.heap_used_mb}/${status.resources.process_memory.heap_total_mb}MB)`,
      ...(status.resources.disk
        ? [
            `  Disk: ${status.resources.disk.used_gb}GB / ${status.resources.disk.total_gb}GB (${status.resources.disk.usage_percent}%)`,
          ]
        : []),
      '',
      `🕐 ${status.timestamp}`,
    ];

    return lines.join('\n');
  }

  private async getHealthCheck(): Promise<{
    healthy: boolean;
    checks: Record<string, boolean>;
  }> {
    const checks: Record<string, boolean> = {};

    // Check database
    try {
      const db = getDatabase();
      db.getQueueStats();
      checks.database = true;
    } catch {
      checks.database = false;
    }

    // Check disk space (warn if < 10% free)
    try {
      const resources = this.getResourceUsage();
      checks.disk = resources.disk ? resources.disk.usage_percent < 90 : true;
    } catch {
      checks.disk = false;
    }

    // Check memory (warn if < 10% free)
    try {
      const freeMem = os.freemem();
      const totalMem = os.totalmem();
      checks.memory = (freeMem / totalMem) > 0.1;
    } catch {
      checks.memory = false;
    }

    const healthy = Object.values(checks).every((v) => v);

    return { healthy, checks };
  }

  /**
   * Fetch a workflow from a Nostr event
   */
  private async workflowFetch(config: SystemActionConfig): Promise<HandlerResult> {
    const eventIdInput = config.event_id;
    if (!eventIdInput) {
      return { success: false, error: 'event_id is required' };
    }

    // Decode event ID (supports nevent1, note1, or hex)
    let eventId: string;
    let relayHints: string[] = [];

    try {
      if (eventIdInput.startsWith('nevent1')) {
        const decoded = nip19.decode(eventIdInput);
        if (decoded.type !== 'nevent') {
          return { success: false, error: 'Invalid nevent' };
        }
        eventId = decoded.data.id;
        relayHints = decoded.data.relays ?? [];
      } else if (eventIdInput.startsWith('note1')) {
        const decoded = nip19.decode(eventIdInput);
        if (decoded.type !== 'note') {
          return { success: false, error: 'Invalid note' };
        }
        eventId = decoded.data;
      } else {
        // Assume hex event ID
        eventId = eventIdInput;
      }
    } catch (err) {
      return { success: false, error: `Failed to decode event ID: ${err}` };
    }

    // Combine relay hints with provided relays
    const relays = [...new Set([...relayHints, ...(config.relay_urls ?? [])])];
    if (relays.length === 0) {
      return { success: false, error: 'No relays available. Provide relay_urls or use nevent with relay hints.' };
    }

    // Fetch the event
    let eventContent: string;
    let eventAuthor: string;
    try {
      const { SimplePool } = await import('nostr-tools');
      const pool = new SimplePool();

      try {
        const event = await Promise.race([
          pool.get(relays, { ids: [eventId] }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 10000))
        ]);

        if (!event) {
          return { success: false, error: 'Event not found on relays (timeout)' };
        }

        eventContent = event.content;
        eventAuthor = event.pubkey;
      } finally {
        pool.close(relays);
      }
    } catch (err) {
      return { success: false, error: `Failed to fetch event: ${err}` };
    }

    // Parse YAML content
    let workflowData: Record<string, unknown>;
    try {
      workflowData = yaml.load(eventContent) as Record<string, unknown>;
    } catch (err) {
      return { success: false, error: `Failed to parse workflow YAML: ${err}` };
    }

    // Validate required fields
    const workflowId = workflowData.id as string;
    const workflowName = workflowData.name as string;
    if (!workflowId) {
      return { success: false, error: 'Workflow YAML must have an "id" field' };
    }

    // Force workflow to be disabled on import
    workflowData.enabled = false;

    // Add metadata about import
    workflowData._imported = {
      from_event: eventId,
      from_author: eventAuthor,
      from_author_npub: nip19.npubEncode(eventAuthor),
      imported_at: new Date().toISOString(),
    };

    // Save workflow file
    const workflowsDir = config.workflows_dir ?? this.workflowsDir;
    const filePath = join(workflowsDir, `${workflowId}.yml`);

    // Check if file already exists
    if (existsSync(filePath)) {
      return { success: false, error: `Workflow "${workflowId}" already exists. Delete it first or use a different ID.` };
    }

    try {
      const yamlContent = yaml.dump(workflowData, { lineWidth: -1 });
      writeFileSync(filePath, yamlContent, 'utf-8');
    } catch (err) {
      return { success: false, error: `Failed to save workflow: ${err}` };
    }

    // Build summary for response
    const triggers = this.extractTriggers(workflowData);
    const actions = (workflowData.actions as Array<{ id?: string; type?: string }>) ?? [];
    const actionSummary = actions.map(a => a.type ?? a.id ?? 'unknown').join(', ');

    const summary = [
      `✅ Workflow imported (disabled)`,
      ``,
      `📋 ID: ${workflowId}`,
      `📝 Name: ${workflowName ?? workflowId}`,
      `👤 Author: ${nip19.npubEncode(eventAuthor).slice(0, 12)}...`,
      `🎯 Triggers: ${triggers.join(', ') || 'none'}`,
      `⚡ Actions: ${actionSummary || 'none'}`,
      ``,
      `To enable: /pipelinostr workflow enable ${workflowId}`,
    ].join('\n');

    logger.info({ workflowId, eventId, author: eventAuthor }, 'Workflow imported from Nostr');

    return {
      success: true,
      data: {
        workflow_id: workflowId,
        workflow_name: workflowName,
        author: eventAuthor,
        author_npub: nip19.npubEncode(eventAuthor),
        event_id: eventId,
        file_path: filePath,
        formatted: summary,
      },
    };
  }

  /**
   * Enable or disable a workflow
   */
  private async workflowSetEnabled(config: SystemActionConfig, enabled: boolean): Promise<HandlerResult> {
    const workflowId = config.workflow_id;
    if (!workflowId) {
      return { success: false, error: 'workflow_id is required' };
    }

    const workflowsDir = config.workflows_dir ?? this.workflowsDir;
    const filePath = join(workflowsDir, `${workflowId}.yml`);

    if (!existsSync(filePath)) {
      return { success: false, error: `Workflow "${workflowId}" not found` };
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      const workflowData = yaml.load(content) as Record<string, unknown>;

      workflowData.enabled = enabled;

      const yamlContent = yaml.dump(workflowData, { lineWidth: -1 });
      writeFileSync(filePath, yamlContent, 'utf-8');

      const action = enabled ? 'enabled' : 'disabled';
      logger.info({ workflowId, enabled }, `Workflow ${action}`);

      return {
        success: true,
        data: {
          workflow_id: workflowId,
          enabled,
          formatted: `${enabled ? '✅' : '❌'} Workflow "${workflowId}" ${action}`,
        },
      };
    } catch (err) {
      return { success: false, error: `Failed to update workflow: ${err}` };
    }
  }

  /**
   * List all workflows
   */
  private async workflowList(config: SystemActionConfig): Promise<HandlerResult> {
    const workflowsDir = config.workflows_dir ?? this.workflowsDir;
    const workflows = this.getWorkflows(workflowsDir);

    const lines = [
      `📋 Workflows (${workflows.filter(w => w.enabled).length}/${workflows.length} enabled)`,
      '',
      ...workflows.map(w => `${w.enabled ? '✅' : '❌'} ${w.id}: ${w.name}`),
    ];

    return {
      success: true,
      data: {
        workflows,
        formatted: lines.join('\n'),
      },
    };
  }

  /**
   * Delete a workflow
   */
  private async workflowDelete(config: SystemActionConfig): Promise<HandlerResult> {
    const workflowId = config.workflow_id;
    if (!workflowId) {
      return { success: false, error: 'workflow_id is required' };
    }

    const workflowsDir = config.workflows_dir ?? this.workflowsDir;
    const filePath = join(workflowsDir, `${workflowId}.yml`);

    if (!existsSync(filePath)) {
      return { success: false, error: `Workflow "${workflowId}" not found` };
    }

    try {
      unlinkSync(filePath);
      logger.info({ workflowId }, 'Workflow deleted');

      return {
        success: true,
        data: {
          workflow_id: workflowId,
          formatted: `🗑️ Workflow "${workflowId}" deleted`,
        },
      };
    } catch (err) {
      return { success: false, error: `Failed to delete workflow: ${err}` };
    }
  }

  async shutdown(): Promise<void> {
    logger.info('System handler shut down');
  }
}
