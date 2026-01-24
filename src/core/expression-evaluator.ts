import { logger } from '../persistence/logger.js';
import type { WorkflowContext } from './workflow.types.js';
import { templateEngine } from './template-engine.js';

/**
 * Expression Evaluator
 *
 * Supports:
 * - Simple Handlebars: {{ actions.send-email.success }}
 * - Comparisons: actions.send-email.success == true
 * - Logical operators: && || !
 * - Nested property access: actions.send-email.response.status
 * - Array access: actions.lookup.response.body.vin[0].address
 *
 * Examples:
 * - "{{ actions.send-email.success }}"
 * - "actions.send-email.success == true"
 * - "actions.send-email.success && match.to != ''"
 * - "!actions.send-email.error"
 * - "{{ actions.http.response.body.items[0].name }}"
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
        const innerExpr = handlebarsMatch[1] as string;
        // Check if it's a helper call (contains spaces, like "lt a b" or "gte x y")
        // vs a simple path like "actions.send-email.success"
        if (innerExpr.includes(' ')) {
          // It's a helper call - use template engine to evaluate
          const rendered = templateEngine.render(expression, context as unknown as Record<string, unknown>);
          return this.toBoolean(rendered);
        } else {
          // Simple path - use resolveValue
          const value = this.resolveValue(innerExpr, context);
          return this.toBoolean(value);
        }
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
  // Returns the raw value if template is a single expression like {{ path.to.value }}
  // Otherwise returns the rendered string
  renderTemplate(template: string, context: WorkflowContext): unknown {
    if (!template) return '';

    // Check if the template is just a single expression (no surrounding text)
    // This allows passing arrays/objects through templates
    const singleExprMatch = template.match(/^\{\{\s*([^}|]+?)\s*\}\}$/);
    if (singleExprMatch) {
      const path = singleExprMatch[1]!.trim();
      // No filters, just a path - return the raw value
      const value = this.resolveValue(path, context);
      // Return the actual value (could be array, object, etc.)
      return value;
    }

    try {
      // Use Handlebars-based template engine for full helper support
      return templateEngine.render(template, context as unknown as Record<string, unknown>);
    } catch (error) {
      // Fallback to simple replacement if Handlebars fails
      logger.warn({ error, template: template.substring(0, 100) }, 'Handlebars render failed, using fallback');
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
        // Support both == and === (treat === as ==)
        if (expression[i + 2] === '=') {
          tokens.push('==');
          i += 2;
        } else {
          tokens.push('==');
          i++;
        }
        current = '';
      } else if (char === '!' && expression[i + 1] === '=') {
        if (current.trim()) tokens.push(current.trim());
        // Support both != and !== (treat !== as !=)
        if (expression[i + 2] === '=') {
          tokens.push('!=');
          i += 2;
        } else {
          tokens.push('!=');
          i++;
        }
        current = '';
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
    // Parse path into segments, handling both dot notation and array access
    // e.g., "actions.lookup.response.body.vin[0].address" becomes:
    // ["actions", "lookup", "response", "body", "vin", "[0]", "address"]
    const segments = this.parsePath(path);
    let current: unknown = context;

    for (const segment of segments) {
      if (current === null || current === undefined) {
        return undefined;
      }

      // Check if it's an array index like "[0]" or "[123]"
      const arrayMatch = segment.match(/^\[(\d+)\]$/);
      if (arrayMatch) {
        const index = parseInt(arrayMatch[1] as string, 10);
        if (Array.isArray(current)) {
          current = current[index];
        } else {
          return undefined;
        }
      } else if (typeof current === 'object') {
        // Handle regular property access (including hyphenated keys like "send-email")
        current = (current as Record<string, unknown>)[segment];
      } else {
        return undefined;
      }
    }

    return current;
  }

  private parsePath(path: string): string[] {
    const segments: string[] = [];
    let current = '';

    for (let i = 0; i < path.length; i++) {
      const char = path[i] as string;

      if (char === '.') {
        if (current) {
          segments.push(current);
          current = '';
        }
      } else if (char === '[') {
        // Push current segment if exists
        if (current) {
          segments.push(current);
          current = '';
        }
        // Find closing bracket and push array index as separate segment
        const closeIndex = path.indexOf(']', i);
        if (closeIndex !== -1) {
          segments.push(path.substring(i, closeIndex + 1));
          i = closeIndex;
        }
      } else {
        current += char;
      }
    }

    if (current) {
      segments.push(current);
    }

    return segments;
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

      case 'date_short': {
        // Format: YYYY-MM-DD HH:MM
        const timestamp = typeof value === 'number' ? value * 1000 : Date.parse(String(value));
        const d = new Date(timestamp);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      }

      case 'sats_to_btc': {
        // Convert satoshis to BTC with 8 decimal places
        const sats = typeof value === 'number' ? value : parseInt(String(value), 10);
        if (isNaN(sats)) return value;
        return (sats / 100000000).toFixed(8);
      }

      case 'number': {
        // Format number with thousand separators
        const num = typeof value === 'number' ? value : parseFloat(String(value));
        if (isNaN(num)) return value;
        return num.toLocaleString('en-US');
      }

      case 'length': {
        // Get array length
        if (Array.isArray(value)) return value.length;
        if (typeof value === 'string') return value.length;
        return 0;
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
