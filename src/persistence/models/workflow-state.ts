/**
 * Workflow State - Generic key-value storage for workflows
 *
 * Use cases:
 * - Balance tracking (zap credits, loyalty points)
 * - Counters (rate limiting, usage stats)
 * - Flags (feature toggles, user preferences)
 * - Arbitrary JSON data
 */

export interface WorkflowState {
  id: number;
  workflow_id: string;
  namespace: string;
  state_key: string;
  value_type: 'number' | 'string' | 'json' | 'boolean';
  value_number?: number | undefined;
  value_string?: string | undefined;
  value_json?: Record<string, unknown> | undefined;
  value_boolean?: boolean | undefined;
  source_event_id?: string | undefined;
  event_log_id?: number | undefined;
  source_pubkey?: string | undefined;
  created_at: Date;
  updated_at: Date;
}

export interface WorkflowStateInput {
  workflow_id: string;
  namespace?: string | undefined;
  state_key: string;
  value_type?: 'number' | 'string' | 'json' | 'boolean' | undefined;
  value_number?: number | undefined;
  value_string?: string | undefined;
  value_json?: Record<string, unknown> | undefined;
  value_boolean?: boolean | undefined;
  source_event_id?: string | undefined;
  event_log_id?: number | undefined;
  source_pubkey?: string | undefined;
}

export interface WorkflowStateHistory {
  id: number;
  state_id: number;
  operation: 'set' | 'increment' | 'decrement' | 'delete';
  old_value_number?: number | undefined;
  old_value_string?: string | undefined;
  new_value_number?: number | undefined;
  new_value_string?: string | undefined;
  delta?: number | undefined;
  source_event_id?: string | undefined;
  source_pubkey?: string | undefined;
  created_at: Date;
}

export interface IncrementOptions {
  create_if_missing?: boolean | undefined;
  default_value?: number | undefined;
  max_value?: number | undefined;
  source_event_id?: string | undefined;
  source_pubkey?: string | undefined;
  track_history?: boolean | undefined;
}

export interface DecrementOptions {
  min_value?: number | undefined;
  source_event_id?: string | undefined;
  source_pubkey?: string | undefined;
  track_history?: boolean | undefined;
}
