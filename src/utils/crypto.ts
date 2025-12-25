import { nip04, nip19, nip44, getPublicKey } from 'nostr-tools';
import * as nip59 from 'nostr-tools/nip59';
import type { NostrEvent } from 'nostr-tools/pure';
import { logger } from '../persistence/logger.js';

// Amethyst adds this prefix to NIP-17 messages for NIP-18 compatibility
const AMETHYST_NIP18_PREFIX = /^\[\/\/\]: # \(nip18\)\s*/;

export interface DecryptedContent {
  content: string;
  encryptionType: 'nip04' | 'nip44' | 'none';
  hasNip18Prefix?: boolean;  // Amethyst NIP-18 prefix was detected (signals NIP-17 preference)
}

export interface UnwrappedGiftWrap {
  content: string;
  senderPubkey: string;  // Real sender (from the rumor)
  kind: number;          // Inner event kind (14 for DM)
  tags: string[][];
  created_at: number;
}

export class CryptoHelper {
  private privateKey: Uint8Array;
  private publicKey: string;

  constructor(privateKeyHex: string) {
    // Handle nsec format
    if (privateKeyHex.startsWith('nsec')) {
      const decoded = nip19.decode(privateKeyHex);
      if (decoded.type !== 'nsec') {
        throw new Error('Invalid nsec key');
      }
      this.privateKey = decoded.data;
    } else {
      // Hex format
      this.privateKey = hexToBytes(privateKeyHex);
    }

    this.publicKey = getPublicKey(this.privateKey);
  }

  getPublicKey(): string {
    return this.publicKey;
  }

  getPublicKeyNpub(): string {
    return nip19.npubEncode(this.publicKey);
  }

  // Decrypt NIP-04 encrypted content
  async decryptNip04(encryptedContent: string, senderPubkey: string): Promise<string> {
    try {
      const decrypted = await nip04.decrypt(this.privateKey, senderPubkey, encryptedContent);
      return decrypted;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage }, 'NIP-04 decryption failed');
      throw new Error(`NIP-04 decryption failed: ${errorMessage}`);
    }
  }

  // Encrypt NIP-04 content
  async encryptNip04(content: string, recipientPubkey: string): Promise<string> {
    try {
      const encrypted = await nip04.encrypt(this.privateKey, recipientPubkey, content);
      return encrypted;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage }, 'NIP-04 encryption failed');
      throw new Error(`NIP-04 encryption failed: ${errorMessage}`);
    }
  }

  // Decrypt NIP-44 encrypted content
  decryptNip44(encryptedContent: string, senderPubkey: string): string {
    try {
      const conversationKey = nip44.getConversationKey(this.privateKey, senderPubkey);
      const decrypted = nip44.decrypt(encryptedContent, conversationKey);
      return decrypted;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage }, 'NIP-44 decryption failed');
      throw new Error(`NIP-44 decryption failed: ${errorMessage}`);
    }
  }

  // Encrypt NIP-44 content
  encryptNip44(content: string, recipientPubkey: string): string {
    try {
      const conversationKey = nip44.getConversationKey(this.privateKey, recipientPubkey);
      const encrypted = nip44.encrypt(content, conversationKey);
      return encrypted;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage }, 'NIP-44 encryption failed');
      throw new Error(`NIP-44 encryption failed: ${errorMessage}`);
    }
  }

  // Unwrap a NIP-59 Gift Wrap event (kind 1059) to get the inner rumor
  unwrapGiftWrap(event: NostrEvent): UnwrappedGiftWrap {
    try {
      // Use nostr-tools nip59 to unwrap: Gift Wrap → Seal → Rumor
      const rumor = nip59.unwrapEvent(event, this.privateKey);

      // Clean Amethyst NIP-18 prefix if present
      const cleanContent = cleanAmethystPrefix(rumor.content);

      logger.debug(
        {
          wrapId: event.id,
          rumorKind: rumor.kind,
          senderPubkey: rumor.pubkey.slice(0, 16) + '...',
          hasAmethystPrefix: rumor.content !== cleanContent,
        },
        'Gift wrap unwrapped successfully'
      );

      return {
        content: cleanContent,
        senderPubkey: rumor.pubkey,
        kind: rumor.kind,
        tags: rumor.tags,
        created_at: rumor.created_at,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage, eventId: event.id }, 'Gift wrap unwrap failed');
      throw new Error(`Gift wrap unwrap failed: ${errorMessage}`);
    }
  }

  // Auto-detect and decrypt based on event kind
  // Note: For kind 1059 (Gift Wrap), use unwrapGiftWrap() instead for full NIP-17 support
  async decryptEvent(kind: number, content: string, senderPubkey: string): Promise<DecryptedContent> {
    // Kind 4: NIP-04 encrypted DM
    if (kind === 4) {
      const decrypted = await this.decryptNip04(content, senderPubkey);
      // Detect Amethyst NIP-18 prefix (signals NIP-17 preference)
      const hasNip18Prefix = AMETHYST_NIP18_PREFIX.test(decrypted);
      const cleanContent = cleanAmethystPrefix(decrypted);
      return { content: cleanContent, encryptionType: 'nip04', hasNip18Prefix };
    }

    // Kind 1059: NIP-44 Gift Wrap - this is a legacy path
    // For proper NIP-17 unwrapping, use unwrapGiftWrap() method instead
    // Kind 1060: Sealed event
    if (kind === 1059 || kind === 1060) {
      const decrypted = this.decryptNip44(content, senderPubkey);
      return { content: decrypted, encryptionType: 'nip44' };
    }

    // Kind 14: NIP-17 private DM (uses NIP-44)
    if (kind === 14) {
      const decrypted = this.decryptNip44(content, senderPubkey);
      const hasNip18Prefix = AMETHYST_NIP18_PREFIX.test(decrypted);
      const cleanContent = cleanAmethystPrefix(decrypted);
      return { content: cleanContent, encryptionType: 'nip44', hasNip18Prefix };
    }

    // Unencrypted content
    return { content, encryptionType: 'none' };
  }

  // Get the private key bytes (for signing)
  getPrivateKeyBytes(): Uint8Array {
    return this.privateKey;
  }
}

// Helper function to convert hex string to Uint8Array
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

// Helper to convert npub to hex pubkey
export function npubToHex(npub: string): string {
  if (!npub.startsWith('npub')) {
    // Already hex
    return npub;
  }
  const decoded = nip19.decode(npub);
  if (decoded.type !== 'npub') {
    throw new Error('Invalid npub');
  }
  return decoded.data;
}

// Helper to convert hex pubkey to npub
export function hexToNpub(hex: string): string {
  return nip19.npubEncode(hex);
}

// Helper to convert nsec to hex
export function nsecToHex(nsec: string): string {
  if (!nsec.startsWith('nsec')) {
    return nsec;
  }
  const decoded = nip19.decode(nsec);
  if (decoded.type !== 'nsec') {
    throw new Error('Invalid nsec');
  }
  return bytesToHex(decoded.data);
}

// Helper to convert bytes to hex
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Clean Amethyst NIP-18 prefix from message content
// Amethyst adds "[//]: # (nip18)\n" prefix to NIP-17 messages
export function cleanAmethystPrefix(content: string): string {
  return content.replace(AMETHYST_NIP18_PREFIX, '');
}
