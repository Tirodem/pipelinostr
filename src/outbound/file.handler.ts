/**
 * File Handler - Génération de fichiers (text, JSON, CSV, etc.)
 * Stockage local ou préparation pour envoi FTP/SFTP
 */

import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import type { Handler, HandlerResult, HandlerConfig } from './handler.interface.js';

interface FileHandlerConfig {
  enabled: boolean;
  output_dir: string;
  max_file_size_mb: number;
  allowed_formats: string[];
}

export interface FileActionConfig extends HandlerConfig {
  filename: string;
  format?: 'text' | 'json' | 'csv' | 'binary';
  content?: string;
  template?: string;
  append?: boolean;
  encoding?: BufferEncoding;
  csv_headers?: string[];
}

export class FileHandler implements Handler {
  readonly name = 'File Handler';
  readonly type = 'file';

  private config: FileHandlerConfig;
  private outputDir: string;

  constructor(config: FileHandlerConfig) {
    this.config = config;
    this.outputDir = config.output_dir || './data/files';
  }

  async initialize(): Promise<void> {
    // Créer le répertoire de sortie s'il n'existe pas
    await fs.mkdir(this.outputDir, { recursive: true });
    console.log(`[File] Handler initialisé - Output: ${this.outputDir}`);
  }

  async execute(config: HandlerConfig, context: Record<string, unknown>): Promise<HandlerResult> {
    const params = config as FileActionConfig;
    const event = context.event as { id: string; pubkey: string; kind: number; created_at: number; content: string; tags: string[][] } | undefined;
    const transformedContent = (context.transformedContent as string) || event?.content || '';

    try {
      // Résoudre le nom de fichier (peut contenir des variables)
      const defaultEvent = { id: 'unknown', pubkey: 'unknown', kind: 0, created_at: Math.floor(Date.now() / 1000) };
      const filename = this.resolveFilename(params.filename, event || defaultEvent);
      const filepath = join(this.outputDir, filename);

      // S'assurer que le répertoire parent existe
      await fs.mkdir(dirname(filepath), { recursive: true });

      let content: string | Buffer;
      const format = params.format || 'text';

      const eventForGeneration = event || { ...defaultEvent, content: '', tags: [] as string[][] };
      switch (format) {
        case 'json':
          content = this.generateJson(eventForGeneration, transformedContent);
          break;
        case 'csv':
          content = this.generateCsv(eventForGeneration, transformedContent, params);
          break;
        case 'binary':
          content = Buffer.from(transformedContent, params.encoding || 'utf-8');
          break;
        case 'text':
        default:
          content = params.template
            ? this.applyTemplate(params.template, eventForGeneration, transformedContent)
            : (params.content || transformedContent);
          break;
      }

      // Vérifier la taille
      const contentBuffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
      const maxSize = this.config.max_file_size_mb * 1024 * 1024;
      if (contentBuffer.length > maxSize) {
        return {
          success: false,
          error: `Fichier trop volumineux: ${contentBuffer.length} bytes (max: ${maxSize})`,
        };
      }

      // Écrire le fichier
      if (params.append) {
        await fs.appendFile(filepath, content);
      } else {
        await fs.writeFile(filepath, content);
      }

      const stats = await fs.stat(filepath);

      console.log(`[File] Fichier généré: ${filepath} (${stats.size} bytes)`);

      return {
        success: true,
        data: {
          filepath,
          size: stats.size,
          format,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  private resolveFilename(
    template: string,
    event: { id: string; pubkey: string; kind: number; created_at: number }
  ): string {
    const now = new Date();
    const isoString = now.toISOString();
    const datePart = isoString.split('T')[0] || '';
    const timePart = isoString.split('T')[1] || '';
    const timeFormatted = timePart.replace(/:/g, '-').split('.')[0] || '';
    return template
      .replace(/{event_id}/g, event.id.substring(0, 8))
      .replace(/{pubkey}/g, event.pubkey.substring(0, 8))
      .replace(/{timestamp}/g, event.created_at.toString())
      .replace(/{date}/g, datePart)
      .replace(/{time}/g, timeFormatted)
      .replace(/{datetime}/g, isoString.replace(/:/g, '-').replace(/\./g, '-'))
      .replace(/{kind}/g, event.kind.toString());
  }

  private generateJson(
    event: { id: string; pubkey: string; kind: number; created_at: number; content: string; tags: string[][] },
    content: string
  ): string {
    const data = {
      generated_at: new Date().toISOString(),
      event: {
        id: event.id,
        pubkey: event.pubkey,
        kind: event.kind,
        created_at: event.created_at,
        content: event.content,
        tags: event.tags,
      },
      transformed_content: content,
    };
    return JSON.stringify(data, null, 2);
  }

  private generateCsv(
    event: { id: string; pubkey: string; kind: number; created_at: number; content: string; tags: string[][] },
    content: string,
    params: FileActionConfig
  ): string {
    const headers = params.csv_headers || ['timestamp', 'event_id', 'pubkey', 'kind', 'content'];
    const lines: string[] = [];

    // Headers
    lines.push(headers.map(h => this.escapeCsvField(h)).join(','));

    // Data row
    const row = headers.map(header => {
      switch (header) {
        case 'timestamp':
          return new Date(event.created_at * 1000).toISOString();
        case 'event_id':
          return event.id;
        case 'pubkey':
          return event.pubkey;
        case 'kind':
          return event.kind.toString();
        case 'content':
          return content;
        case 'raw_content':
          return event.content;
        default:
          // Chercher dans les tags
          const tag = event.tags.find((t: string[]) => t[0] === header);
          return tag ? tag[1] : '';
      }
    });
    lines.push(row.map(v => this.escapeCsvField(String(v))).join(','));

    return lines.join('\n');
  }

  private escapeCsvField(field: string): string {
    if (field.includes(',') || field.includes('"') || field.includes('\n')) {
      return `"${field.replace(/"/g, '""')}"`;
    }
    return field;
  }

  private applyTemplate(
    template: string,
    event: { id: string; pubkey: string; kind: number; created_at: number; content: string },
    content: string
  ): string {
    return template
      .replace(/{content}/g, content)
      .replace(/{raw_content}/g, event.content)
      .replace(/{event_id}/g, event.id)
      .replace(/{pubkey}/g, event.pubkey)
      .replace(/{kind}/g, event.kind.toString())
      .replace(/{timestamp}/g, new Date(event.created_at * 1000).toISOString())
      .replace(/{created_at}/g, event.created_at.toString());
  }

  async shutdown(): Promise<void> {
    console.log('[File] Handler arrêté');
  }

  // Méthode utilitaire pour récupérer un fichier généré (utilisé par FTP/SFTP)
  async getFilePath(filename: string): Promise<string> {
    return join(this.outputDir, filename);
  }

  async readGeneratedFile(filename: string): Promise<Buffer> {
    const filepath = join(this.outputDir, filename);
    return fs.readFile(filepath);
  }
}
