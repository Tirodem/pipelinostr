import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import { logger } from '../persistence/logger.js';
import type { Handler, HandlerResult, HandlerConfig } from './handler.interface.js';

export interface SignalHandlerOptions {
  // Path to signal-cli binary (default: 'signal-cli' in PATH)
  signalCliBin?: string | undefined;
  // Phone number registered with Signal (with country code, e.g., +33612345678)
  phoneNumber: string;
  // Config directory for signal-cli
  configDir?: string | undefined;
}

export interface SignalActionConfig extends HandlerConfig {
  to: string | string[]; // Phone number(s) with country code
  message: string;
  // Optional: attachment file paths
  attachments?: string[] | undefined;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export class SignalHandler extends EventEmitter implements Handler {
  readonly name = 'Signal Handler';
  readonly type = 'signal';

  private options: SignalHandlerOptions;
  private daemonProcess: ChildProcess | null = null;
  private readline: ReadlineInterface | null = null;
  private isReady = false;
  private requestId = 0;
  private pendingRequests: Map<number, {
    resolve: (result: unknown) => void;
    reject: (error: Error) => void;
  }> = new Map();

  constructor(options: SignalHandlerOptions) {
    super();
    this.options = options;
  }

  async initialize(): Promise<void> {
    const signalCliBin = this.options.signalCliBin ?? 'signal-cli';

    // Build command arguments
    const args: string[] = [
      '-u', this.options.phoneNumber,
      'jsonRpc',
    ];

    if (this.options.configDir) {
      args.unshift('--config', this.options.configDir);
    }

    logger.info(
      { bin: signalCliBin, phone: this.options.phoneNumber },
      'Starting Signal daemon...'
    );

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Signal daemon startup timed out (30 seconds)'));
      }, 30000);

      try {
        this.daemonProcess = spawn(signalCliBin, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        // Handle stdout (JSON-RPC responses)
        this.readline = createInterface({
          input: this.daemonProcess.stdout!,
          crlfDelay: Infinity,
        });

        this.readline.on('line', (line) => {
          this.handleResponse(line);
        });

        // Handle stderr (logs)
        this.daemonProcess.stderr!.on('data', (data: Buffer) => {
          const message = data.toString().trim();
          if (message) {
            // Check for ready signal
            if (message.includes('Listening') || message.includes('Started')) {
              clearTimeout(timeout);
              this.isReady = true;
              logger.info('Signal daemon ready');
              resolve();
            } else if (message.toLowerCase().includes('error')) {
              logger.error({ message }, 'Signal daemon error');
            } else {
              logger.debug({ message }, 'Signal daemon log');
            }
          }
        });

        this.daemonProcess.on('error', (error) => {
          clearTimeout(timeout);
          logger.error({ error: error.message }, 'Failed to start Signal daemon');
          reject(new Error(`Failed to start signal-cli: ${error.message}`));
        });

        this.daemonProcess.on('exit', (code, signal) => {
          this.isReady = false;
          if (code !== 0 && code !== null) {
            logger.error({ code, signal }, 'Signal daemon exited unexpectedly');
          } else {
            logger.info({ code, signal }, 'Signal daemon stopped');
          }
        });

        // If daemon doesn't output anything but process is running, assume ready after delay
        setTimeout(() => {
          if (!this.isReady && this.daemonProcess && !this.daemonProcess.killed) {
            clearTimeout(timeout);
            this.isReady = true;
            logger.info('Signal daemon assumed ready (no explicit ready signal)');
            resolve();
          }
        }, 5000);

      } catch (error) {
        clearTimeout(timeout);
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error({ error: errorMessage }, 'Failed to start Signal daemon');
        reject(new Error(`Failed to start Signal daemon: ${errorMessage}`));
      }
    });
  }

  private handleResponse(line: string): void {
    try {
      const response = JSON.parse(line) as JsonRpcResponse;

      if (response.id !== undefined) {
        const pending = this.pendingRequests.get(response.id);
        if (pending) {
          this.pendingRequests.delete(response.id);
          if (response.error) {
            pending.reject(new Error(response.error.message));
          } else {
            pending.resolve(response.result);
          }
        }
      }
    } catch {
      // Not a JSON-RPC response, might be a log line
      logger.debug({ line }, 'Signal daemon output');
    }
  }

  private async sendRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.daemonProcess || !this.isReady) {
      throw new Error('Signal daemon not ready');
    }

    const id = ++this.requestId;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error('Signal request timed out'));
      }, 30000);

      this.pendingRequests.set(id, {
        resolve: (result) => {
          clearTimeout(timeout);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });

      const requestLine = JSON.stringify(request) + '\n';
      this.daemonProcess!.stdin!.write(requestLine);
    });
  }

  async execute(config: HandlerConfig, _context: Record<string, unknown>): Promise<HandlerResult> {
    const signalConfig = config as SignalActionConfig;

    if (!this.isReady) {
      return { success: false, error: 'Signal daemon not ready' };
    }

    if (!signalConfig.to) {
      return { success: false, error: 'Missing required field: to (phone number)' };
    }

    if (!signalConfig.message) {
      return { success: false, error: 'Missing required field: message' };
    }

    try {
      const recipients = Array.isArray(signalConfig.to)
        ? signalConfig.to
        : [signalConfig.to];

      const params: Record<string, unknown> = {
        recipient: recipients,
        message: signalConfig.message,
      };

      if (signalConfig.attachments && signalConfig.attachments.length > 0) {
        params.attachment = signalConfig.attachments;
      }

      const result = await this.sendRequest('send', params);

      logger.info(
        { to: recipients, result },
        'Signal message sent successfully'
      );

      return {
        success: true,
        data: {
          recipients,
          result,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ to: signalConfig.to, error: errorMessage }, 'Failed to send Signal message');
      return { success: false, error: errorMessage };
    }
  }

  async shutdown(): Promise<void> {
    if (this.daemonProcess) {
      logger.info('Shutting down Signal daemon...');

      // Close readline
      if (this.readline) {
        this.readline.close();
        this.readline = null;
      }

      // Reject all pending requests
      for (const [id, pending] of this.pendingRequests) {
        pending.reject(new Error('Signal daemon shutting down'));
        this.pendingRequests.delete(id);
      }

      // Kill process gracefully
      this.daemonProcess.kill('SIGTERM');

      // Wait for exit or force kill after 5 seconds
      await new Promise<void>((resolve) => {
        const forceKillTimeout = setTimeout(() => {
          if (this.daemonProcess && !this.daemonProcess.killed) {
            this.daemonProcess.kill('SIGKILL');
          }
          resolve();
        }, 5000);

        if (this.daemonProcess) {
          this.daemonProcess.once('exit', () => {
            clearTimeout(forceKillTimeout);
            resolve();
          });
        } else {
          clearTimeout(forceKillTimeout);
          resolve();
        }
      });

      this.daemonProcess = null;
      this.isReady = false;
    }

    logger.info('Signal handler shut down');
  }

  // Check if daemon is ready
  isDaemonReady(): boolean {
    return this.isReady;
  }
}
