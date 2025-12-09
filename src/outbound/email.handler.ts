import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { logger } from '../persistence/logger.js';
import type { Handler, HandlerResult, HandlerConfig } from './handler.interface.js';

export interface EmailHandlerOptions {
  host: string;
  port: number;
  secure?: boolean | undefined;
  auth: {
    user: string;
    pass: string;
  };
  from?: {
    name?: string | undefined;
    address: string;
  } | undefined;
}

export interface EmailActionConfig extends HandlerConfig {
  to: string;
  subject: string;
  body: string;
  html?: string;
  from?: string;
  cc?: string;
  bcc?: string;
  replyTo?: string;
}

export class EmailHandler implements Handler {
  readonly name = 'Email Handler';
  readonly type = 'email';

  private transporter: Transporter | null = null;
  private options: EmailHandlerOptions;
  private defaultFrom: string;

  constructor(options: EmailHandlerOptions) {
    this.options = options;
    this.defaultFrom = options.from
      ? `${options.from.name ?? ''} <${options.from.address}>`.trim()
      : options.auth.user;
  }

  async initialize(): Promise<void> {
    this.transporter = nodemailer.createTransport({
      host: this.options.host,
      port: this.options.port,
      secure: this.options.secure ?? this.options.port === 465,
      auth: {
        user: this.options.auth.user,
        pass: this.options.auth.pass,
      },
    });

    // Verify connection
    try {
      await this.transporter.verify();
      logger.info({ host: this.options.host, port: this.options.port }, 'Email handler initialized');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage }, 'Failed to verify email connection');
      throw error;
    }
  }

  async execute(config: HandlerConfig, _context: Record<string, unknown>): Promise<HandlerResult> {
    const emailConfig = config as EmailActionConfig;

    if (!this.transporter) {
      return { success: false, error: 'Email handler not initialized' };
    }

    if (!emailConfig.to || !emailConfig.subject) {
      return { success: false, error: 'Missing required fields: to, subject' };
    }

    try {
      const mailOptions = {
        from: emailConfig.from ?? this.defaultFrom,
        to: emailConfig.to,
        subject: emailConfig.subject,
        text: emailConfig.body,
        html: emailConfig.html,
        cc: emailConfig.cc,
        bcc: emailConfig.bcc,
        replyTo: emailConfig.replyTo,
      };

      const result = await this.transporter.sendMail(mailOptions);

      logger.info(
        { messageId: result.messageId, to: emailConfig.to },
        'Email sent successfully'
      );

      return {
        success: true,
        data: {
          messageId: result.messageId,
          accepted: result.accepted,
          rejected: result.rejected,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage, to: emailConfig.to }, 'Failed to send email');
      return { success: false, error: errorMessage };
    }
  }

  async shutdown(): Promise<void> {
    if (this.transporter) {
      this.transporter.close();
      this.transporter = null;
      logger.info('Email handler shut down');
    }
  }
}
