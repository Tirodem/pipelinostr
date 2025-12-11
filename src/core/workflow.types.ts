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
}

export interface WorkflowTrigger {
  type: 'nostr_event' | 'http_webhook';

  // For nostr_event
  filters?: WorkflowFilter;

  // For http_webhook
  config?: {
    path?: string;
    method?: string;
    body_schema?: Record<string, unknown>;
  };
}

export interface WorkflowAction {
  id: string;
  type: string; // 'email', 'nostr_dm', 'nostr_note', 'http', 'telegram', etc.
  config: Record<string, unknown>;

  // Condition for execution (expression)
  when?: string | undefined;

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
}

export interface WorkflowContext {
  trigger: TriggerContext;
  match: Record<string, string>;
  actions: Record<string, ActionResult>;

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
