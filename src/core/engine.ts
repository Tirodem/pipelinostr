/**
 * Workflow engine
 *
 * Executes matched workflows: actions sequentially, when clauses,
 * on_fail/on_complete/on_start hooks with depth guard.
 * Shallow-copies variables (devB feedback).
 */

import type { Logger } from 'pino';
import type {
  WorkflowDefinition, WorkflowAction, WorkflowContext,
  WorkflowExecutionResult, ActionResult, TriggerContext,
  ParentWorkflowInfo, NormalizedEvent, MatchResult,
} from './types.js';
import type { HandlerRegistry } from '../handlers/registry.js';
import { TemplateEngine } from './template.js';
import { ExpressionEvaluator } from './expression.js';

const DEFAULT_MAX_HOOK_DEPTH = 10;

export class WorkflowEngine {
  private templateEngine: TemplateEngine;
  private expressionEvaluator: ExpressionEvaluator;
  private maxHookDepth: number;
  private workflows: Map<string, WorkflowDefinition>;

  constructor(
    private registry: HandlerRegistry,
    private logger: Logger,
    options: { maxHookDepth?: number } = {},
  ) {
    this.templateEngine = new TemplateEngine();
    this.expressionEvaluator = new ExpressionEvaluator();
    this.maxHookDepth = options.maxHookDepth ?? DEFAULT_MAX_HOOK_DEPTH;
    this.workflows = new Map();
  }

  setWorkflows(workflows: Map<string, WorkflowDefinition>): void {
    this.workflows = workflows;
  }

  /**
   * Execute a workflow for a matched event.
   */
  async execute(
    workflow: WorkflowDefinition,
    event: NormalizedEvent,
    match: MatchResult,
    parentInfo?: ParentWorkflowInfo,
    hookDepth = 0,
    visitedWorkflows = new Set<string>(),
  ): Promise<WorkflowExecutionResult> {
    // Hook depth guard (devB feedback: prevent infinite recursion)
    if (hookDepth > this.maxHookDepth) {
      const error = `Max hook depth (${this.maxHookDepth}) exceeded. Chain: ${Array.from(visitedWorkflows).join(' → ')} → ${workflow.id}`;
      this.logger.error({ workflowId: workflow.id, depth: hookDepth }, error);
      return this.buildResult(workflow, { error, success: false });
    }

    // Cycle detection
    if (visitedWorkflows.has(workflow.id)) {
      const error = `Circular hook detected: ${Array.from(visitedWorkflows).join(' → ')} → ${workflow.id}`;
      this.logger.error({ workflowId: workflow.id }, error);
      return this.buildResult(workflow, { error, success: false });
    }

    const visited = new Set(visitedWorkflows);
    visited.add(workflow.id);

    this.logger.info({ workflowId: workflow.id, workflowName: workflow.name }, 'Executing workflow');

    // Build context — shallow-copy variables (devB feedback)
    const context: WorkflowContext = {
      trigger: this.buildTriggerContext(event),
      match: match.groups,
      actions: {},
      variables: { ...(workflow.variables ?? {}) },
      parent: parentInfo,
    };

    // Fire on_start hooks (non-blocking)
    if (workflow.hooks?.on_start) {
      this.fireHooks(workflow.hooks.on_start, workflow, event, match, context, hookDepth, visited);
    }

    // Execute actions sequentially
    let actionsExecuted = 0;
    let actionsFailed = 0;
    let actionsSkipped = 0;
    let workflowError: string | undefined;

    for (const action of workflow.actions) {
      // Evaluate when clause
      if (action.when) {
        const shouldRun = this.expressionEvaluator.evaluate(action.when, context);
        if (!shouldRun) {
          context.actions[action.id] = { success: false, skipped: true };
          actionsSkipped++;
          this.logger.debug({ workflowId: workflow.id, actionId: action.id }, 'Action skipped (when clause)');
          continue;
        }
      }

      // Execute action
      const result = await this.executeAction(action, context, workflow.id);
      context.actions[action.id] = result;
      actionsExecuted++;

      if (!result.success) {
        actionsFailed++;
        this.logger.warn(
          { workflowId: workflow.id, actionId: action.id, error: result.error },
          'Action failed'
        );

        // Action-level on_fail hook — stops remaining actions
        if (action.on_fail) {
          const failWorkflow = this.workflows.get(action.on_fail.workflow);
          if (failWorkflow) {
            const parentCtx = this.buildParentInfo(workflow, context, false, actionsExecuted, actionsFailed, actionsSkipped, result.error);
            await this.execute(failWorkflow, event, match, parentCtx, hookDepth + 1, visited);
          }
          workflowError = result.error;
          break; // Stop remaining actions
        }
      }
    }

    const success = actionsFailed === 0 && !workflowError;

    // Fire hooks
    if (success && workflow.hooks?.on_complete) {
      const parentCtx = this.buildParentInfo(workflow, context, true, actionsExecuted, actionsFailed, actionsSkipped);
      await this.executeHooks(workflow.hooks.on_complete, workflow, event, match, parentCtx, hookDepth, visited);
    } else if (!success && workflow.hooks?.on_fail) {
      const parentCtx = this.buildParentInfo(workflow, context, false, actionsExecuted, actionsFailed, actionsSkipped, workflowError);
      await this.executeHooks(workflow.hooks.on_fail, workflow, event, match, parentCtx, hookDepth, visited);
    }

    const result = this.buildResult(workflow, {
      success,
      actionsExecuted,
      actionsFailed,
      actionsSkipped,
      error: workflowError,
      context,
    });

    this.logger.info(
      { workflowId: workflow.id, success, actionsExecuted, actionsFailed, actionsSkipped },
      'Workflow execution complete'
    );

    return result;
  }

  /**
   * Execute a single action.
   */
  private async executeAction(
    action: WorkflowAction,
    context: WorkflowContext,
    workflowId: string,
  ): Promise<ActionResult> {
    const handler = this.registry.get(action.type);
    if (!handler) {
      const status = this.registry.getStatus(action.type);
      const error = status?.error
        ? `Handler "${action.type}" unavailable: ${status.error}`
        : `Handler "${action.type}" not found`;
      return { success: false, error };
    }

    // Extract handler params (everything except id, type, when, on_fail, retry, idempotent)
    const { id, type, when, on_fail, retry, idempotent, ...params } = action;

    // Render templates in params
    const renderedParams = this.templateEngine.renderObject(params, context) as Record<string, unknown>;

    try {
      const result = await handler.execute(renderedParams, {
        trigger: context.trigger as Record<string, unknown>,
        match: context.match,
        actions: context.actions as Record<string, unknown>,
        variables: context.variables,
        parent: context.parent as Record<string, unknown> | undefined,
      });

      return {
        success: result.success,
        error: result.error,
        response: result.data,
      };
    } catch (err) {
      return {
        success: false,
        error: (err as Error).message,
      };
    }
  }

  /**
   * Execute hook workflows (blocking).
   */
  private async executeHooks(
    hooks: Array<{ workflow_id: string; when?: string; pass_context?: boolean }>,
    parentWorkflow: WorkflowDefinition,
    event: NormalizedEvent,
    match: MatchResult,
    parentInfo: ParentWorkflowInfo,
    hookDepth: number,
    visited: Set<string>,
  ): Promise<void> {
    for (const hook of hooks) {
      // Evaluate hook when clause
      if (hook.when) {
        const dummyContext: WorkflowContext = {
          trigger: this.buildTriggerContext(event),
          match: match.groups,
          actions: {},
          variables: parentInfo.variables ?? {},
          parent: parentInfo,
        };
        if (!this.expressionEvaluator.evaluate(hook.when, dummyContext)) {
          continue;
        }
      }

      const hookWorkflow = this.workflows.get(hook.workflow_id);
      if (!hookWorkflow) {
        this.logger.warn(
          { parentWorkflow: parentWorkflow.id, hookWorkflowId: hook.workflow_id },
          'Hook references non-existent workflow'
        );
        continue;
      }

      await this.execute(
        hookWorkflow,
        event,
        match,
        hook.pass_context !== false ? parentInfo : undefined,
        hookDepth + 1,
        visited,
      );
    }
  }

  /**
   * Fire hooks non-blocking (for on_start).
   */
  private fireHooks(
    hooks: Array<{ workflow_id: string; when?: string; pass_context?: boolean }>,
    parentWorkflow: WorkflowDefinition,
    event: NormalizedEvent,
    match: MatchResult,
    context: WorkflowContext,
    hookDepth: number,
    visited: Set<string>,
  ): void {
    const parentInfo = this.buildParentInfo(
      parentWorkflow, context, true, 0, 0, 0,
    );
    // Fire and forget
    this.executeHooks(hooks, parentWorkflow, event, match, parentInfo, hookDepth, visited)
      .catch((err) => {
        this.logger.error({ error: (err as Error).message }, 'on_start hook failed');
      });
  }

  private buildTriggerContext(event: NormalizedEvent): TriggerContext {
    return {
      source: event.source,
      origin: event.origin,
      type: event.type,
      sender: event.sender,
      content: event.content,
      timestamp: event.timestamp,
      // Spread metadata for template access (trigger.dm_format, trigger.zap.amount, etc.)
      ...event.metadata,
      // Keep backward compat
      from: event.sender,
      raw: event.raw,
    };
  }

  private buildParentInfo(
    workflow: WorkflowDefinition,
    context: WorkflowContext,
    success: boolean,
    actionsExecuted: number,
    actionsFailed: number,
    actionsSkipped: number,
    error?: string,
  ): ParentWorkflowInfo {
    return {
      id: workflow.id,
      name: workflow.name,
      success,
      actionsExecuted,
      actionsFailed,
      actionsSkipped,
      error,
      variables: { ...(workflow.variables ?? {}) },
    };
  }

  private buildResult(
    workflow: WorkflowDefinition,
    overrides: Partial<WorkflowExecutionResult> & { success: boolean },
  ): WorkflowExecutionResult {
    return {
      workflowId: workflow.id,
      workflowName: workflow.name,
      success: overrides.success,
      actionsExecuted: overrides.actionsExecuted ?? 0,
      actionsFailed: overrides.actionsFailed ?? 0,
      actionsSkipped: overrides.actionsSkipped ?? 0,
      error: overrides.error,
      context: overrides.context ?? {
        trigger: {} as TriggerContext,
        match: {},
        actions: {},
        variables: {},
      },
    };
  }
}
