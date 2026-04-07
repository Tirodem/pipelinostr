/**
 * TTS handler (v2)
 *
 * Text-to-speech via Piper or espeak-ng.
 * Ported from v1. Generated files auto-cleaned after 10 minutes.
 */

import { z } from 'zod';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BaseHandler, type HandlerResult, type ActionContext } from './base.js';
import type { SystemDependency } from '../utils/system-deps.js';

const ALLOWED_FORMATS = ['wav', 'ogg', 'mp3'] as const;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 min
const FILE_MAX_AGE_MS = 10 * 60 * 1000; // 10 min

export class TtsHandler extends BaseHandler {
  static type = 'tts';
  static configSchema = z.object({
    engine: z.enum(['piper', 'espeak']).optional(),
    piper_path: z.string().optional(),
    piper_model: z.string().optional(),
    espeak_voice: z.string().optional(),
    output_dir: z.string().optional(),
    enabled: z.boolean().optional(),
  });

  static systemDeps: SystemDependency[] = [
    { binary: 'espeak-ng', packages: { apt: 'espeak-ng', apk: 'espeak-ng', pacman: 'espeak-ng', brew: 'espeak' } },
  ];

  readonly name = 'TTS';
  readonly type = 'tts';

  private engine: 'piper' | 'espeak' = 'espeak';
  private piperPath = 'piper';
  private piperModel = 'fr_FR-siwis-medium';
  private espeakVoice = 'fr-fr';
  private outputDir = './data/tts';
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  async initialize(config: Record<string, unknown>): Promise<void> {
    // Validate config
    const parsed = TtsHandler.configSchema.parse(config);
    this.engine = parsed.engine ?? 'espeak';
    this.piperPath = parsed.piper_path ?? 'piper';
    this.piperModel = parsed.piper_model ?? 'fr_FR-siwis-medium';
    this.espeakVoice = parsed.espeak_voice ?? 'fr-fr';
    this.outputDir = parsed.output_dir ?? './data/tts';

    await fs.mkdir(this.outputDir, { recursive: true });

    // Start cleanup timer
    this.cleanupTimer = setInterval(() => { this.cleanupOldFiles(); }, CLEANUP_INTERVAL_MS);
  }

  async execute(action: Record<string, unknown>, _context: ActionContext): Promise<HandlerResult> {
    const text = (action.text as string)?.trim();
    if (!text) return { success: false, error: 'Missing "text" field' };

    // Validate format
    const rawFormat = (action.format as string) ?? 'wav';
    if (!ALLOWED_FORMATS.includes(rawFormat as typeof ALLOWED_FORMATS[number])) {
      return { success: false, error: `Invalid format "${rawFormat}". Allowed: ${ALLOWED_FORMATS.join(', ')}` };
    }
    const format = rawFormat as typeof ALLOWED_FORMATS[number];

    const outputId = randomUUID();
    const outputFile = join(this.outputDir, `${outputId}.${format}`);

    try {
      if (this.engine === 'piper') {
        await this.generateWithPiper(text, outputFile, action.voice as string | undefined, format);
      } else {
        await this.generateWithEspeak(text, outputFile, action.voice as string | undefined, action.speed as number | undefined);
      }

      const stats = await fs.stat(outputFile);

      return {
        success: true,
        data: {
          file_path: outputFile,
          format,
          size: stats.size,
          engine: this.engine,
        },
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async shutdown(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  private async cleanupOldFiles(): Promise<void> {
    try {
      const files = await fs.readdir(this.outputDir);
      const now = Date.now();

      for (const file of files) {
        const filePath = join(this.outputDir, file);
        try {
          const stats = await fs.stat(filePath);
          if (now - stats.mtimeMs > FILE_MAX_AGE_MS) {
            await fs.unlink(filePath);
          }
        } catch { /* skip */ }
      }
    } catch { /* dir doesn't exist, ignore */ }
  }

  private generateWithPiper(text: string, outputFile: string, voice?: string, format?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const model = voice ?? this.piperModel;
      const wavFile = format === 'wav' ? outputFile : outputFile.replace(/\.[^.]+$/, '.wav');

      const proc = spawn(this.piperPath, ['--model', model, '--output_file', wavFile], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stderr = '';
      proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });
      proc.stdin?.write(text);
      proc.stdin?.end();

      proc.on('error', (error) => reject(new Error(`Piper failed to start: ${error.message}`)));

      proc.on('close', async (code) => {
        if (code !== 0) { reject(new Error(`Piper exited with code ${code}: ${stderr}`)); return; }

        if (format === 'ogg' && wavFile !== outputFile) {
          try {
            await this.convertToOgg(wavFile, outputFile);
            await fs.unlink(wavFile);
          } catch {
            await fs.rename(wavFile, outputFile.replace('.ogg', '.wav'));
          }
        }
        resolve();
      });
    });
  }

  private convertToOgg(inputFile: string, outputFile: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', ['-i', inputFile, '-c:a', 'libopus', '-b:a', '64k', '-y', outputFile], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderr = '';
      proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });
      proc.on('error', () => reject(new Error('ffmpeg not found')));
      proc.on('close', (code) => { if (code === 0) resolve(); else reject(new Error(`ffmpeg exited ${code}: ${stderr}`)); });
    });
  }

  private generateWithEspeak(text: string, outputFile: string, voice?: string, speed?: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = ['-v', voice ?? this.espeakVoice, '-w', outputFile];
      if (speed) args.push('-s', speed.toString());
      args.push(text);

      const proc = spawn('espeak-ng', args, { stdio: ['ignore', 'pipe', 'pipe'] });

      let stderr = '';
      proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });
      proc.on('error', (error) => reject(new Error(`espeak-ng failed: ${error.message}`)));
      proc.on('close', (code) => { if (code === 0) resolve(); else reject(new Error(`espeak-ng exited ${code}: ${stderr}`)); });
    });
  }
}
