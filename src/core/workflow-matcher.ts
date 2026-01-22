import { logger } from '../persistence/logger.js';
import { npubToHex } from '../utils/crypto.js';
import { parseZapReceipt, type ParsedZap } from '../utils/zap-parser.js';
import { nip19 } from 'nostr-tools';
import type { ProcessedEvent } from '../inbound/nostr-listener.js';
import type { WorkflowDefinition, WorkflowFilter, MatchResult, TriggerContext, ZapContext } from './workflow.types.js';

export class WorkflowMatcher {
  private whitelistHex: Set<string>;
  private whitelistDisabled: boolean;

  constructor(whitelistNpubs: string[] = []) {
    // Check for wildcard "*" which disables whitelisting
    this.whitelistDisabled = whitelistNpubs.includes('*');
    this.whitelistHex = new Set(
      whitelistNpubs
        .filter((npub) => npub && npub.length > 0 && npub !== '*')
        .map((npub) => {
          try {
            return npubToHex(npub);
          } catch {
            return null;
          }
        })
        .filter((hex): hex is string => hex !== null)
    );
  }

  updateWhitelist(npubs: string[]): void {
    // Check for wildcard "*" which disables whitelisting
    this.whitelistDisabled = npubs.includes('*');
    this.whitelistHex = new Set(
      npubs
        .filter((npub) => npub && npub.length > 0 && npub !== '*')
        .map((npub) => {
          try {
            return npubToHex(npub);
          } catch {
            return null;
          }
        })
        .filter((hex): hex is string => hex !== null)
    );
  }

  /**
   * Normalize trigger type aliases to nostr_event with implicit kinds:
   * - type: dm -> type: nostr_event, kinds: [4, 14] (NIP-04 and NIP-17)
   * - type: zap -> type: nostr_event, kinds: [9735]
   */
  private normalizeTrigger(trigger: WorkflowDefinition['trigger']): WorkflowDefinition['trigger'] {
    if (trigger.type === 'dm') {
      return {
        ...trigger,
        type: 'nostr_event',
        filters: {
          ...trigger.filters,
          // Merge implicit DM kinds with any explicit kinds (implicit takes precedence if not set)
          kinds: trigger.filters?.kinds ?? [4, 14],
        },
      };
    }

    if (trigger.type === 'zap') {
      return {
        ...trigger,
        type: 'nostr_event',
        filters: {
          ...trigger.filters,
          // Merge implicit zap kind with any explicit kinds
          kinds: trigger.filters?.kinds ?? [9735],
        },
      };
    }

    return trigger;
  }

  // Result type for findMatchesWithDisabled
  public static readonly MATCH_RESULT = {
    ENABLED: 'enabled',
    DISABLED: 'disabled',
  } as const;

  // Find matching workflows for an event (including disabled ones)
  findMatchesWithDisabled(
    event: ProcessedEvent,
    workflows: WorkflowDefinition[]
  ): {
    enabled: Array<{ workflow: WorkflowDefinition; match: MatchResult; context: TriggerContext }>;
    disabled: Array<{ workflow: WorkflowDefinition; match: MatchResult; context: TriggerContext }>;
  } {
    const enabled: Array<{ workflow: WorkflowDefinition; match: MatchResult; context: TriggerContext }> = [];
    const disabled: Array<{ workflow: WorkflowDefinition; match: MatchResult; context: TriggerContext }> = [];
    const content = event.decryptedContent ?? event.rawContent;

    // Parse zap if kind 9735
    let zapContext: ZapContext | undefined;
    let parsedZap: ParsedZap | null = null;
    if (event.kind === 9735) {
      parsedZap = parseZapReceipt({
        id: event.id,
        pubkey: event.pubkey,
        kind: event.kind,
        created_at: event.created_at,
        tags: event.tags,
        content: event.rawContent,
      });
      if (parsedZap) {
        zapContext = {
          amount: parsedZap.amount,
          sender: parsedZap.sender.npub,
          sender_pubkey: parsedZap.sender.pubkey,
          recipient: parsedZap.recipient.npub,
          recipient_pubkey: parsedZap.recipient.pubkey,
          message: parsedZap.message,
          zapped_event_id: parsedZap.zappedEventId,
          bolt11: parsedZap.bolt11,
        };
      }
    }

    // Determine DM format based on encryption type and NIP-18 prefix
    // nip04 = kind 4, nip44 = kind 14 (from unwrapped 1059)
    // Amethyst NIP-18 prefix signals NIP-17 preference even when sent via NIP-04
    let dmFormat: 'nip04' | 'nip17' | undefined;
    if (event.encryptionType === 'nip44' || event.hasNip18Prefix) {
      dmFormat = 'nip17';
    } else if (event.encryptionType === 'nip04') {
      dmFormat = 'nip04';
    }

    logger.info(
      { eventId: event.id, encryptionType: event.encryptionType, hasNip18Prefix: event.hasNip18Prefix, dmFormat },
      'DM format detected from event'
    );

    const triggerContext: TriggerContext = {
      from: event.pubkeyNpub,
      pubkey: event.pubkey,
      content,
      kind: event.kind,
      timestamp: event.created_at,
      relayUrl: event.relayUrl,
      dm_format: dmFormat,
      zap: zapContext,
      event: {
        id: event.id,
        pubkey: event.pubkey,
        kind: event.kind,
        created_at: event.created_at,
        tags: event.tags,
        content: event.rawContent,
        sig: event.sig,
      },
    };

    for (const workflow of workflows) {
      // Handle internal triggers (e.g., morse_listener)
      if (workflow.trigger.type === 'internal') {
        const triggerSource = workflow.trigger.source;
        const eventSourceTag = event.tags.find(t => t[0] === 'source');
        const eventSource = eventSourceTag?.[1];

        if (triggerSource && eventSource === triggerSource) {
          const matchResult: MatchResult = { matched: true, groups: {} };

          // Build extended context for internal triggers
          const rawTag = event.tags.find(t => t[0] === 'raw');
          const addressTag = event.tags.find(t => t[0] === 'address');
          const targetPubkeyTag = event.tags.find(t => t[0] === 'target_pubkey');
          const pollTypeTag = event.tags.find(t => t[0] === 'poll_type');
          const dmFormatTag = event.tags.find(t => t[0] === 'dm_format');

          const internalContext = {
            ...triggerContext,
            raw_morse: rawTag?.[1] ?? '',
            // For internal_poll events
            poll_type: pollTypeTag?.[1] ?? '',
            address: addressTag?.[1] ?? '',
            target_pubkey: targetPubkeyTag?.[1] ?? triggerContext.from,
            // Propagate dm_format for notification handling
            dm_format: dmFormatTag?.[1] as 'nip04' | 'nip17' | undefined,
          };

          const matchData = {
            workflow,
            match: matchResult,
            context: internalContext,
          };

          if (workflow.enabled) {
            enabled.push(matchData);
            logger.debug(
              { workflowId: workflow.id, source: eventSource },
              'Internal workflow matched'
            );
          } else {
            disabled.push(matchData);
          }
        }
        continue;
      }

      // Normalize trigger type aliases (dm, zap -> nostr_event with implicit kinds)
      const normalizedTrigger = this.normalizeTrigger(workflow.trigger);
      if (normalizedTrigger.type !== 'nostr_event') continue;

      // Skip expensive regex checks for disabled workflows (just basic filter matching for visibility)
      const skipExpensiveChecks = !workflow.enabled;
      const matchResult = this.matchWorkflow(event, workflow, content, parsedZap, skipExpensiveChecks, normalizedTrigger);

      if (matchResult.matched) {
        const matchData = {
          workflow,
          match: matchResult,
          context: triggerContext,
        };

        if (workflow.enabled) {
          enabled.push(matchData);

          logger.debug(
            { workflowId: workflow.id, groups: matchResult.groups },
            'Workflow matched'
          );

          // If workflow doesn't allow multiple, stop checking enabled workflows
          if (!workflow.multiple) {
            // Continue checking for disabled matches
            continue;
          }
        } else {
          disabled.push(matchData);

          logger.debug(
            { workflowId: workflow.id, groups: matchResult.groups },
            'Workflow matched but disabled'
          );
        }
      }
    }

    return { enabled, disabled };
  }

  // Find matching workflows for an event (legacy method, only enabled workflows)
  findMatches(
    event: ProcessedEvent,
    workflows: WorkflowDefinition[]
  ): Array<{ workflow: WorkflowDefinition; match: MatchResult; context: TriggerContext }> {
    return this.findMatchesWithDisabled(event, workflows).enabled;
  }

  private matchWorkflow(
    event: ProcessedEvent,
    workflow: WorkflowDefinition,
    content: string,
    parsedZap: ParsedZap | null,
    skipExpensiveChecks: boolean = false,
    normalizedTrigger?: WorkflowDefinition['trigger']
  ): MatchResult {
    // Use normalized trigger if provided (for dm/zap aliases), otherwise use workflow trigger
    const trigger = normalizedTrigger ?? workflow.trigger;
    const filters = trigger.filters;
    if (!filters) {
      // No filters = match all
      return { matched: true, groups: {} };
    }

    // Check kinds
    if (filters.kinds && filters.kinds.length > 0) {
      if (!filters.kinds.includes(event.kind)) {
        return { matched: false, groups: {} };
      }
    }

    // Determine the pubkey to check for whitelist/from_npubs filters
    // For zaps (kind 9735), use the real sender from the zap request, not the LNURL provider
    const senderPubkey = (event.kind === 9735 && parsedZap?.sender.pubkey)
      ? parsedZap.sender.pubkey
      : event.pubkey;

    // Check whitelist (skipped if whitelist contains "*")
    if (filters.from_whitelist === true) {
      if (!this.whitelistDisabled && !this.whitelistHex.has(senderPubkey)) {
        return { matched: false, groups: {} };
      }
    }

    // Check specific npubs (skipped if from_npubs contains "*")
    if (filters.from_npubs && filters.from_npubs.length > 0) {
      // Wildcard "*" allows all npubs
      if (!filters.from_npubs.includes('*')) {
        const allowedHex = new Set(
          filters.from_npubs.map((npub) => {
            try {
              return npubToHex(npub);
            } catch {
              return null;
            }
          }).filter((hex): hex is string => hex !== null)
        );

        if (!allowedHex.has(senderPubkey)) {
          return { matched: false, groups: {} };
        }
      }
    }

    // Zap-specific filters (only for kind 9735)
    if (event.kind === 9735) {
      // Check zap_recipients filter
      if (filters.zap_recipients && filters.zap_recipients.length > 0) {
        if (!parsedZap) {
          return { matched: false, groups: {} };
        }
        const recipientHexSet = new Set(
          filters.zap_recipients.map((npub) => {
            try {
              return npubToHex(npub);
            } catch {
              return null;
            }
          }).filter((hex): hex is string => hex !== null)
        );
        if (!recipientHexSet.has(parsedZap.recipient.pubkey)) {
          return { matched: false, groups: {} };
        }
      }

      // Check zap_min_amount filter
      if (filters.zap_min_amount !== undefined && filters.zap_min_amount > 0) {
        if (!parsedZap || parsedZap.amount < filters.zap_min_amount) {
          return { matched: false, groups: {} };
        }
      }

      // Check zap_event_id filter (only match zaps on a specific note)
      if (filters.zap_event_id) {
        if (!parsedZap || !parsedZap.zappedEventId) {
          // Zap is not on an event (profile zap) or parsing failed
          return { matched: false, groups: {} };
        }
        // Convert note1... to hex if needed
        let filterEventId = filters.zap_event_id;
        if (filterEventId.startsWith('note1')) {
          try {
            // note1 is bech32 encoded event id
            const decoded = nip19.decode(filterEventId);
            if (decoded.type === 'note') {
              filterEventId = decoded.data;
            }
          } catch {
            logger.warn({ zap_event_id: filters.zap_event_id }, 'Invalid note1 ID in zap_event_id filter');
            return { matched: false, groups: {} };
          }
        }
        if (parsedZap.zappedEventId !== filterEventId) {
          return { matched: false, groups: {} };
        }
      }
    }

    // Check quick matchers (shortcuts)
    if (!this.matchShortcuts(content, filters)) {
      return { matched: false, groups: {} };
    }

    // Check regex pattern
    if (filters.content_pattern) {
      // Skip expensive regex matching for disabled workflows (used only for visibility)
      if (skipExpensiveChecks) {
        return { matched: true, groups: {} };
      }
      const regexResult = this.matchRegex(content, filters.content_pattern);
      if (!regexResult.matched) {
        return { matched: false, groups: {} };
      }
      return regexResult;
    }

    // All filters passed
    return { matched: true, groups: {} };
  }

  private matchShortcuts(content: string, filters: WorkflowFilter): boolean {
    // starts_with
    if (filters.starts_with !== undefined) {
      if (!content.startsWith(filters.starts_with)) {
        return false;
      }
    }

    // contains
    if (filters.contains !== undefined) {
      if (!content.includes(filters.contains)) {
        return false;
      }
    }

    // ends_with
    if (filters.ends_with !== undefined) {
      if (!content.endsWith(filters.ends_with)) {
        return false;
      }
    }

    return true;
  }

  private matchRegex(content: string, pattern: string): MatchResult {
    try {
      // Convert PCRE-style inline flags to JS flags
      const { cleanPattern, flags } = this.convertPcreFlags(pattern);
      const regex = new RegExp(cleanPattern, flags);
      const match = regex.exec(content);

      if (!match) {
        return { matched: false, groups: {} };
      }

      // Extract named groups
      const groups: Record<string, string> = {};
      if (match.groups) {
        for (const [key, value] of Object.entries(match.groups)) {
          groups[key] = value ?? '';
        }
      }

      // Also add indexed groups as $1, $2, etc.
      for (let i = 1; i < match.length; i++) {
        groups[`$${i}`] = match[i] ?? '';
      }

      return { matched: true, groups };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ pattern, error: errorMessage }, 'Invalid regex pattern');
      return { matched: false, groups: {} };
    }
  }

  /**
   * Convert PCRE-style inline flags to JavaScript RegExp flags.
   * Supports: (?i) → case insensitive, (?s) → dotAll, (?m) → multiline
   * Example: "(?i)^hello" → { cleanPattern: "^hello", flags: "si" }
   */
  private convertPcreFlags(pattern: string): { cleanPattern: string; flags: string } {
    let flags = 's'; // Always include dotAll for consistency
    let cleanPattern = pattern;

    // Match PCRE-style inline flags at the start: (?i), (?s), (?m), (?is), etc.
    const inlineFlagMatch = cleanPattern.match(/^\(\?([ismx]+)\)/);
    if (inlineFlagMatch && inlineFlagMatch[1]) {
      const pcreFlags = inlineFlagMatch[1];
      // Remove the inline flag from pattern
      cleanPattern = cleanPattern.slice(inlineFlagMatch[0].length);

      // Convert PCRE flags to JS flags
      if (pcreFlags.includes('i')) flags += 'i';
      if (pcreFlags.includes('m')) flags += 'm';
      // 's' is already included, 'x' (extended) not supported in JS
    }

    // Deduplicate flags
    flags = [...new Set(flags.split(''))].join('');

    return { cleanPattern, flags };
  }
}
