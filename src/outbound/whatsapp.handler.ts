// =============================================================================
// DEPRECATED: WhatsApp handler is temporarily disabled due to security
// vulnerabilities in whatsapp-web.js dependencies (puppeteer).
// See: https://github.com/nickvidal/whatsapp-web.js/issues
// Will be re-enabled when upstream fixes are available.
// =============================================================================

import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../persistence/logger.js';
import type { Handler, HandlerResult, HandlerConfig } from './handler.interface.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..');

export interface WhatsAppHandlerOptions {
  sessionDir?: string | undefined;
  puppeteerArgs?: string[] | undefined;
  headless?: boolean | undefined;
}

export interface WhatsAppActionConfig extends HandlerConfig {
  to: string; // Phone number with country code (e.g., "33612345678")
  message: string;
}

type WhatsAppClient = {
  initialize: () => Promise<void>;
  sendMessage: (chatId: string, content: string) => Promise<{ id: { id: string } }>;
  destroy: () => Promise<void>;
  on: (event: string, callback: (...args: unknown[]) => void) => void;
  info?: { pushname?: string; wid?: { user?: string } };
};

export class WhatsAppHandler extends EventEmitter implements Handler {
  readonly name = 'WhatsApp Handler';
  readonly type = 'whatsapp';

  private client: WhatsAppClient | null = null;
  private options: WhatsAppHandlerOptions;
  private sessionDir: string;
  private isReady = false;
  private initPromise: Promise<void> | null = null;

  constructor(options: WhatsAppHandlerOptions = {}) {
    super();
    this.options = options;
    this.sessionDir = options.sessionDir ?? join(PROJECT_ROOT, 'data', 'whatsapp-session');
  }

  async initialize(): Promise<void> {
    // Ensure session directory exists
    if (!existsSync(this.sessionDir)) {
      mkdirSync(this.sessionDir, { recursive: true });
    }

    // Dynamically import whatsapp-web.js to avoid loading if not needed
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let whatsappModule: any;
    try {
      // Use dynamic import with variable to avoid TypeScript checking the module
      const moduleName = 'whatsapp-web.js';
      whatsappModule = await import(/* webpackIgnore: true */ moduleName);
    } catch {
      throw new Error(
        'WhatsApp handler is DEPRECATED due to security vulnerabilities. ' +
        'If you still want to use it, install manually: npm install whatsapp-web.js'
      );
    }
    const { Client, LocalAuth } = whatsappModule;

    const puppeteerArgs = this.options.puppeteerArgs ?? [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
    ];

    this.client = new Client({
      authStrategy: new LocalAuth({
        dataPath: this.sessionDir,
      }),
      puppeteer: {
        headless: this.options.headless ?? true,
        args: puppeteerArgs,
      },
    }) as WhatsAppClient;

    // Set up event handlers
    this.initPromise = new Promise<void>((resolveInit, rejectInit) => {
      const timeout = setTimeout(() => {
        rejectInit(new Error('WhatsApp initialization timed out (5 minutes)'));
      }, 5 * 60 * 1000);

      this.client!.on('qr', (...args: unknown[]) => {
        const qr = args[0] as string;
        logger.info('WhatsApp QR Code received. Scan it with your phone:');
        // Log QR code as ASCII for terminal display
        this.emitQrCode(qr);
        this.emit('qr', qr);
      });

      this.client!.on('authenticated', () => {
        logger.info('WhatsApp authenticated successfully');
      });

      this.client!.on('auth_failure', (...args: unknown[]) => {
        const msg = args[0] as string;
        clearTimeout(timeout);
        logger.error({ error: msg }, 'WhatsApp authentication failed');
        rejectInit(new Error(`WhatsApp auth failed: ${msg}`));
      });

      this.client!.on('ready', () => {
        clearTimeout(timeout);
        this.isReady = true;
        const info = this.client!.info;
        logger.info(
          { name: info?.pushname, number: info?.wid?.user },
          'WhatsApp daemon ready'
        );
        resolveInit();
      });

      this.client!.on('disconnected', (...args: unknown[]) => {
        const reason = args[0] as string;
        logger.warn({ reason }, 'WhatsApp disconnected');
        this.isReady = false;
      });
    });

    // Start client
    logger.info('Starting WhatsApp daemon...');
    await this.client.initialize();
    await this.initPromise;
  }

  private async emitQrCode(qr: string): Promise<void> {
    try {
      // Dynamically import qrcode-terminal for QR display
      const qrcode = await import('qrcode-terminal');
      qrcode.generate(qr, { small: true });
    } catch {
      // If qrcode-terminal not available, just log the raw QR
      logger.info({ qr }, 'WhatsApp QR Code (install qrcode-terminal for visual display)');
    }
  }

  async execute(config: HandlerConfig, _context: Record<string, unknown>): Promise<HandlerResult> {
    const waConfig = config as WhatsAppActionConfig;

    if (!this.client || !this.isReady) {
      return { success: false, error: 'WhatsApp daemon not ready' };
    }

    if (!waConfig.to) {
      return { success: false, error: 'Missing required field: to (phone number)' };
    }

    if (!waConfig.message) {
      return { success: false, error: 'Missing required field: message' };
    }

    try {
      // Format phone number to WhatsApp chat ID format
      const phoneNumber = waConfig.to.replace(/[^0-9]/g, '');
      const chatId = `${phoneNumber}@c.us`;

      const result = await this.client.sendMessage(chatId, waConfig.message);

      logger.info(
        { to: phoneNumber, messageId: result.id.id },
        'WhatsApp message sent successfully'
      );

      return {
        success: true,
        data: {
          message_id: result.id.id,
          to: phoneNumber,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ to: waConfig.to, error: errorMessage }, 'Failed to send WhatsApp message');
      return { success: false, error: errorMessage };
    }
  }

  async shutdown(): Promise<void> {
    if (this.client) {
      logger.info('Shutting down WhatsApp daemon...');
      try {
        await this.client.destroy();
      } catch (error) {
        logger.error({ error }, 'Error shutting down WhatsApp client');
      }
      this.client = null;
      this.isReady = false;
    }
    logger.info('WhatsApp handler shut down');
  }

  // Check if daemon is ready
  isDaemonReady(): boolean {
    return this.isReady;
  }
}
