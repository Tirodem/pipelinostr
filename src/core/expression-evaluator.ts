import { logger } from '../persistence/logger.js';
import type { WorkflowContext } from './workflow.types.js';

/**
 * Expression Evaluator
 *
 * Supports:
 * - Simple Handlebars: {{ actions.send-email.success }}
 * - Comparisons: actions.send-email.success == true
 * - Logical operators: && || !
 * - Nested property access: actions.send-email.response.status
 *
 * Examples:
 * - "{{ actions.send-email.success }}"
 * - "actions.send-email.success == true"
 * - "actions.send-email.success && match.to != ''"
 * - "!actions.send-email.error"
 */

export class ExpressionEvaluator {
  // Evaluate a condition expression
  evaluate(expression: string, context: WorkflowContext): boolean {
    if (!expression || expression.trim() === '') {
      return true; // Empty condition = always execute
    }

    try {
      // Check if it's a simple Handlebars expression
      const handlebarsMatch = expression.match(/^\{\{\s*(.+?)\s*\}\}$/);
      if (handlebarsMatch) {
        const value = this.resolveValue(handlebarsMatch[1] as string, context);
        return this.toBoolean(value);
      }

      // Otherwise, evaluate as expression
      return this.evaluateExpression(expression, context);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ expression, error: errorMessage }, 'Failed to evaluate expression');
      return false;
    }
  }

  // Render a template string with context
  renderTemplate(template: string, context: WorkflowContext): string {
    if (!template) return '';

    // Replace {{ variable }} patterns
    return template.replace(/\{\{\s*(.+?)\s*\}\}/g, (_, path: string) => {
      // Handle filters like {{ value | trim }}
      const [valuePath, ...filters] = path.split('|').map((s: string) => s.trim());
      let value = this.resolveValue(valuePath as string, context);

      // Apply filters
      for (const filter of filters) {
        value = this.applyFilter(value, filter);
      }

      return String(value ?? '');
    });
  }

  private evaluateExpression(expression: string, context: WorkflowContext): boolean {
    // Tokenize and evaluate
    // This is a simple recursive descent parser

    const tokens = this.tokenize(expression);
    const result = this.parseOr(tokens, context);

    return this.toBoolean(result);
  }

  private tokenize(expression: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let inString = false;
    let stringChar = '';

    for (let i = 0; i < expression.length; i++) {
      const char = expression[i] as string;

      if (inString) {
        current += char;
        if (char === stringChar) {
          tokens.push(current);
          current = '';
          inString = false;
        }
      } else if (char === '"' || char === "'") {
        if (current.trim()) tokens.push(current.trim());
        current = char;
        inString = true;
        stringChar = char;
      } else if (char === '&' && expression[i + 1] === '&') {
        if (current.trim()) tokens.push(current.trim());
        tokens.push('&&');
        current = '';
        i++;
      } else if (char === '|' && expression[i + 1] === '|') {
        if (current.trim()) tokens.push(current.trim());
        tokens.push('||');
        current = '';
        i++;
      } else if (char === '=' && expression[i + 1] === '=') {
        if (current.trim()) tokens.push(current.trim());
        tokens.push('==');
        current = '';
        i++;
      } else if (char === '!' && expression[i + 1] === '=') {
        if (current.trim()) tokens.push(current.trim());
        tokens.push('!=');
        current = '';
        i++;
      } else if (char === '!' && expression[i + 1] !== '=') {
        if (current.trim()) tokens.push(current.trim());
        tokens.push('!');
        current = '';
      } else if (char === '(' || char === ')') {
        if (current.trim()) tokens.push(current.trim());
        tokens.push(char);
        current = '';
      } else if (char === '>' || char === '<') {
        if (current.trim()) tokens.push(current.trim());
        if (expression[i + 1] === '=') {
          tokens.push(char + '=');
          i++;
        } else {
          tokens.push(char);
        }
        current = '';
      } else {
        current += char;
      }
    }

    if (current.trim()) tokens.push(current.trim());

    return tokens;
  }

  private parseOr(tokens: string[], context: WorkflowContext): unknown {
    let left = this.parseAnd(tokens, context);

    while (tokens.length > 0 && tokens[0] === '||') {
      tokens.shift(); // consume ||
      const right = this.parseAnd(tokens, context);
      left = this.toBoolean(left) || this.toBoolean(right);
    }

    return left;
  }

  private parseAnd(tokens: string[], context: WorkflowContext): unknown {
    let left = this.parseNot(tokens, context);

    while (tokens.length > 0 && tokens[0] === '&&') {
      tokens.shift(); // consume &&
      const right = this.parseNot(tokens, context);
      left = this.toBoolean(left) && this.toBoolean(right);
    }

    return left;
  }

  private parseNot(tokens: string[], context: WorkflowContext): unknown {
    if (tokens[0] === '!') {
      tokens.shift(); // consume !
      const value = this.parseComparison(tokens, context);
      return !this.toBoolean(value);
    }

    return this.parseComparison(tokens, context);
  }

  private parseComparison(tokens: string[], context: WorkflowContext): unknown {
    const left = this.parsePrimary(tokens, context);

    if (tokens.length > 0 && ['==', '!=', '>', '<', '>=', '<='].includes(tokens[0] as string)) {
      const operator = tokens.shift() as string;
      const right = this.parsePrimary(tokens, context);

      switch (operator) {
        case '==':
          return left === right || String(left) === String(right);
        case '!=':
          return left !== right && String(left) !== String(right);
        case '>':
          return Number(left) > Number(right);
        case '<':
          return Number(left) < Number(right);
        case '>=':
          return Number(left) >= Number(right);
        case '<=':
          return Number(left) <= Number(right);
      }
    }

    return left;
  }

  private parsePrimary(tokens: string[], context: WorkflowContext): unknown {
    const token = tokens.shift();

    if (!token) return undefined;

    // Parentheses
    if (token === '(') {
      const result = this.parseOr(tokens, context);
      tokens.shift(); // consume )
      return result;
    }

    // String literal
    if ((token.startsWith('"') && token.endsWith('"')) ||
        (token.startsWith("'") && token.endsWith("'"))) {
      return token.slice(1, -1);
    }

    // Boolean literals
    if (token === 'true') return true;
    if (token === 'false') return false;

    // Null/undefined
    if (token === 'null' || token === 'undefined') return undefined;

    // Number
    if (/^-?\d+(\.\d+)?$/.test(token)) {
      return parseFloat(token);
    }

    // Variable path
    return this.resolveValue(token, context);
  }

  private resolveValue(path: string, context: WorkflowContext): unknown {
    const parts = path.split('.');
    let current: unknown = context;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }

      if (typeof current === 'object') {
        // Handle hyphenated keys like "send-email"
        current = (current as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }

    return current;
  }

  private applyFilter(value: unknown, filter: string): unknown {
    const [filterName, ...args] = filter.split(':').map((s) => s.trim());

    switch (filterName) {
      case 'trim':
        return typeof value === 'string' ? value.trim() : value;

      case 'lower':
      case 'lowercase':
        return typeof value === 'string' ? value.toLowerCase() : value;

      case 'upper':
      case 'uppercase':
        return typeof value === 'string' ? value.toUpperCase() : value;

      case 'truncate': {
        const length = parseInt(args[0] ?? '100', 10);
        if (typeof value === 'string' && value.length > length) {
          return value.substring(0, length) + '...';
        }
        return value;
      }

      case 'default': {
        return value ?? args[0] ?? '';
      }

      case 'json':
        return JSON.stringify(value);

      case 'date': {
        const timestamp = typeof value === 'number' ? value * 1000 : Date.parse(String(value));
        return new Date(timestamp).toISOString();
      }

      default:
        logger.warn({ filter: filterName }, 'Unknown filter');
        return value;
    }
  }

  private toBoolean(value: unknown): boolean {
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value === null || value === undefined) return false;
    if (value === '') return false;
    if (value === 0) return false;
    return true;
  }
}

// Singleton instance
export const expressionEvaluator = new ExpressionEvaluator();
