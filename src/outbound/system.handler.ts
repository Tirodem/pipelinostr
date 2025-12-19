import { execSync } from 'node:child_process';
import * as os from 'node:os';
import { statSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { logger } from '../persistence/logger.js';
import { getDatabase } from '../persistence/database.js';
import type { Handler, HandlerResult, HandlerConfig } from './handler.interface.js';

export interface SystemActionConfig extends HandlerConfig {
  action: 'status' | 'health';
  workflows_dir?: string;
  recent_executions_limit?: number;
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
        const status = await this.getSystemStatus(systemConfig);
        return {
          success: true,
          data: {
            status,
            formatted: this.formatStatus(status),
          },
        };
      } else if (action === 'health') {
        const health = await this.getHealthCheck();
        return {
          success: true,
          data: health,
        };
      }

      return {
        success: false,
        error: `Unknown action: ${action}`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage }, 'System handler failed');
      return {
        success: false,
        error: errorMessage,
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

      return logs.map((log) => ({
        id: log.id ?? 0,
        received_at: log.received_at?.toISOString() ?? '',
        workflow_id: log.workflow_id ?? null,
        workflow_name: log.workflow_name ?? null,
        status: log.status,
        source_type: log.source_type,
      }));
    } catch {
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
        model: cpus[0]?.model ?? 'Unknown',
        cores: cpus.length,
        load_avg: os.loadavg(),
      },
      memory: {
        total_mb: Math.round(totalMem / 1048576),
        free_mb: Math.round(freeMem / 1048576),
        used_mb: Math.round(usedMem / 1048576),
        usage_percent: Math.round((usedMem / totalMem) * 100),
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
      `  RAM: ${status.resources.memory.used_mb}MB / ${status.resources.memory.total_mb}MB (${status.resources.memory.usage_percent}%)`,
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

  async shutdown(): Promise<void> {
    logger.info('System handler shut down');
  }
}
