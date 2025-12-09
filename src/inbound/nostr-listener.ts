import { type Event as NostrEvent } from 'nostr-tools/pure';
import { type Filter } from 'nostr-tools/filter';
import { logger } from '../persistence/logger.js';
import { RelayManager } from '../relay/manager.js';
import { CryptoHelper, npubToHex, hexToNpub } from '../utils/crypto.js';
import { getDatabase } from '../persistence/database.js';

// Kinds that contain encrypted content
const ENCRYPTED_KINDS = [
  4,    // NIP-04 DM
  14,   // NIP-17 private DM
  1059, // NIP-59 Gift Wrap
  1060, // Sealed event
];

export interface ProcessedEvent {
  // Original event data
  id: string;
  pubkey: string;
  pubkeyNpub: string;
  kind: number;
  created_at: number;
  tags: string[][];
  sig: string;

  // Processed content
  rawContent: string;
  decryptedContent?: string | undefined;
  encryptionType: 'nip04' | 'nip44' | 'none';

  // Metadata
  isEncrypted: boolean;
  isFromWhitelist: boolean;
  relayUrl: string;
}

export type EventCallback = (event: ProcessedEvent) => void | Promise<void>;

export interface NostrListenerConfig {
  privateKey: string;
  whitelist: {
    enabled: boolean;
    npubs: string[];
  };
  // Optional: specific kinds to listen to. If empty, listen to all events for our pubkey
  kinds?: number[];
  // Listen to all events (not just those tagged to us)
  listenToAll?: boolean;
}

export class NostrListener {
  private config: NostrListenerConfig;
  private relayManager: RelayManager;
  private crypto: CryptoHelper;
  private whitelistHex: Set<string>;
  private eventCallbacks: EventCallback[] = [];
  private processedEventIds: Set<string> = new Set();
  private maxProcessedCache = 10000;

  constructor(config: NostrListenerConfig, relayManager: RelayManager) {
    this.config = config;
    this.relayManager = relayManager;
    this.crypto = new CryptoHelper(config.privateKey);

    // Convert whitelist npubs to hex for faster lookup
    this.whitelistHex = new Set(
      config.whitelist.npubs
        .filter((npub) => npub && npub.length > 0)
        .map((npub) => {
          try {
            return npubToHex(npub);
          } catch {
            logger.warn({ npub }, 'Invalid npub in whitelist');
            return null;
          }
        })
        .filter((hex): hex is string => hex !== null)
    );

    logger.info(
      {
        publicKey: this.crypto.getPublicKeyNpub(),
        whitelistCount: this.whitelistHex.size,
        whitelistEnabled: config.whitelist.enabled,
      },
      'NostrListener initialized'
    );
  }

  getPublicKey(): string {
    return this.crypto.getPublicKey();
  }

  getPublicKeyNpub(): string {
    return this.crypto.getPublicKeyNpub();
  }

  getCryptoHelper(): CryptoHelper {
    return this.crypto;
  }

  // Register callback for processed events
  onEvent(callback: EventCallback): void {
    this.eventCallbacks.push(callback);
  }

  // Start listening
  start(): void {
    const filters = this.buildFilters();

    logger.info({ filters }, 'Starting Nostr listener with filters');

    // Subscribe via relay manager
    this.relayManager.onEvent((event, relayUrl) => {
      this.handleEvent(event, relayUrl);
    });

    this.relayManager.subscribe(filters);
  }

  private buildFilters(): Filter[] {
    const myPubkey = this.crypto.getPublicKey();
    const filters: Filter[] = [];

    if (this.config.listenToAll) {
      // Listen to all events (useful for monitoring)
      if (this.config.kinds && this.config.kinds.length > 0) {
        filters.push({ kinds: this.config.kinds });
      } else {
        // All events - be careful with this!
        filters.push({});
      }
    } else {
      // Default: Listen to events tagged to us (p tag) or authored by us
      // This catches DMs and mentions

      // Events where we are tagged
      const taggedFilter: Filter = {
        '#p': [myPubkey],
      };
      if (this.config.kinds && this.config.kinds.length > 0) {
        taggedFilter.kinds = this.config.kinds;
      }
      filters.push(taggedFilter);

      // DMs sent TO us (kind 4 uses p tag for recipient)
      filters.push({
        kinds: [4],
        '#p': [myPubkey],
      });

      // Gift-wrapped events to us
      filters.push({
        kinds: [1059],
        '#p': [myPubkey],
      });
    }

    return filters;
  }

  private async handleEvent(event: NostrEvent, relayUrl: string): Promise<void> {
    // Deduplicate events (same event from multiple relays)
    if (this.processedEventIds.has(event.id)) {
      return;
    }

    // Add to cache and cleanup if needed
    this.processedEventIds.add(event.id);
    if (this.processedEventIds.size > this.maxProcessedCache) {
      const idsArray = Array.from(this.processedEventIds);
      const toRemove = idsArray.slice(0, this.maxProcessedCache / 2);
      toRemove.forEach((id) => this.processedEventIds.delete(id));
    }

    try {
      const processed = await this.processEvent(event, relayUrl);

      // Log to database
      this.logEventToDatabase(processed);

      // Notify callbacks
      await this.notifyCallbacks(processed);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ eventId: event.id, error: errorMessage }, 'Failed to process event');
    }
  }

  private async processEvent(event: NostrEvent, relayUrl: string): Promise<ProcessedEvent> {
    const isEncrypted = ENCRYPTED_KINDS.includes(event.kind);
    const isFromWhitelist = this.isWhitelisted(event.pubkey);

    let decryptedContent: string | undefined;
    let encryptionType: 'nip04' | 'nip44' | 'none' = 'none';

    // Try to decrypt if encrypted
    if (isEncrypted) {
      try {
        const result = await this.crypto.decryptEvent(event.kind, event.content, event.pubkey);
        decryptedContent = result.content;
        encryptionType = result.encryptionType;

        logger.debug(
          { eventId: event.id, kind: event.kind, encryptionType },
          'Event decrypted successfully'
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.warn(
          { eventId: event.id, kind: event.kind, error: errorMessage },
          'Failed to decrypt event'
        );
        // Keep going with raw content
      }
    }

    const processed: ProcessedEvent = {
      id: event.id,
      pubkey: event.pubkey,
      pubkeyNpub: hexToNpub(event.pubkey),
      kind: event.kind,
      created_at: event.created_at,
      tags: event.tags,
      sig: event.sig,
      rawContent: event.content,
      decryptedContent,
      encryptionType,
      isEncrypted,
      isFromWhitelist,
      relayUrl,
    };

    logger.debug(
      {
        eventId: event.id,
        kind: event.kind,
        from: processed.pubkeyNpub.slice(0, 20) + '...',
        isEncrypted,
        isFromWhitelist,
      },
      'Event processed'
    );

    return processed;
  }

  private isWhitelisted(pubkeyHex: string): boolean {
    if (!this.config.whitelist.enabled) {
      return true; // Whitelist disabled = everyone is allowed
    }
    return this.whitelistHex.has(pubkeyHex);
  }

  private logEventToDatabase(event: ProcessedEvent): void {
    try {
      const db = getDatabase();
      db.insertEventLog({
        received_at: new Date(),
        source_type: `nostr_kind_${event.kind}`,
        source_identifier: event.pubkeyNpub,
        source_raw: JSON.stringify({
          id: event.id,
          pubkey: event.pubkey,
          kind: event.kind,
          created_at: event.created_at,
          tags: event.tags,
          // Don't log encrypted content in raw form for security
          content: event.isEncrypted ? '[encrypted]' : event.rawContent,
        }),
        status: 'received',
        retry_count: 0,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to log event to database');
    }
  }

  private async notifyCallbacks(event: ProcessedEvent): Promise<void> {
    for (const callback of this.eventCallbacks) {
      try {
        await callback(event);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error({ error: errorMessage, eventId: event.id }, 'Error in event callback');
      }
    }
  }

  // Add npub to whitelist at runtime
  addToWhitelist(npub: string): void {
    try {
      const hex = npubToHex(npub);
      this.whitelistHex.add(hex);
      logger.info({ npub }, 'Added to whitelist');
    } catch {
      logger.error({ npub }, 'Failed to add invalid npub to whitelist');
    }
  }

  // Remove npub from whitelist at runtime
  removeFromWhitelist(npub: string): void {
    try {
      const hex = npubToHex(npub);
      this.whitelistHex.delete(hex);
      logger.info({ npub }, 'Removed from whitelist');
    } catch {
      logger.error({ npub }, 'Failed to remove invalid npub from whitelist');
    }
  }

  // Check if npub is whitelisted
  isNpubWhitelisted(npub: string): boolean {
    try {
      const hex = npubToHex(npub);
      return this.isWhitelisted(hex);
    } catch {
      return false;
    }
  }

  // Get whitelist as npubs
  getWhitelist(): string[] {
    return Array.from(this.whitelistHex).map((hex) => hexToNpub(hex));
  }
}
