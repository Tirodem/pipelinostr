/**
 * Bitcoin Wallet Handler - Watch-only wallet via xpub
 *
 * Actions:
 * - get_addresses: Derive addresses from xpub and get balances
 * - generate_bill: Create QR code for payment request
 * - check_transaction: Check transaction status and confirmations
 * - convert_currency: Convert between fiat and BTC/SAT
 */

import * as bitcoin from 'bitcoinjs-lib';
import * as QRCode from 'qrcode';
import { logger } from '../persistence/logger.js';
import type { Handler, HandlerResult, HandlerConfig } from './handler.interface.js';

// BIP32 interface for xpub derivation
interface BIP32Interface {
  derive(index: number): BIP32Interface;
  publicKey: Buffer;
}

export interface WalletHandlerConfig {
  xpub: string;
  mempool_api?: string;
  rate_limit_seconds?: number;
  confirmations_notify?: number;
  network?: 'mainnet' | 'testnet';
}

export interface WalletActionConfig extends HandlerConfig {
  action: 'get_addresses' | 'generate_bill' | 'check_transaction' | 'convert_currency';
  // For get_addresses
  start_index?: number;
  count?: number;
  // For generate_bill
  address_index?: number;
  amount?: number;
  currency?: 'EUR' | 'USD' | 'CHF' | 'SAT' | 'BTC';
  // For check_transaction
  address?: string;
  txid?: string;
  // For convert_currency
  from_currency?: string;
  to_currency?: string;
  value?: number;
}

interface AddressInfo {
  index: number;
  address: string;
  balance_sats: number;
  balance_btc: number;
  tx_count: number;
}

interface TransactionStatus {
  txid: string;
  confirmed: boolean;
  block_height: number | null;
  confirmations: number;
  amount_sats: number;
}

// Mempool.space API types
interface MempoolTxStatus {
  confirmed: boolean;
  block_height?: number;
}

interface MempoolTxVout {
  value: number;
}

interface MempoolTx {
  txid: string;
  status?: MempoolTxStatus;
  vout?: MempoolTxVout[];
}

interface MempoolAddressStats {
  funded_txo_sum?: number;
  spent_txo_sum?: number;
  tx_count?: number;
}

interface MempoolAddressInfo {
  chain_stats?: MempoolAddressStats;
  mempool_stats?: MempoolAddressStats;
}

interface CoinbasePrice {
  data: {
    amount: string;
  };
}

interface NostrBuildResponse {
  data?: Array<{ url?: string }>;
}

// Rate limiting cache
const rateLimitCache: Map<string, number> = new Map();

export class WalletHandler implements Handler {
  readonly name = 'Bitcoin Wallet Handler';
  readonly type = 'wallet';

  private xpub: string;
  private mempoolApi: string;
  private rateLimitSeconds: number;
  private confirmationsNotify: number;
  private network: bitcoin.Network;

  constructor(config: WalletHandlerConfig) {
    this.xpub = config.xpub;
    this.mempoolApi = config.mempool_api ?? 'https://mempool.space/api';
    this.rateLimitSeconds = config.rate_limit_seconds ?? 10;
    this.confirmationsNotify = config.confirmations_notify ?? 3;
    this.network = config.network === 'testnet' ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;
  }

  async initialize(): Promise<void> {
    if (!this.xpub) {
      logger.warn('Wallet handler: No xpub configured');
      return;
    }
    logger.info({ mempoolApi: this.mempoolApi }, 'Wallet handler initialized');
  }

  async execute(config: HandlerConfig, _context: Record<string, unknown>): Promise<HandlerResult> {
    const walletConfig = config as WalletActionConfig;
    const action = walletConfig.action;

    try {
      switch (action) {
        case 'get_addresses':
          return await this.getAddresses(walletConfig);
        case 'generate_bill':
          return await this.generateBill(walletConfig);
        case 'check_transaction':
          return await this.checkTransaction(walletConfig);
        case 'convert_currency':
          return await this.convertCurrency(walletConfig);
        default:
          return { success: false, error: `Unknown action: ${action}` };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage, action }, 'Wallet handler failed');
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Derive addresses from xpub and get their balances
   */
  private async getAddresses(config: WalletActionConfig): Promise<HandlerResult> {
    const startIndex = config.start_index ?? 0;
    const count = config.count ?? 1;

    if (!this.xpub) {
      return { success: false, error: 'No xpub configured' };
    }

    const addresses: AddressInfo[] = [];

    for (let i = startIndex; i < startIndex + count; i++) {
      const address = this.deriveAddress(i);
      if (!address) {
        return { success: false, error: `Failed to derive address at index ${i}` };
      }

      // Get balance from mempool.space
      const balanceInfo = await this.getAddressBalance(address);

      addresses.push({
        index: i,
        address,
        balance_sats: balanceInfo.balance_sats,
        balance_btc: balanceInfo.balance_sats / 100_000_000,
        tx_count: balanceInfo.tx_count,
      });
    }

    // Format response
    const formatted = addresses.map(a =>
      `Address #${a.index}: ${a.address}\n  Balance: ${a.balance_btc.toFixed(8)} BTC (${a.balance_sats.toLocaleString()} sats)\n  Transactions: ${a.tx_count}`
    ).join('\n\n');

    return {
      success: true,
      data: {
        addresses,
        formatted,
      },
    };
  }

  /**
   * Generate a payment bill with QR code
   */
  private async generateBill(config: WalletActionConfig): Promise<HandlerResult> {
    const addressIndex = config.address_index ?? 0;
    const amount = config.amount ?? 0;
    const currency = config.currency ?? 'SAT';

    if (!this.xpub) {
      return { success: false, error: 'No xpub configured' };
    }

    // Derive address
    const address = this.deriveAddress(addressIndex);
    if (!address) {
      return { success: false, error: `Failed to derive address at index ${addressIndex}` };
    }

    // Convert amount to SAT if needed
    let amountSats = amount;
    let amountBtc = amount / 100_000_000;
    let conversionInfo = '';

    if (currency !== 'SAT') {
      const converted = await this.convertToSats(amount, currency);
      if (!converted.success) {
        return { success: false, error: converted.error ?? 'Conversion failed' };
      }
      amountSats = converted.sats;
      amountBtc = amountSats / 100_000_000;
      conversionInfo = ` (~${amount} ${currency})`;
    } else {
      amountBtc = amountSats / 100_000_000;
    }

    // Generate BIP21 URI
    const bip21Uri = amountSats > 0
      ? `bitcoin:${address}?amount=${amountBtc.toFixed(8)}`
      : `bitcoin:${address}`;

    // Generate QR code as PNG buffer
    const qrBuffer = await QRCode.toBuffer(bip21Uri, {
      type: 'png',
      width: 400,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    });

    // Upload to nostr.build
    const imageUrl = await this.uploadToNostrBuild(qrBuffer);
    if (!imageUrl) {
      return { success: false, error: 'Failed to upload QR code to nostr.build' };
    }

    // Format response
    const formatted = amountSats > 0
      ? `💰 Payment Request\n\nAddress: ${address}\nAmount: ${amountSats.toLocaleString()} sats (${amountBtc.toFixed(8)} BTC)${conversionInfo}\n\n${imageUrl}`
      : `📍 Bitcoin Address #${addressIndex}\n\nAddress: ${address}\n\n${imageUrl}`;

    return {
      success: true,
      data: {
        address,
        address_index: addressIndex,
        amount_sats: amountSats,
        amount_btc: amountBtc,
        currency,
        bip21_uri: bip21Uri,
        qr_url: imageUrl,
        formatted,
      },
    };
  }

  /**
   * Check transaction status and confirmations
   */
  private async checkTransaction(config: WalletActionConfig): Promise<HandlerResult> {
    const address = config.address;
    const txid = config.txid;

    if (!address && !txid) {
      return { success: false, error: 'Either address or txid is required' };
    }

    // Check rate limit
    if (!this.checkRateLimit('transaction')) {
      return { success: false, error: `Rate limited. Please wait ${this.rateLimitSeconds} seconds.` };
    }

    try {
      if (txid) {
        // Get specific transaction
        const response = await fetch(`${this.mempoolApi}/tx/${txid}`);
        if (!response.ok) {
          return { success: false, error: `Transaction not found: ${txid}` };
        }

        const tx = await response.json() as MempoolTx;
        const blockHeight = tx.status?.block_height ?? null;

        // Get current block height for confirmations
        let confirmations = 0;
        if (blockHeight) {
          const tipResponse = await fetch(`${this.mempoolApi}/blocks/tip/height`);
          if (tipResponse.ok) {
            const tipHeight = await tipResponse.json() as number;
            confirmations = tipHeight - blockHeight + 1;
          }
        }

        const status: TransactionStatus = {
          txid,
          confirmed: tx.status?.confirmed ?? false,
          block_height: blockHeight,
          confirmations,
          amount_sats: tx.vout?.reduce((sum, out) => sum + out.value, 0) ?? 0,
        };

        const formatted = status.confirmed
          ? `✅ Transaction confirmed\nTxID: ${txid}\nBlock: ${blockHeight}\nConfirmations: ${confirmations}`
          : `⏳ Transaction in mempool\nTxID: ${txid}\nWaiting for confirmation...`;

        return {
          success: true,
          data: { ...status, formatted },
        };
      } else if (address) {
        // Get recent transactions for address
        const response = await fetch(`${this.mempoolApi}/address/${address}/txs`);
        if (!response.ok) {
          return { success: false, error: `Failed to get transactions for address: ${address}` };
        }

        const txs = await response.json() as MempoolTx[];
        const recentTxs = txs.slice(0, 5);

        // Get current block height
        const tipResponse = await fetch(`${this.mempoolApi}/blocks/tip/height`);
        const tipHeight = tipResponse.ok ? await tipResponse.json() as number : 0;

        const transactions = recentTxs.map((tx) => {
          const blockHeight = tx.status?.block_height ?? null;
          const confirmations = blockHeight && tipHeight ? tipHeight - blockHeight + 1 : 0;
          return {
            txid: tx.txid,
            confirmed: tx.status?.confirmed ?? false,
            block_height: blockHeight,
            confirmations,
            amount_sats: tx.vout?.reduce((sum, out) => sum + out.value, 0) ?? 0,
          };
        });

        const formatted = transactions.length > 0
          ? transactions.map((tx: TransactionStatus) =>
              `${tx.confirmed ? '✅' : '⏳'} ${tx.txid.slice(0, 8)}... - ${tx.confirmations} conf`
            ).join('\n')
          : 'No transactions found';

        return {
          success: true,
          data: { address, transactions, formatted },
        };
      }

      return { success: false, error: 'Invalid parameters' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: `API error: ${errorMessage}` };
    }
  }

  /**
   * Convert between currencies
   */
  private async convertCurrency(config: WalletActionConfig): Promise<HandlerResult> {
    const fromCurrency = config.from_currency?.toUpperCase() ?? 'EUR';
    const toCurrency = config.to_currency?.toUpperCase() ?? 'SAT';
    const value = config.value ?? 0;

    try {
      if (fromCurrency === toCurrency) {
        return { success: true, data: { from: value, to: value, rate: 1 } };
      }

      // Get BTC price in fiat
      const btcPrice = await this.getBtcPrice(fromCurrency === 'BTC' || fromCurrency === 'SAT' ? toCurrency : fromCurrency);

      let result: number;
      let rate: number;

      if (fromCurrency === 'SAT') {
        // SAT -> fiat or BTC
        if (toCurrency === 'BTC') {
          result = value / 100_000_000;
          rate = 100_000_000;
        } else {
          result = (value / 100_000_000) * btcPrice;
          rate = btcPrice / 100_000_000;
        }
      } else if (fromCurrency === 'BTC') {
        // BTC -> fiat or SAT
        if (toCurrency === 'SAT') {
          result = value * 100_000_000;
          rate = 100_000_000;
        } else {
          result = value * btcPrice;
          rate = btcPrice;
        }
      } else {
        // Fiat -> BTC or SAT
        if (toCurrency === 'BTC') {
          result = value / btcPrice;
          rate = 1 / btcPrice;
        } else if (toCurrency === 'SAT') {
          result = Math.round((value / btcPrice) * 100_000_000);
          rate = 100_000_000 / btcPrice;
        } else {
          // Fiat -> Fiat (through BTC)
          const btcPriceTo = await this.getBtcPrice(toCurrency);
          result = (value / btcPrice) * btcPriceTo;
          rate = btcPriceTo / btcPrice;
        }
      }

      const formatted = `${value} ${fromCurrency} = ${toCurrency === 'SAT' ? Math.round(result).toLocaleString() : result.toFixed(8)} ${toCurrency}`;

      return {
        success: true,
        data: {
          from_value: value,
          from_currency: fromCurrency,
          to_value: result,
          to_currency: toCurrency,
          rate,
          formatted,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Conversion failed: ${errorMessage}` };
    }
  }

  /**
   * Derive address from xpub at given index (BIP84 - Native SegWit)
   */
  private deriveAddress(index: number): string | null {
    try {
      // Dynamically import bip32 (ESM compatible)
      const { BIP32Factory } = require('bip32');
      const ecc = require('tiny-secp256k1');
      const bip32 = BIP32Factory(ecc);

      // Parse xpub
      const node = bip32.fromBase58(this.xpub, this.network) as BIP32Interface;

      // Derive: m/0/index (external chain)
      const child = node.derive(0).derive(index);

      // Create P2WPKH address (Native SegWit - bc1q...)
      const { address } = bitcoin.payments.p2wpkh({
        pubkey: child.publicKey,
        network: this.network,
      });

      return address ?? null;
    } catch (error) {
      logger.error({ error, index }, 'Failed to derive address');
      return null;
    }
  }

  /**
   * Get address balance from mempool.space
   */
  private async getAddressBalance(address: string): Promise<{ balance_sats: number; tx_count: number }> {
    // Check rate limit
    if (!this.checkRateLimit('balance')) {
      logger.warn('Rate limited, returning cached or zero balance');
      return { balance_sats: 0, tx_count: 0 };
    }

    try {
      const response = await fetch(`${this.mempoolApi}/address/${address}`);
      if (!response.ok) {
        logger.warn({ address, status: response.status }, 'Failed to get address info');
        return { balance_sats: 0, tx_count: 0 };
      }

      const data = await response.json() as MempoolAddressInfo;
      const funded = data.chain_stats?.funded_txo_sum ?? 0;
      const spent = data.chain_stats?.spent_txo_sum ?? 0;
      const mempoolFunded = data.mempool_stats?.funded_txo_sum ?? 0;
      const mempoolSpent = data.mempool_stats?.spent_txo_sum ?? 0;

      return {
        balance_sats: funded - spent + mempoolFunded - mempoolSpent,
        tx_count: (data.chain_stats?.tx_count ?? 0) + (data.mempool_stats?.tx_count ?? 0),
      };
    } catch (error) {
      logger.error({ error, address }, 'Error fetching address balance');
      return { balance_sats: 0, tx_count: 0 };
    }
  }

  /**
   * Convert amount to satoshis
   */
  private async convertToSats(amount: number, currency: string): Promise<{ success: boolean; sats: number; error?: string }> {
    if (currency === 'SAT') {
      return { success: true, sats: amount };
    }
    if (currency === 'BTC') {
      return { success: true, sats: Math.round(amount * 100_000_000) };
    }

    try {
      const btcPrice = await this.getBtcPrice(currency);
      const btcAmount = amount / btcPrice;
      const sats = Math.round(btcAmount * 100_000_000);
      return { success: true, sats };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, sats: 0, error: errorMessage };
    }
  }

  /**
   * Get BTC price in fiat currency from Coinbase API
   */
  private async getBtcPrice(currency: string): Promise<number> {
    const response = await fetch(`https://api.coinbase.com/v2/prices/BTC-${currency}/spot`);
    if (!response.ok) {
      throw new Error(`Failed to get BTC price for ${currency}`);
    }
    const data = await response.json() as CoinbasePrice;
    return parseFloat(data.data.amount);
  }

  /**
   * Upload image to nostr.build
   */
  private async uploadToNostrBuild(imageBuffer: Buffer): Promise<string | null> {
    try {
      // Use native FormData with Blob
      const blob = new Blob([imageBuffer], { type: 'image/png' });
      const formData = new FormData();
      formData.append('file', blob, 'qrcode.png');

      const response = await fetch('https://nostr.build/api/v2/upload/files', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        logger.error({ status: response.status }, 'nostr.build upload failed');
        return null;
      }

      const result = await response.json() as NostrBuildResponse;
      return result.data?.[0]?.url ?? null;
    } catch (error) {
      logger.error({ error }, 'Failed to upload to nostr.build');
      return null;
    }
  }

  /**
   * Check rate limit for mempool.space API calls
   */
  private checkRateLimit(key: string): boolean {
    const now = Date.now();
    const lastCall = rateLimitCache.get(key) ?? 0;

    if (now - lastCall < this.rateLimitSeconds * 1000) {
      return false;
    }

    rateLimitCache.set(key, now);
    return true;
  }

  async shutdown(): Promise<void> {
    logger.info('Wallet handler shut down');
  }
}
