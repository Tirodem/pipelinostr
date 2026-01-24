import Handlebars from 'handlebars';

export class TemplateEngine {
  private handlebars: typeof Handlebars;

  constructor() {
    this.handlebars = Handlebars.create();
    this.registerHelpers();
  }

  private registerHelpers(): void {
    this.handlebars.registerHelper('trim', (str: string) => str?.trim());

    this.handlebars.registerHelper('truncate', (str: string, length: number) => {
      if (!str || str.length <= length) return str;
      return str.substring(0, length) + '...';
    });

    this.handlebars.registerHelper('date', (timestamp: number | string, format: string) => {
      const date = new Date(typeof timestamp === 'number' ? timestamp * 1000 : timestamp);
      // Simple date formatting (could use date-fns for more complex formats)
      return date.toISOString().replace('T', ' ').substring(0, 19);
    });

    this.handlebars.registerHelper('default', (value: unknown, defaultValue: unknown) => {
      return value ?? defaultValue;
    });

    this.handlebars.registerHelper('json', (obj: unknown) => {
      return JSON.stringify(obj, null, 2);
    });

    // Math helpers - all handle Handlebars options object
    this.handlebars.registerHelper('add', (a: unknown, b: unknown) => {
      // If b is options object, treat as single arg
      if (typeof b === 'object' && b !== null && 'hash' in b) b = 0;
      return (Number(a) || 0) + (Number(b) || 0);
    });

    this.handlebars.registerHelper('subtract', (a: unknown, b: unknown) => {
      if (typeof b === 'object' && b !== null && 'hash' in b) b = 0;
      return (Number(a) || 0) - (Number(b) || 0);
    });

    this.handlebars.registerHelper('multiply', (a: unknown, b: unknown) => {
      if (typeof b === 'object' && b !== null && 'hash' in b) b = 1;
      return (Number(a) || 0) * (Number(b) || 1);
    });

    this.handlebars.registerHelper('divide', (a: unknown, b: unknown) => {
      if (typeof b === 'object' && b !== null && 'hash' in b) b = 1;
      const divisor = Number(b) || 1;
      return (Number(a) || 0) / divisor;
    });

    // Note: Single-arg helpers also receive options as 2nd arg in some contexts
    this.handlebars.registerHelper('floor', (a: unknown, options: unknown) => {
      // If a is the options object, return 0
      if (typeof a === 'object' && a !== null && 'hash' in a) return 0;
      return Math.floor(Number(a) || 0);
    });

    this.handlebars.registerHelper('ceil', (a: unknown, options: unknown) => {
      if (typeof a === 'object' && a !== null && 'hash' in a) return 0;
      return Math.ceil(Number(a) || 0);
    });

    this.handlebars.registerHelper('round', (a: unknown, options: unknown) => {
      if (typeof a === 'object' && a !== null && 'hash' in a) return 0;
      return Math.round(Number(a) || 0);
    });

    // Simple token cost calculator: ceil(tokens / 100), minimum 1
    // Usage: {{ token_cost tokens }} or {{ token_cost actions.claude.response.tokens_used }}
    this.handlebars.registerHelper('token_cost', (tokens: unknown, options: unknown) => {
      if (typeof tokens === 'object' && tokens !== null && 'hash' in tokens) return 1;
      const t = Number(tokens) || 0;
      return t === 0 ? 1 : Math.max(Math.ceil(t / 100), 1);
    });

    // Calculate SATs cost from tokens: tokens * sats_per_1k / 1000, minimum 1 SAT
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.handlebars.registerHelper('sats_cost', function(this: any, ...args: any[]) {
      // Handlebars passes options as last argument
      // sats_cost tokens rate -> args = [tokens, rate, options]
      // sats_cost tokens -> args = [tokens, options]
      const options = args.pop(); // Remove options object
      let tokens = args[0];
      let satsPerK = args[1];

      // If tokens is undefined, try to get from hash (named params)
      if (tokens === undefined && options?.hash?.tokens !== undefined) {
        tokens = options.hash.tokens;
      }
      if (satsPerK === undefined && options?.hash?.rate !== undefined) {
        satsPerK = options.hash.rate;
      }

      const t = Number(tokens) || 0;
      const rate = Number(satsPerK) || 10;
      const cost = Math.ceil((t * rate) / 1000);

      // Debug: if tokens is 0, something is wrong
      if (t === 0) {
        return '?'; // Indicate error
      }

      return Math.max(cost, 1); // Minimum 1 SAT
    });

    // String length helper
    this.handlebars.registerHelper('length', (str: string | unknown[]) => {
      if (typeof str === 'string') return str.length;
      if (Array.isArray(str)) return str.length;
      return 0;
    });

    // Comparison helpers for conditionals
    this.handlebars.registerHelper('gt', (a: number, b: number) => {
      return Number(a) > Number(b);
    });

    this.handlebars.registerHelper('gte', (a: number, b: number) => {
      return Number(a) >= Number(b);
    });

    this.handlebars.registerHelper('lt', (a: number, b: number) => {
      return Number(a) < Number(b);
    });

    this.handlebars.registerHelper('lte', (a: number, b: number) => {
      return Number(a) <= Number(b);
    });

    this.handlebars.registerHelper('eq', (a: unknown, b: unknown) => {
      return a === b;
    });

    this.handlebars.registerHelper('ne', (a: unknown, b: unknown) => {
      return a !== b;
    });

    // Max helper - returns the larger of two values
    this.handlebars.registerHelper('max', (a: unknown, b: unknown) => {
      if (typeof b === 'object' && b !== null && 'hash' in b) b = 0;
      return Math.max(Number(a) || 0, Number(b) || 0);
    });

    // Min helper - returns the smaller of two values
    this.handlebars.registerHelper('min', (a: unknown, b: unknown) => {
      if (typeof b === 'object' && b !== null && 'hash' in b) b = 0;
      return Math.min(Number(a) || 0, Number(b) || 0);
    });

    // Semantic aliases for clearer intent
    // at_least: ensures a minimum value (equivalent to max)
    // Usage: {{ at_least value 1 }} = "value but at least 1"
    this.handlebars.registerHelper('at_least', (a: unknown, b: unknown) => {
      if (typeof b === 'object' && b !== null && 'hash' in b) b = 0;
      return Math.max(Number(a) || 0, Number(b) || 0);
    });

    // at_most: ensures a maximum value (equivalent to min)
    // Usage: {{ at_most value 100 }} = "value but at most 100"
    this.handlebars.registerHelper('at_most', (a: unknown, b: unknown) => {
      if (typeof b === 'object' && b !== null && 'hash' in b) b = Infinity;
      return Math.min(Number(a) || 0, Number(b) || Infinity);
    });

    // Format number with fixed decimal places
    // Usage: {{ fixed 3.5 2 }} -> "3.50"
    this.handlebars.registerHelper('fixed', (value: unknown, decimals: unknown) => {
      if (typeof decimals === 'object' && decimals !== null && 'hash' in decimals) decimals = 2;
      const num = Number(value) || 0;
      const dec = Number(decimals) || 2;
      return num.toFixed(dec);
    });

    // Pad string to fixed width (left pad with spaces)
    // Usage: {{ pad_left "21" 5 }} -> "   21"
    this.handlebars.registerHelper('pad_left', (value: unknown, width: unknown) => {
      if (typeof width === 'object' && width !== null && 'hash' in width) width = 0;
      const str = String(value ?? '');
      const w = Number(width) || 0;
      return str.padStart(w, ' ');
    });

    // Pad string to fixed width (right pad with spaces)
    // Usage: {{ pad_right "Vin" 20 }} -> "Vin                 "
    this.handlebars.registerHelper('pad_right', (value: unknown, width: unknown) => {
      if (typeof width === 'object' && width !== null && 'hash' in width) width = 0;
      const str = String(value ?? '');
      const w = Number(width) || 0;
      return str.padEnd(w, ' ');
    });

    // Format sats with automatic mSats conversion for sub-sat values
    // Usage: {{ format_sats 0.18 }} -> "180 mSats"
    // Usage: {{ format_sats 5.5 }} -> "5.50 sats"
    this.handlebars.registerHelper('format_sats', (value: unknown, options: unknown) => {
      if (typeof value === 'object' && value !== null && 'hash' in value) return '0 sats';
      const num = Number(value) || 0;
      if (num < 1 && num > 0) {
        // Convert to mSats (millisatoshis)
        const msats = Math.round(num * 1000);
        return `${msats} mSats`;
      }
      // Regular sats with 2 decimals if needed
      if (num === Math.floor(num)) {
        return `${num} sats`;
      }
      return `${num.toFixed(2)} sats`;
    });
  }

  compile(template: string): HandlebarsTemplateDelegate {
    return this.handlebars.compile(template);
  }

  render(template: string, context: Record<string, unknown>): string {
    const compiled = this.compile(template);
    return compiled(context);
  }
}

export const templateEngine = new TemplateEngine();
