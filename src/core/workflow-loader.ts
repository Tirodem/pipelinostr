/**
 * Workflow loader (ADR-009 flat format)
 *
 * Loads workflow YAML files from a directory.
 * Validates structure. Manages workflow storage tables (ADR-004).
 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import type { Logger } from 'pino';
import type { WorkflowDefinition } from './types.js';
import type { WorkflowTableStorage } from '../storage/storage.port.js';

export class WorkflowLoader {
  private workflows = new Map<string, WorkflowDefinition>();

  constructor(
    private logger: Logger,
    private workflowTables?: WorkflowTableStorage,
  ) {}

  /**
   * Load all workflow YAML files from a directory.
   * Files ending in .example are skipped.
   */
  loadFromDirectory(dir: string): Map<string, WorkflowDefinition> {
    if (!fs.existsSync(dir)) {
      this.logger.warn({ dir }, 'Workflow directory not found');
      return this.workflows;
    }

    const files = fs.readdirSync(dir)
      .filter((f) => (f.endsWith('.yml') || f.endsWith('.yaml')) && !f.endsWith('.example'));

    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(dir, file), 'utf-8');
        const parsed = YAML.parse(raw) as WorkflowDefinition;

        if (!this.validateWorkflow(parsed, file)) continue;

        // Default enabled to true (ADR-009)
        if (parsed.enabled === undefined) {
          parsed.enabled = true;
        }

        if (!parsed.enabled) {
          this.logger.debug({ id: parsed.id, file }, 'Workflow disabled, skipping');
          continue;
        }

        // Ensure storage table if declared (ADR-004)
        if (parsed.storage && this.workflowTables) {
          this.ensureWorkflowStorage(parsed);
        }

        this.workflows.set(parsed.id, parsed);
        this.logger.debug({ id: parsed.id, file }, 'Workflow loaded');
      } catch (err) {
        this.logger.warn({ file, error: (err as Error).message }, 'Failed to load workflow');
      }
    }

    this.logger.info({ count: this.workflows.size }, 'Workflows loaded');
    return this.workflows;
  }

  /**
   * Get a workflow by ID.
   */
  get(id: string): WorkflowDefinition | undefined {
    return this.workflows.get(id);
  }

  /**
   * Get all loaded workflows.
   */
  getAll(): Map<string, WorkflowDefinition> {
    return this.workflows;
  }

  private validateWorkflow(wf: WorkflowDefinition, file: string): boolean {
    // S-001: YAML parsed (already done if we're here)
    // S-002: Required fields
    if (!wf.id) {
      this.logger.warn({ file }, 'Workflow missing "id" field, skipping');
      return false;
    }
    if (!wf.trigger) {
      this.logger.warn({ file, id: wf.id }, 'Workflow missing "trigger" field, skipping');
      return false;
    }
    if (!wf.actions || wf.actions.length === 0) {
      this.logger.warn({ file, id: wf.id }, 'Workflow has no actions, skipping');
      return false;
    }

    // S-004: Unique action IDs
    const actionIds = new Set<string>();
    for (const action of wf.actions) {
      if (!action.id) {
        this.logger.warn({ file, id: wf.id }, 'Action missing "id" field, skipping workflow');
        return false;
      }
      if (actionIds.has(action.id)) {
        this.logger.warn({ file, id: wf.id, actionId: action.id }, 'Duplicate action ID, skipping workflow');
        return false;
      }
      actionIds.add(action.id);
    }

    return true;
  }

  /**
   * Ensure workflow storage table exists (ADR-004: additive-only).
   */
  private ensureWorkflowStorage(wf: WorkflowDefinition): void {
    if (!wf.storage || !this.workflowTables) return;

    const { table, columns, primary_key, indexes } = wf.storage;

    try {
      this.workflowTables.ensureTable(table, columns, primary_key);

      // Create indexes
      if (indexes) {
        // Note: index creation is handled separately via SQL
        // For now, log that indexes are declared
        this.logger.debug({ id: wf.id, table, indexes }, 'Workflow storage table ensured');
      }
    } catch (err) {
      this.logger.warn(
        { id: wf.id, table, error: (err as Error).message },
        'Failed to ensure workflow storage table'
      );
    }
  }
}
