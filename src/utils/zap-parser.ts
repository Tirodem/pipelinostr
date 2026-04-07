/**
 * Zap receipt parser
 *
 * Extracts amount, sender, recipient, message from kind 9735 events.
 * Ported from v1 with cleanup.
 */

import { decode, type Section } from 'light-bolt11-decoder';
import { hexToNpub } from './crypto.js';

export interface ParsedZap {
  amount: number;
  sender: string;         // npub
  sender_pubkey: string;  // hex
  recipient: string;      // npub
  recipient_pubkey: string; // hex
  message: string;
  zapped_event_id?: string | undefined;
  bolt11: string;
  timestamp: number;
}

export function parseZapReceipt(event: {
  id: string;
  pubkey: string;
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}): ParsedZap | null {
  if (event.kind !== 9735) return null;

  const bolt11Tag = event.tags.find((t) => t[0] === 'bolt11');
  const descriptionTag = event.tags.find((t) => t[0] === 'description');
  const pTag = event.tags.find((t) => t[0] === 'p');
  const eTag = event.tags.find((t) => t[0] === 'e');

  if (!bolt11Tag?.[1] || !pTag?.[1]) return null;

  const bolt11 = bolt11Tag[1];
  const recipientPubkey = pTag[1];

  // Decode bolt11 for amount
  let amount = 0;
  try {
    const decoded = decode(bolt11);
    const amountSection = decoded.sections.find(
      (s: Section) => s.name === 'amount',
    ) as { name: 'amount'; value: string } | undefined;
    if (amountSection?.value) {
      amount = Math.floor(parseInt(amountSection.value, 10) / 1000);
    }
  } catch {
    // Failed to decode bolt11, amount stays 0
  }

  // Parse zap request for sender info
  let senderPubkey = '';
  let message = '';
  if (descriptionTag?.[1]) {
    try {
      const zapRequest = JSON.parse(descriptionTag[1]) as { pubkey?: string; content?: string };
      senderPubkey = zapRequest.pubkey ?? '';
      message = zapRequest.content ?? '';
    } catch {
      // Failed to parse zap request
    }
  }

  return {
    amount,
    sender: senderPubkey ? hexToNpub(senderPubkey) : '',
    sender_pubkey: senderPubkey,
    recipient: hexToNpub(recipientPubkey),
    recipient_pubkey: recipientPubkey,
    message,
    zapped_event_id: eTag?.[1],
    bolt11,
    timestamp: event.created_at,
  };
}
