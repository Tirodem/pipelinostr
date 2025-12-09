import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { logger } from '../persistence/logger.js';
import type { WorkflowDefinition } from './workflow.types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..');

export class WorkflowLoader {
  private workflowsDir: string;
  private workflows: Map<string, WorkflowDefinition> = new Map();

  constructor(workflowsDir?: string) {
    this.workflowsDir = workflowsDir ?? join(PROJECT_ROOT, 'config', 'workflows');
  }

  async loadAll(): Promise<WorkflowDefinition[]> {
    this.workflows.clear();

    if (!existsSync(this.workflowsDir)) {
      logger.warn({ path: this.workflowsDir }, 'Workflows directory not found');
      return [];
    }

    const files = await readdir(this.workflowsDir);
    const yamlFiles = files.filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));

    logger.info({ count: yamlFiles.length, path: this.workflowsDir }, 'Loading workflows');

    for (const file of yamlFiles) {
      try {
        const workflow = await this.loadFile(join(this.workflowsDir, file));
        if (workflow) {
          this.workflows.set(workflow.id, workflow);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error({ file, error: errorMessage }, 'Failed to load workflow');
      }
    }

    const enabled = Array.from(this.workflows.values()).filter((w) => w.enabled);
    logger.info(
      { total: this.workflows.size, enabled: enabled.length },
      'Workflows loaded'
    );

    return Array.from(this.workflows.values());
  }

  private async loadFile(filePath: string): Promise<WorkflowDefinition | null> {
    const content = await readFile(filePath, 'utf-8');
    const raw = parseYaml(content) as Record<string, unknown>;

    // Validate required fields
    if (!raw['id'] || typeof raw['id'] !== 'string') {
      logger.warn({ file: filePath }, 'Workflow missing required field: id');
      return null;
    }

    if (!raw['trigger']) {
      logger.warn({ file: filePath, id: raw['id'] }, 'Workflow missing required field: trigger');
      return null;
    }

    if (!raw['actions'] || !Array.isArray(raw['actions'])) {
      logger.warn({ file: filePath, id: raw['id'] }, 'Workflow missing required field: actions');
      return null;
    }

    const workflow: WorkflowDefinition = {
      id: raw['id'] as string,
      name: (raw['name'] as string) ?? raw['id'],
      description: raw['description'] as string | undefined,
      enabled: raw['enabled'] !== false, // Default to true
      multiple: raw['multiple'] === true, // Default to false
      trigger: raw['trigger'] as WorkflowDefinition['trigger'],
      actions: (raw['actions'] as unknown[]).map((action, index) => {
        const a = action as Record<string, unknown>;
        return {
          id: (a['id'] as string) ?? `action_${index}`,
          type: a['type'] as string,
          config: (a['config'] as Record<string, unknown>) ?? {},
          when: a['when'] as string | undefined,
          retry: a['retry'] as WorkflowDefinition['actions'][0]['retry'],
        };
      }),
    };

    logger.debug({ id: workflow.id, name: workflow.name, enabled: workflow.enabled }, 'Workflow loaded');

    return workflow;
  }

  getWorkflow(id: string): WorkflowDefinition | undefined {
    return this.workflows.get(id);
  }

  getEnabledWorkflows(): WorkflowDefinition[] {
    return Array.from(this.workflows.values()).filter((w) => w.enabled);
  }

  getAllWorkflows(): WorkflowDefinition[] {
    return Array.from(this.workflows.values());
  }

  // Hot reload a single workflow
  async reloadWorkflow(id: string): Promise<boolean> {
    const files = await readdir(this.workflowsDir);

    for (const file of files) {
      if (!file.endsWith('.yml') && !file.endsWith('.yaml')) continue;

      try {
        const workflow = await this.loadFile(join(this.workflowsDir, file));
        if (workflow && workflow.id === id) {
          this.workflows.set(workflow.id, workflow);
          logger.info({ id }, 'Workflow reloaded');
          return true;
        }
      } catch {
        // Continue to next file
      }
    }

    return false;
  }

  // Reload all workflows
  async reload(): Promise<void> {
    await this.loadAll();
  }
}
