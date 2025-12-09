import { finalizeEvent, type Event as NostrEvent } from 'nostr-tools/pure';
import { logger } from '../persistence/logger.js';
import { CryptoHelper, npubToHex } from '../utils/crypto.js';
import type { RelayManager } from '../relay/manager.js';
import type { Handler, HandlerResult, HandlerConfig } from './handler.interface.js';

export interface NostrDmConfig extends HandlerConfig {
  to: string; // npub or hex
  content: string;
}

export interface NostrNoteConfig extends HandlerConfig {
  content: string;
  kind?: number;
  tags?: string[][];
}

export interface NostrHandlerOptions {
  privateKey: string;
  relayManager: RelayManager;
}

export class NostrHandler implements Handler {
  readonly name = 'Nostr Handler';
  readonly type = 'nostr';

  private crypto: CryptoHelper;
  private relayManager: RelayManager;

  constructor(options: NostrHandlerOptions) {
    this.crypto = new CryptoHelper(options.privateKey);
    this.relayManager = options.relayManager;
  }

  async initialize(): Promise<void> {
    logger.info({ pubkey: this.crypto.getPublicKeyNpub() }, 'Nostr handler initialized');
  }

  async execute(config: HandlerConfig, _context: Record<string, unknown>): Promise<HandlerResult> {
    // Determine action type from config
    const actionType = (config as Record<string, unknown>)['_action_type'] as string | undefined;

    if (actionType === 'nostr_note' || (config as NostrNoteConfig).kind !== undefined) {
      return this.publishNote(config as NostrNoteConfig);
    }

    // Default to DM if 'to' field is present
    if ((config as NostrDmConfig).to) {
      return this.sendDm(config as NostrDmConfig);
    }

    return { success: false, error: 'Invalid Nostr action config' };
  }

  async sendDm(config: NostrDmConfig): Promise<HandlerResult> {
    if (!config.to || !config.content) {
      return { success: false, error: 'Missing required fields: to, content' };
    }

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
        { eventId: signedEvent.id, to: config.to, relays: result.successes.length },
        'DM sent successfully'
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
      logger.error({ error: errorMessage, to: config.to }, 'Failed to send DM');
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

  async execute(config: HandlerConfig, _context: Record<string, unknown>): Promise<HandlerResult> {
    return this.nostrHandler.sendDm(config as NostrDmConfig);
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
