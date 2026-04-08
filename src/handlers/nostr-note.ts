/**
 * Nostr note handler (v2)
 *
 * Publishes kind 1 text notes to nostr relays.
 * Shares crypto with nostr-dm handler.
 */

import { z } from 'zod';
import { finalizeEvent } from 'nostr-tools/pure';
import { BaseHandler, type HandlerResult, type ActionContext } from './base.js';
import { type CryptoHelper } from '../utils/crypto.js';
import { Relay } from 'nostr-tools/relay';

export class NostrNoteHandler extends BaseHandler {
  static type = 'nostr_note';
  static configSchema = z.object({ enabled: z.boolean().optional() });

  readonly name = 'Nostr Note';
  readonly type = 'nostr_note';

  private crypto!: CryptoHelper;
  private relays: string[] = [];

  async initialize(config: Record<string, unknown>): Promise<void> {
    this.crypto = config._crypto as CryptoHelper;
    this.relays = config._relays as string[];
    if (!this.crypto) throw new Error('NostrNoteHandler requires _crypto');
    if (!this.relays?.length) throw new Error('NostrNoteHandler requires _relays');
  }

  async execute(action: Record<string, unknown>, _context: ActionContext): Promise<HandlerResult> {
    const content = action.content as string;
    if (!content) return { success: false, error: 'Missing content' };

    try {
      const event = finalizeEvent({
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: (action.tags as string[][] | undefined) ?? [],
        content,
      }, this.crypto.getPrivateKeyBytes());

      let published = 0;
      for (const url of this.relays) {
        try {
          const relay = await Relay.connect(url);
          await relay.publish(event);
          relay.close();
          published++;
        } catch { /* skip */ }
      }

      return {
        success: true,
        data: { event_id: event.id, relays_published: published },
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async shutdown(): Promise<void> {}
}
