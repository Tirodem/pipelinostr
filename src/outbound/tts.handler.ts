import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { logger } from '../persistence/logger.js';
import type { Handler, HandlerResult, HandlerConfig } from './handler.interface.js';

export interface TTSHandlerOptions {
  engine?: 'piper' | 'espeak' | undefined;
  piperPath?: string | undefined;
  piperModel?: string | undefined;
  espeakVoice?: string | undefined;
  outputDir?: string | undefined;
}

export interface TTSActionConfig extends HandlerConfig {
  text: string;
  voice?: string;
  format?: 'wav' | 'mp3' | 'ogg';
  speed?: number;
}

export class TTSHandler implements Handler {
  readonly name = 'TTS Handler';
  readonly type = 'tts';

  private engine: 'piper' | 'espeak';
  private piperPath: string;
  private piperModel: string;
  private espeakVoice: string;
  private outputDir: string;

  constructor(options: TTSHandlerOptions = {}) {
    this.engine = options.engine ?? 'piper';
    this.piperPath = options.piperPath ?? 'piper';
    this.piperModel = options.piperModel ?? 'fr_FR-siwis-medium';
    this.espeakVoice = options.espeakVoice ?? 'fr-fr';
    this.outputDir = options.outputDir ?? './data/tts';
  }

  async initialize(): Promise<void> {
    // Ensure output directory exists
    await fs.mkdir(this.outputDir, { recursive: true });

    // Verify TTS engine is available
    try {
      if (this.engine === 'piper') {
        await this.checkCommand(this.piperPath, ['--help']);
        logger.info({ engine: 'piper', model: this.piperModel }, 'TTS handler initialized with Piper');
      } else {
        await this.checkCommand('espeak-ng', ['--version']);
        logger.info({ engine: 'espeak-ng', voice: this.espeakVoice, outputDir: this.outputDir }, 'TTS handler initialized with espeak-ng');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn({ engine: this.engine, error: errorMessage }, 'TTS engine not found - handler will fail on execute');
    }
  }

  private checkCommand(command: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, { stdio: 'ignore' });
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Command ${command} exited with code ${code}`));
      });
    });
  }

  async execute(config: HandlerConfig, _context: Record<string, unknown>): Promise<HandlerResult> {
    const ttsConfig = config as TTSActionConfig;

    if (!ttsConfig.text) {
      return { success: false, error: 'Missing required field: text' };
    }

    const text = ttsConfig.text.trim();
    if (!text) {
      return { success: false, error: 'Text cannot be empty' };
    }

    const format = ttsConfig.format ?? 'ogg';
    const outputId = randomUUID();
    const outputFile = join(this.outputDir, `${outputId}.${format}`);

    try {
      if (this.engine === 'piper') {
        await this.generateWithPiper(text, outputFile, ttsConfig.voice, format);
      } else {
        await this.generateWithEspeak(text, outputFile, ttsConfig.voice, ttsConfig.speed);
      }

      // Verify file was created
      const stats = await fs.stat(outputFile);

      logger.info(
        { engine: this.engine, outputFile, size: stats.size },
        'TTS audio generated successfully'
      );

      return {
        success: true,
        data: {
          file_path: outputFile,
          format,
          size: stats.size,
          engine: this.engine,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ text: text.substring(0, 50), error: errorMessage }, 'TTS generation failed');
      return { success: false, error: errorMessage };
    }
  }

  private generateWithPiper(
    text: string,
    outputFile: string,
    voice?: string,
    format?: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const model = voice ?? this.piperModel;
      const wavFile = format === 'wav' ? outputFile : outputFile.replace(/\.[^.]+$/, '.wav');

      // Piper outputs WAV, we'll convert if needed
      const args = [
        '--model', model,
        '--output_file', wavFile,
      ];

      logger.debug({ command: this.piperPath, args, text: text.substring(0, 50) }, 'Running Piper TTS');

      const proc = spawn(this.piperPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stderr = '';
      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.stdin?.write(text);
      proc.stdin?.end();

      proc.on('error', (error) => {
        reject(new Error(`Piper failed to start: ${error.message}`));
      });

      proc.on('close', async (code) => {
        if (code !== 0) {
          reject(new Error(`Piper exited with code ${code}: ${stderr}`));
          return;
        }

        // Convert to OGG if needed (Telegram prefers OGG Opus for voice)
        if (format === 'ogg' && wavFile !== outputFile) {
          try {
            await this.convertToOgg(wavFile, outputFile);
            await fs.unlink(wavFile); // Clean up WAV
          } catch (convError) {
            // If conversion fails, keep the WAV
            await fs.rename(wavFile, outputFile.replace('.ogg', '.wav'));
            logger.warn({ error: convError }, 'OGG conversion failed, keeping WAV');
          }
        }

        resolve();
      });
    });
  }

  private convertToOgg(inputFile: string, outputFile: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Use ffmpeg to convert WAV to OGG Opus
      const args = [
        '-i', inputFile,
        '-c:a', 'libopus',
        '-b:a', '64k',
        '-y',
        outputFile,
      ];

      const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

      let stderr = '';
      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('error', () => {
        reject(new Error('ffmpeg not found - install ffmpeg for OGG conversion'));
      });

      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
      });
    });
  }

  private generateWithEspeak(
    text: string,
    outputFile: string,
    voice?: string,
    speed?: number
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const actualVoice = voice ?? this.espeakVoice;
      const args = [
        '-v', actualVoice,
        '-w', outputFile,
      ];

      if (speed) {
        args.push('-s', speed.toString());
      }

      args.push(text);

      logger.info({ command: 'espeak-ng', voice: actualVoice, args }, 'Running espeak-ng TTS');

      const proc = spawn('espeak-ng', args, { stdio: ['ignore', 'pipe', 'pipe'] });

      let stderr = '';
      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('error', (error) => {
        reject(new Error(`espeak-ng failed to start: ${error.message}`));
      });

      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`espeak-ng exited with code ${code}: ${stderr}`));
      });
    });
  }

  async shutdown(): Promise<void> {
    logger.info('TTS handler shut down');
  }
}
