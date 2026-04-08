/**
 * Nostr DM handler (v2)
 *
 * Sends DMs via Nostr relays.
 * Replies in the same format (NIP-04/NIP-17) as the incoming message.
 */

import { z } from 'zod';
import { finalizeEvent, type NostrEvent } from 'nostr-tools/pure';
import * as nip17 from 'nostr-tools/nip17';
import { BaseHandler, type HandlerResult, type ActionContext } from './base.js';
import { type CryptoHelper, npubToHex } from '../utils/crypto.js';
import { Relay } from 'nostr-tools/relay';

export class NostrDmHandler extends BaseHandler {
  static type = 'nostr_dm';
  static configSchema = z.object({
    default_dm_format: z.enum(['nip04', 'nip17']).optional(),
    enabled: z.boolean().optional(),
  });

  readonly name = 'Nostr DM';
  readonly type = 'nostr_dm';

  private crypto!: CryptoHelper;
  private relays: string[] = [];
  private defaultDmFormat: 'nip04' | 'nip17' = 'nip04';

  /**
   * Initialize with a shared CryptoHelper (injected, not created).
   * The crypto helper is shared with the NostrInboundListener.
   */
  async initialize(config: Record<string, unknown>): Promise<void> {
    this.crypto = config._crypto as CryptoHelper;
    this.relays = config._relays as string[];
    this.defaultDmFormat = (config.default_dm_format as 'nip04' | 'nip17') ?? 'nip04';

    if (!this.crypto) throw new Error('NostrDmHandler requires _crypto (CryptoHelper) in config');
    if (!this.relays?.length) throw new Error('NostrDmHandler requires _relays in config');
  }

  async execute(action: Record<string, unknown>, context: ActionContext): Promise<HandlerResult> {
    const recipientInput = action.to as string;
    if (!recipientInput) return { success: false, error: 'Missing "to" field' };

    const content = action.content as string;
    if (!content) return { success: false, error: 'Missing "content" field' };

    // Determine DM format: action override > trigger format > default
    const dmFormat = (action.dm_format as string)
      ?? (context.trigger.dm_format as string)
      ?? this.defaultDmFormat;

    try {
      const recipientPubkey = npubToHex(recipientInput);

      let event: NostrEvent;
      if (dmFormat === 'nip17') {
        event = this.createNip17Event(content, recipientPubkey);
      } else {
        event = await this.createNip04Event(content, recipientPubkey);
      }

      // Publish to relays
      const published = await this.publishToRelays(event);

      return {
        success: true,
        data: {
          event_id: event.id,
          recipient: recipientInput,
          dm_format: dmFormat,
          relays_published: published,
        },
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async shutdown(): Promise<void> {}

  private async createNip04Event(content: string, recipientPubkey: string): Promise<NostrEvent> {
    const encrypted = await this.crypto.encryptNip04(content, recipientPubkey);

    const event = finalizeEvent({
      kind: 4,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', recipientPubkey]],
      content: encrypted,
    }, this.crypto.getPrivateKeyBytes());

    return event;
  }

  private createNip17Event(content: string, recipientPubkey: string): NostrEvent {
    return nip17.wrapEvent(
      this.crypto.getPrivateKeyBytes(),
      { publicKey: recipientPubkey },
      content,
    );
  }

  private async publishToRelays(event: NostrEvent): Promise<number> {
    let count = 0;

    for (const url of this.relays) {
      try {
        const relay = await Relay.connect(url);
        await relay.publish(event);
        relay.close();
        count++;
      } catch {
        // Skip failed relays
      }
    }

    return count;
  }
}
