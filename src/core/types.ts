/**
 * Core types (ADR-009, ADR-012)
 *
 * NormalizedEvent: transport-agnostic event model.
 * Workflow types: v2 flat YAML format.
 */

// --- NormalizedEvent (ADR-012) ---

export interface NormalizedEvent {
  /** Full source string: "nostr.dm", "telegram.dm", "webhook.post" */
  source: string;
  /** Platform origin: "nostr", "telegram", "bluesky", "webhook" */
  origin: string;
  /** Event category: "dm", "zap", "note", "mention", "post" */
  type: string;
  /** Sender identifier (npub for nostr, user id for telegram, etc.) */
  sender: string;
  /** Message/event content */
  content: string;
  /** Unix timestamp */
  timestamp: number;
  /** Platform-specific metadata (dm_format, zap amount, relay, etc.) */
  metadata: Record<string, unknown>;
  /** Original raw event for power users */
  raw: unknown;
}

// --- Trigger context (available as trigger.* in templates) ---

export interface TriggerContext {
  source: string;
  origin: string;
  type: string;
  sender: string;
  content: string;
  timestamp: number;
  dm_format?: string;
  zap?: ZapContext;
  raw?: unknown;
  [key: string]: unknown;
}

export interface ZapContext {
  amount: number;
  sender: string;
  sender_pubkey: string;
  recipient: string;
  recipient_pubkey: string;
  message: string;
  zapped_event_id?: string;
  bolt11: string;
}

// --- Match result ---

export interface MatchResult {
  matched: boolean;
  groups: Record<string, string>;
}

// --- Workflow definition (v2 flat format, ADR-009) ---

export interface WorkflowDefinition {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  /** Continue matching other workflows after this one */
  multiple?: boolean;

  trigger: WorkflowTrigger;
  actions: WorkflowAction[];
  hooks?: WorkflowHooks;
  variables?: Record<string, unknown>;
  storage?: WorkflowStorage;
}

// --- Trigger (ADR-009 flat, ADR-012 multi-source) ---

export interface WorkflowTrigger {
  /** Source with origin.type notation: "nostr.dm", "telegram.dm", "dm", "nostr.zap" */
  source?: string;
  /** Regex with named capture groups */
  content_pattern?: string;
  /** Only whitelisted senders */
  from_whitelist?: boolean;
  /** Specific sender IDs */
  from_list?: string[];
  /** Quick matchers */
  starts_with?: string;
  contains?: string;
  ends_with?: string;

  // Nostr-specific filters (validated per source by auditor)
  dm_format?: 'nip04' | 'nip17';
  min_amount?: number;
  zap_recipients?: string[];
  relays?: string[];

  // Raw nostr escape hatch
  kinds?: number[];

  // Webhook-specific
  path?: string;
  method?: string;

  // Internal triggers
  internal_source?: string;
}

// --- Action (ADR-009 flat — no config wrapper) ---

export interface WorkflowAction {
  id: string;
  /** Handler type: "telegram", "email", "nostr_dm", etc. */
  type: string;
  /** Conditional execution expression */
  when?: string;
  /** Action-level failure hook */
  on_fail?: ActionFailHook;
  /** Retry config */
  retry?: RetryConfig;
  /** Idempotency flag for replay (ADR-011) */
  idempotent?: boolean;
  /** All other fields are handler-specific parameters (flattened) */
  [key: string]: unknown;
}

export interface ActionFailHook {
  workflow: string;
  pass_context?: boolean;
}

export interface RetryConfig {
  max_attempts?: number;
  backoff?: {
    type?: 'exponential' | 'linear' | 'fixed';
    initial_delay_ms?: number;
    multiplier?: number;
    max_delay_ms?: number;
  };
}

// --- Hooks ---

export interface WorkflowHooks {
  on_start?: WorkflowHook[];
  on_complete?: WorkflowHook[];
  on_fail?: WorkflowHook[];
}

export interface WorkflowHook {
  workflow_id: string;
  when?: string;
  pass_context?: boolean;
}

// --- Storage declaration (ADR-004) ---

export interface WorkflowStorage {
  table: string;
  columns: Record<string, string>;
  primary_key?: string | string[];
  indexes?: (string | string[])[];
}

// --- Execution results ---

export interface ActionResult {
  success: boolean;
  error?: string | undefined;
  response?: unknown | undefined;
  skipped?: boolean | undefined;
}

export interface WorkflowContext {
  trigger: TriggerContext;
  match: Record<string, string>;
  actions: Record<string, ActionResult>;
  variables: Record<string, unknown>;
  parent?: ParentWorkflowInfo | undefined;
}

export interface ParentWorkflowInfo {
  id: string;
  name: string;
  success: boolean;
  actionsExecuted: number;
  actionsFailed: number;
  actionsSkipped: number;
  error?: string | undefined;
  variables?: Record<string, unknown> | undefined;
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
