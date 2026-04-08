/**
 * Base handler interface and class (ADR-010)
 *
 * Every handler extends BaseHandler and declares:
 * - static type: string (used in workflow YAML)
 * - static configSchema: Zod schema for config validation
 * - initialize(): setup connections
 * - execute(): handle an action
 * - shutdown(): cleanup (must be idempotent, resolve within timeout - ADR-014)
 */

import type { z } from 'zod';
import type { SystemDependency } from '../utils/system-deps.js';

export interface HandlerResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

export interface ActionContext {
  trigger: Record<string, unknown>;
  match: Record<string, string>;
  actions: Record<string, unknown>;
  variables: Record<string, unknown>;
  parent?: Record<string, unknown> | undefined;
}

export abstract class BaseHandler {
  /** Handler type identifier, used in workflow YAML action.type */
  static type: string;

  /** Zod schema for validating handler config from YAML */
  static configSchema: z.ZodType<unknown>;

  /** Optional npm dependencies this handler requires (ADR-015) */
  static npmDependencies?: string[];

  /** Optional system dependencies with auto-install support */
  static systemDeps?: SystemDependency[];

  /** Optional platform restrictions (ADR-015) */
  static platforms?: string[];

  /** Handler display name */
  abstract readonly name: string;

  /** Handler type (mirrors static type for instance access) */
  abstract readonly type: string;

  /** Called once at startup. Connect, validate, prepare. */
  abstract initialize(config: Record<string, unknown>): Promise<void>;

  /**
   * Execute an action.
   * @param action - Action parameters from workflow YAML (flattened, no config wrapper)
   * @param context - Runtime context (trigger, match, actions, variables)
   */
  abstract execute(action: Record<string, unknown>, context: ActionContext): Promise<HandlerResult>;

  /**
   * Cleanup on shutdown (ADR-014).
   * MUST be idempotent — safe to call twice.
   * MUST resolve within handler timeout (default 5s).
   * MUST NOT call process.exit().
   */
  abstract shutdown(): Promise<void>;
}
