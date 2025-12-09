/**
 * Serial Handler - Communication série RS232/USB
 * Compatible avec Arduino, équipements industriels, etc.
 */

import type { Handler, HandlerResult, HandlerConfig } from './handler.interface.js';

// Types pour serialport (optionnel)
interface SerialPortInstance {
  isOpen: boolean;
  on(event: 'data', callback: (data: Buffer) => void): void;
  on(event: 'error', callback: (err: Error) => void): void;
  on(event: string, callback: (...args: unknown[]) => void): void;
  open(callback: (err: Error | null) => void): void;
  write(data: Buffer, callback: (err: Error | null) => void): void;
  drain(callback: (err: Error | null) => void): void;
  close(callback: () => void): void;
}

interface SerialPortConstructor {
  new (options: {
    path: string;
    baudRate: number;
    dataBits: number;
    stopBits: number;
    parity: string;
    rtscts: boolean;
    xon: boolean;
    xoff: boolean;
    autoOpen: boolean;
  }): SerialPortInstance;
}

let SerialPort: SerialPortConstructor | undefined;

interface SerialHandlerConfig {
  enabled: boolean;
  port: string; // ex: /dev/ttyUSB0, COM3
  baudrate?: number | undefined;
  databits?: 5 | 6 | 7 | 8 | undefined;
  stopbits?: 1 | 1.5 | 2 | undefined;
  parity?: 'none' | 'even' | 'odd' | 'mark' | 'space' | undefined;
  rtscts?: boolean | undefined;
  xon?: boolean | undefined;
  xoff?: boolean | undefined;
}

export interface SerialActionConfig extends HandlerConfig {
  // Surcharge du port (optionnel)
  port?: string | undefined;
  // Données à envoyer
  data?: string | undefined;
  // Format des données
  format?: 'text' | 'hex' | 'json' | undefined;
  // Encodage
  encoding?: BufferEncoding | undefined;
  // Terminateur de ligne
  line_ending?: 'none' | 'lf' | 'crlf' | 'cr' | undefined;
  // Attendre une réponse
  wait_response?: boolean | undefined;
  response_timeout?: number | undefined;
  response_delimiter?: string | undefined;
}

export class SerialHandler implements Handler {
  readonly name = 'Serial Handler';
  readonly type = 'serial';

  private config: SerialHandlerConfig;
  private port: SerialPortInstance | null = null;
  private responseBuffer = '';

  constructor(config: SerialHandlerConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    try {
      // @ts-expect-error - Optional dependency, may not be installed
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const serialportModule = await import('serialport') as any;
      SerialPort = serialportModule.SerialPort;
    } catch {
      throw new Error(
        'serialport module not found. Install it with: npm install serialport'
      );
    }

    // Ouvrir le port série
    await this.openPort(this.config.port);
    console.log(`[Serial] Port ${this.config.port} ouvert @ ${this.config.baudrate || 9600} bauds`);
  }

  private async openPort(portPath: string): Promise<void> {
    if (!SerialPort) {
      throw new Error('SerialPort not initialized');
    }

    return new Promise((resolve, reject) => {
      this.port = new SerialPort!({
        path: portPath,
        baudRate: this.config.baudrate || 9600,
        dataBits: this.config.databits || 8,
        stopBits: this.config.stopbits || 1,
        parity: this.config.parity || 'none',
        rtscts: this.config.rtscts || false,
        xon: this.config.xon || false,
        xoff: this.config.xoff || false,
        autoOpen: false,
      });

      this.port.on('data', (data: Buffer) => {
        this.responseBuffer += data.toString();
      });

      this.port.on('error', (err: Error) => {
        console.error(`[Serial] Erreur: ${err.message}`);
      });

      this.port.open((err) => {
        if (err) {
          reject(new Error(`Failed to open port ${portPath}: ${err.message}`));
        } else {
          resolve();
        }
      });
    });
  }

  async execute(config: HandlerConfig, context: Record<string, unknown>): Promise<HandlerResult> {
    if (!this.port || !this.port.isOpen) {
      return { success: false, error: 'Port série non ouvert' };
    }

    const params = config as SerialActionConfig;
    const event = context.event as {
      id: string;
      pubkey: string;
      kind: number;
      created_at: number;
      content: string;
    };
    const transformedContent = (context.transformedContent as string) || event.content;

    try {
      // Préparer les données à envoyer
      let dataToSend = params.data || transformedContent;

      // Format JSON
      if (params.format === 'json') {
        dataToSend = JSON.stringify({
          event_id: event.id,
          pubkey: event.pubkey,
          kind: event.kind,
          content: transformedContent,
          timestamp: event.created_at,
        });
      }

      // Ajouter le terminateur de ligne
      const lineEnding = this.getLineEnding(params.line_ending);
      dataToSend += lineEnding;

      // Convertir en buffer
      let buffer: Buffer;
      if (params.format === 'hex') {
        // Données hexadécimales (ex: "48454C4C4F")
        buffer = Buffer.from(dataToSend.replace(/\s/g, ''), 'hex');
      } else {
        buffer = Buffer.from(dataToSend, params.encoding || 'utf8');
      }

      // Envoyer les données
      await this.write(buffer);

      // Attendre une réponse si demandé
      let response: string | undefined;
      if (params.wait_response) {
        response = await this.waitForResponse(
          params.response_timeout || 5000,
          params.response_delimiter || '\n'
        );
      }

      console.log(`[Serial] Envoyé ${buffer.length} octets sur ${this.config.port}`);

      return {
        success: true,
        data: {
          port: this.config.port,
          bytes_sent: buffer.length,
          response,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }

  private write(data: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      this.port!.write(data, (err) => {
        if (err) {
          reject(err);
        } else {
          this.port!.drain((drainErr) => {
            if (drainErr) {
              reject(drainErr);
            } else {
              resolve();
            }
          });
        }
      });
    });
  }

  private waitForResponse(timeout: number, delimiter: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.responseBuffer = '';
      const startTime = Date.now();

      const checkBuffer = () => {
        const delimiterIndex = this.responseBuffer.indexOf(delimiter);
        if (delimiterIndex !== -1) {
          const response = this.responseBuffer.substring(0, delimiterIndex);
          this.responseBuffer = this.responseBuffer.substring(delimiterIndex + delimiter.length);
          resolve(response);
          return;
        }

        if (Date.now() - startTime > timeout) {
          // Retourner ce qu'on a reçu même sans délimiteur
          const response = this.responseBuffer;
          this.responseBuffer = '';
          resolve(response);
          return;
        }

        setTimeout(checkBuffer, 10);
      };

      checkBuffer();
    });
  }

  private getLineEnding(type?: string): string {
    switch (type) {
      case 'lf':
        return '\n';
      case 'crlf':
        return '\r\n';
      case 'cr':
        return '\r';
      case 'none':
      default:
        return '';
    }
  }

  async shutdown(): Promise<void> {
    if (this.port && this.port.isOpen) {
      await new Promise<void>((resolve) => {
        this.port!.close(() => resolve());
      });
    }
    console.log('[Serial] Handler arrêté');
  }
}
