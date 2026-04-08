/**
 * Workflow auditor (ADR-008)
 *
 * Static lint at startup. Validates workflows against rules.
 * Phase 1: structural, template, hook, and storage coherence checks.
 * Zero false positives policy.
 */

import type { Logger } from 'pino';
import type { WorkflowDefinition } from './types.js';
import type { HandlerRegistry } from '../handlers/registry.js';

export type AuditSeverity = 'error' | 'warn';

export interface AuditResult {
  ruleId: string;
  severity: AuditSeverity;
  workflowId: string;
  message: string;
}

interface AuditRule {
  id: string;
  severity: AuditSeverity;
  check(workflow: WorkflowDefinition, context: AuditContext): AuditResult[];
}

interface AuditContext {
  allWorkflows: Map<string, WorkflowDefinition>;
  handlerTypes: Set<string>;
}

// --- Rules ---

const rules: AuditRule[] = [
  // S-003: Action type maps to a loaded handler
  {
    id: 'S-003',
    severity: 'error',
    check(wf, ctx) {
      const results: AuditResult[] = [];
      for (const action of wf.actions) {
        if (!ctx.handlerTypes.has(action.type)) {
          // Suggest similar handler names
          const similar = Array.from(ctx.handlerTypes)
            .filter((t) => t.includes(action.type) || action.type.includes(t))
            .join(', ');
          const hint = similar ? ` (did you mean: ${similar}?)` : '';
          results.push({
            ruleId: 'S-003',
            severity: 'error',
            workflowId: wf.id,
            message: `Action "${action.id}" references unknown handler "${action.type}"${hint}`,
          });
        }
      }
      return results;
    },
  },

  // T-001: Action reference exists and is sequenced before
  {
    id: 'T-001',
    severity: 'error',
    check(wf) {
      const results: AuditResult[] = [];
      const seenActions = new Set<string>();

      for (const action of wf.actions) {
        // Check all string values for {{ actions.X.* }} references
        const refs = findActionReferences(action);
        for (const ref of refs) {
          if (!seenActions.has(ref)) {
            const exists = wf.actions.some((a) => a.id === ref);
            if (!exists) {
              results.push({
                ruleId: 'T-001',
                severity: 'error',
                workflowId: wf.id,
                message: `Action "${action.id}" references non-existent action "${ref}"`,
              });
            } else {
              results.push({
                ruleId: 'T-001',
                severity: 'error',
                workflowId: wf.id,
                message: `Action "${action.id}" references action "${ref}" which hasn't executed yet (forward reference)`,
              });
            }
          }
        }
        seenActions.add(action.id);
      }
      return results;
    },
  },

  // T-002: Variables referenced are declared
  {
    id: 'T-002',
    severity: 'warn',
    check(wf) {
      const results: AuditResult[] = [];
      const declaredVars = new Set(Object.keys(wf.variables ?? {}));
      const referencedVars = findVariableReferences(wf);

      for (const varName of referencedVars) {
        if (!declaredVars.has(varName)) {
          results.push({
            ruleId: 'T-002',
            severity: 'warn',
            workflowId: wf.id,
            message: `References undeclared variable "{{ variables.${varName} }}"`,
          });
        }
      }
      return results;
    },
  },

  // H-001: Hook targets reference existing workflows
  {
    id: 'H-001',
    severity: 'error',
    check(wf, ctx) {
      const results: AuditResult[] = [];
      const allHooks = [
        ...(wf.hooks?.on_start ?? []),
        ...(wf.hooks?.on_complete ?? []),
        ...(wf.hooks?.on_fail ?? []),
      ];

      for (const hook of allHooks) {
        if (!ctx.allWorkflows.has(hook.workflow_id)) {
          results.push({
            ruleId: 'H-001',
            severity: 'error',
            workflowId: wf.id,
            message: `Hook references non-existent workflow "${hook.workflow_id}"`,
          });
        }
      }

      // Action-level on_fail hooks
      for (const action of wf.actions) {
        if (action.on_fail && !ctx.allWorkflows.has(action.on_fail.workflow)) {
          results.push({
            ruleId: 'H-001',
            severity: 'error',
            workflowId: wf.id,
            message: `Action "${action.id}" on_fail references non-existent workflow "${action.on_fail.workflow}"`,
          });
        }
      }

      return results;
    },
  },

  // H-003: Detect circular hook chains
  {
    id: 'H-003',
    severity: 'error',
    check(wf, ctx) {
      const results: AuditResult[] = [];
      const visited = new Set<string>();

      function walk(id: string, path: string[]): boolean {
        if (visited.has(id)) return false; // Already checked, no cycle from here
        if (path.includes(id)) {
          results.push({
            ruleId: 'H-003',
            severity: 'error',
            workflowId: wf.id,
            message: `Circular hook chain: ${[...path, id].join(' → ')}`,
          });
          return true;
        }

        const target = ctx.allWorkflows.get(id);
        if (!target) return false;

        const newPath = [...path, id];
        const hookIds = [
          ...(target.hooks?.on_start ?? []).map((h) => h.workflow_id),
          ...(target.hooks?.on_complete ?? []).map((h) => h.workflow_id),
          ...(target.hooks?.on_fail ?? []).map((h) => h.workflow_id),
          ...target.actions.filter((a) => a.on_fail).map((a) => a.on_fail!.workflow),
        ];

        for (const hookId of hookIds) {
          if (walk(hookId, newPath)) return true;
        }

        visited.add(id);
        return false;
      }

      walk(wf.id, []);
      return results;
    },
  },

  // D-001: Shared storage table schema compatibility
  {
    id: 'D-001',
    severity: 'warn',
    check(wf, ctx) {
      const results: AuditResult[] = [];
      if (!wf.storage) return results;

      for (const [otherId, other] of ctx.allWorkflows) {
        if (otherId === wf.id || !other.storage) continue;
        if (other.storage.table !== wf.storage.table) continue;

        // Same table — check column compatibility
        for (const [col, type] of Object.entries(wf.storage.columns)) {
          const otherType = other.storage.columns[col];
          if (otherType && otherType !== type) {
            results.push({
              ruleId: 'D-001',
              severity: 'warn',
              workflowId: wf.id,
              message: `Storage table "${wf.storage.table}" column "${col}" type mismatch: "${type}" here vs "${otherType}" in workflow "${otherId}"`,
            });
          }
        }
      }

      return results;
    },
  },
];

// --- Auditor ---

export class WorkflowAuditor {
  constructor(private logger: Logger) {}

  /**
   * Audit all workflows. Returns results grouped by workflow.
   * Workflows with ERROR-level results should be disabled.
   */
  audit(
    workflows: Map<string, WorkflowDefinition>,
    registry: HandlerRegistry,
  ): Map<string, AuditResult[]> {
    const handlerTypes = new Set(
      Array.from(registry.listAll().keys())
    );

    const context: AuditContext = {
      allWorkflows: workflows,
      handlerTypes,
    };

    const resultsByWorkflow = new Map<string, AuditResult[]>();

    for (const workflow of workflows.values()) {
      const workflowResults: AuditResult[] = [];

      for (const rule of rules) {
        const ruleResults = rule.check(workflow, context);
        workflowResults.push(...ruleResults);
      }

      if (workflowResults.length > 0) {
        resultsByWorkflow.set(workflow.id, workflowResults);

        for (const result of workflowResults) {
          const logFn = result.severity === 'error' ? this.logger.error.bind(this.logger) : this.logger.warn.bind(this.logger);
          logFn(
            { ruleId: result.ruleId, workflowId: result.workflowId },
            `[AUDIT] ${result.severity.toUpperCase()} ${result.ruleId}: ${result.message}`
          );
        }
      }
    }

    return resultsByWorkflow;
  }

  /**
   * Audit and auto-disable workflows with errors.
   * Returns the list of disabled workflow IDs.
   */
  auditAndDisable(
    workflows: Map<string, WorkflowDefinition>,
    registry: HandlerRegistry,
  ): string[] {
    const results = this.audit(workflows, registry);
    const disabled: string[] = [];

    for (const [workflowId, auditResults] of results) {
      const hasErrors = auditResults.some((r) => r.severity === 'error');
      if (hasErrors) {
        const workflow = workflows.get(workflowId);
        if (workflow) {
          workflow.enabled = false;
          disabled.push(workflowId);
          this.logger.warn(
            { workflowId, errors: auditResults.filter((r) => r.severity === 'error').length },
            'Workflow disabled due to audit errors'
          );
        }
      }
    }

    return disabled;
  }
}

// --- Helpers ---

function findActionReferences(action: Record<string, unknown>): string[] {
  const refs = new Set<string>();
  const pattern = /\{\{\s*actions\.(\w+)\./g;

  function scan(obj: unknown): void {
    if (typeof obj === 'string') {
      let match;
      while ((match = pattern.exec(obj)) !== null) {
        refs.add(match[1]!);
      }
      pattern.lastIndex = 0;
    } else if (Array.isArray(obj)) {
      obj.forEach(scan);
    } else if (obj !== null && typeof obj === 'object') {
      Object.values(obj as Record<string, unknown>).forEach(scan);
    }
  }

  scan(action);
  return Array.from(refs);
}

function findVariableReferences(wf: WorkflowDefinition): Set<string> {
  const refs = new Set<string>();
  const pattern = /\{\{\s*variables\.(\w+)\s*\}\}/g;

  function scan(obj: unknown): void {
    if (typeof obj === 'string') {
      let match;
      while ((match = pattern.exec(obj)) !== null) {
        refs.add(match[1]!);
      }
      pattern.lastIndex = 0;
    } else if (Array.isArray(obj)) {
      obj.forEach(scan);
    } else if (obj !== null && typeof obj === 'object') {
      Object.values(obj as Record<string, unknown>).forEach(scan);
    }
  }

  // Scan actions
  for (const action of wf.actions) {
    scan(action);
  }

  return refs;
}
