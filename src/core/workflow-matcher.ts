import { logger } from '../persistence/logger.js';
import { npubToHex } from '../utils/crypto.js';
import { parseZapReceipt, type ParsedZap } from '../utils/zap-parser.js';
import type { ProcessedEvent } from '../inbound/nostr-listener.js';
import type { WorkflowDefinition, WorkflowFilter, MatchResult, TriggerContext, ZapContext } from './workflow.types.js';

export class WorkflowMatcher {
  private whitelistHex: Set<string>;

  constructor(whitelistNpubs: string[] = []) {
    this.whitelistHex = new Set(
      whitelistNpubs
        .filter((npub) => npub && npub.length > 0)
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
    this.whitelistHex = new Set(
      npubs
        .filter((npub) => npub && npub.length > 0)
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

          const internalContext = {
            ...triggerContext,
            raw_morse: rawTag?.[1] ?? '',
            // For internal_poll events
            poll_type: pollTypeTag?.[1] ?? '',
            address: addressTag?.[1] ?? '',
            target_pubkey: targetPubkeyTag?.[1] ?? triggerContext.from,
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

      if (workflow.trigger.type !== 'nostr_event') continue;

      // Skip expensive regex checks for disabled workflows (just basic filter matching for visibility)
      const skipExpensiveChecks = !workflow.enabled;
      const matchResult = this.matchWorkflow(event, workflow, content, parsedZap, skipExpensiveChecks);

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
    skipExpensiveChecks: boolean = false
  ): MatchResult {
    const filters = workflow.trigger.filters;
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

    // Check whitelist
    if (filters.from_whitelist === true) {
      if (!this.whitelistHex.has(event.pubkey)) {
        return { matched: false, groups: {} };
      }
    }

    // Check specific npubs
    if (filters.from_npubs && filters.from_npubs.length > 0) {
      const allowedHex = new Set(
        filters.from_npubs.map((npub) => {
          try {
            return npubToHex(npub);
          } catch {
            return null;
          }
        }).filter((hex): hex is string => hex !== null)
      );

      if (!allowedHex.has(event.pubkey)) {
        return { matched: false, groups: {} };
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
