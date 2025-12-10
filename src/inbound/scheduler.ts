/**
 * Scheduler - Planification de tâches avec expressions cron
 * Déclenche des workflows à des moments programmés
 */

import { logger } from '../persistence/logger.js';

export interface SchedulerEvent {
  // Metadata
  id: string;
  source: 'scheduler';
  timestamp: number;

  // Schedule info
  scheduleId: string;
  scheduleName: string;
  cron: string;

  // Execution info
  scheduledTime: number;
  executionTime: number;
  runNumber: number;

  // Optional payload
  payload?: unknown | undefined;
}

export type SchedulerCallback = (event: SchedulerEvent) => void | Promise<void>;

export interface ScheduleConfig {
  id: string;
  name: string;
  cron: string; // Cron expression (5 or 6 fields)
  timezone?: string | undefined;
  enabled?: boolean | undefined;
  payload?: unknown | undefined;
  description?: string | undefined;
}

export interface SchedulerManagerConfig {
  enabled: boolean;
  schedules?: ScheduleConfig[] | undefined;
  timezone?: string | undefined; // Default timezone
}

interface ScheduleState {
  config: ScheduleConfig;
  timer: NodeJS.Timeout | null;
  nextRun: Date | null;
  runNumber: number;
  isRunning: boolean;
}

// Simple cron parser for 5-field cron expressions
// minute hour day month weekday
interface CronFields {
  minutes: number[];
  hours: number[];
  days: number[];
  months: number[];
  weekdays: number[];
}

export class SchedulerManager {
  private config: SchedulerManagerConfig;
  private schedules: Map<string, ScheduleState> = new Map();
  private callbacks: SchedulerCallback[] = [];
  private eventCounter = 0;
  private checkInterval: NodeJS.Timeout | null = null;

  constructor(config: SchedulerManagerConfig) {
    this.config = config;
  }

  onSchedule(callback: SchedulerCallback): void {
    this.callbacks.push(callback);
  }

  async start(): Promise<void> {
    if (!this.config.enabled) {
      logger.debug('[Scheduler] Scheduling disabled');
      return;
    }

    if (!this.config.schedules || this.config.schedules.length === 0) {
      logger.debug('[Scheduler] No schedules configured');
      return;
    }

    for (const scheduleConfig of this.config.schedules) {
      if (scheduleConfig.enabled === false) {
        continue;
      }

      try {
        const state: ScheduleState = {
          config: scheduleConfig,
          timer: null,
          nextRun: this.calculateNextRun(scheduleConfig.cron),
          runNumber: 0,
          isRunning: false,
        };

        this.schedules.set(scheduleConfig.id, state);

        logger.info(
          {
            scheduleId: scheduleConfig.id,
            cron: scheduleConfig.cron,
            nextRun: state.nextRun?.toISOString(),
          },
          '[Scheduler] Schedule registered'
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(
          { scheduleId: scheduleConfig.id, error: errorMessage },
          '[Scheduler] Invalid cron expression'
        );
      }
    }

    // Start the scheduler check loop (every second)
    this.checkInterval = setInterval(() => {
      this.checkSchedules();
    }, 1000);

    logger.info({ count: this.schedules.size }, '[Scheduler] Manager started');
  }

  private checkSchedules(): void {
    const now = new Date();

    for (const [, state] of this.schedules) {
      if (state.isRunning || !state.nextRun) {
        continue;
      }

      // Check if it's time to run
      if (now >= state.nextRun) {
        this.executeSchedule(state);
        // Calculate next run
        state.nextRun = this.calculateNextRun(state.config.cron);
      }
    }
  }

  private async executeSchedule(state: ScheduleState): Promise<void> {
    state.isRunning = true;
    const scheduledTime = state.nextRun?.getTime() || Date.now();

    try {
      state.runNumber++;

      const event: SchedulerEvent = {
        id: `sched_${Date.now()}_${++this.eventCounter}`,
        source: 'scheduler',
        timestamp: Date.now(),
        scheduleId: state.config.id,
        scheduleName: state.config.name,
        cron: state.config.cron,
        scheduledTime,
        executionTime: Date.now(),
        runNumber: state.runNumber,
        payload: state.config.payload,
      };

      // Process callbacks
      for (const callback of this.callbacks) {
        try {
          await callback(event);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error(
            { error: errorMessage, scheduleId: state.config.id },
            '[Scheduler] Callback error'
          );
        }
      }

      logger.debug(
        {
          scheduleId: state.config.id,
          runNumber: state.runNumber,
          nextRun: state.nextRun?.toISOString(),
        },
        '[Scheduler] Schedule executed'
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(
        { error: errorMessage, scheduleId: state.config.id },
        '[Scheduler] Execution failed'
      );
    } finally {
      state.isRunning = false;
    }
  }

  private parseCron(cron: string): CronFields {
    const parts = cron.trim().split(/\s+/);

    if (parts.length < 5 || parts.length > 6) {
      throw new Error(`Invalid cron expression: expected 5 or 6 fields, got ${parts.length}`);
    }

    // Handle 6-field cron (with seconds) by ignoring seconds
    const offset = parts.length === 6 ? 1 : 0;

    const minuteField = parts[offset];
    const hourField = parts[offset + 1];
    const dayField = parts[offset + 2];
    const monthField = parts[offset + 3];
    const weekdayField = parts[offset + 4];

    if (!minuteField || !hourField || !dayField || !monthField || !weekdayField) {
      throw new Error('Invalid cron expression: missing fields');
    }

    return {
      minutes: this.parseField(minuteField, 0, 59),
      hours: this.parseField(hourField, 0, 23),
      days: this.parseField(dayField, 1, 31),
      months: this.parseField(monthField, 1, 12),
      weekdays: this.parseField(weekdayField, 0, 6),
    };
  }

  private parseField(field: string, min: number, max: number): number[] {
    const values: number[] = [];

    // Handle comma-separated values
    const fieldParts = field.split(',');

    for (const part of fieldParts) {
      if (part === '*') {
        // All values
        for (let i = min; i <= max; i++) {
          values.push(i);
        }
      } else if (part.includes('/')) {
        // Step values (*/5 or 0-30/5)
        const slashParts = part.split('/');
        const range = slashParts[0] || '*';
        const stepStr = slashParts[1] || '1';
        const step = parseInt(stepStr, 10);
        let start = min;
        let end = max;

        if (range !== '*') {
          if (range.includes('-')) {
            const rangeParts = range.split('-');
            start = parseInt(rangeParts[0] || String(min), 10);
            end = parseInt(rangeParts[1] || String(max), 10);
          } else {
            start = parseInt(range, 10);
          }
        }

        for (let i = start; i <= end; i += step) {
          values.push(i);
        }
      } else if (part.includes('-')) {
        // Range values (1-5)
        const rangeParts = part.split('-');
        const start = parseInt(rangeParts[0] || String(min), 10);
        const end = parseInt(rangeParts[1] || String(max), 10);
        for (let i = start; i <= end; i++) {
          values.push(i);
        }
      } else {
        // Single value
        values.push(parseInt(part, 10));
      }
    }

    // Remove duplicates and sort
    return [...new Set(values)].sort((a, b) => a - b);
  }

  private calculateNextRun(cron: string): Date {
    const fields = this.parseCron(cron);
    const now = new Date();

    // Start from next minute
    const candidate = new Date(now);
    candidate.setSeconds(0);
    candidate.setMilliseconds(0);
    candidate.setMinutes(candidate.getMinutes() + 1);

    // Search for next valid time (max 2 years ahead)
    const maxIterations = 525600; // ~1 year of minutes
    let iterations = 0;

    while (iterations < maxIterations) {
      iterations++;

      const month = candidate.getMonth() + 1;
      const day = candidate.getDate();
      const weekday = candidate.getDay();
      const hour = candidate.getHours();
      const minute = candidate.getMinutes();

      // Check if current time matches all fields
      if (
        fields.months.includes(month) &&
        fields.days.includes(day) &&
        fields.weekdays.includes(weekday) &&
        fields.hours.includes(hour) &&
        fields.minutes.includes(minute)
      ) {
        return candidate;
      }

      // Advance by 1 minute
      candidate.setMinutes(candidate.getMinutes() + 1);
    }

    throw new Error('Could not calculate next run time');
  }

  getSchedules(): ScheduleConfig[] {
    return Array.from(this.schedules.values()).map((state) => state.config);
  }

  getScheduleStats(): Record<string, { nextRun: string | null; runNumber: number; isRunning: boolean }> {
    const stats: Record<string, { nextRun: string | null; runNumber: number; isRunning: boolean }> = {};
    for (const [id, state] of this.schedules) {
      stats[id] = {
        nextRun: state.nextRun?.toISOString() || null,
        runNumber: state.runNumber,
        isRunning: state.isRunning,
      };
    }
    return stats;
  }

  async triggerSchedule(scheduleId: string): Promise<void> {
    const state = this.schedules.get(scheduleId);
    if (state) {
      await this.executeSchedule(state);
    }
  }

  async shutdown(): Promise<void> {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    for (const [, state] of this.schedules) {
      if (state.timer) {
        clearTimeout(state.timer);
      }
    }

    this.schedules.clear();
    logger.info('[Scheduler] Manager stopped');
  }
}
