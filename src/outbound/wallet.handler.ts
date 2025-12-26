/**
 * Bitcoin Wallet Handler - Watch-only wallet via xpub
 *
 * Actions:
 * - get_addresses: Derive addresses from xpub and get balances
 * - generate_bill: Create QR code for payment request
 * - check_transaction: Check transaction status and confirmations
 * - convert_currency: Convert between fiat and BTC/SAT
 * - start_monitor: Start monitoring an address for incoming transactions
 * - poll_monitor: Poll a monitored address (called by queue worker)
 * - cancel_monitor: Cancel address monitoring
 * - get_monitor_status: Get current monitoring status
 */

import * as bitcoin from 'bitcoinjs-lib';
import * as QRCode from 'qrcode';
import { BIP32Factory } from 'bip32';
import * as ecc from 'tiny-secp256k1';
import { Client as FtpClient } from 'basic-ftp';
import { Readable } from 'stream';
import { logger } from '../persistence/logger.js';
import { getDatabase } from '../persistence/database.js';
import type { Handler, HandlerResult, HandlerConfig } from './handler.interface.js';

// Initialize BIP32 with secp256k1
const bip32 = BIP32Factory(ecc);

// BIP32 interface for xpub derivation (using Uint8Array to match library type)
interface BIP32Node {
  derive(index: number): BIP32Node;
  publicKey: Uint8Array;
}

export interface WalletHandlerConfig {
  xpub: string;
  mempool_api?: string;
  rate_limit_seconds?: number;
  confirmations_notify?: number;
  network?: 'mainnet' | 'testnet';
  // FTP config for QR code uploads
  ftp?: {
    host: string;
    port?: number;
    user: string;
    password: string;
    secure?: boolean;
    remote_path: string;    // e.g., "/public_html/qr/"
    public_url: string;     // e.g., "https://example.com/qr/"
  };
}

export interface WalletActionConfig extends HandlerConfig {
  action: 'get_addresses' | 'generate_bill' | 'check_transaction' | 'convert_currency'
    | 'start_monitor' | 'poll_monitor' | 'cancel_monitor' | 'get_monitor_status';
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
  // For start_monitor/poll_monitor/cancel_monitor/get_monitor_status
  target_pubkey?: string;             // Who to notify
  confirmations_notify?: number;      // Number of confirmations before completing (default: 3)
  poll_interval_waiting_ms?: number;  // Poll interval before mempool detection (default: 15000)
  poll_interval_mempool_ms?: number;  // Poll interval after mempool detection (default: 600000)
  max_waiting_polls?: number;         // Max polls before timeout in waiting state (default: 10)
  dm_format?: 'nip04' | 'nip17';      // DM format for notifications (inherited from trigger)
}

// Monitor state persisted in workflow_state table
export interface MonitorState {
  address: string;
  target_pubkey: string;
  dm_format: 'nip04' | 'nip17';      // Original DM format to use for notifications
  state: 'waiting' | 'mempool' | 'confirming' | 'completed' | 'cancelled' | 'timeout';
  confirmations: number;
  target_confirmations: number;
  txid: string | null;
  amount_sats: number;
  poll_interval_waiting_ms: number;
  poll_interval_mempool_ms: number;
  max_waiting_polls: number;         // Max polls before giving up (before mempool detection)
  waiting_poll_count: number;        // Current poll count in waiting state
  created_at: string;
  last_check_at: string;
  last_notified_confirmations: number;
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


// Global rate limiting for mempool.space API
let lastMempoolApiCall = 0;
const MEMPOOL_API_DELAY_MS = 15000; // 15 seconds between calls

// Per-key rate limiting cache (for transaction checks)
const rateLimitCache: Map<string, number> = new Map();

export class WalletHandler implements Handler {
  readonly name = 'Bitcoin Wallet Handler';
  readonly type = 'wallet';

  private xpub: string;
  private mempoolApi: string;
  private rateLimitSeconds: number;
  private confirmationsNotify: number;
  private network: bitcoin.Network;
  private ftpConfig: WalletHandlerConfig['ftp'];

  constructor(config: WalletHandlerConfig) {
    this.xpub = config.xpub;
    this.mempoolApi = config.mempool_api ?? 'https://mempool.space/api';
    this.rateLimitSeconds = config.rate_limit_seconds ?? 10;
    this.confirmationsNotify = config.confirmations_notify ?? 3;
    this.network = config.network === 'testnet' ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;
    this.ftpConfig = config.ftp;
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
        case 'start_monitor':
          return await this.startMonitor(walletConfig);
        case 'poll_monitor':
          return await this.pollMonitor(walletConfig);
        case 'cancel_monitor':
          return await this.cancelMonitor(walletConfig);
        case 'get_monitor_status':
          return await this.getMonitorStatus(walletConfig);
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
    // Parse as integers (template values come as strings)
    const rawStartIndex = config.start_index;
    const rawCount = config.count;
    const startIndex = parseInt(String(rawStartIndex ?? 0), 10) || 0;
    const count = parseInt(String(rawCount ?? 1), 10) || 1;

    logger.debug({ rawStartIndex, rawCount, startIndex, count }, 'getAddresses params');

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

    logger.debug({ addressCount: addresses.length }, 'getAddresses result');

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
    // Parse as integers/floats (template values come as strings)
    const addressIndex = parseInt(String(config.address_index ?? 0), 10) || 0;
    const amount = parseFloat(String(config.amount ?? 0)) || 0;
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

    // Upload to FTP
    const imageUrl = await this.uploadQrToFtp(qrBuffer);
    if (!imageUrl) {
      return { success: false, error: 'Failed to upload QR code to FTP' };
    }

    // Format response
    const formatted = amountSats > 0
      ? `💰 Payment Request\n\nAddress: ${address}\nAmount: ${amountSats.toLocaleString()} sats (${amountBtc.toFixed(8)} BTC)${conversionInfo}\n\n[Ouvrir le wallet](${bip21Uri})\n\n${imageUrl}`
      : `📍 Bitcoin Address #${addressIndex}\n\nAddress: ${address}\n\n[Ouvrir le wallet](${bip21Uri})\n\n${imageUrl}`;

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
    // Parse as float (template values come as strings)
    const value = parseFloat(String(config.value ?? 0)) || 0;

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
      // Debug: log xpub prefix
      logger.debug({ xpubPrefix: this.xpub?.substring(0, 10), index }, 'Deriving address');

      if (!this.xpub) {
        logger.error('No xpub configured');
        return null;
      }

      // Parse xpub using module-level bip32 instance
      const node = bip32.fromBase58(this.xpub, this.network) as BIP32Node;

      // Derive: m/0/index (external chain)
      const child = node.derive(0).derive(index);

      // Create P2WPKH address (Native SegWit - bc1q...)
      // Convert Uint8Array to Buffer for bitcoinjs-lib compatibility
      const { address } = bitcoin.payments.p2wpkh({
        pubkey: Buffer.from(child.publicKey),
        network: this.network,
      });

      logger.debug({ index, address }, 'Address derived successfully');
      return address ?? null;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      logger.error({ errorMessage, errorStack, index, xpubPrefix: this.xpub?.substring(0, 10) }, 'Failed to derive address');
      return null;
    }
  }

  /**
   * Get address balance from mempool.space
   */
  private async getAddressBalance(address: string): Promise<{ balance_sats: number; tx_count: number }> {
    // Wait for global rate limit (15s between calls)
    const now = Date.now();
    const timeSinceLastCall = now - lastMempoolApiCall;
    if (timeSinceLastCall < MEMPOOL_API_DELAY_MS) {
      const waitTime = MEMPOOL_API_DELAY_MS - timeSinceLastCall;
      logger.debug({ address, waitTime }, 'Waiting for mempool.space rate limit');
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    lastMempoolApiCall = Date.now();

    const url = `${this.mempoolApi}/address/${address}`;
    logger.debug({ url }, 'Fetching address balance from mempool.space');

    try {
      const response = await fetch(url);
      logger.debug({ address, status: response.status }, 'Mempool API response');

      if (!response.ok) {
        const errorBody = await response.text();
        logger.warn({ address, status: response.status, errorBody }, 'Mempool API error');
        return { balance_sats: 0, tx_count: 0 };
      }

      const data = await response.json() as MempoolAddressInfo;
      const funded = data.chain_stats?.funded_txo_sum ?? 0;
      const spent = data.chain_stats?.spent_txo_sum ?? 0;
      const mempoolFunded = data.mempool_stats?.funded_txo_sum ?? 0;
      const mempoolSpent = data.mempool_stats?.spent_txo_sum ?? 0;
      const balance = funded - spent + mempoolFunded - mempoolSpent;
      const txCount = (data.chain_stats?.tx_count ?? 0) + (data.mempool_stats?.tx_count ?? 0);

      logger.debug({ address, balance, txCount }, 'Balance calculated');

      return { balance_sats: balance, tx_count: txCount };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ errorMessage, address, url }, 'Error fetching address balance');
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
   * Upload image to FTP and return public URL
   */
  private async uploadQrToFtp(imageBuffer: Buffer): Promise<string | null> {
    if (!this.ftpConfig) {
      logger.error('No FTP config for wallet handler');
      return null;
    }

    const client = new FtpClient();
    client.ftp.verbose = false;

    try {
      // Connect to FTP
      await client.access({
        host: this.ftpConfig.host,
        port: this.ftpConfig.port ?? 21,
        user: this.ftpConfig.user,
        password: this.ftpConfig.password,
        secure: this.ftpConfig.secure ?? false,
      });

      // Generate unique filename
      const filename = `qr-${Date.now()}.png`;
      const remotePath = `${this.ftpConfig.remote_path}${filename}`;

      // Ensure directory exists
      const remoteDir = this.ftpConfig.remote_path;
      if (remoteDir) {
        await client.ensureDir(remoteDir);
      }

      // Upload
      const stream = Readable.from(imageBuffer);
      await client.uploadFrom(stream, remotePath);

      // Build public URL
      const publicUrl = `${this.ftpConfig.public_url}${filename}`;
      logger.debug({ remotePath, publicUrl }, 'QR code uploaded to FTP');

      return publicUrl;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ errorMessage }, 'Failed to upload QR to FTP');
      return null;
    } finally {
      client.close();
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

  // ==========================================================================
  // MONITORING ACTIONS
  // ==========================================================================

  /**
   * Start monitoring an address for incoming transactions
   */
  private async startMonitor(config: WalletActionConfig): Promise<HandlerResult> {
    const address = config.address;
    const targetPubkey = config.target_pubkey;

    if (!address) {
      return { success: false, error: 'address is required' };
    }
    if (!targetPubkey) {
      return { success: false, error: 'target_pubkey is required' };
    }

    // Parse config with defaults
    const targetConfirmations = parseInt(String(config.confirmations_notify ?? this.confirmationsNotify), 10) || 3;
    const pollIntervalWaiting = parseInt(String(config.poll_interval_waiting_ms ?? 15000), 10) || 15000;
    const pollIntervalMempool = parseInt(String(config.poll_interval_mempool_ms ?? 600000), 10) || 600000;
    const maxWaitingPolls = parseInt(String(config.max_waiting_polls ?? 10), 10) || 10;
    const dmFormat = (config.dm_format === 'nip04' || config.dm_format === 'nip17') ? config.dm_format : 'nip04';

    // Check if already monitoring this address
    const db = getDatabase();
    const existingState = db.getState('wallet-monitor', 'address_monitor', `monitor:${address}`);
    if (existingState && existingState.value_type === 'json' && existingState.value_json) {
      const state = existingState.value_json as unknown as MonitorState;
      // Terminal states allow restart
      const terminalStates = ['completed', 'cancelled', 'timeout'];

      if (!terminalStates.includes(state.state)) {
        // Check if state is orphaned (no recent activity)
        // If last_check_at is older than 2x the poll interval, consider it stale
        const lastCheck = new Date(state.last_check_at).getTime();
        const now = Date.now();
        const maxAge = state.state === 'waiting'
          ? state.poll_interval_waiting_ms * 3  // 3x poll interval for waiting (45s default)
          : state.poll_interval_mempool_ms * 2; // 2x poll interval for mempool/confirming

        if (now - lastCheck > maxAge) {
          // State is stale - clear it and allow restart
          logger.info(
            { address, staleState: state.state, lastCheck: state.last_check_at, maxAgeMs: maxAge },
            '[Wallet] Found stale monitoring state, clearing and restarting'
          );
          // Fall through to create new state
        } else {
          // Still active - return success (idempotent)
          logger.info(
            { address, existingState: state.state, targetPubkey: state.target_pubkey },
            '[Wallet] Address already being monitored, returning existing state'
          );
          return {
            success: true,
            data: {
              address,
              target_pubkey: state.target_pubkey,
              target_confirmations: state.target_confirmations,
              poll_interval_waiting_ms: state.poll_interval_waiting_ms,
              poll_interval_mempool_ms: state.poll_interval_mempool_ms,
              state: state.state,
              already_monitoring: true,
            },
          };
        }
      }
    }

    // Create monitor state
    const monitorState: MonitorState = {
      address,
      target_pubkey: targetPubkey,
      dm_format: dmFormat,
      state: 'waiting',
      confirmations: 0,
      target_confirmations: targetConfirmations,
      txid: null,
      amount_sats: 0,
      poll_interval_waiting_ms: pollIntervalWaiting,
      poll_interval_mempool_ms: pollIntervalMempool,
      max_waiting_polls: maxWaitingPolls,
      waiting_poll_count: 0,
      created_at: new Date().toISOString(),
      last_check_at: new Date().toISOString(),
      last_notified_confirmations: 0,
    };

    // Save state to workflow_state table
    db.setState({
      workflow_id: 'wallet-monitor',
      namespace: 'address_monitor',
      state_key: `monitor:${address}`,
      value_type: 'json',
      value_json: monitorState as unknown as Record<string, unknown>,
    });

    logger.info(
      { address, targetPubkey, targetConfirmations },
      '[Wallet] Address monitoring started'
    );

    return {
      success: true,
      data: {
        address,
        target_pubkey: targetPubkey,
        target_confirmations: targetConfirmations,
        poll_interval_waiting_ms: pollIntervalWaiting,
        poll_interval_mempool_ms: pollIntervalMempool,
        state: 'waiting',
        message: `Monitoring started for ${address}`,
      },
    };
  }

  /**
   * Poll a monitored address for transaction updates
   */
  private async pollMonitor(config: WalletActionConfig): Promise<HandlerResult> {
    const address = config.address;

    if (!address) {
      return { success: false, error: 'address is required' };
    }

    // Get current monitor state
    const db = getDatabase();
    const stateRecord = db.getState('wallet-monitor', 'address_monitor', `monitor:${address}`);

    if (!stateRecord || stateRecord.value_type !== 'json' || !stateRecord.value_json) {
      return { success: false, error: `No active monitor for address ${address}` };
    }

    const monitorState = stateRecord.value_json as unknown as MonitorState;

    // Check if already completed, cancelled, or timed out
    if (monitorState.state === 'completed' || monitorState.state === 'cancelled' || monitorState.state === 'timeout') {
      return {
        success: true,
        data: {
          ...monitorState,
          should_continue: false,
          notification_type: null,
          notification_message: null,
        },
      };
    }

    // Increment waiting poll count if in waiting state
    if (monitorState.state === 'waiting') {
      monitorState.waiting_poll_count = (monitorState.waiting_poll_count || 0) + 1;

      // Check for timeout (max polls reached without detecting a transaction)
      if (monitorState.waiting_poll_count >= monitorState.max_waiting_polls) {
        monitorState.state = 'timeout';
        monitorState.last_check_at = new Date().toISOString();

        const elapsedSeconds = monitorState.waiting_poll_count * (monitorState.poll_interval_waiting_ms / 1000);

        db.setState({
          workflow_id: 'wallet-monitor',
          namespace: 'address_monitor',
          state_key: `monitor:${address}`,
          value_type: 'json',
          value_json: monitorState as unknown as Record<string, unknown>,
        });

        logger.info({ address, pollCount: monitorState.waiting_poll_count }, '[Wallet] Monitor timeout - no transaction detected');

        return {
          success: true,
          data: {
            ...monitorState,
            should_continue: false,
            notification_type: 'timeout',
            notification_message: `Aucune transaction detectee pour cette adresse depuis ${Math.round(elapsedSeconds)} secondes. Monitoring arrete.\n\nAdresse: ${address}`,
          },
        };
      }
    }

    // Poll mempool.space API for address transactions
    const previousState = monitorState.state;
    const previousConfirmations = monitorState.confirmations;
    let notificationType: string | null = null;
    let notificationMessage: string | null = null;

    try {
      // Get transactions for address
      const response = await fetch(`${this.mempoolApi}/address/${address}/txs`);
      if (!response.ok) {
        logger.warn({ address, status: response.status }, '[Wallet] Failed to fetch transactions');
        // Don't fail, just continue polling
        monitorState.last_check_at = new Date().toISOString();
        db.setState({
          workflow_id: 'wallet-monitor',
          namespace: 'address_monitor',
          state_key: `monitor:${address}`,
          value_type: 'json',
          value_json: monitorState as unknown as Record<string, unknown>,
        });
        return {
          success: true,
          data: {
            ...monitorState,
            should_continue: true,
            next_poll_delay_ms: monitorState.poll_interval_waiting_ms,
            notification_type: null,
            notification_message: null,
          },
        };
      }

      const txs = await response.json() as MempoolTx[];

      // Find incoming transaction (most recent unspent to this address)
      // We look for any transaction that has this address in outputs
      let incomingTx: MempoolTx | null = null;

      for (const tx of txs) {
        // If we already have a txid, look for that specific one
        if (monitorState.txid && tx.txid === monitorState.txid) {
          incomingTx = tx;
          break;
        }
        // Otherwise, take the first (most recent) transaction
        if (!monitorState.txid) {
          incomingTx = tx;
          break;
        }
      }

      if (incomingTx) {
        // Transaction found
        const isConfirmed = incomingTx.status?.confirmed ?? false;
        const blockHeight = incomingTx.status?.block_height ?? null;

        // Get current block height for confirmations
        let confirmations = 0;
        if (blockHeight) {
          const tipResponse = await fetch(`${this.mempoolApi}/blocks/tip/height`);
          if (tipResponse.ok) {
            const tipHeight = await tipResponse.json() as number;
            confirmations = tipHeight - blockHeight + 1;
          }
        }

        // Calculate amount (sum of outputs to this address)
        const amountSats = incomingTx.vout?.reduce((sum, out) => sum + out.value, 0) ?? 0;

        // Update state based on confirmation status
        monitorState.txid = incomingTx.txid;
        monitorState.amount_sats = amountSats;
        monitorState.confirmations = confirmations;

        if (!isConfirmed && monitorState.state === 'waiting') {
          // Transaction detected in mempool
          monitorState.state = 'mempool';
          notificationType = 'mempool';
          notificationMessage = `📡 Transaction detected in mempool!\nTxID: ${incomingTx.txid}\nAmount: ${amountSats.toLocaleString()} sats`;
        } else if (isConfirmed) {
          // Transaction confirmed
          if (confirmations >= monitorState.target_confirmations) {
            // Target reached
            monitorState.state = 'completed';
            notificationType = 'completed';
            notificationMessage = `✅ ${confirmations} confirmations - Payment confirmed!\nTxID: ${incomingTx.txid}\nAmount: ${amountSats.toLocaleString()} sats`;
          } else if (confirmations > monitorState.last_notified_confirmations) {
            // New confirmation(s)
            monitorState.state = 'confirming';
            notificationType = 'confirmation';
            notificationMessage = `⛏️ ${confirmations} confirmation${confirmations > 1 ? 's' : ''} (block #${blockHeight})\nTxID: ${incomingTx.txid}`;
            monitorState.last_notified_confirmations = confirmations;
          }
        }
      }

      // Update last check time
      monitorState.last_check_at = new Date().toISOString();

      // Save updated state
      db.setState({
        workflow_id: 'wallet-monitor',
        namespace: 'address_monitor',
        state_key: `monitor:${address}`,
        value_type: 'json',
        value_json: monitorState as unknown as Record<string, unknown>,
      });

      // Determine if we should continue polling
      // Note: 'cancelled' and 'timeout' checks are for type safety, already checked at function entry
      const currentState = monitorState.state as MonitorState['state'];
      const shouldContinue = currentState !== 'completed' && currentState !== 'cancelled' && currentState !== 'timeout';

      // Determine next poll delay
      const nextPollDelay = monitorState.state === 'waiting'
        ? monitorState.poll_interval_waiting_ms
        : monitorState.poll_interval_mempool_ms;

      logger.debug(
        {
          address,
          previousState,
          newState: monitorState.state,
          confirmations: monitorState.confirmations,
          shouldContinue,
          notificationType,
        },
        '[Wallet] Poll monitor result'
      );

      return {
        success: true,
        data: {
          ...monitorState,
          previous_state: previousState,
          previous_confirmations: previousConfirmations,
          should_continue: shouldContinue,
          next_poll_delay_ms: nextPollDelay,
          notification_type: notificationType,
          notification_message: notificationMessage,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ address, error: errorMessage }, '[Wallet] Poll monitor failed');

      // Update last check time even on error
      monitorState.last_check_at = new Date().toISOString();
      db.setState({
        workflow_id: 'wallet-monitor',
        namespace: 'address_monitor',
        state_key: `monitor:${address}`,
        value_type: 'json',
        value_json: monitorState as unknown as Record<string, unknown>,
      });

      // Continue polling despite error
      return {
        success: true,
        data: {
          ...monitorState,
          should_continue: true,
          next_poll_delay_ms: monitorState.poll_interval_waiting_ms,
          notification_type: null,
          notification_message: null,
          error: errorMessage,
        },
      };
    }
  }

  /**
   * Cancel monitoring an address
   */
  private async cancelMonitor(config: WalletActionConfig): Promise<HandlerResult> {
    const address = config.address;

    if (!address) {
      return { success: false, error: 'address is required' };
    }

    const db = getDatabase();
    const stateRecord = db.getState('wallet-monitor', 'address_monitor', `monitor:${address}`);

    if (!stateRecord || stateRecord.value_type !== 'json' || !stateRecord.value_json) {
      return {
        success: true,
        data: {
          address,
          cancelled: false,
          message: `No active monitor found for ${address}`,
        },
      };
    }

    const monitorState = stateRecord.value_json as unknown as MonitorState;

    if (monitorState.state === 'completed' || monitorState.state === 'cancelled') {
      return {
        success: true,
        data: {
          address,
          cancelled: false,
          message: `Monitor already ${monitorState.state} for ${address}`,
        },
      };
    }

    // Update state to cancelled
    monitorState.state = 'cancelled';
    monitorState.last_check_at = new Date().toISOString();

    db.setState({
      workflow_id: 'wallet-monitor',
      namespace: 'address_monitor',
      state_key: `monitor:${address}`,
      value_type: 'json',
      value_json: monitorState as unknown as Record<string, unknown>,
    });

    logger.info({ address }, '[Wallet] Address monitoring cancelled');

    return {
      success: true,
      data: {
        address,
        cancelled: true,
        message: `Monitoring cancelled for ${address}`,
      },
    };
  }

  /**
   * Get current monitoring status for an address
   */
  private async getMonitorStatus(config: WalletActionConfig): Promise<HandlerResult> {
    const address = config.address;

    if (!address) {
      return { success: false, error: 'address is required' };
    }

    const db = getDatabase();
    const stateRecord = db.getState('wallet-monitor', 'address_monitor', `monitor:${address}`);

    if (!stateRecord || stateRecord.value_type !== 'json' || !stateRecord.value_json) {
      return {
        success: true,
        data: {
          address,
          found: false,
          message: `No monitor found for ${address}`,
        },
      };
    }

    const monitorState = stateRecord.value_json as unknown as MonitorState;

    return {
      success: true,
      data: {
        ...monitorState,
        found: true,
      },
    };
  }

  async shutdown(): Promise<void> {
    logger.info('Wallet handler shut down');
  }
}
