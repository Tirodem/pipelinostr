import { logger } from '../persistence/logger.js';
import { getDatabase } from '../persistence/database.js';
import { withRetry, type RetryConfig, defaultRetryConfig } from '../utils/retry.js';
import type { ProcessedEvent } from '../inbound/nostr-listener.js';
import type { Handler, HandlerResult } from '../outbound/handler.interface.js';
import { WorkflowLoader } from './workflow-loader.js';
import { WorkflowMatcher } from './workflow-matcher.js';
import { expressionEvaluator } from './expression-evaluator.js';
import { lcdDisplay } from './lcd-display.js';
import type {
  WorkflowDefinition,
  WorkflowAction,
  WorkflowContext,
  WorkflowExecutionResult,
  ActionResult,
  TriggerContext,
  MatchResult,
  WorkflowHook,
  ParentWorkflowInfo,
} from './workflow.types.js';

// Hook record function type - called after hook execution to record history
export type HookRecordFn = (
  hookType: 'on_start' | 'on_complete' | 'on_fail',
  parentWorkflowId: string,
  parentWorkflowName: string,
  targetWorkflowId: string,
  targetWorkflowName: string,
  success: boolean,
  error?: string,
  context?: WorkflowContext
) => void;

// Error notification config type
interface ErrorNotificationConfig {
  enabled: boolean;
  dm_triggers_only?: boolean;
}

export class WorkflowEngine {
  private loader: WorkflowLoader;
  private matcher: WorkflowMatcher;
  private handlers: Map<string, Handler> = new Map();
  private globalRetryConfig: RetryConfig;
  private hookRecorder?: HookRecordFn | undefined;
  private errorNotificationConfig?: ErrorNotificationConfig;

  constructor(options: {
    workflowsDir?: string;
    whitelistNpubs?: string[];
    retryConfig?: RetryConfig;
  } = {}) {
    this.loader = new WorkflowLoader(options.workflowsDir);
    this.matcher = new WorkflowMatcher(options.whitelistNpubs ?? []);
    this.globalRetryConfig = options.retryConfig ?? defaultRetryConfig;
  }

  // Set error notification config
  setErrorNotificationConfig(config: ErrorNotificationConfig): void {
    this.errorNotificationConfig = config;
    if (config.enabled) {
      logger.info({ dmTriggersOnly: config.dm_triggers_only ?? true }, 'Error notification enabled');
    }
  }

  // Set hook recorder for history tracking
  setHookRecorder(fn: HookRecordFn): void {
    this.hookRecorder = fn;
  }

  // Initialize: load workflows
  async initialize(): Promise<void> {
    await this.loader.loadAll();
    logger.info('Workflow engine initialized');
  }

  // Register a handler
  registerHandler(type: string, handler: Handler): void {
    this.handlers.set(type, handler);
    logger.debug({ type }, 'Handler registered');
  }

  // Update whitelist
  updateWhitelist(npubs: string[]): void {
    this.matcher.updateWhitelist(npubs);
  }

  // Result type for processEventWithMatchInfo
  static readonly MATCH_STATUS = {
    EXECUTED: 'executed',       // Workflows matched and executed
    NO_MATCH: 'no_match',       // No workflow matched
    ALL_DISABLED: 'all_disabled', // Workflows matched but all disabled
  } as const;

  // Process an incoming event with detailed match info
  async processEventWithMatchInfo(event: ProcessedEvent): Promise<{
    status: typeof WorkflowEngine.MATCH_STATUS[keyof typeof WorkflowEngine.MATCH_STATUS];
    results: WorkflowExecutionResult[];
    disabledMatches: Array<{ workflowId: string; workflowName: string }>;
  }> {
    const allWorkflows = this.loader.getAllWorkflows();
    const { enabled, disabled } = this.matcher.findMatchesWithDisabled(event, allWorkflows);

    const disabledMatches = disabled.map(({ workflow }) => ({
      workflowId: workflow.id,
      workflowName: workflow.name,
    }));

    // No matches at all
    if (enabled.length === 0 && disabled.length === 0) {
      logger.debug({ eventId: event.id }, 'No workflow matched');
      return {
        status: WorkflowEngine.MATCH_STATUS.NO_MATCH,
        results: [],
        disabledMatches: [],
      };
    }

    // Only disabled matches
    if (enabled.length === 0) {
      logger.debug(
        { eventId: event.id, disabledWorkflows: disabledMatches.map((m) => m.workflowId) },
        'Workflows matched but all disabled'
      );
      return {
        status: WorkflowEngine.MATCH_STATUS.ALL_DISABLED,
        results: [],
        disabledMatches,
      };
    }

    // Execute enabled workflows
    const results: WorkflowExecutionResult[] = [];

    for (const { workflow, match, context } of enabled) {
      try {
        const result = await this.executeWorkflow(workflow, match, context);
        results.push(result);

        // Log to database
        this.updateEventLog(event, workflow, result);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(
          { workflowId: workflow.id, error: errorMessage },
          'Workflow execution failed'
        );

        results.push({
          workflowId: workflow.id,
          workflowName: workflow.name,
          success: false,
          actionsExecuted: 0,
          actionsFailed: 1,
          actionsSkipped: 0,
          error: errorMessage,
          context: {
            trigger: context,
            match: match.groups,
            actions: {},
          },
        });
      }
    }

    return {
      status: WorkflowEngine.MATCH_STATUS.EXECUTED,
      results,
      disabledMatches,
    };
  }

  // Process an incoming event (legacy method)
  async processEvent(event: ProcessedEvent): Promise<WorkflowExecutionResult[]> {
    const { results } = await this.processEventWithMatchInfo(event);
    return results;
  }

  private async executeWorkflow(
    workflow: WorkflowDefinition,
    match: MatchResult,
    triggerContext: TriggerContext,
    parentInfo?: ParentWorkflowInfo
  ): Promise<WorkflowExecutionResult> {
    logger.info({ workflowId: workflow.id, workflowName: workflow.name }, 'Executing workflow');

    // Update LCD display (only for top-level workflows, not hooks)
    if (!parentInfo) {
      // Try to fetch profile name with short timeout before displaying
      const triggerSource = await lcdDisplay.formatTriggerSourceAsync(triggerContext.from);
      lcdDisplay.showProcessing(workflow.name, triggerSource).catch(() => {});
    }

    const context: WorkflowContext = {
      trigger: triggerContext,
      match: match.groups,
      actions: {},
      variables: workflow.variables,
      parent: parentInfo,
    };

    let actionsExecuted = 0;
    let actionsFailed = 0;
    let actionsSkipped = 0;
    const actionErrors: string[] = [];

    // Execute on_start hooks (in parallel, don't wait)
    if (workflow.hooks?.on_start) {
      this.executeHooks(workflow.hooks.on_start, context, workflow, 'on_start');
    }

    // Execute actions sequentially
    let stoppedByActionHook = false;

    for (const action of workflow.actions) {
      // Skip remaining actions if workflow was stopped by an action-level on_fail hook
      if (stoppedByActionHook) {
        actionsSkipped++;
        context.actions[action.id] = { success: true, skipped: true };
        continue;
      }

      const actionResult = await this.executeAction(action, context, workflow);

      context.actions[action.id] = actionResult;

      if (actionResult.skipped) {
        actionsSkipped++;
      } else if (actionResult.success) {
        actionsExecuted++;
      } else {
        actionsFailed++;
        // Collect error messages from failed actions
        if (actionResult.error) {
          actionErrors.push(`${action.id}: ${actionResult.error}`);
        } else {
          actionErrors.push(`${action.id}: unknown error`);
        }

        // Check for action-level on_fail hook
        if (action.on_fail) {
          const hookWorkflow = this.loader.getWorkflow(action.on_fail.workflow);
          if (hookWorkflow && hookWorkflow.enabled) {
            logger.info(
              { workflowId: workflow.id, actionId: action.id, hookWorkflow: action.on_fail.workflow },
              'Action failed, executing on_fail hook and stopping workflow'
            );

            // Build parent info for the hook workflow
            const hookParentInfo: ParentWorkflowInfo = {
              id: workflow.id,
              name: workflow.name,
              success: false,
              actionsExecuted,
              actionsFailed,
              actionsSkipped,
              error: actionResult.error,
              variables: workflow.variables,
            };

            // Create match result for the hook
            const hookMatch: MatchResult = action.on_fail.pass_context !== false
              ? { matched: true, groups: context.match }
              : { matched: true, groups: {} };

            // Execute hook workflow (don't await to not block, but log result)
            this.executeWorkflow(hookWorkflow, hookMatch, context.trigger, hookParentInfo)
              .then((result) => {
                this.hookRecorder?.(
                  'on_fail',
                  workflow.id,
                  workflow.name,
                  hookWorkflow.id,
                  hookWorkflow.name,
                  result.success,
                  result.error,
                  result.context
                );
              })
              .catch((error) => {
                const errorMessage = error instanceof Error ? error.message : String(error);
                logger.error({ hookWorkflow: action.on_fail!.workflow, error: errorMessage }, 'Action on_fail hook failed');
              });

            // Stop processing remaining actions
            stoppedByActionHook = true;
          } else {
            logger.warn(
              { workflowId: workflow.id, actionId: action.id, hookWorkflow: action.on_fail.workflow },
              'Action on_fail hook workflow not found or disabled'
            );
          }
        }
      }

      // Log action execution
      this.logActionExecution(workflow, action, actionResult);
    }

    const success = actionsFailed === 0;

    logger.info(
      {
        workflowId: workflow.id,
        success,
        executed: actionsExecuted,
        failed: actionsFailed,
        skipped: actionsSkipped,
      },
      'Workflow completed'
    );

    // Update LCD display with completion status (only for top-level workflows)
    if (!parentInfo) {
      lcdDisplay.showComplete(success).catch(() => {});
    }

    const result: WorkflowExecutionResult = {
      workflowId: workflow.id,
      workflowName: workflow.name,
      success,
      actionsExecuted,
      actionsFailed,
      actionsSkipped,
      error: actionErrors.length > 0 ? actionErrors.join('; ') : undefined,
      context,
    };

    // Execute on_complete or on_fail hooks
    if (success && workflow.hooks?.on_complete) {
      await this.executeHooks(workflow.hooks.on_complete, context, workflow, 'on_complete', result);
    } else if (!success && workflow.hooks?.on_fail) {
      await this.executeHooks(workflow.hooks.on_fail, context, workflow, 'on_fail', result);
    }

    // Send error notification DM if enabled and conditions are met
    if (!success && !parentInfo && this.errorNotificationConfig?.enabled) {
      await this.sendErrorNotification(workflow.id, result.error ?? 'Unknown error', triggerContext);
    }

    return result;
  }

  // Send error notification DM to the trigger source
  private async sendErrorNotification(
    workflowId: string,
    error: string,
    trigger: TriggerContext
  ): Promise<void> {
    // Check if dm_triggers_only is set (default: true) and trigger is a DM
    const dmTriggersOnly = this.errorNotificationConfig?.dm_triggers_only ?? true;
    const isDmTrigger = trigger.kind === 4 || trigger.kind === 1059;

    if (dmTriggersOnly && !isDmTrigger) {
      logger.debug({ workflowId, kind: trigger.kind }, 'Error notification skipped (not a DM trigger)');
      return;
    }

    // Get the nostr_dm handler
    const dmHandler = this.handlers.get('nostr_dm');
    if (!dmHandler) {
      logger.warn('Error notification: nostr_dm handler not available');
      return;
    }

    try {
      const errorMessage = `❌ Workflow error\n\nWorkflow: ${workflowId}\nError: ${error}`;

      await dmHandler.execute(
        {
          to: trigger.from,
          content: errorMessage,
          dm_format: trigger.dm_format, // Reply in same format as received
        },
        { trigger }
      );

      logger.info({ workflowId, to: trigger.from }, 'Error notification sent');
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error({ workflowId, error: errMsg }, 'Failed to send error notification');
    }
  }

  // Execute workflow hooks
  private async executeHooks(
    hooks: WorkflowHook[],
    context: WorkflowContext,
    parentWorkflow: WorkflowDefinition,
    hookType: 'on_start' | 'on_complete' | 'on_fail',
    executionResult?: WorkflowExecutionResult
  ): Promise<void> {
    for (const hook of hooks) {
      try {
        // Check condition if present
        if (hook.when) {
          const shouldExecute = expressionEvaluator.evaluate(hook.when, context);
          if (!shouldExecute) {
            logger.debug({ hookType, workflowId: hook.workflow_id, condition: hook.when }, 'Hook skipped (condition false)');
            continue;
          }
        }

        // Get the target workflow
        const targetWorkflow = this.loader.getWorkflow(hook.workflow_id);
        if (!targetWorkflow) {
          logger.warn({ hookType, workflowId: hook.workflow_id }, 'Hook target workflow not found');
          continue;
        }

        if (!targetWorkflow.enabled) {
          logger.debug({ hookType, workflowId: hook.workflow_id }, 'Hook target workflow is disabled');
          continue;
        }

        // Build parent info for the child workflow
        const parentInfo: ParentWorkflowInfo = {
          id: parentWorkflow.id,
          name: parentWorkflow.name,
          success: executionResult?.success ?? true,
          actionsExecuted: executionResult?.actionsExecuted ?? 0,
          actionsFailed: executionResult?.actionsFailed ?? 0,
          actionsSkipped: executionResult?.actionsSkipped ?? 0,
          error: executionResult?.error,
          variables: parentWorkflow.variables,
        };

        logger.info({ hookType, parentId: parentWorkflow.id, targetId: hook.workflow_id }, 'Executing hook');

        // Create a match result for the child (empty if not passing context)
        const childMatch: MatchResult = hook.pass_context !== false
          ? { matched: true, groups: context.match }
          : { matched: true, groups: {} };

        // Execute the target workflow and record result
        if (hookType === 'on_start') {
          // on_start hooks run in parallel (fire and forget)
          this.executeWorkflow(targetWorkflow, childMatch, context.trigger, parentInfo)
            .then((result) => {
              // Record successful execution
              this.hookRecorder?.(
                hookType,
                parentWorkflow.id,
                parentWorkflow.name,
                targetWorkflow.id,
                targetWorkflow.name,
                result.success,
                result.error,
                result.context
              );
            })
            .catch((error) => {
              const errorMessage = error instanceof Error ? error.message : String(error);
              logger.error({ hookType, workflowId: hook.workflow_id, error: errorMessage }, 'Hook workflow failed');
              // Record failed execution
              this.hookRecorder?.(
                hookType,
                parentWorkflow.id,
                parentWorkflow.name,
                targetWorkflow.id,
                targetWorkflow.name,
                false,
                errorMessage
              );
            });
        } else {
          // on_complete and on_fail hooks run sequentially
          try {
            const result = await this.executeWorkflow(targetWorkflow, childMatch, context.trigger, parentInfo);
            // Record execution result
            this.hookRecorder?.(
              hookType,
              parentWorkflow.id,
              parentWorkflow.name,
              targetWorkflow.id,
              targetWorkflow.name,
              result.success,
              result.error,
              result.context
            );
          } catch (execError) {
            const errorMessage = execError instanceof Error ? execError.message : String(execError);
            logger.error({ hookType, workflowId: hook.workflow_id, error: errorMessage }, 'Hook workflow failed');
            // Record failed execution
            this.hookRecorder?.(
              hookType,
              parentWorkflow.id,
              parentWorkflow.name,
              targetWorkflow.id,
              targetWorkflow.name,
              false,
              errorMessage
            );
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error({ hookType, workflowId: hook.workflow_id, error: errorMessage }, 'Hook execution failed');
      }
    }
  }

  private async executeAction(
    action: WorkflowAction,
    context: WorkflowContext,
    workflow: WorkflowDefinition
  ): Promise<ActionResult> {
    // Check condition
    if (action.when) {
      const shouldExecute = expressionEvaluator.evaluate(action.when, context);
      if (!shouldExecute) {
        logger.debug({ actionId: action.id, condition: action.when }, 'Action skipped (condition false)');
        return { success: true, skipped: true };
      }
    }

    // Get handler
    const handler = this.handlers.get(action.type);
    if (!handler) {
      logger.error({ actionId: action.id, type: action.type }, 'Handler not found');
      return { success: false, error: `Handler not found: ${action.type}` };
    }

    // Render config templates
    const renderedConfig = this.renderConfig(action.config, context);

    // Build retry config
    const retryConfig = this.buildRetryConfig(action);

    // Execute with retry
    try {
      const result = await withRetry(
        async () => {
          return await handler.execute(renderedConfig, context as unknown as Record<string, unknown>);
        },
        retryConfig,
        `${workflow.id}/${action.id}`
      );

      return {
        success: result.success,
        error: result.error,
        response: result.data,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  private renderConfig(
    config: Record<string, unknown>,
    context: WorkflowContext
  ): Record<string, unknown> {
    const rendered: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(config)) {
      if (typeof value === 'string') {
        rendered[key] = expressionEvaluator.renderTemplate(value, context);
      } else if (Array.isArray(value)) {
        rendered[key] = value.map((item) => {
          if (typeof item === 'string') {
            return expressionEvaluator.renderTemplate(item, context);
          }
          if (typeof item === 'object' && item !== null) {
            return this.renderConfig(item as Record<string, unknown>, context);
          }
          return item;
        });
      } else if (typeof value === 'object' && value !== null) {
        rendered[key] = this.renderConfig(value as Record<string, unknown>, context);
      } else {
        rendered[key] = value;
      }
    }

    return rendered;
  }

  private buildRetryConfig(action: WorkflowAction): RetryConfig {
    if (!action.retry) {
      return this.globalRetryConfig;
    }

    const multiplier = action.retry.backoff?.multiplier ?? this.globalRetryConfig.backoff.multiplier ?? 2;

    return {
      maxAttempts: action.retry.max_attempts ?? this.globalRetryConfig.maxAttempts,
      backoff: {
        type: action.retry.backoff?.type ?? this.globalRetryConfig.backoff.type,
        initialDelayMs: action.retry.backoff?.initial_delay_ms ?? this.globalRetryConfig.backoff.initialDelayMs,
        multiplier,
        maxDelayMs: action.retry.backoff?.max_delay_ms ?? this.globalRetryConfig.backoff.maxDelayMs,
      },
    };
  }

  private updateEventLog(
    event: ProcessedEvent,
    workflow: WorkflowDefinition,
    result: WorkflowExecutionResult
  ): void {
    try {
      const db = getDatabase();
      // Find the event log entry and update it
      const logs = db.getRecentEventLogs(10);
      const log = logs.find((l) => l.source_raw?.includes(event.id));

      if (log?.id) {
        db.updateEventLogStatus(
          log.id,
          result.success ? 'success' : 'fail_after_retries',
          {
            workflow_id: workflow.id,
            workflow_name: workflow.name,
            workflow_matched_at: new Date(),
            workflow_completed_at: new Date(),
            error_message: result.error,
          }
        );
      }
    } catch (error) {
      logger.error({ error }, 'Failed to update event log');
    }
  }

  private logActionExecution(
    workflow: WorkflowDefinition,
    action: WorkflowAction,
    result: ActionResult
  ): void {
    try {
      const db = getDatabase();
      db.insertWorkflowExecution({
        event_log_id: null, // Optional - not linked to event_log
        workflow_id: workflow.id,
        action_id: action.id,
        action_type: action.type,
        started_at: new Date(),
        completed_at: new Date(),
        status: result.skipped ? 'skipped' : result.success ? 'success' : 'failed',
        attempt_number: 1,
        output_data: result.response ? JSON.stringify(result.response) : undefined,
        error_message: result.error,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to log action execution');
    }
  }

  // Reload workflows
  async reloadWorkflows(): Promise<void> {
    await this.loader.reload();
    logger.info('Workflows reloaded');
  }

  // Get workflow stats
  getStats(): {
    totalWorkflows: number;
    enabledWorkflows: number;
    handlers: string[];
  } {
    return {
      totalWorkflows: this.loader.getAllWorkflows().length,
      enabledWorkflows: this.loader.getEnabledWorkflows().length,
      handlers: Array.from(this.handlers.keys()),
    };
  }

  // Get all handler types used by enabled workflows
  // Used for lazy initialization of daemon-based handlers
  getUsedHandlerTypes(): Set<string> {
    const usedTypes = new Set<string>();
    const enabledWorkflows = this.loader.getEnabledWorkflows();

    for (const workflow of enabledWorkflows) {
      for (const action of workflow.actions) {
        usedTypes.add(action.type);
      }
    }

    return usedTypes;
  }

  // Check if a specific handler type is used by any enabled workflow
  isHandlerTypeUsed(type: string): boolean {
    return this.getUsedHandlerTypes().has(type);
  }

}
