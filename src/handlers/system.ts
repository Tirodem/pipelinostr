/**
 * System handler (v2)
 *
 * System status + workflow management via DM commands.
 * Actions: status, workflow_list, workflow_enable, workflow_disable, workflow_delete
 */

import { z } from 'zod';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { BaseHandler, type HandlerResult, type ActionContext } from './base.js';
import { WORKFLOWS_DIR } from '../utils/paths.js';

export class SystemHandler extends BaseHandler {
  static type = 'system';
  static configSchema = z.object({ enabled: z.boolean().optional() });

  readonly name = 'System';
  readonly type = 'system';

  async initialize(_config: Record<string, unknown>): Promise<void> {}

  async execute(action: Record<string, unknown>, _context: ActionContext): Promise<HandlerResult> {
    const op = (action.action as string) ?? 'status';

    switch (op) {
      case 'status': return this.handleStatus();
      case 'workflow_list': return this.handleWorkflowList();
      case 'workflow_enable': return this.handleWorkflowToggle(action, true);
      case 'workflow_disable': return this.handleWorkflowToggle(action, false);
      case 'workflow_delete': return this.handleWorkflowDelete(action);
      default: return { success: false, error: `Unknown system action: ${op}` };
    }
  }

  async shutdown(): Promise<void> {}

  // --- Status ---

  private handleStatus(): HandlerResult {
    const mem = process.memoryUsage();
    const uptime = process.uptime();
    const uptimeStr = this.formatUptime(uptime);
    const rssMb = Math.round(mem.rss / 1024 / 1024);
    const heapMb = Math.round(mem.heapUsed / 1024 / 1024);
    const totalMem = Math.round(os.totalmem() / 1024 / 1024);
    const freeMem = Math.round(os.freemem() / 1024 / 1024);
    const load = os.loadavg().map((l) => Math.round(l * 100) / 100);

    // Count workflows
    const workflows = this.getWorkflowFiles();
    const enabled = workflows.filter((f) => {
      const wf = this.loadYaml(f);
      return wf?.enabled !== false;
    }).length;

    const formatted = [
      `PipeliNostr v2`,
      `Uptime: ${uptimeStr}`,
      `Node: ${process.version} (${os.platform()} ${os.arch()})`,
      `Host: ${os.hostname()}`,
      `Memory: ${rssMb}MB RSS / ${heapMb}MB heap`,
      `System: ${freeMem}MB free / ${totalMem}MB total`,
      `Load: ${load.join(', ')}`,
      `Workflows: ${enabled}/${workflows.length} enabled`,
    ].join('\n');

    return {
      success: true,
      data: {
        formatted,
        version: 'v2',
        platform: os.platform(),
        arch: os.arch(),
        node: process.version,
        uptime_seconds: Math.floor(uptime),
        uptime_human: uptimeStr,
        memory: { rss_mb: rssMb, heap_used_mb: heapMb },
        os: { hostname: os.hostname(), total_memory_mb: totalMem, free_memory_mb: freeMem, load_avg: load },
        workflows: { enabled, total: workflows.length },
      },
    };
  }

  // --- Workflow list ---

  private handleWorkflowList(): HandlerResult {
    const files = this.getWorkflowFiles();
    const lines: string[] = [];

    for (const file of files) {
      const wf = this.loadYaml(file);
      if (!wf) continue;
      const status = wf.enabled !== false ? 'ON' : 'OFF';
      const id = (wf.id as string) ?? path.basename(file, '.yml');
      const source = (wf.trigger as Record<string, unknown>)?.source ?? '?';
      lines.push(`[${status}] ${id} (${source})`);
    }

    const formatted = lines.length > 0
      ? `Workflows (${lines.length}):\n\n${lines.join('\n')}`
      : 'No workflows found.';

    return {
      success: true,
      data: { formatted, count: lines.length, workflows: lines },
    };
  }

  // --- Workflow enable/disable ---

  private handleWorkflowToggle(action: Record<string, unknown>, enable: boolean): HandlerResult {
    const id = action.workflow_id as string;
    if (!id) return { success: false, error: 'Missing workflow_id' };

    const file = this.findWorkflowFile(id);
    if (!file) return { success: false, error: `Workflow not found: ${id}` };

    const wf = this.loadYaml(file);
    if (!wf) return { success: false, error: `Failed to parse workflow: ${id}` };

    wf.enabled = enable;
    fs.writeFileSync(file, YAML.stringify(wf, { lineWidth: 0 }));

    const formatted = `Workflow "${id}" ${enable ? 'enabled' : 'disabled'}. Restart PipeliNostr to apply.`;
    return { success: true, data: { formatted, workflow_id: id, enabled: enable } };
  }

  // --- Workflow delete ---

  private handleWorkflowDelete(action: Record<string, unknown>): HandlerResult {
    const id = action.workflow_id as string;
    if (!id) return { success: false, error: 'Missing workflow_id' };

    const file = this.findWorkflowFile(id);
    if (!file) return { success: false, error: `Workflow not found: ${id}` };

    fs.unlinkSync(file);

    const formatted = `Workflow "${id}" deleted. Restart PipeliNostr to apply.`;
    return { success: true, data: { formatted, workflow_id: id } };
  }

  // --- Helpers ---

  private getWorkflowFiles(): string[] {
    if (!fs.existsSync(WORKFLOWS_DIR)) return [];
    return fs.readdirSync(WORKFLOWS_DIR)
      .filter((f) => f.endsWith('.yml') && !f.endsWith('.example') && !f.endsWith('.old'))
      .map((f) => path.join(WORKFLOWS_DIR, f))
      .sort();
  }

  private findWorkflowFile(id: string): string | null {
    const files = this.getWorkflowFiles();
    for (const file of files) {
      const wf = this.loadYaml(file);
      if ((wf?.id as string) === id) return file;
    }
    return null;
  }

  private loadYaml(file: string): Record<string, unknown> | null {
    try {
      return YAML.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private formatUptime(seconds: number): string {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const parts: string[] = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    parts.push(`${m}m`);
    return parts.join(' ');
  }
}
