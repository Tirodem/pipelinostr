/**
 * Workflow matcher (ADR-012)
 *
 * Matches a NormalizedEvent against workflow triggers.
 * Supports source matching (exact, origin-only, type-only, wildcard).
 * Returns matched workflows with regex capture groups.
 */

import type { NormalizedEvent, WorkflowDefinition, WorkflowTrigger, MatchResult } from './types.js';

/**
 * Match a normalized event against a single workflow trigger.
 */
export function matchTrigger(event: NormalizedEvent, trigger: WorkflowTrigger): MatchResult {
  const noMatch: MatchResult = { matched: false, groups: {} };

  // Source matching (ADR-012)
  if (trigger.source) {
    if (!matchSource(event.source, trigger.source)) {
      return noMatch;
    }
  }

  // Internal trigger source
  if (trigger.internal_source) {
    if (event.source !== `internal.${trigger.internal_source}`) {
      return noMatch;
    }
  }

  // DM format filter (nostr-specific)
  if (trigger.dm_format) {
    if (event.metadata.dm_format !== trigger.dm_format) {
      return noMatch;
    }
  }

  // Minimum amount (zap filter)
  if (trigger.min_amount !== undefined) {
    const amount = (event.metadata.zap as Record<string, unknown>)?.amount as number | undefined;
    if (!amount || amount < trigger.min_amount) {
      return noMatch;
    }
  }

  // Zap recipients filter
  if (trigger.zap_recipients && trigger.zap_recipients.length > 0) {
    const recipient = (event.metadata.zap as Record<string, unknown>)?.recipient as string | undefined;
    if (!recipient || !trigger.zap_recipients.includes(recipient)) {
      return noMatch;
    }
  }

  // Relay filter
  if (trigger.relays && trigger.relays.length > 0) {
    const relay = event.metadata.relay as string | undefined;
    if (!relay || !trigger.relays.includes(relay)) {
      return noMatch;
    }
  }

  // Raw kinds filter (nostr.raw escape hatch)
  if (trigger.kinds && trigger.kinds.length > 0) {
    const kind = event.metadata.kind as number | undefined;
    if (kind === undefined || !trigger.kinds.includes(kind)) {
      return noMatch;
    }
  }

  // Webhook path/method
  if (trigger.path) {
    if (event.metadata.path !== trigger.path) {
      return noMatch;
    }
  }
  if (trigger.method) {
    if (String(event.metadata.method).toUpperCase() !== trigger.method.toUpperCase()) {
      return noMatch;
    }
  }

  // Quick string matchers
  if (trigger.starts_with && !event.content.startsWith(trigger.starts_with)) {
    return noMatch;
  }
  if (trigger.contains && !event.content.includes(trigger.contains)) {
    return noMatch;
  }
  if (trigger.ends_with && !event.content.endsWith(trigger.ends_with)) {
    return noMatch;
  }

  // Whitelist check (delegated to caller — matcher just checks the flag)
  // from_whitelist and from_list are handled at a higher level where the
  // whitelist configuration is available

  // Content pattern (regex with named capture groups)
  let groups: Record<string, string> = {};
  if (trigger.content_pattern) {
    const result = matchPattern(event.content, trigger.content_pattern);
    if (!result.matched) {
      return noMatch;
    }
    groups = result.groups;
  }

  return { matched: true, groups };
}

/**
 * Find all workflows that match a given event.
 */
export function findMatchingWorkflows(
  event: NormalizedEvent,
  workflows: Map<string, WorkflowDefinition>,
  whitelist?: string[],
): Array<{ workflow: WorkflowDefinition; match: MatchResult }> {
  const matches: Array<{ workflow: WorkflowDefinition; match: MatchResult }> = [];

  for (const workflow of workflows.values()) {
    if (!workflow.enabled) continue;

    // Check whitelist if required
    if (workflow.trigger.from_whitelist && whitelist) {
      if (!whitelist.includes(event.sender)) continue;
    }

    // Check from_list
    if (workflow.trigger.from_list && workflow.trigger.from_list.length > 0) {
      if (!workflow.trigger.from_list.includes(event.sender)) continue;
    }

    const result = matchTrigger(event, workflow.trigger);
    if (result.matched) {
      matches.push({ workflow, match: result });

      // Stop after first match unless workflow allows multiple
      if (!workflow.multiple) break;
    }
  }

  return matches;
}

// --- Source matching (ADR-012) ---

function matchSource(eventSource: string, triggerSource: string): boolean {
  // Exact match: "nostr.dm" === "nostr.dm"
  if (eventSource === triggerSource) return true;

  // Type-only match: event "nostr.dm" matches trigger "dm"
  if (!triggerSource.includes('.')) {
    const eventType = eventSource.split('.')[1];
    if (eventType === triggerSource) return true;
  }

  // Origin-only match: event "nostr.dm" matches trigger "nostr"
  const triggerParts = triggerSource.split('.');
  const eventParts = eventSource.split('.');
  if (triggerParts.length === 1 && eventParts[0] === triggerParts[0]) {
    return true;
  }

  return false;
}

// --- Regex matching ---

function matchPattern(content: string, pattern: string): MatchResult {
  try {
    // Extract flags if present (e.g., (?i) at the start)
    let flags = '';
    let cleanPattern = pattern;

    const flagMatch = pattern.match(/^\(\?([gimsuy]+)\)/);
    if (flagMatch) {
      flags = flagMatch[1]!;
      cleanPattern = pattern.slice(flagMatch[0].length);
    }

    const regex = new RegExp(cleanPattern, flags);
    const match = regex.exec(content);

    if (!match) {
      return { matched: false, groups: {} };
    }

    // Named capture groups
    const groups: Record<string, string> = {};
    if (match.groups) {
      for (const [key, value] of Object.entries(match.groups)) {
        if (value !== undefined) {
          groups[key] = value;
        }
      }
    }

    // Also include numbered groups
    for (let i = 1; i < match.length; i++) {
      if (match[i] !== undefined) {
        groups[String(i)] = match[i]!;
      }
    }

    return { matched: true, groups };
  } catch {
    return { matched: false, groups: {} };
  }
}
