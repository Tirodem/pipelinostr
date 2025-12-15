import { logger } from '../persistence/logger.js';
import { DPOReporter } from '../core/dpo-reporter.js';
import type { Handler, HandlerResult, HandlerConfig } from './handler.interface.js';

export interface DPOActionConfig extends HandlerConfig {
  format?: 'markdown' | 'text';
}

export class DPOHandler implements Handler {
  readonly name = 'DPO Handler';
  readonly type = 'dpo_report';

  private reporter: DPOReporter;

  constructor() {
    this.reporter = new DPOReporter();
  }

  async initialize(): Promise<void> {
    logger.info('DPO handler initialized');
  }

  async execute(config: HandlerConfig, _context: Record<string, unknown>): Promise<HandlerResult> {
    const dpoConfig = config as DPOActionConfig;

    try {
      logger.info('Generating DPO report');

      const report = await this.reporter.generateReport();

      // For text format, strip markdown formatting
      const output = dpoConfig.format === 'text'
        ? this.stripMarkdown(report)
        : report;

      logger.info({ length: output.length }, 'DPO report generated successfully');

      return {
        success: true,
        data: {
          report: output,
          format: dpoConfig.format || 'markdown',
          generated_at: new Date().toISOString(),
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage }, 'DPO report generation failed');
      return { success: false, error: errorMessage };
    }
  }

  private stripMarkdown(markdown: string): string {
    return markdown
      .replace(/^#+\s*/gm, '')           // Remove headers
      .replace(/\*\*([^*]+)\*\*/g, '$1') // Remove bold
      .replace(/\*([^*]+)\*/g, '$1')     // Remove italic
      .replace(/\|/g, ' ')               // Replace table pipes
      .replace(/-{3,}/g, '')             // Remove horizontal rules
      .replace(/\n{3,}/g, '\n\n')        // Normalize line breaks
      .trim();
  }

  async shutdown(): Promise<void> {
    logger.info('DPO handler shut down');
  }
}
