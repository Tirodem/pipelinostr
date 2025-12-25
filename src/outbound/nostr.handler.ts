import { finalizeEvent, type Event as NostrEvent } from 'nostr-tools/pure';
import * as nip17 from 'nostr-tools/nip17';
import { logger } from '../persistence/logger.js';
import { CryptoHelper, npubToHex } from '../utils/crypto.js';
import type { RelayManager } from '../relay/manager.js';
import type { Handler, HandlerResult, HandlerConfig } from './handler.interface.js';

export type DmFormat = 'nip04' | 'nip17';

export interface NostrDmConfig extends HandlerConfig {
  to: string; // npub or hex
  content: string;
  dm_format?: DmFormat; // Override handler default for this action
}

export interface NostrNoteConfig extends HandlerConfig {
  content: string;
  kind?: number;
  tags?: string[][];
}

export interface NostrHandlerOptions {
  privateKey: string;
  relayManager: RelayManager;
  dm_format?: DmFormat; // Default format for DMs: 'nip04' or 'nip17'
  dm_reply_match_format?: boolean; // If true, reply in the same format as received (default: true)
}

export class NostrHandler implements Handler {
  readonly name = 'Nostr Handler';
  readonly type = 'nostr';

  private crypto: CryptoHelper;
  private relayManager: RelayManager;
  private defaultDmFormat: DmFormat;
  private dmReplyMatchFormat: boolean;

  constructor(options: NostrHandlerOptions) {
    this.crypto = new CryptoHelper(options.privateKey);
    this.relayManager = options.relayManager;
    this.defaultDmFormat = options.dm_format ?? 'nip04'; // Default to NIP-04 for backwards compatibility
    this.dmReplyMatchFormat = options.dm_reply_match_format ?? true; // Default to matching format
  }

  async initialize(): Promise<void> {
    logger.info(
      {
        pubkey: this.crypto.getPublicKeyNpub(),
        dm_format: this.defaultDmFormat,
        dm_reply_match_format: this.dmReplyMatchFormat,
      },
      'Nostr handler initialized'
    );
  }

  async execute(config: HandlerConfig, context: Record<string, unknown>): Promise<HandlerResult> {
    // Determine action type from config
    const actionType = (config as Record<string, unknown>)['_action_type'] as string | undefined;

    if (actionType === 'nostr_note' || (config as NostrNoteConfig).kind !== undefined) {
      return this.publishNote(config as NostrNoteConfig);
    }

    // Default to DM if 'to' field is present
    if ((config as NostrDmConfig).to) {
      // Extract trigger's dm_format for reply matching
      const trigger = context.trigger as Record<string, unknown> | undefined;
      const triggerDmFormat = trigger?.dm_format as DmFormat | undefined;

      logger.info(
        {
          hasTrigger: !!trigger,
          triggerKeys: trigger ? Object.keys(trigger) : [],
          triggerDmFormat,
        },
        'Extracting trigger dm_format'
      );

      return this.sendDm(config as NostrDmConfig, triggerDmFormat);
    }

    return { success: false, error: 'Invalid Nostr action config' };
  }

  async sendDm(config: NostrDmConfig, triggerDmFormat?: DmFormat): Promise<HandlerResult> {
    if (!config.to || !config.content) {
      return { success: false, error: 'Missing required fields: to, content' };
    }

    // Priority: action-level override > trigger format (if match enabled) > handler default
    let dmFormat: DmFormat;
    let formatSource: string;
    if (config.dm_format) {
      // Explicit action override
      dmFormat = config.dm_format;
      formatSource = 'action';
    } else if (this.dmReplyMatchFormat && triggerDmFormat) {
      // Reply in same format as received
      dmFormat = triggerDmFormat;
      formatSource = 'trigger';
    } else {
      // Use handler default
      dmFormat = this.defaultDmFormat;
      formatSource = 'default';
    }

    logger.info(
      {
        configDmFormat: config.dm_format,
        triggerDmFormat,
        dmReplyMatchFormat: this.dmReplyMatchFormat,
        defaultDmFormat: this.defaultDmFormat,
        resolvedFormat: dmFormat,
        formatSource,
      },
      'DM format resolution'
    );

    if (dmFormat === 'nip17') {
      return this.sendDmNip17(config);
    }
    return this.sendDmNip04(config);
  }

  private async sendDmNip04(config: NostrDmConfig): Promise<HandlerResult> {
    try {
      // Convert npub to hex if needed
      const recipientPubkey = npubToHex(config.to);

      // Encrypt content with NIP-04
      const encryptedContent = await this.crypto.encryptNip04(config.content, recipientPubkey);

      // Build event
      const eventTemplate = {
        kind: 4,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', recipientPubkey]],
        content: encryptedContent,
      };

      // Sign event
      const signedEvent = finalizeEvent(eventTemplate, this.crypto.getPrivateKeyBytes());

      // Publish
      const result = await this.relayManager.publish(signedEvent);

      if (result.successes.length === 0) {
        return { success: false, error: 'Failed to publish to any relay' };
      }

      logger.info(
        { eventId: signedEvent.id, to: config.to, format: 'nip04', relays: result.successes.length },
        'DM sent successfully (NIP-04)'
      );

      return {
        success: true,
        data: {
          event_id: signedEvent.id,
          format: 'nip04',
          relays_success: result.successes,
          relays_failed: result.failures,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage, to: config.to, format: 'nip04' }, 'Failed to send DM');
      return { success: false, error: errorMessage };
    }
  }

  private async sendDmNip17(config: NostrDmConfig): Promise<HandlerResult> {
    try {
      // Convert npub to hex if needed
      const recipientPubkey = npubToHex(config.to);

      // Create NIP-17 wrapped event using nostr-tools
      // nip17.wrapEvent handles: Rumor (kind 14) → Seal (kind 13) → Gift Wrap (kind 1059)
      const wrappedEvent = nip17.wrapEvent(
        this.crypto.getPrivateKeyBytes(),
        { publicKey: recipientPubkey },
        config.content
      );

      // Publish the Gift Wrap
      const result = await this.relayManager.publish(wrappedEvent);

      if (result.successes.length === 0) {
        return { success: false, error: 'Failed to publish to any relay' };
      }

      logger.info(
        { eventId: wrappedEvent.id, to: config.to, format: 'nip17', relays: result.successes.length },
        'DM sent successfully (NIP-17)'
      );

      return {
        success: true,
        data: {
          event_id: wrappedEvent.id,
          format: 'nip17',
          relays_success: result.successes,
          relays_failed: result.failures,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage, to: config.to, format: 'nip17' }, 'Failed to send DM');
      return { success: false, error: errorMessage };
    }
  }

  async publishNote(config: NostrNoteConfig): Promise<HandlerResult> {
    if (!config.content) {
      return { success: false, error: 'Missing required field: content' };
    }

    try {
      const kind = config.kind ?? 1; // Default to kind 1 (short text note)
      const tags = config.tags ?? [];

      // Add client tag
      if (!tags.some((t) => t[0] === 'client')) {
        tags.push(['client', 'PipeliNostr']);
      }

      // Build event
      const eventTemplate = {
        kind,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: config.content,
      };

      // Sign event
      const signedEvent = finalizeEvent(eventTemplate, this.crypto.getPrivateKeyBytes());

      // Publish
      const result = await this.relayManager.publish(signedEvent);

      if (result.successes.length === 0) {
        return { success: false, error: 'Failed to publish to any relay' };
      }

      logger.info(
        { eventId: signedEvent.id, kind, relays: result.successes.length },
        'Note published successfully'
      );

      return {
        success: true,
        data: {
          event_id: signedEvent.id,
          relays_success: result.successes,
          relays_failed: result.failures,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage }, 'Failed to publish note');
      return { success: false, error: errorMessage };
    }
  }

  async shutdown(): Promise<void> {
    logger.info('Nostr handler shut down');
  }
}

// Separate handler classes for workflow engine registration
export class NostrDmHandler implements Handler {
  readonly name = 'Nostr DM Handler';
  readonly type = 'nostr_dm';

  private nostrHandler: NostrHandler;

  constructor(options: NostrHandlerOptions) {
    this.nostrHandler = new NostrHandler(options);
  }

  async initialize(): Promise<void> {
    await this.nostrHandler.initialize();
  }

  async execute(config: HandlerConfig, context: Record<string, unknown>): Promise<HandlerResult> {
    // Extract trigger's dm_format for reply matching
    const trigger = context.trigger as Record<string, unknown> | undefined;
    const triggerDmFormat = trigger?.dm_format as DmFormat | undefined;
    return this.nostrHandler.sendDm(config as NostrDmConfig, triggerDmFormat);
  }

  async shutdown(): Promise<void> {
    await this.nostrHandler.shutdown();
  }
}

export class NostrNoteHandler implements Handler {
  readonly name = 'Nostr Note Handler';
  readonly type = 'nostr_note';

  private nostrHandler: NostrHandler;

  constructor(options: NostrHandlerOptions) {
    this.nostrHandler = new NostrHandler(options);
  }

  async initialize(): Promise<void> {
    await this.nostrHandler.initialize();
  }

  async execute(config: HandlerConfig, _context: Record<string, unknown>): Promise<HandlerResult> {
    return this.nostrHandler.publishNote(config as NostrNoteConfig);
  }

  async shutdown(): Promise<void> {
    await this.nostrHandler.shutdown();
  }
}
