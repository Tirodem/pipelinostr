/**
 * Workflow Activator handler (v2)
 *
 * Activates/deactivates workflows via DM commands.
 * Used by the Claude workflow generator flow.
 */

import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { BaseHandler, type HandlerResult, type ActionContext } from './base.js';
import { WORKFLOWS_DIR } from '../utils/paths.js';

export class WorkflowActivatorHandler extends BaseHandler {
  static type = 'workflow_activator';
  static configSchema = z.object({ enabled: z.boolean().optional() });

  readonly name = 'Workflow Activator';
  readonly type = 'workflow_activator';

  async initialize(_config: Record<string, unknown>): Promise<void> {}

  async execute(action: Record<string, unknown>, _context: ActionContext): Promise<HandlerResult> {
    const op = (action.action as string) ?? 'list';
    const workflowId = action.workflow_id as string | undefined;

    switch (op) {
      case 'activate': {
        if (!workflowId) return { success: false, error: 'Missing workflow_id' };
        return this.toggleWorkflow(workflowId, true);
      }
      case 'cancel':
      case 'deactivate': {
        if (!workflowId) return { success: false, error: 'Missing workflow_id' };
        return this.toggleWorkflow(workflowId, false);
      }
      case 'list': {
        return this.listWorkflows();
      }
      default:
        return { success: false, error: `Unknown action: ${op}` };
    }
  }

  async shutdown(): Promise<void> {}

  private toggleWorkflow(id: string, enable: boolean): HandlerResult {
    const file = this.findWorkflowFile(id);
    if (!file) return { success: false, error: `Workflow not found: ${id}` };

    try {
      const content = YAML.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>;
      content.enabled = enable;
      fs.writeFileSync(file, YAML.stringify(content, { lineWidth: 0 }));

      return {
        success: true,
        data: {
          workflow_id: id,
          enabled: enable,
          formatted: `Workflow "${id}" ${enable ? 'activated' : 'deactivated'}. Restart to apply.`,
        },
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  private listWorkflows(): HandlerResult {
    if (!fs.existsSync(WORKFLOWS_DIR)) return { success: true, data: { workflows: [], formatted: 'No workflows found.' } };

    const files = fs.readdirSync(WORKFLOWS_DIR)
      .filter((f) => f.endsWith('.yml') && !f.endsWith('.example') && !f.endsWith('.old'));

    const workflows = files.map((f) => {
      const wf = YAML.parse(fs.readFileSync(path.join(WORKFLOWS_DIR, f), 'utf-8')) as Record<string, unknown>;
      return { id: wf.id as string, enabled: wf.enabled !== false };
    });

    const formatted = workflows
      .map((w) => `[${w.enabled ? 'ON' : 'OFF'}] ${w.id}`)
      .join('\n');

    return { success: true, data: { workflows, count: workflows.length, formatted } };
  }

  private findWorkflowFile(id: string): string | null {
    if (!fs.existsSync(WORKFLOWS_DIR)) return null;
    const files = fs.readdirSync(WORKFLOWS_DIR)
      .filter((f) => f.endsWith('.yml') && !f.endsWith('.example'));

    for (const f of files) {
      const content = YAML.parse(fs.readFileSync(path.join(WORKFLOWS_DIR, f), 'utf-8')) as Record<string, unknown>;
      if (content.id === id) return path.join(WORKFLOWS_DIR, f);
    }
    return null;
  }
}
