/**
 * Email handler (v2)
 *
 * Sends emails via SMTP using nodemailer.
 * Optional dependency: nodemailer.
 */

import { z } from 'zod';
import { BaseHandler, type HandlerResult, type ActionContext } from './base.js';
import { Secret } from '../config/secrets.js';

export class EmailHandler extends BaseHandler {
  static type = 'email';
  static npmDependencies = ['nodemailer'];
  static configSchema = z.object({
    host: z.string(),
    port: z.number(),
    secure: z.boolean().optional(),
    auth: z.object({
      user: z.string(),
      pass: z.union([z.string(), z.instanceof(Secret)]),
    }),
    from: z.object({
      name: z.string().optional(),
      address: z.string(),
    }).optional(),
    enabled: z.boolean().optional(),
  });

  readonly name = 'Email';
  readonly type = 'email';

  private transporter: unknown = null;
  private defaultFrom = '';

  async initialize(config: Record<string, unknown>): Promise<void> {
    const nodemailer = await import('nodemailer');

    const auth = config.auth as { user: string; pass: string | Secret };
    const pass = auth.pass instanceof Secret ? auth.pass.unwrap() : auth.pass;

    this.transporter = nodemailer.default.createTransport({
      host: config.host as string,
      port: config.port as number,
      secure: (config.secure as boolean | undefined) ?? (config.port as number) === 465,
      auth: { user: auth.user, pass },
    });

    const from = config.from as { name?: string; address: string } | undefined;
    this.defaultFrom = from
      ? `${from.name ?? ''} <${from.address}>`.trim()
      : auth.user;

    await (this.transporter as { verify: () => Promise<void> }).verify();
  }

  async execute(action: Record<string, unknown>, _context: ActionContext): Promise<HandlerResult> {
    if (!this.transporter) return { success: false, error: 'Email handler not initialized' };

    const to = action.to as string;
    const subject = action.subject as string;
    if (!to || !subject) return { success: false, error: 'Missing to or subject' };

    try {
      const result = await (this.transporter as { sendMail: (opts: unknown) => Promise<{ messageId: string; accepted: string[]; rejected: string[] }> }).sendMail({
        from: (action.from as string) ?? this.defaultFrom,
        to,
        subject,
        text: action.body as string,
        html: action.html as string | undefined,
        cc: action.cc as string | undefined,
        bcc: action.bcc as string | undefined,
        replyTo: action.reply_to as string | undefined,
      });

      return {
        success: true,
        data: { messageId: result.messageId, accepted: result.accepted },
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async shutdown(): Promise<void> {
    if (this.transporter) {
      (this.transporter as { close: () => void }).close();
      this.transporter = null;
    }
  }
}
