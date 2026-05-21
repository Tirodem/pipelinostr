/**
 * Nostr inbound listener (ADR-012)
 *
 * Connects to relays, subscribes to events, converts to NormalizedEvent.
 * Handles NIP-04/NIP-17 DM decryption, zap parsing, deduplication.
 * Maps kind numbers to source types (nostr.dm, nostr.zap, nostr.note).
 */

import { Relay } from 'nostr-tools/relay';
import { finalizeEvent, type Event as NostrEvent } from 'nostr-tools/pure';
import type { Filter } from 'nostr-tools/filter';
import type { Logger } from 'pino';
import type { NormalizedEvent } from '../core/types.js';
import type { EventStorage } from '../storage/storage.port.js';
import { CryptoHelper, npubToHex, hexToNpub } from '../utils/crypto.js';
import { parseZapReceipt } from '../utils/zap-parser.js';
import { Secret } from '../config/secrets.js';

// Kind → source type mapping (ADR-012)
const KIND_SOURCE_MAP: Record<number, string> = {
  4: 'nostr.dm',
  14: 'nostr.dm',
  1059: 'nostr.dm',
  9735: 'nostr.zap',
  1: 'nostr.note',
  7: 'nostr.reaction',
  6: 'nostr.repost',
};

export type EventHandler = (event: NormalizedEvent) => void | Promise<void>;

export interface NostrListenerConfig {
  privateKey: string | Secret;
  relays: string[];
  whitelist: string[];
  zapRecipients?: string[];
  since?: number;
  processHistorical?: boolean;
  eventStorage?: EventStorage | undefined;
}

export class NostrInboundListener {
  private crypto: CryptoHelper;
  private relays: Relay[] = [];
  private whitelistHex: Set<string>;
  private whitelistDisabled: boolean;
  private processedIds = new Set<string>();
  private maxCacheSize = 10000;
  private startTimestamp: number;
  private handlers: EventHandler[] = [];
  private running = false;
  private eoseReceived = new Set<string>(); // relays that sent EOSE

  constructor(
    private config: NostrListenerConfig,
    private logger: Logger,
  ) {
    const keyValue = config.privateKey instanceof Secret
      ? config.privateKey.unwrap()
      : config.privateKey;
    this.crypto = new CryptoHelper(keyValue);

    this.startTimestamp = config.since ?? Math.floor(Date.now() / 1000);

    // Whitelist setup
    this.whitelistDisabled = config.whitelist.includes('*');
    this.whitelistHex = new Set(
      config.whitelist
        .filter((npub) => npub && npub !== '*')
        .map((npub) => {
          try { return npubToHex(npub); }
          catch { this.logger.warn({ npub }, 'Invalid npub in whitelist'); return null; }
        })
        .filter((hex): hex is string => hex !== null)
    );

    this.logger.info({
      publicKey: this.crypto.getPublicKeyNpub(),
      whitelistCount: this.whitelistHex.size,
      relayCount: config.relays.length,
    }, 'Nostr listener initialized');
  }

  getPublicKey(): string { return this.crypto.getPublicKey(); }
  getPublicKeyNpub(): string { return this.crypto.getPublicKeyNpub(); }
  getCrypto(): CryptoHelper { return this.crypto; }
  getWhitelist(): string[] {
    const list = Array.from(this.whitelistHex).map(hexToNpub);
    if (this.whitelistDisabled) list.push('*');
    return list;
  }

  onEvent(handler: EventHandler): void {
    this.handlers.push(handler);
  }

  async start(): Promise<void> {
    this.running = true;

    // Seed processedIds from database to prevent duplicate processing on restart
    if (this.config.eventStorage) {
      this.seedProcessedIds(this.config.eventStorage);
    }

    const filters = this.buildFilters();

    for (const url of this.config.relays) {
      try {
        const relay = await Relay.connect(url, {
          enableReconnect: true,
        } as Parameters<typeof Relay.connect>[1]);
        this.relays.push(relay);

        relay.onclose = () => {
          this.logger.warn({ relay: url }, 'Relay disconnected — auto-reconnect enabled');
        };

        relay.subscribe(filters, {
          onevent: (event) => { this.handleEvent(event, url); },
          oneose: () => {
            this.eoseReceived.add(url);
            this.logger.info({ relay: url }, 'EOSE received — now processing live events');
          },
        });

        this.logger.info({ relay: url }, 'Connected to relay');
      } catch (err) {
        this.logger.warn({ relay: url, error: (err as Error).message }, 'Failed to connect to relay');
      }
    }

    // Publish relay lists so other clients know where to send DMs
    await this.publishRelayLists();
  }

  /**
   * Publish NIP-65 (kind 10002) and NIP-17 inbox (kind 10050) relay lists.
   * Both are replaceable events — re-publishing at startup keeps them fresh.
   */
  private async publishRelayLists(): Promise<void> {
    const now = Math.floor(Date.now() / 1000);

    // Kind 10002: NIP-65 general relay list (read+write)
    const nip65Event = finalizeEvent({
      kind: 10002,
      created_at: now,
      tags: this.config.relays.map((url) => ['r', url]),
      content: '',
    }, this.crypto.getPrivateKeyBytes());

    // Kind 10050: NIP-17 DM inbox relays
    const nip17InboxEvent = finalizeEvent({
      kind: 10050,
      created_at: now,
      tags: this.config.relays.map((url) => ['relay', url]),
      content: '',
    }, this.crypto.getPrivateKeyBytes());

    // Publish to all connected relays in parallel
    const results = await Promise.allSettled(
      this.relays.map(async (relay) => {
        await relay.publish(nip65Event);
        await relay.publish(nip17InboxEvent);
      })
    );

    const published = results.filter((r) => r.status === 'fulfilled').length;

    if (published === 0) {
      this.logger.warn('Failed to publish relay lists to any relay — NIP-17 DMs may not be deliverable');
    } else {
      this.logger.info({ published, relays: this.config.relays }, 'Published relay lists (NIP-65 + NIP-17 inbox)');
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    for (const relay of this.relays) {
      try { relay.close(); } catch { /* ignore */ }
    }
    this.relays = [];
    this.logger.info('Nostr listener stopped');
  }

  // --- Private ---

  /**
   * Seed processedIds from database to prevent duplicate processing on restart.
   * Loads event source_ids from the last 3 days.
   */
  private seedProcessedIds(eventStorage: EventStorage): void {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const recentIds = eventStorage.getRecentSourceIds(threeDaysAgo);
    for (const id of recentIds) {
      this.processedIds.add(id);
    }
    this.logger.info({ count: recentIds.length }, 'Seeded processedIds from database');
  }

  private buildFilters(): Filter[] {
    const myPubkey = this.crypto.getPublicKey();
    const since = this.config.processHistorical ? undefined : this.startTimestamp;
    const filters: Filter[] = [];

    // DMs to us (NIP-04 kind 4)
    filters.push({ kinds: [4], '#p': [myPubkey], ...(since && { since }) });

    // Gift-wrapped DMs to us (NIP-17 kind 1059)
    // No 'since' filter — NIP-17 randomizes the outer created_at timestamp
    // to protect metadata, so it may appear to be in the past
    filters.push({ kinds: [1059], '#p': [myPubkey] });

    // Events where we are tagged
    filters.push({ '#p': [myPubkey], ...(since && { since }) });

    // Zap receipts
    const zapPubkeys = [myPubkey];
    if (this.config.zapRecipients) {
      for (const npub of this.config.zapRecipients) {
        try {
          const hex = npubToHex(npub);
          if (!zapPubkeys.includes(hex)) zapPubkeys.push(hex);
        } catch { /* skip */ }
      }
    }
    filters.push({ kinds: [9735], '#p': zapPubkeys, ...(since && { since }) });

    return filters;
  }

  private async handleEvent(event: NostrEvent, relayUrl: string): Promise<void> {
    // Skip kind 1059 (NIP-17 Gift Wrap) before EOSE — these are historical replays
    // Other kinds have since filters and don't need this gate
    if (event.kind === 1059 && !this.eoseReceived.has(relayUrl)) {
      return;
    }

    // Dedup
    if (this.processedIds.has(event.id)) {
      this.logger.debug({ eventId: event.id.slice(0, 12) }, 'Event deduplicated');
      return;
    }
    this.processedIds.add(event.id);
    if (this.processedIds.size > this.maxCacheSize) {
      const arr = Array.from(this.processedIds);
      arr.slice(0, this.maxCacheSize / 2).forEach((id) => this.processedIds.delete(id));
    }

    // Skip historical — but NOT for kind 1059 (NIP-17 Gift Wrap has randomized timestamps)
    if (!this.config.processHistorical && event.kind !== 1059 && event.created_at < this.startTimestamp) {
      this.logger.debug({ eventId: event.id.slice(0, 12), kind: event.kind }, 'Skipping historical event');
      return;
    }

    this.logger.info({ eventId: event.id.slice(0, 12), kind: event.kind, relay: relayUrl }, 'Event received');

    try {
      const normalized = await this.normalizeEvent(event, relayUrl);
      if (!normalized) {
        this.logger.info({ eventId: event.id.slice(0, 12), kind: event.kind }, 'Event filtered out (whitelist or parse failure)');
        return;
      }

      this.logger.info({ source: normalized.source, sender: normalized.sender.slice(0, 20), content: normalized.content.slice(0, 50) }, 'Event normalized');

      for (const handler of this.handlers) {
        try { await handler(normalized); }
        catch (err) { this.logger.error({ eventId: event.id, error: (err as Error).message }, 'Event handler error'); }
      }
    } catch (err) {
      this.logger.error({ eventId: event.id, error: (err as Error).message }, 'Failed to process event');
    }
  }

  private async normalizeEvent(event: NostrEvent, relayUrl: string): Promise<NormalizedEvent | null> {
    // --- Zap receipts ---
    if (event.kind === 9735) {
      return this.normalizeZap(event, relayUrl);
    }

    // --- NIP-17 Gift Wrap ---
    if (event.kind === 1059) {
      return this.normalizeGiftWrap(event, relayUrl);
    }

    // --- NIP-04 DM ---
    if (event.kind === 4) {
      return this.normalizeNip04Dm(event, relayUrl);
    }

    // --- Other events (notes, reactions, etc.) ---
    return this.normalizeGenericEvent(event, relayUrl);
  }

  private normalizeZap(event: NostrEvent, relayUrl: string): NormalizedEvent | null {
    const zap = parseZapReceipt(event);
    if (!zap) return null;

    // Whitelist check on zap sender
    if (!this.isWhitelisted(zap.sender_pubkey)) return null;

    return {
      source: 'nostr.zap',
      origin: 'nostr',
      type: 'zap',
      sender: zap.sender,
      content: zap.message,
      timestamp: event.created_at,
      metadata: {
        id: event.id,
        kind: event.kind,
        relay: relayUrl,
        zap: {
          amount: zap.amount,
          sender: zap.sender,
          sender_pubkey: zap.sender_pubkey,
          recipient: zap.recipient,
          recipient_pubkey: zap.recipient_pubkey,
          message: zap.message,
          zapped_event_id: zap.zapped_event_id,
          bolt11: zap.bolt11,
        },
      },
      raw: event,
    };
  }

  private normalizeGiftWrap(event: NostrEvent, relayUrl: string): NormalizedEvent | null {
    try {
      const unwrapped = this.crypto.unwrapGiftWrap(event);

      this.logger.info({
        eventId: event.id.slice(0, 12),
        innerKind: unwrapped.kind,
        sender: hexToNpub(unwrapped.senderPubkey).slice(0, 20),
      }, 'NIP-17 Gift Wrap unwrapped');

      // Whitelist check on real sender
      if (!this.isWhitelisted(unwrapped.senderPubkey)) {
        this.logger.info({ sender: hexToNpub(unwrapped.senderPubkey).slice(0, 20) }, 'NIP-17 sender not whitelisted');
        return null;
      }

      return {
        source: 'nostr.dm',
        origin: 'nostr',
        type: 'dm',
        sender: hexToNpub(unwrapped.senderPubkey),
        content: unwrapped.content,
        timestamp: unwrapped.created_at,
        metadata: {
          id: event.id,
          kind: 1059,
          inner_kind: unwrapped.kind,
          relay: relayUrl,
          dm_format: 'nip17',
          sender_pubkey: unwrapped.senderPubkey,
        },
        raw: event,
      };
    } catch (err) {
      this.logger.warn({ eventId: event.id, error: (err as Error).message }, 'Failed to unwrap gift wrap');
      return null;
    }
  }

  private async normalizeNip04Dm(event: NostrEvent, relayUrl: string): Promise<NormalizedEvent | null> {
    // Whitelist check
    if (!this.isWhitelisted(event.pubkey)) return null;

    try {
      const decrypted = await this.crypto.decryptEvent(4, event.content, event.pubkey);

      return {
        source: 'nostr.dm',
        origin: 'nostr',
        type: 'dm',
        sender: hexToNpub(event.pubkey),
        content: decrypted.content,
        timestamp: event.created_at,
        metadata: {
          id: event.id,
          kind: 4,
          relay: relayUrl,
          dm_format: decrypted.hasNip18Prefix ? 'nip17' : 'nip04',
          sender_pubkey: event.pubkey,
        },
        raw: event,
      };
    } catch (err) {
      this.logger.warn({ eventId: event.id, error: (err as Error).message }, 'Failed to decrypt NIP-04 DM');
      return null;
    }
  }

  private normalizeGenericEvent(event: NostrEvent, relayUrl: string): NormalizedEvent | null {
    // Whitelist check
    if (!this.isWhitelisted(event.pubkey)) return null;

    const source = KIND_SOURCE_MAP[event.kind] ?? `nostr.kind${event.kind}`;
    const type = source.split('.')[1] ?? 'event';

    return {
      source,
      origin: 'nostr',
      type,
      sender: hexToNpub(event.pubkey),
      content: event.content,
      timestamp: event.created_at,
      metadata: {
        id: event.id,
        kind: event.kind,
        relay: relayUrl,
        sender_pubkey: event.pubkey,
        tags: event.tags,
      },
      raw: event,
    };
  }

  private isWhitelisted(pubkeyHex: string): boolean {
    if (this.whitelistDisabled) return true;
    if (this.whitelistHex.size === 0) return true;
    return this.whitelistHex.has(pubkeyHex);
  }
}
