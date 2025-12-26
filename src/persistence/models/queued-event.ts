/**
 * Queued Event Model
 * Represents an event in the processing queue
 */

export type QueuedEventStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'dead'
  | 'no_match'           // No workflow matched this event
  | 'skipped_disabled';  // Matched workflow(s) but all were disabled

export type QueuedEventType = 'nostr_dm' | 'nostr_event' | 'api_webhook' | 'hook' | 'manual' | 'internal_poll';

export interface QueuedEvent {
  id: number;

  // Event identification
  event_type: QueuedEventType;
  event_id?: string | undefined;        // Original event ID (e.g., Nostr event ID)
  event_data: string;                    // JSON payload

  // Queue management
  status: QueuedEventStatus;
  priority: number;                      // Higher = more urgent (default: 0)

  // Retry logic
  retry_count: number;
  max_retries: number;
  next_retry_at?: Date | undefined;

  // Timestamps
  created_at: Date;
  started_at?: Date | undefined;
  completed_at?: Date | undefined;

  // Execution results
  workflow_id?: string | undefined;
  workflow_name?: string | undefined;
  error_message?: string | undefined;
  result_data?: string | undefined;      // JSON result
}

export interface EnqueueOptions {
  priority?: number;
  max_retries?: number;
  delay_ms?: number;                     // Delay before first processing
}

export interface QueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  dead: number;
  no_match: number;
  skipped_disabled: number;
  total: number;
}
