// Workflow definition types

export interface WorkflowFilter {
  // Event kinds to match
  kinds?: number[];

  // Whitelist check
  from_whitelist?: boolean;

  // Specific npubs (overrides whitelist)
  from_npubs?: string[];

  // Quick matchers (evaluated before regex)
  starts_with?: string;
  contains?: string;
  ends_with?: string;

  // Regex pattern with named capture groups
  content_pattern?: string;

  // Zap-specific filters (for kind 9735)
  // Filter to only zaps received by these specific npubs
  zap_recipients?: string[];

  // Minimum zap amount in sats
  zap_min_amount?: number;

  // Filter to only zaps on a specific event (note)
  // Use note ID (note1...) or hex event ID
  zap_event_id?: string;
}

export interface WorkflowTrigger {
  // Trigger types:
  // - nostr_event: raw Nostr events with kinds filter
  // - dm: alias for nostr_event with kinds [4, 14] (NIP-04 and NIP-17 DMs)
  // - zap: alias for nostr_event with kinds [9735] (zap receipts)
  // - http_webhook: HTTP webhook trigger
  // - internal: internal system triggers (e.g., morse_listener)
  type: 'nostr_event' | 'http_webhook' | 'internal' | 'dm' | 'zap';

  // For nostr_event
  filters?: WorkflowFilter;

  // For http_webhook
  config?: {
    path?: string;
    method?: string;
    body_schema?: Record<string, unknown>;
  };

  // For internal triggers (e.g., morse_listener)
  source?: string;
}

// Hook for action-level failure handling
export interface ActionFailHook {
  // ID of workflow to trigger on failure
  workflow: string;

  // Pass current context to the hook workflow (default: true)
  pass_context?: boolean | undefined;
}

export interface WorkflowAction {
  id: string;
  type: string; // 'email', 'nostr_dm', 'nostr_note', 'http', 'telegram', etc.
  config: Record<string, unknown>;

  // Condition for execution (expression)
  when?: string | undefined;

  // Hook triggered when this action fails
  // When triggered, stops workflow execution and runs the specified workflow
  on_fail?: ActionFailHook | undefined;

  // Retry config override
  retry?: {
    max_attempts?: number | undefined;
    backoff?: {
      type?: 'exponential' | 'linear' | 'fixed' | undefined;
      initial_delay_ms?: number | undefined;
      multiplier?: number | undefined;
      max_delay_ms?: number | undefined;
    } | undefined;
  } | undefined;
}

// Hook to trigger another workflow
export interface WorkflowHook {
  // ID of workflow to trigger
  workflow_id: string;

  // Optional condition (expression)
  when?: string | undefined;

  // Pass parent context to child workflow (default: true)
  pass_context?: boolean | undefined;
}

// Workflow lifecycle hooks
export interface WorkflowHooks {
  // Triggered when workflow starts (before actions)
  // Useful for launching parallel workflows
  on_start?: WorkflowHook[] | undefined;

  // Triggered when workflow completes successfully
  on_complete?: WorkflowHook[] | undefined;

  // Triggered when workflow fails (any action fails)
  on_fail?: WorkflowHook[] | undefined;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description?: string | undefined;
  enabled: boolean;

  // If true, continue matching other workflows after this one
  multiple?: boolean | undefined;

  trigger: WorkflowTrigger;
  actions: WorkflowAction[];

  // Lifecycle hooks for workflow chaining
  hooks?: WorkflowHooks | undefined;

  // Workflow-level variables (accessible via {{ variables.xxx }})
  variables?: Record<string, unknown> | undefined;
}

// Runtime context types

export interface ZapContext {
  // Amount in sats
  amount: number;

  // Sender info
  sender: string;       // npub
  sender_pubkey: string; // hex

  // Recipient info
  recipient: string;    // npub
  recipient_pubkey: string; // hex

  // Zap comment/message
  message: string;

  // Event that was zapped (if any)
  zapped_event_id?: string | undefined;

  // Bolt11 invoice
  bolt11: string;
}

export interface TriggerContext {
  // Event metadata
  from: string;        // npub
  pubkey: string;      // hex
  content: string;     // decrypted content
  kind: number;
  timestamp: number;
  relayUrl: string;

  // DM format used by the sender (for reply in same format)
  // Set for kind 4 (nip04) and kind 14/1059 (nip17)
  dm_format?: 'nip04' | 'nip17' | undefined;

  // Zap-specific context (only for kind 9735)
  zap?: ZapContext | undefined;

  // Full event
  event: {
    id: string;
    pubkey: string;
    kind: number;
    created_at: number;
    tags: string[][];
    content: string;
    sig: string;
  };
}

export interface MatchResult {
  matched: boolean;
  groups: Record<string, string>;
}

export interface ActionResult {
  success: boolean;
  error?: string | undefined;
  response?: unknown;
  skipped?: boolean;
}

// Parent workflow info (passed via hooks)
export interface ParentWorkflowInfo {
  id: string;
  name: string;
  success: boolean;
  actionsExecuted: number;
  actionsFailed: number;
  actionsSkipped: number;
  error?: string | undefined;

  // Parent workflow variables (accessible via {{ parent.variables.xxx }})
  variables?: Record<string, unknown> | undefined;
}

export interface WorkflowContext {
  trigger: TriggerContext;
  match: Record<string, string>;
  actions: Record<string, ActionResult>;

  // Workflow-level variables (accessible via {{ variables.xxx }})
  variables?: Record<string, unknown> | undefined;

  // Info about parent workflow (when triggered via hook)
  parent?: ParentWorkflowInfo | undefined;
}

export interface WorkflowExecutionResult {
  workflowId: string;
  workflowName: string;
  success: boolean;
  actionsExecuted: number;
  actionsFailed: number;
  actionsSkipped: number;
  error?: string | undefined;
  context: WorkflowContext;
}
