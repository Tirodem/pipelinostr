/**
 * Expression evaluator for `when` clauses.
 *
 * Evaluates simple expressions like:
 * - "actions.generate_audio.success"
 * - "!actions.step1.success"
 * - "actions.gen_audio.success && !actions.telegram.success"
 * - "trigger.dm_format == 'nip17'"
 * - "trigger.zap.amount > 1000"
 */

import type { WorkflowContext } from './types.js';

export class ExpressionEvaluator {
  /**
   * Evaluate a when expression against a workflow context.
   * Returns true if the expression is truthy.
   */
  evaluate(expression: string, context: WorkflowContext): boolean {
    try {
      // Handle && and || by splitting and recursing
      if (expression.includes('&&')) {
        return expression.split('&&').every((part) => this.evaluate(part.trim(), context));
      }
      if (expression.includes('||')) {
        return expression.split('||').some((part) => this.evaluate(part.trim(), context));
      }

      // Handle negation
      const trimmed = expression.trim();
      if (trimmed.startsWith('!')) {
        return !this.evaluate(trimmed.slice(1).trim(), context);
      }

      // Handle comparison operators
      for (const op of ['===', '!==', '==', '!=', '>=', '<=', '>', '<']) {
        const idx = trimmed.indexOf(op);
        if (idx > 0) {
          const left = this.resolveValue(trimmed.slice(0, idx).trim(), context);
          const right = this.resolveValue(trimmed.slice(idx + op.length).trim(), context);
          return this.compare(left, right, op);
        }
      }

      // Simple truthy check — resolve the path and check if truthy
      const value = this.resolveValue(trimmed, context);
      return Boolean(value);
    } catch {
      return false;
    }
  }

  /**
   * Resolve a dotted path like "actions.send.success" or a literal value.
   */
  private resolveValue(expr: string, context: WorkflowContext): unknown {
    const trimmed = expr.trim();

    // String literal: 'value' or "value"
    if ((trimmed.startsWith("'") && trimmed.endsWith("'")) ||
        (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
      return trimmed.slice(1, -1);
    }

    // Number literal
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      return Number(trimmed);
    }

    // Boolean literals
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    if (trimmed === 'null') return null;

    // Dotted path resolution
    const parts = trimmed.split('.');
    let current: unknown = context;

    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      if (typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }

  private compare(left: unknown, right: unknown, op: string): boolean {
    switch (op) {
      case '===':
      case '==':
        return left == right;
      case '!==':
      case '!=':
        return left != right;
      case '>':
        return Number(left) > Number(right);
      case '>=':
        return Number(left) >= Number(right);
      case '<':
        return Number(left) < Number(right);
      case '<=':
        return Number(left) <= Number(right);
      default:
        return false;
    }
  }
}
