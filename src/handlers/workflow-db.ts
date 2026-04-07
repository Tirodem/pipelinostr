/**
 * Workflow DB handler (v2)
 *
 * Persistent state operations: get, set, increment, decrement, delete, list, check.
 * Uses the Storage port's StateStorage interface (ADR-005).
 */

import { z } from 'zod';
import { BaseHandler, type HandlerResult, type ActionContext } from './base.js';
import type { StateStorage } from '../storage/storage.port.js';

export class WorkflowDbHandler extends BaseHandler {
  static type = 'workflow_db';
  static configSchema = z.object({ enabled: z.boolean().optional() });

  readonly name = 'Workflow DB';
  readonly type = 'workflow_db';

  private state!: StateStorage;

  async initialize(config: Record<string, unknown>): Promise<void> {
    this.state = config._stateStorage as StateStorage;
    if (!this.state) throw new Error('WorkflowDbHandler requires _stateStorage in config');
  }

  async execute(action: Record<string, unknown>, _context: ActionContext): Promise<HandlerResult> {
    const op = action.action as string;
    const namespace = (action.namespace as string) ?? 'default';
    const key = action.key as string;

    switch (op) {
      case 'get':
        return this.handleGet(namespace, key);
      case 'set':
        return this.handleSet(namespace, key, action.value);
      case 'increment':
        return this.handleIncrement(namespace, key, action);
      case 'decrement':
        return this.handleDecrement(namespace, key, action);
      case 'delete':
        return this.handleDelete(namespace, key);
      case 'list':
        return this.handleList(namespace);
      case 'check':
        return this.handleCheck(namespace, key, action);
      default:
        return { success: false, error: `Unknown action: ${op}` };
    }
  }

  async shutdown(): Promise<void> {}

  private handleGet(namespace: string, key: string): HandlerResult {
    if (!key) return { success: false, error: 'Missing key' };
    const value = this.state.get(namespace, key);
    return { success: true, data: { value, found: value !== null } };
  }

  private handleSet(namespace: string, key: string, value: unknown): HandlerResult {
    if (!key) return { success: false, error: 'Missing key' };
    this.state.set(namespace, key, value);
    return { success: true, data: { key, value } };
  }

  private handleIncrement(namespace: string, key: string, action: Record<string, unknown>): HandlerResult {
    if (!key) return { success: false, error: 'Missing key' };

    const amount = (action.amount as number) ?? 1;
    const current = this.state.get(namespace, key) as number | null;
    const defaultValue = (action.default_value as number) ?? 0;

    let newValue = (current ?? defaultValue) + amount;

    if (action.max_value !== undefined && newValue > (action.max_value as number)) {
      newValue = action.max_value as number;
    }

    this.state.set(namespace, key, newValue);
    return { success: true, data: { key, value: newValue, previous: current ?? defaultValue } };
  }

  private handleDecrement(namespace: string, key: string, action: Record<string, unknown>): HandlerResult {
    if (!key) return { success: false, error: 'Missing key' };

    const amount = (action.amount as number) ?? 1;
    const current = this.state.get(namespace, key) as number | null;
    const defaultValue = (action.default_value as number) ?? 0;

    let newValue = (current ?? defaultValue) - amount;

    if (action.min_value !== undefined && newValue < (action.min_value as number)) {
      newValue = action.min_value as number;
    }

    this.state.set(namespace, key, newValue);
    return { success: true, data: { key, value: newValue, previous: current ?? defaultValue } };
  }

  private handleDelete(namespace: string, key: string): HandlerResult {
    if (!key) return { success: false, error: 'Missing key' };
    const deleted = this.state.delete(namespace, key);
    return { success: true, data: { key, deleted } };
  }

  private handleList(namespace: string): HandlerResult {
    const entries = this.state.listByNamespace(namespace);
    return {
      success: true,
      data: {
        namespace,
        count: entries.length,
        entries: entries.map((e) => ({ key: e.key, value: e.value })),
      },
    };
  }

  private handleCheck(namespace: string, key: string, action: Record<string, unknown>): HandlerResult {
    if (!key) return { success: false, error: 'Missing key' };

    const operator = action.operator as string ?? 'exists';
    const compareValue = action.compare_value;
    const current = this.state.get(namespace, key);

    let passed = false;

    switch (operator) {
      case 'exists': passed = current !== null; break;
      case 'not_exists': passed = current === null; break;
      case 'eq': passed = current == compareValue; break;
      case 'ne': passed = current != compareValue; break;
      case 'gt': passed = Number(current) > Number(compareValue); break;
      case 'gte': passed = Number(current) >= Number(compareValue); break;
      case 'lt': passed = Number(current) < Number(compareValue); break;
      case 'lte': passed = Number(current) <= Number(compareValue); break;
      default: return { success: false, error: `Unknown operator: ${operator}` };
    }

    if (!passed) {
      return { success: false, error: `Check failed: ${key} ${operator} ${compareValue} (current: ${current})`, data: { value: current, passed: false } };
    }

    return { success: true, data: { value: current, passed: true } };
  }
}
