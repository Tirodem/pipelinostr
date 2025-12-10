import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { logger } from '../persistence/logger.js';
import type { Handler, HandlerResult, HandlerConfig } from './handler.interface.js';
import { randomUUID } from 'crypto';

export interface CalendarHandlerOptions {
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
  organizer?: {
    name?: string | undefined;
    email: string;
  } | undefined;
}

export interface CalendarActionConfig extends HandlerConfig {
  to: string;           // Recipients (comma-separated)
  title: string;        // Event title
  start: string;        // Start datetime (YYYY-MM-DD HH:mm)
  duration: string;     // Duration (e.g., "1h", "30m", "1h30m")
  location?: string;    // Location (optional)
  description?: string; // Description (optional)
  reminder?: string;    // Reminder before event (e.g., "15m", "1h")
}

export class CalendarHandler implements Handler {
  readonly name = 'Calendar Handler';
  readonly type = 'calendar';

  private transporter: Transporter | null = null;
  private options: CalendarHandlerOptions;
  private defaultFrom: string;
  private organizerEmail: string;
  private organizerName: string;

  constructor(options: CalendarHandlerOptions) {
    this.options = options;
    this.defaultFrom = options.from
      ? `${options.from.name ?? ''} <${options.from.address}>`.trim()
      : options.auth.user;
    this.organizerEmail = options.organizer?.email ?? options.from?.address ?? options.auth.user;
    this.organizerName = options.organizer?.name ?? options.from?.name ?? 'PipeliNostr';
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

    try {
      await this.transporter.verify();
      logger.info({ host: this.options.host, port: this.options.port }, 'Calendar handler initialized');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage }, 'Failed to verify email connection for calendar');
      throw error;
    }
  }

  /**
   * Parse duration string to minutes
   * Supports: "30m", "1h", "1h30m", "2h", "1h30"
   */
  private parseDuration(duration: string): number {
    const match = duration.match(/^(?:(\d+)h)?(?:(\d+)m?)?$/);
    if (!match) {
      throw new Error(`Invalid duration format: ${duration}`);
    }

    const hours = parseInt(match[1] ?? '0', 10);
    const minutes = parseInt(match[2] ?? '0', 10);

    return hours * 60 + minutes;
  }

  /**
   * Parse datetime string to Date object
   * Supports: "YYYY-MM-DD HH:mm"
   */
  private parseDateTime(dateStr: string): Date {
    const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
    if (!match) {
      throw new Error(`Invalid datetime format: ${dateStr}. Expected: YYYY-MM-DD HH:mm`);
    }

    const [, year, month, day, hour, minute] = match as [string, string, string, string, string, string];
    return new Date(
      parseInt(year, 10),
      parseInt(month, 10) - 1,
      parseInt(day, 10),
      parseInt(hour, 10),
      parseInt(minute, 10)
    );
  }

  /**
   * Format Date to iCal datetime format (YYYYMMDDTHHMMSS)
   */
  private formatICalDate(date: Date): string {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}00`;
  }

  /**
   * Format Date to UTC iCal datetime format (YYYYMMDDTHHMMSSZ)
   */
  private formatICalDateUTC(date: Date): string {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}00Z`;
  }

  /**
   * Generate ICS file content
   */
  private generateICS(config: CalendarActionConfig): string {
    const uid = randomUUID();
    const now = new Date();
    const startDate = this.parseDateTime(config.start.trim());
    const durationMinutes = this.parseDuration(config.duration.trim());
    const endDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000);

    // Parse attendees
    const attendees = config.to.split(',').map((email) => email.trim());

    // Build ICS content
    const lines: string[] = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//PipeliNostr//Calendar//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:REQUEST',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${this.formatICalDateUTC(now)}`,
      `DTSTART:${this.formatICalDate(startDate)}`,
      `DTEND:${this.formatICalDate(endDate)}`,
      `SUMMARY:${this.escapeICalText(config.title.trim())}`,
      `ORGANIZER;CN=${this.organizerName}:mailto:${this.organizerEmail}`,
    ];

    // Add attendees
    for (const attendee of attendees) {
      lines.push(`ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${attendee}`);
    }

    // Add optional fields
    if (config.location) {
      lines.push(`LOCATION:${this.escapeICalText(config.location)}`);
    }

    if (config.description) {
      lines.push(`DESCRIPTION:${this.escapeICalText(config.description)}`);
    }

    // Add reminder (default: 15 minutes)
    const reminderMinutes = config.reminder ? this.parseDuration(config.reminder) : 15;
    lines.push('BEGIN:VALARM');
    lines.push('ACTION:DISPLAY');
    lines.push(`DESCRIPTION:${this.escapeICalText(config.title.trim())}`);
    lines.push(`TRIGGER:-PT${reminderMinutes}M`);
    lines.push('END:VALARM');

    lines.push('END:VEVENT');
    lines.push('END:VCALENDAR');

    return lines.join('\r\n');
  }

  /**
   * Escape special characters for iCal text fields
   */
  private escapeICalText(text: string): string {
    return text
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\n/g, '\\n');
  }

  async execute(config: HandlerConfig, _context: Record<string, unknown>): Promise<HandlerResult> {
    const calConfig = config as CalendarActionConfig;

    if (!this.transporter) {
      return { success: false, error: 'Calendar handler not initialized' };
    }

    if (!calConfig.to || !calConfig.title || !calConfig.start || !calConfig.duration) {
      return { success: false, error: 'Missing required fields: to, title, start, duration' };
    }

    try {
      // Generate ICS content
      const icsContent = this.generateICS(calConfig);

      // Parse start date for email subject
      const startDate = this.parseDateTime(calConfig.start.trim());
      const dateStr = startDate.toLocaleDateString('fr-FR', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

      const mailOptions = {
        from: this.defaultFrom,
        to: calConfig.to,
        subject: `Invitation: ${calConfig.title.trim()}`,
        text: `Vous êtes invité à : ${calConfig.title.trim()}\n\nDate: ${dateStr}\nDurée: ${calConfig.duration}\n${calConfig.location ? `Lieu: ${calConfig.location}\n` : ''}${calConfig.description ? `\n${calConfig.description}` : ''}`,
        html: `
          <h2>Invitation: ${calConfig.title.trim()}</h2>
          <p><strong>Date:</strong> ${dateStr}</p>
          <p><strong>Durée:</strong> ${calConfig.duration}</p>
          ${calConfig.location ? `<p><strong>Lieu:</strong> ${calConfig.location}</p>` : ''}
          ${calConfig.description ? `<p>${calConfig.description}</p>` : ''}
          <p><em>Veuillez ouvrir le fichier .ics joint pour ajouter cet événement à votre calendrier.</em></p>
        `,
        icalEvent: {
          filename: 'invite.ics',
          method: 'REQUEST',
          content: icsContent,
        },
      };

      const result = await this.transporter.sendMail(mailOptions);

      logger.info(
        {
          messageId: result.messageId,
          to: calConfig.to,
          event: calConfig.title,
          start: calConfig.start,
        },
        'Calendar invite sent successfully'
      );

      return {
        success: true,
        data: {
          messageId: result.messageId,
          accepted: result.accepted,
          rejected: result.rejected,
          event: {
            title: calConfig.title,
            start: calConfig.start,
            duration: calConfig.duration,
            location: calConfig.location,
          },
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage, to: calConfig.to }, 'Failed to send calendar invite');
      return { success: false, error: errorMessage };
    }
  }

  async shutdown(): Promise<void> {
    if (this.transporter) {
      this.transporter.close();
      this.transporter = null;
      logger.info('Calendar handler shut down');
    }
  }
}
