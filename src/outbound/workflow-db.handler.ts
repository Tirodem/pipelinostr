/**
 * Workflow DB Handler - Persistent state management for workflows
 *
 * System handler (always active) for workflow state operations.
 * Exposes workflow_state table operations for YAML workflows.
 *
 * Use cases:
 * - Balance tracking (zap credits, SATs)
 * - Counters (rate limiting, usage stats)
 * - Flags (user preferences, feature toggles)
 * - Arbitrary data storage
 */

import type { Handler, HandlerResult, HandlerConfig } from './handler.interface.js';
import { getDatabase } from '../persistence/database.js';
import { logger } from '../persistence/logger.js';

interface WorkflowDbHandlerConfig {
  enabled: boolean;
}

export interface WorkflowDbActionConfig extends HandlerConfig {
  action: 'get' | 'set' | 'increment' | 'decrement' | 'delete' | 'list' | 'check';

  // Common params
  workflow_id?: string;  // If not specified, uses current workflow ID
  namespace?: string;    // Default: 'default'
  key?: string;          // State key (required for most actions)

  // For 'set' action
  value?: number | string | boolean | Record<string, unknown>;
  value_type?: 'number' | 'string' | 'json' | 'boolean';

  // For 'increment'/'decrement' actions
  amount?: number;
  create_if_missing?: boolean;
  default_value?: number;
  max_value?: number;
  min_value?: number;
  track_history?: boolean;

  // For 'list' action
  key_pattern?: string;
  limit?: number;

  // For 'check' action
  operator?: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'exists' | 'not_exists';
  compare_value?: number | string | boolean;

  // Metadata
  source_event_id?: string;
  source_pubkey?: string;
}

export class WorkflowDbHandler implements Handler {
  readonly name = 'Workflow DB Handler';
  readonly type = 'workflow_db';

  private config: WorkflowDbHandlerConfig;

  constructor(config: WorkflowDbHandlerConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    logger.info('[WorkflowDB] Handler initialized');
  }

  async execute(config: HandlerConfig, context: Record<string, unknown>): Promise<HandlerResult> {
    const params = config as WorkflowDbActionConfig;
    const db = getDatabase();

    // Get workflow ID from context if not specified
    const workflowId = params.workflow_id || (context.workflow as { id?: string })?.id || 'unknown';
    const namespace = params.namespace || 'default';

    // Get source info from event if available
    const event = context.event as { id?: string; pubkey?: string } | undefined;
    const sourceEventId = params.source_event_id || event?.id;
    const sourcePubkey = params.source_pubkey || event?.pubkey;

    try {
      switch (params.action) {
        case 'get':
          return this.handleGet(db, workflowId, namespace, params);

        case 'set':
          return this.handleSet(db, workflowId, namespace, params, sourceEventId, sourcePubkey);

        case 'increment':
          return this.handleIncrement(db, workflowId, namespace, params, sourceEventId, sourcePubkey);

        case 'decrement':
          return this.handleDecrement(db, workflowId, namespace, params, sourceEventId, sourcePubkey);

        case 'delete':
          return this.handleDelete(db, workflowId, namespace, params);

        case 'list':
          return this.handleList(db, workflowId, namespace, params);

        case 'check':
          return this.handleCheck(db, workflowId, namespace, params);

        default:
          return {
            success: false,
            error: `Unknown action: ${params.action}`,
          };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage, action: params.action }, '[WorkflowDB] Action failed');
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  private handleGet(
    db: ReturnType<typeof getDatabase>,
    workflowId: string,
    namespace: string,
    params: WorkflowDbActionConfig
  ): HandlerResult {
    if (!params.key) {
      return { success: false, error: 'Missing required parameter: key' };
    }

    // DEBUG
    logger.info({ namespace, key: params.key }, '[WorkflowDB] GET lookup');

    const state = db.getState(workflowId, namespace, params.key);

    // DEBUG
    logger.info({ found: !!state, value: state?.value_number }, '[WorkflowDB] GET result');

    if (!state) {
      return {
        success: true,
        data: {
          found: false,
          key: params.key,
          value: null,
        },
      };
    }

    // Return the appropriate value based on type
    let value: unknown;
    switch (state.value_type) {
      case 'number':
        value = state.value_number;
        break;
      case 'string':
        value = state.value_string;
        break;
      case 'json':
        value = state.value_json;
        break;
      case 'boolean':
        value = state.value_boolean;
        break;
    }

    return {
      success: true,
      data: {
        found: true,
        key: params.key,
        value,
        value_type: state.value_type,
        updated_at: state.updated_at.toISOString(),
        source_pubkey: state.source_pubkey,
      },
    };
  }

  private handleSet(
    db: ReturnType<typeof getDatabase>,
    workflowId: string,
    namespace: string,
    params: WorkflowDbActionConfig,
    sourceEventId?: string,
    sourcePubkey?: string
  ): HandlerResult {
    if (!params.key) {
      return { success: false, error: 'Missing required parameter: key' };
    }
    if (params.value === undefined) {
      return { success: false, error: 'Missing required parameter: value' };
    }

    // Determine value type
    let valueType = params.value_type;
    if (!valueType) {
      if (typeof params.value === 'number') valueType = 'number';
      else if (typeof params.value === 'boolean') valueType = 'boolean';
      else if (typeof params.value === 'object') valueType = 'json';
      else valueType = 'string';
    }

    db.setState({
      workflow_id: workflowId,
      namespace,
      state_key: params.key,
      value_type: valueType,
      value_number: valueType === 'number' ? params.value as number : undefined,
      value_string: valueType === 'string' ? String(params.value) : undefined,
      value_json: valueType === 'json' ? params.value as Record<string, unknown> : undefined,
      value_boolean: valueType === 'boolean' ? params.value as boolean : undefined,
      source_event_id: sourceEventId,
      source_pubkey: sourcePubkey,
    });

    logger.debug({ workflowId, namespace, key: params.key, value: params.value }, '[WorkflowDB] Value set');

    return {
      success: true,
      data: {
        key: params.key,
        value: params.value,
        value_type: valueType,
      },
    };
  }

  private handleIncrement(
    db: ReturnType<typeof getDatabase>,
    workflowId: string,
    namespace: string,
    params: WorkflowDbActionConfig,
    sourceEventId?: string,
    sourcePubkey?: string
  ): HandlerResult {
    if (!params.key) {
      return { success: false, error: 'Missing required parameter: key' };
    }

    // Convert amount to number (may come as string from template)
    const amount = Number(params.amount) || 1;

    const result = db.incrementState(workflowId, namespace, params.key, amount, {
      create_if_missing: params.create_if_missing ?? true,
      default_value: params.default_value ?? 0,
      max_value: params.max_value,
      source_event_id: sourceEventId,
      source_pubkey: sourcePubkey,
      track_history: params.track_history ?? false,
    });

    if (!result.success) {
      return {
        success: false,
        error: result.error_code === 'LIMIT_EXCEEDED'
          ? `Increment would exceed max_value (${params.max_value})`
          : `Increment failed: ${result.error_code}`,
        data: {
          error_code: result.error_code,
          current_value: result.value,
        },
      };
    }

    logger.debug({
      workflowId, namespace, key: params.key,
      amount, previous: result.previous, new: result.value
    }, '[WorkflowDB] Value incremented');

    return {
      success: true,
      data: {
        key: params.key,
        value: result.value,
        previous: result.previous,
        delta: amount,
      },
    };
  }

  private handleDecrement(
    db: ReturnType<typeof getDatabase>,
    workflowId: string,
    namespace: string,
    params: WorkflowDbActionConfig,
    sourceEventId?: string,
    sourcePubkey?: string
  ): HandlerResult {
    if (!params.key) {
      return { success: false, error: 'Missing required parameter: key' };
    }

    // Convert amount to number (may come as string from template)
    const amount = Number(params.amount) || 1;

    const result = db.decrementState(workflowId, namespace, params.key, amount, {
      min_value: Number(params.min_value) || 0,
      source_event_id: sourceEventId,
      source_pubkey: sourcePubkey,
      track_history: params.track_history ?? false,
    });

    if (!result.success) {
      return {
        success: false,
        error: result.error_code === 'INSUFFICIENT_BALANCE'
          ? `Insufficient balance: ${result.value} < ${amount}`
          : result.error_code === 'NOT_FOUND'
          ? `State not found: ${params.key}`
          : `Decrement failed: ${result.error_code}`,
        data: {
          error_code: result.error_code,
          current_value: result.value,
          required: amount,
        },
      };
    }

    logger.debug({
      workflowId, namespace, key: params.key,
      amount, previous: result.previous, new: result.value
    }, '[WorkflowDB] Value decremented');

    return {
      success: true,
      data: {
        key: params.key,
        value: result.value,
        previous: result.previous,
        delta: -amount,
      },
    };
  }

  private handleDelete(
    db: ReturnType<typeof getDatabase>,
    workflowId: string,
    namespace: string,
    params: WorkflowDbActionConfig
  ): HandlerResult {
    if (!params.key) {
      return { success: false, error: 'Missing required parameter: key' };
    }

    const deleted = db.deleteState(workflowId, namespace, params.key);

    return {
      success: true,
      data: {
        key: params.key,
        deleted,
      },
    };
  }

  private handleList(
    db: ReturnType<typeof getDatabase>,
    workflowId: string,
    namespace: string,
    params: WorkflowDbActionConfig
  ): HandlerResult {
    const states = db.listStates(
      workflowId,
      params.namespace, // Can be undefined to list all namespaces
      params.key_pattern,
      params.limit ?? 100
    );

    const items = states.map(s => ({
      key: s.state_key,
      namespace: s.namespace,
      value: s.value_type === 'number' ? s.value_number
           : s.value_type === 'string' ? s.value_string
           : s.value_type === 'json' ? s.value_json
           : s.value_boolean,
      value_type: s.value_type,
      updated_at: s.updated_at.toISOString(),
      source_pubkey: s.source_pubkey,
    }));

    return {
      success: true,
      data: {
        count: items.length,
        items,
      },
    };
  }

  private handleCheck(
    db: ReturnType<typeof getDatabase>,
    workflowId: string,
    namespace: string,
    params: WorkflowDbActionConfig
  ): HandlerResult {
    if (!params.key) {
      return { success: false, error: 'Missing required parameter: key' };
    }
    if (!params.operator) {
      return { success: false, error: 'Missing required parameter: operator' };
    }

    const state = db.getState(workflowId, namespace, params.key);
    const exists = !!state;

    // Handle exists/not_exists operators
    if (params.operator === 'exists') {
      return {
        success: exists,
        data: { key: params.key, exists, operator: 'exists' },
        error: exists ? undefined : `State not found: ${params.key}`,
      };
    }
    if (params.operator === 'not_exists') {
      return {
        success: !exists,
        data: { key: params.key, exists, operator: 'not_exists' },
        error: !exists ? undefined : `State already exists: ${params.key}`,
      };
    }

    // For comparison operators, we need the state to exist
    if (!state) {
      return {
        success: false,
        error: `State not found: ${params.key}`,
        data: { key: params.key, exists: false },
      };
    }

    // Get current value
    let currentValue: number | string | boolean | undefined;
    switch (state.value_type) {
      case 'number':
        currentValue = state.value_number;
        break;
      case 'string':
        currentValue = state.value_string;
        break;
      case 'boolean':
        currentValue = state.value_boolean;
        break;
      default:
        return {
          success: false,
          error: `Cannot compare JSON values with operator ${params.operator}`,
        };
    }

    const rawCompareValue = params.compare_value;
    if (rawCompareValue === undefined) {
      return { success: false, error: 'Missing required parameter: compare_value' };
    }

    // Convert compare_value to match currentValue type for numeric comparisons
    let compareValue: number | string | boolean = rawCompareValue;
    if (typeof currentValue === 'number' && typeof rawCompareValue === 'string') {
      const parsed = Number(rawCompareValue);
      if (!isNaN(parsed)) {
        compareValue = parsed;
      }
    }

    // Perform comparison
    let result = false;
    switch (params.operator) {
      case 'eq':
        result = currentValue === compareValue;
        break;
      case 'ne':
        result = currentValue !== compareValue;
        break;
      case 'gt':
        result = typeof currentValue === 'number' && typeof compareValue === 'number'
          && currentValue > compareValue;
        break;
      case 'gte':
        result = typeof currentValue === 'number' && typeof compareValue === 'number'
          && currentValue >= compareValue;
        break;
      case 'lt':
        result = typeof currentValue === 'number' && typeof compareValue === 'number'
          && currentValue < compareValue;
        break;
      case 'lte':
        result = typeof currentValue === 'number' && typeof compareValue === 'number'
          && currentValue <= compareValue;
        break;
    }

    logger.debug({
      key: params.key, currentValue, operator: params.operator,
      compareValue, result
    }, '[WorkflowDB] Check performed');

    return {
      success: result,
      data: {
        key: params.key,
        value: currentValue,
        operator: params.operator,
        compare_value: compareValue,
        result,
      },
      error: result ? undefined : `Check failed: ${currentValue} ${params.operator} ${compareValue}`,
    };
  }

  async shutdown(): Promise<void> {
    logger.info('[WorkflowDB] Handler stopped');
  }
}
