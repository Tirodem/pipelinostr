import { logger } from '../persistence/logger.js';
import { npubToHex } from '../utils/crypto.js';
import type { ProcessedEvent } from '../inbound/nostr-listener.js';
import type { WorkflowDefinition, WorkflowFilter, MatchResult, TriggerContext } from './workflow.types.js';

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

  // Find matching workflows for an event
  findMatches(
    event: ProcessedEvent,
    workflows: WorkflowDefinition[]
  ): Array<{ workflow: WorkflowDefinition; match: MatchResult; context: TriggerContext }> {
    const results: Array<{ workflow: WorkflowDefinition; match: MatchResult; context: TriggerContext }> = [];
    const content = event.decryptedContent ?? event.rawContent;

    const triggerContext: TriggerContext = {
      from: event.pubkeyNpub,
      pubkey: event.pubkey,
      content,
      kind: event.kind,
      timestamp: event.created_at,
      relayUrl: event.relayUrl,
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
      if (!workflow.enabled) continue;
      if (workflow.trigger.type !== 'nostr_event') continue;

      const matchResult = this.matchWorkflow(event, workflow, content);

      if (matchResult.matched) {
        results.push({
          workflow,
          match: matchResult,
          context: triggerContext,
        });

        logger.debug(
          { workflowId: workflow.id, groups: matchResult.groups },
          'Workflow matched'
        );

        // If workflow doesn't allow multiple, stop here
        if (!workflow.multiple) {
          break;
        }
      }
    }

    return results;
  }

  private matchWorkflow(
    event: ProcessedEvent,
    workflow: WorkflowDefinition,
    content: string
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

    // Check quick matchers (shortcuts)
    if (!this.matchShortcuts(content, filters)) {
      return { matched: false, groups: {} };
    }

    // Check regex pattern
    if (filters.content_pattern) {
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
      const regex = new RegExp(pattern, 's'); // 's' flag for dotAll
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
}
