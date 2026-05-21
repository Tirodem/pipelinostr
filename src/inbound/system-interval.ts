/**
 * System interval listener (ADR-012)
 *
 * Drives workflows whose trigger source is `system.interval`. Each such
 * workflow declares its own `every_ms`; on every tick the listener invokes
 * the engine directly on that workflow (bypassing matcher and queue —
 * queueing 1 Hz mirror loops would flood the DB).
 */

import type { Logger } from 'pino';
import type { WorkflowDefinition, NormalizedEvent } from '../core/types.js';

export type IntervalTickHandler =
  (workflow: WorkflowDefinition, event: NormalizedEvent) => void | Promise<void>;

const MIN_INTERVAL_MS = 100;

export class SystemIntervalListener {
  private timers: ReturnType<typeof setInterval>[] = [];
  private handler?: IntervalTickHandler;

  constructor(
    private workflows: Map<string, WorkflowDefinition>,
    private logger: Logger,
  ) {}

  onTick(handler: IntervalTickHandler): void {
    this.handler = handler;
  }

  start(): void {
    let registered = 0;
    for (const wf of this.workflows.values()) {
      if (!wf.enabled) continue;
      if (wf.trigger.source !== 'system.interval') continue;

      const every_ms = Number((wf.trigger as Record<string, unknown>).every_ms);
      if (!Number.isFinite(every_ms) || every_ms < MIN_INTERVAL_MS) {
        this.logger.warn(
          { workflowId: wf.id, every_ms, min: MIN_INTERVAL_MS },
          'system.interval workflow missing valid every_ms, skipped',
        );
        continue;
      }

      this.timers.push(setInterval(() => this.fireTick(wf), every_ms));
      registered++;
      this.logger.info({ workflowId: wf.id, every_ms }, 'system.interval registered');
    }
    this.logger.info({ registered }, 'System interval listener started');
  }

  async stop(): Promise<void> {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.logger.info('System interval listener stopped');
  }

  private async fireTick(wf: WorkflowDefinition): Promise<void> {
    if (!this.handler) return;
    const event: NormalizedEvent = {
      source: 'system.interval',
      origin: 'system',
      type: 'interval',
      sender: '',
      content: '',
      timestamp: Math.floor(Date.now() / 1000),
      metadata: { workflow_id: wf.id },
      raw: null,
    };
    try {
      await this.handler(wf, event);
    } catch (err) {
      this.logger.error(
        { workflowId: wf.id, error: (err as Error).message },
        'system.interval tick failed',
      );
    }
  }
}
