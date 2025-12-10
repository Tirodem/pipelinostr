import { decode, type Section } from 'light-bolt11-decoder';
import { logger } from '../persistence/logger.js';
import { hexToNpub } from './crypto.js';

/**
 * Parsed zap receipt information
 */
export interface ParsedZap {
  // Amount in sats
  amount: number;

  // Sender info (from zap request)
  sender: {
    pubkey: string;  // hex
    npub: string;
  };

  // Recipient info (from p tag)
  recipient: {
    pubkey: string;  // hex
    npub: string;
  };

  // Optional zap comment/message
  message: string;

  // Event that was zapped (if zapping a note)
  zappedEventId?: string | undefined;

  // Bolt11 invoice
  bolt11: string;

  // Payment preimage (proof of payment)
  preimage?: string | undefined;

  // Timestamp
  timestamp: number;
}

/**
 * Parse a zap receipt event (kind 9735)
 *
 * Zap receipt structure:
 * - tags contain: bolt11, description (zap request), p (recipient), e (zapped event)
 * - description tag contains the original zap request (kind 9734) as JSON
 */
export function parseZapReceipt(event: {
  id: string;
  pubkey: string;
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}): ParsedZap | null {
  try {
    if (event.kind !== 9735) {
      logger.warn({ kind: event.kind }, 'Not a zap receipt event');
      return null;
    }

    // Extract tags
    const bolt11Tag = event.tags.find(t => t[0] === 'bolt11');
    const descriptionTag = event.tags.find(t => t[0] === 'description');
    const pTag = event.tags.find(t => t[0] === 'p');
    const eTag = event.tags.find(t => t[0] === 'e');
    const preimageTag = event.tags.find(t => t[0] === 'preimage');

    if (!bolt11Tag || !bolt11Tag[1]) {
      logger.warn({ eventId: event.id }, 'Zap receipt missing bolt11 tag');
      return null;
    }

    if (!pTag || !pTag[1]) {
      logger.warn({ eventId: event.id }, 'Zap receipt missing p tag (recipient)');
      return null;
    }

    const bolt11 = bolt11Tag[1];
    const recipientPubkey = pTag[1];

    // Decode bolt11 to get amount
    let amount = 0;
    try {
      const decoded = decode(bolt11);
      const amountSection = decoded.sections.find(
        (s: Section) => s.name === 'amount'
      ) as { name: 'amount'; letters: string; value: string } | undefined;
      if (amountSection && amountSection.value) {
        // Amount is in millisats, convert to sats
        amount = Math.floor(parseInt(amountSection.value, 10) / 1000);
      }
    } catch (decodeError) {
      logger.warn({ eventId: event.id, error: decodeError }, 'Failed to decode bolt11');
    }

    // Parse zap request from description tag to get sender info
    let senderPubkey = '';
    let message = '';

    if (descriptionTag && descriptionTag[1]) {
      try {
        const zapRequest = JSON.parse(descriptionTag[1]);
        senderPubkey = zapRequest.pubkey || '';
        message = zapRequest.content || '';
      } catch {
        logger.debug({ eventId: event.id }, 'Failed to parse zap request description');
      }
    }

    // Fallback: if no sender found, can't determine who zapped
    if (!senderPubkey) {
      logger.warn({ eventId: event.id }, 'Could not determine zap sender');
      // Still return partial info
    }

    const parsedZap: ParsedZap = {
      amount,
      sender: {
        pubkey: senderPubkey,
        npub: senderPubkey ? hexToNpub(senderPubkey) : '',
      },
      recipient: {
        pubkey: recipientPubkey,
        npub: hexToNpub(recipientPubkey),
      },
      message,
      zappedEventId: eTag ? eTag[1] : undefined,
      bolt11,
      preimage: preimageTag ? preimageTag[1] : undefined,
      timestamp: event.created_at,
    };

    logger.debug(
      {
        eventId: event.id,
        amount: parsedZap.amount,
        sender: parsedZap.sender.npub.slice(0, 20) + '...',
        recipient: parsedZap.recipient.npub.slice(0, 20) + '...',
      },
      'Parsed zap receipt'
    );

    return parsedZap;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ eventId: event.id, error: errorMessage }, 'Failed to parse zap receipt');
    return null;
  }
}

/**
 * Format amount for display (with K/M suffixes)
 */
export function formatSats(amount: number): string {
  if (amount >= 1_000_000) {
    return `${(amount / 1_000_000).toFixed(1)}M`;
  }
  if (amount >= 1_000) {
    return `${(amount / 1_000).toFixed(1)}K`;
  }
  return `${amount}`;
}
