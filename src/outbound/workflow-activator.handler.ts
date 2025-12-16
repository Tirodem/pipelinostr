import { writeFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../persistence/logger.js';
import { ClaudeHandler } from './claude.handler.js';
import type { Handler, HandlerResult, HandlerConfig } from './handler.interface.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..');

export interface WorkflowActivatorConfig extends HandlerConfig {
  action: 'activate' | 'cancel' | 'list';
  workflowId?: string;
}

export class WorkflowActivatorHandler implements Handler {
  readonly name = 'Workflow Activator Handler';
  readonly type = 'workflow_activator';

  private workflowsDir: string;
  private workflowReloader: (() => Promise<void>) | null = null;

  constructor(workflowsDir?: string) {
    this.workflowsDir = workflowsDir ?? join(PROJECT_ROOT, 'config', 'workflows');
  }

  // Set the workflow reloader function (called from index.ts)
  setWorkflowReloader(reloader: () => Promise<void>): void {
    this.workflowReloader = reloader;
  }

  async initialize(): Promise<void> {
    logger.info({ workflowsDir: this.workflowsDir }, 'Workflow activator handler initialized');
  }

  async execute(config: HandlerConfig, context: Record<string, unknown>): Promise<HandlerResult> {
    const activatorConfig = config as WorkflowActivatorConfig;
    const trigger = context['trigger'] as Record<string, unknown> | undefined;
    const userId = (trigger?.['from'] as string) ?? 'unknown';

    try {
      switch (activatorConfig.action) {
        case 'activate':
          return await this.activateWorkflow(activatorConfig.workflowId ?? '', userId);

        case 'cancel':
          return this.cancelWorkflow(activatorConfig.workflowId ?? '', userId);

        case 'list':
          return this.listPendingWorkflows(userId);

        default:
          return { success: false, error: `Action inconnue: ${activatorConfig.action}` };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage, action: activatorConfig.action }, 'Workflow activator error');
      return { success: false, error: errorMessage };
    }
  }

  private async activateWorkflow(workflowId: string, userId: string): Promise<HandlerResult> {
    if (!workflowId.trim()) {
      return { success: false, error: 'ID du workflow manquant. Utilisez: /activate <workflow-id>' };
    }

    // Get pending workflow
    const pending = ClaudeHandler.getPendingWorkflow(workflowId, userId);

    if (!pending) {
      return {
        success: false,
        error: `Workflow "${workflowId}" non trouvé ou expiré. Générez-en un nouveau avec /workflow`,
      };
    }

    // Sanitize workflow ID for filename
    const safeId = workflowId.replace(/[^a-zA-Z0-9-_]/g, '-');
    const filename = `${safeId}.yml`;
    const filepath = join(this.workflowsDir, filename);

    // Enable the workflow before writing
    let yamlContent = pending.yaml;
    yamlContent = yamlContent.replace(/enabled:\s*false/, 'enabled: true');

    // Write the file
    await writeFile(filepath, yamlContent, 'utf-8');

    logger.info({ workflowId, filepath, userId }, 'Workflow activated and written to disk');

    // Remove from pending
    ClaudeHandler.removePendingWorkflow(workflowId);

    // Reload workflows if reloader is set
    if (this.workflowReloader) {
      try {
        await this.workflowReloader();
        logger.info({ workflowId }, 'Workflows reloaded');
      } catch (error) {
        logger.warn({ error }, 'Failed to reload workflows, restart required');
      }
    }

    return {
      success: true,
      data: {
        workflowId,
        filepath,
        message: `Workflow "${workflowId}" activé et enregistré dans ${filename}`,
        reloaded: !!this.workflowReloader,
      },
    };
  }

  private cancelWorkflow(workflowId: string, userId: string): HandlerResult {
    if (!workflowId.trim()) {
      // Cancel all pending for this user
      const pending = ClaudeHandler.listPendingWorkflows(userId);
      for (const p of pending) {
        ClaudeHandler.removePendingWorkflow(p.id);
      }

      return {
        success: true,
        data: {
          cancelled: pending.length,
          message: `${pending.length} workflow(s) en attente annulé(s)`,
        },
      };
    }

    const pending = ClaudeHandler.getPendingWorkflow(workflowId, userId);

    if (!pending) {
      return {
        success: false,
        error: `Workflow "${workflowId}" non trouvé`,
      };
    }

    ClaudeHandler.removePendingWorkflow(workflowId);

    return {
      success: true,
      data: {
        workflowId,
        message: `Workflow "${workflowId}" annulé`,
      },
    };
  }

  private listPendingWorkflows(userId: string): HandlerResult {
    const pending = ClaudeHandler.listPendingWorkflows(userId);

    if (pending.length === 0) {
      return {
        success: true,
        data: {
          count: 0,
          message: 'Aucun workflow en attente',
          workflows: [],
        },
      };
    }

    const workflows = pending.map(p => ({
      id: p.id,
      description: p.description,
      createdAt: new Date(p.createdAt).toISOString(),
      expiresIn: Math.round((p.createdAt + 10 * 60 * 1000 - Date.now()) / 1000 / 60) + ' minutes',
    }));

    return {
      success: true,
      data: {
        count: pending.length,
        workflows,
        message: `${pending.length} workflow(s) en attente d'activation`,
      },
    };
  }

  async shutdown(): Promise<void> {
    logger.info('Workflow activator handler shut down');
  }
}
