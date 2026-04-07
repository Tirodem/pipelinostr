/**
 * Calendar handler (v2)
 *
 * Sends iCal calendar invitations via email.
 * Depends on nodemailer (shared with email handler).
 */

import { z } from 'zod';
import { BaseHandler, type HandlerResult, type ActionContext } from './base.js';
import { Secret } from '../config/secrets.js';

export class CalendarHandler extends BaseHandler {
  static type = 'calendar';
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
    organizer: z.object({
      name: z.string().optional(),
      email: z.string(),
    }).optional(),
    enabled: z.boolean().optional(),
  });

  readonly name = 'Calendar';
  readonly type = 'calendar';

  private transporter: unknown = null;
  private defaultFrom = '';
  private organizerName = '';
  private organizerEmail = '';

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
    this.defaultFrom = from ? `${from.name ?? ''} <${from.address}>`.trim() : auth.user;

    const organizer = config.organizer as { name?: string; email: string } | undefined;
    this.organizerName = organizer?.name ?? 'PipeliNostr';
    this.organizerEmail = organizer?.email ?? auth.user;

    await (this.transporter as { verify: () => Promise<void> }).verify();
  }

  async execute(action: Record<string, unknown>, _context: ActionContext): Promise<HandlerResult> {
    if (!this.transporter) return { success: false, error: 'Calendar handler not initialized' };

    const to = action.to as string;
    const title = action.title as string;
    const start = action.start as string;
    if (!to || !title || !start) return { success: false, error: 'Missing to, title, or start' };

    try {
      const startDate = new Date(start);
      const duration = this.parseDuration(action.duration as string ?? '1h');
      const endDate = new Date(startDate.getTime() + duration);

      const ics = this.generateIcs(title, startDate, endDate, {
        location: action.location as string,
        description: action.description as string,
        reminder: action.reminder as number,
      });

      const result = await (this.transporter as { sendMail: (opts: unknown) => Promise<{ messageId: string }> }).sendMail({
        from: this.defaultFrom,
        to,
        subject: `Invitation: ${title}`,
        text: `You are invited to: ${title}\nDate: ${startDate.toISOString()}\nLocation: ${action.location ?? 'TBD'}`,
        icalEvent: {
          method: 'REQUEST',
          content: ics,
        },
      });

      return { success: true, data: { messageId: result.messageId, to, title } };
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

  private generateIcs(title: string, start: Date, end: Date, opts: {
    location?: string; description?: string; reminder?: number;
  }): string {
    const uid = `${Date.now()}-${Math.random().toString(36).slice(2)}@pipelinostr`;
    const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

    let ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//PipeliNostr//v2//EN',
      'METHOD:REQUEST',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTART:${fmt(start)}`,
      `DTEND:${fmt(end)}`,
      `SUMMARY:${title}`,
      `ORGANIZER;CN=${this.organizerName}:mailto:${this.organizerEmail}`,
    ];

    if (opts.location) ics.push(`LOCATION:${opts.location}`);
    if (opts.description) ics.push(`DESCRIPTION:${opts.description}`);

    if (opts.reminder) {
      ics.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${title}`,
        `TRIGGER:-PT${opts.reminder}M`, 'END:VALARM');
    }

    ics.push('END:VEVENT', 'END:VCALENDAR');
    return ics.join('\r\n');
  }

  private parseDuration(str: string): number {
    let ms = 0;
    const hours = str.match(/(\d+)h/);
    const minutes = str.match(/(\d+)m/);
    if (hours) ms += parseInt(hours[1]!) * 3600000;
    if (minutes) ms += parseInt(minutes[1]!) * 60000;
    return ms || 3600000; // default 1h
  }
}
