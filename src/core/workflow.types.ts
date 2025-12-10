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
  // Listen to zaps received by these npubs
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

export interface WorkflowDefinition {
  id: string;
  name: string;
  description?: string | undefined;
  enabled: boolean;

  // If true, continue matching other workflows after this one
  multiple?: boolean | undefined;

  trigger: WorkflowTrigger;
  actions: WorkflowAction[];
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

export interface WorkflowContext {
  trigger: TriggerContext;
  match: Record<string, string>;
  actions: Record<string, ActionResult>;
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
