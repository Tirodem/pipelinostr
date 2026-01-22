import { type Event as NostrEvent } from 'nostr-tools/pure';
import { type Filter } from 'nostr-tools/filter';
import { logger } from '../persistence/logger.js';
import { RelayManager } from '../relay/manager.js';
import { CryptoHelper, npubToHex, hexToNpub, cleanAmethystPrefix } from '../utils/crypto.js';
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

  // NIP-18 prefix detected (Amethyst signals NIP-17 preference)
  hasNip18Prefix?: boolean | undefined;
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
  // Only process events after this timestamp (default: now)
  since?: number;
  // Process historical events (default: false - only new events)
  processHistorical?: boolean;
  // Additional npubs to monitor for incoming zaps (kind 9735).
  // PipeliNostr always listens to zaps for its own pubkey.
  // Add other npubs here to also receive their zap notifications.
  zapRecipients?: string[] | undefined;
}

export class NostrListener {
  private config: NostrListenerConfig;
  private relayManager: RelayManager;
  private crypto: CryptoHelper;
  private whitelistHex: Set<string>;
  private whitelistDisabled: boolean;
  private eventCallbacks: EventCallback[] = [];
  private processedEventIds: Set<string> = new Set();
  private maxProcessedCache = 10000;
  private startTimestamp: number;

  constructor(config: NostrListenerConfig, relayManager: RelayManager) {
    this.config = config;
    this.relayManager = relayManager;
    this.crypto = new CryptoHelper(config.privateKey);

    // Set start timestamp to ignore historical events (unless processHistorical is true)
    this.startTimestamp = config.since ?? Math.floor(Date.now() / 1000);

    // Check for wildcard "*" which disables whitelisting
    this.whitelistDisabled = config.whitelist.npubs.includes('*');

    // Convert whitelist npubs to hex for faster lookup
    this.whitelistHex = new Set(
      config.whitelist.npubs
        .filter((npub) => npub && npub.length > 0 && npub !== '*')
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
        startTimestamp: this.startTimestamp,
        processHistorical: config.processHistorical ?? false,
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

    // Add 'since' to filter if not processing historical events
    // This tells relays to only send events after this timestamp
    const sinceTimestamp = this.config.processHistorical ? undefined : this.startTimestamp;

    if (this.config.listenToAll) {
      // Listen to all events (useful for monitoring)
      if (this.config.kinds && this.config.kinds.length > 0) {
        filters.push({ kinds: this.config.kinds, ...(sinceTimestamp && { since: sinceTimestamp }) });
      } else {
        // All events - be careful with this!
        filters.push({ ...(sinceTimestamp && { since: sinceTimestamp }) });
      }
    } else {
      // Default: Listen to events tagged to us (p tag) or authored by us
      // This catches DMs and mentions

      // Events where we are tagged
      const taggedFilter: Filter = {
        '#p': [myPubkey],
        ...(sinceTimestamp && { since: sinceTimestamp }),
      };
      if (this.config.kinds && this.config.kinds.length > 0) {
        taggedFilter.kinds = this.config.kinds;
      }
      filters.push(taggedFilter);

      // DMs sent TO us (kind 4 uses p tag for recipient)
      filters.push({
        kinds: [4],
        '#p': [myPubkey],
        ...(sinceTimestamp && { since: sinceTimestamp }),
      });

      // Gift-wrapped events to us
      filters.push({
        kinds: [1059],
        '#p': [myPubkey],
        ...(sinceTimestamp && { since: sinceTimestamp }),
      });
    }

    // Zap receipts (kind 9735) - can listen to zaps for any npub
    const zapPubkeys: string[] = [];
    const zapSources: Array<{ npub: string; source: string }> = [];

    // Always listen to zaps for our pubkey
    zapPubkeys.push(myPubkey);
    zapSources.push({ npub: hexToNpub(myPubkey), source: 'self' });

    // Add configured zap recipients
    if (this.config.zapRecipients && this.config.zapRecipients.length > 0) {
      for (const npub of this.config.zapRecipients) {
        try {
          const hex = npubToHex(npub);
          if (!zapPubkeys.includes(hex)) {
            zapPubkeys.push(hex);
            zapSources.push({ npub, source: 'config.yml' });
          }
        } catch {
          logger.warn({ npub }, 'Invalid npub in zapRecipients');
        }
      }
    }

    // Subscribe to zap receipts for all configured pubkeys
    filters.push({
      kinds: [9735],
      '#p': zapPubkeys,
      ...(sinceTimestamp && { since: sinceTimestamp }),
    });

    logger.info(
      { zapPubkeysCount: zapPubkeys.length, zapRecipients: zapSources },
      'Subscribed to zap receipts'
    );

    return filters;
  }

  private async handleEvent(event: NostrEvent, relayUrl: string): Promise<void> {
    // Deduplicate events (same event from multiple relays)
    if (this.processedEventIds.has(event.id)) {
      return;
    }

    // Ignore historical events unless processHistorical is enabled
    if (!this.config.processHistorical && event.created_at < this.startTimestamp) {
      logger.debug(
        { eventId: event.id, eventTime: event.created_at, startTime: this.startTimestamp },
        'Ignoring historical event'
      );
      return;
    }

    // Early whitelist check for non-Gift Wrap events (kind !== 1059)
    // For Gift Wrap, we need to unwrap first to know the real sender
    // For Zap receipts (kind 9735), event.pubkey is the LNURL provider (e.g. Wallet of Satoshi),
    // not the zap sender - so skip whitelist check here, apply it later on the real sender
    if (event.kind !== 1059 && event.kind !== 9735 && !this.isWhitelisted(event.pubkey)) {
      // Silently ignore events from non-whitelisted pubkeys
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

      // Check if event was rejected (null = not whitelisted after unwrap)
      if (processed === null) {
        return;
      }

      // Log to database
      this.logEventToDatabase(processed);

      // Notify callbacks
      await this.notifyCallbacks(processed);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ eventId: event.id, error: errorMessage }, 'Failed to process event');
    }
  }

  private async processEvent(event: NostrEvent, relayUrl: string): Promise<ProcessedEvent | null> {
    const isEncrypted = ENCRYPTED_KINDS.includes(event.kind);

    let decryptedContent: string | undefined;
    let encryptionType: 'nip04' | 'nip44' | 'none' = 'none';
    let hasNip18Prefix = false;

    // For Gift Wrap (kind 1059), the real sender is inside the rumor
    let realSenderPubkey = event.pubkey;
    let innerKind = event.kind;

    // Try to decrypt if encrypted
    if (isEncrypted) {
      try {
        // Special handling for NIP-17 Gift Wrap (kind 1059)
        if (event.kind === 1059) {
          const unwrapped = this.crypto.unwrapGiftWrap(event);
          decryptedContent = unwrapped.content;
          realSenderPubkey = unwrapped.senderPubkey;
          innerKind = unwrapped.kind;
          encryptionType = 'nip44';

          // Check whitelist after unwrap (real sender now known)
          if (!this.isWhitelisted(realSenderPubkey)) {
            // Silently ignore Gift Wrap from non-whitelisted senders
            return null;
          }

          logger.info(
            {
              eventId: event.id,
              wrapKind: event.kind,
              innerKind: unwrapped.kind,
              encryptionType,
              from: hexToNpub(realSenderPubkey).slice(0, 20) + '...',
              content: decryptedContent,
            },
            'NIP-17 Gift Wrap received and unwrapped'
          );
        } else {
          // NIP-04 or other encrypted kinds
          const result = await this.crypto.decryptEvent(event.kind, event.content, event.pubkey);
          decryptedContent = result.content;
          encryptionType = result.encryptionType;
          hasNip18Prefix = result.hasNip18Prefix ?? false;

          logger.info(
            { eventId: event.id, kind: event.kind, encryptionType, hasNip18Prefix, content: decryptedContent },
            'Event received and decrypted'
          );
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.warn(
          { eventId: event.id, kind: event.kind, error: errorMessage },
          'Failed to decrypt event'
        );
        // Keep going with raw content
      }
    }

    // Check whitelist with the real sender (important for Gift Wrap)
    const isFromWhitelist = this.isWhitelisted(realSenderPubkey);

    const processed: ProcessedEvent = {
      id: event.id,
      pubkey: realSenderPubkey,  // Use real sender for Gift Wrap
      pubkeyNpub: hexToNpub(realSenderPubkey),
      kind: innerKind,  // Use inner kind for Gift Wrap (14 instead of 1059)
      created_at: event.created_at,
      tags: event.tags,
      sig: event.sig,
      rawContent: event.content,
      decryptedContent,
      encryptionType,
      isEncrypted,
      isFromWhitelist,
      relayUrl,
      hasNip18Prefix,
    };

    logger.debug(
      {
        eventId: event.id,
        kind: processed.kind,
        from: processed.pubkeyNpub.slice(0, 20) + '...',
        isEncrypted,
        isFromWhitelist,
      },
      'Event processed'
    );

    return processed;
  }

  private isWhitelisted(pubkeyHex: string): boolean {
    if (!this.config.whitelist.enabled || this.whitelistDisabled) {
      return true; // Whitelist disabled or "*" = everyone is allowed
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
