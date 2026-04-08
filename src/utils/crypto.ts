/**
 * Nostr crypto utilities
 *
 * NIP-04 / NIP-44 encryption/decryption, NIP-59 Gift Wrap unwrapping,
 * key format conversions. Ported from v1 with cleanup.
 */

import { nip04, nip19, nip44, getPublicKey } from 'nostr-tools';
import * as nip59 from 'nostr-tools/nip59';
import type { NostrEvent } from 'nostr-tools/pure';

const AMETHYST_NIP18_PREFIX = /^\[\/\/\]: # \(nip18\)\s*/;

export interface DecryptedContent {
  content: string;
  encryptionType: 'nip04' | 'nip44' | 'none';
  hasNip18Prefix?: boolean | undefined;
}

export interface UnwrappedGiftWrap {
  content: string;
  senderPubkey: string;
  kind: number;
  tags: string[][];
  created_at: number;
}

export class CryptoHelper {
  private privateKey: Uint8Array;
  private publicKey: string;

  constructor(privateKeyHex: string) {
    if (privateKeyHex.startsWith('nsec')) {
      const decoded = nip19.decode(privateKeyHex);
      if (decoded.type !== 'nsec') throw new Error('Invalid nsec key');
      this.privateKey = decoded.data;
    } else {
      this.privateKey = hexToBytes(privateKeyHex);
    }
    this.publicKey = getPublicKey(this.privateKey);
  }

  getPublicKey(): string { return this.publicKey; }
  getPublicKeyNpub(): string { return nip19.npubEncode(this.publicKey); }
  getPrivateKeyBytes(): Uint8Array { return this.privateKey; }

  async decryptNip04(content: string, senderPubkey: string): Promise<string> {
    return nip04.decrypt(this.privateKey, senderPubkey, content);
  }

  async encryptNip04(content: string, recipientPubkey: string): Promise<string> {
    return nip04.encrypt(this.privateKey, recipientPubkey, content);
  }

  decryptNip44(content: string, senderPubkey: string): string {
    const conversationKey = nip44.getConversationKey(this.privateKey, senderPubkey);
    return nip44.decrypt(content, conversationKey);
  }

  encryptNip44(content: string, recipientPubkey: string): string {
    const conversationKey = nip44.getConversationKey(this.privateKey, recipientPubkey);
    return nip44.encrypt(content, conversationKey);
  }

  unwrapGiftWrap(event: NostrEvent): UnwrappedGiftWrap {
    const rumor = nip59.unwrapEvent(event, this.privateKey);
    return {
      content: cleanAmethystPrefix(rumor.content),
      senderPubkey: rumor.pubkey,
      kind: rumor.kind,
      tags: rumor.tags,
      created_at: rumor.created_at,
    };
  }

  async decryptEvent(kind: number, content: string, senderPubkey: string): Promise<DecryptedContent> {
    if (kind === 4) {
      const decrypted = await this.decryptNip04(content, senderPubkey);
      const hasNip18Prefix = AMETHYST_NIP18_PREFIX.test(decrypted);
      return { content: cleanAmethystPrefix(decrypted), encryptionType: 'nip04', hasNip18Prefix };
    }
    if (kind === 1059 || kind === 1060) {
      return { content: this.decryptNip44(content, senderPubkey), encryptionType: 'nip44' };
    }
    if (kind === 14) {
      const decrypted = this.decryptNip44(content, senderPubkey);
      const hasNip18Prefix = AMETHYST_NIP18_PREFIX.test(decrypted);
      return { content: cleanAmethystPrefix(decrypted), encryptionType: 'nip44', hasNip18Prefix };
    }
    return { content, encryptionType: 'none' };
  }
}

// --- Helpers ---

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function npubToHex(npub: string): string {
  if (!npub.startsWith('npub')) return npub;
  const decoded = nip19.decode(npub);
  if (decoded.type !== 'npub') throw new Error('Invalid npub');
  return decoded.data;
}

export function hexToNpub(hex: string): string {
  return nip19.npubEncode(hex);
}

export function nsecToHex(nsec: string): string {
  if (!nsec.startsWith('nsec')) return nsec;
  const decoded = nip19.decode(nsec);
  if (decoded.type !== 'nsec') throw new Error('Invalid nsec');
  return bytesToHex(decoded.data);
}

export function cleanAmethystPrefix(content: string): string {
  return content.replace(AMETHYST_NIP18_PREFIX, '');
}
