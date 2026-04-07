/**
 * Template engine (Handlebars)
 *
 * Data-driven helper registration (devB feedback: collapse ~120 lines into ~30).
 * Renders trigger.*, match.*, actions.*, variables.*, parent.* contexts.
 */

import Handlebars from 'handlebars';
import type { WorkflowContext } from './types.js';

// --- Data-driven helpers ---

const MATH_OPS: Record<string, (a: number, b: number) => number> = {
  add: (a, b) => a + b,
  subtract: (a, b) => a - b,
  multiply: (a, b) => a * b,
  divide: (a, b) => b === 0 ? 0 : a / b,
  mod: (a, b) => b === 0 ? 0 : a % b,
  min: (a, b) => Math.min(a, b),
  max: (a, b) => Math.max(a, b),
  pow: (a, b) => Math.pow(a, b),
};

const COMPARISON_OPS: Record<string, (a: unknown, b: unknown) => boolean> = {
  eq: (a, b) => a === b,
  ne: (a, b) => a !== b,
  gt: (a, b) => Number(a) > Number(b),
  gte: (a, b) => Number(a) >= Number(b),
  lt: (a, b) => Number(a) < Number(b),
  lte: (a, b) => Number(a) <= Number(b),
};

// --- Template engine ---

export class TemplateEngine {
  private handlebars: typeof Handlebars;

  constructor() {
    this.handlebars = Handlebars.create();
    this.registerHelpers();
  }

  /**
   * Render a template string with the workflow context.
   */
  render(template: string, context: WorkflowContext): string {
    try {
      const compiled = this.handlebars.compile(template, { noEscape: true });
      return compiled(context);
    } catch (err) {
      return template; // Return raw template on error
    }
  }

  /**
   * Render all string values in an object (deep).
   */
  renderObject(obj: unknown, context: WorkflowContext): unknown {
    if (typeof obj === 'string') {
      return this.render(obj, context);
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => this.renderObject(item, context));
    }
    if (obj !== null && typeof obj === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        result[key] = this.renderObject(value, context);
      }
      return result;
    }
    return obj;
  }

  private registerHelpers(): void {
    // Math helpers — data-driven
    for (const [name, fn] of Object.entries(MATH_OPS)) {
      this.handlebars.registerHelper(name, function (this: unknown, ...args: unknown[]) {
        const a = Number(args[0]);
        const b = Number(args[1]);
        if (isNaN(a) || isNaN(b)) return 0;
        return fn(a, b);
      });
    }

    // Comparison helpers — data-driven (for use in {{#if (gt a b)}})
    for (const [name, fn] of Object.entries(COMPARISON_OPS)) {
      this.handlebars.registerHelper(name, function (this: unknown, ...args: unknown[]) {
        return fn(args[0], args[1]);
      });
    }

    // String helpers
    this.handlebars.registerHelper('uppercase', (str: unknown) =>
      String(str ?? '').toUpperCase()
    );
    this.handlebars.registerHelper('lowercase', (str: unknown) =>
      String(str ?? '').toLowerCase()
    );
    this.handlebars.registerHelper('trim', (str: unknown) =>
      String(str ?? '').trim()
    );
    this.handlebars.registerHelper('truncate', (str: unknown, len: unknown) => {
      const s = String(str ?? '');
      const n = Number(len);
      return isNaN(n) ? s : s.slice(0, n);
    });
    this.handlebars.registerHelper('replace', (str: unknown, search: unknown, replace: unknown) =>
      String(str ?? '').replaceAll(String(search), String(replace))
    );
    this.handlebars.registerHelper('split', (str: unknown, sep: unknown) =>
      String(str ?? '').split(String(sep))
    );
    this.handlebars.registerHelper('join', (arr: unknown, sep: unknown) =>
      Array.isArray(arr) ? arr.join(String(sep ?? ',')) : String(arr ?? '')
    );

    // Formatting helpers
    this.handlebars.registerHelper('sats_to_btc', (sats: unknown) => {
      const n = Number(sats);
      return isNaN(n) ? '0' : (n / 100_000_000).toFixed(8);
    });
    this.handlebars.registerHelper('format_sats', (sats: unknown) => {
      const n = Number(sats);
      return isNaN(n) ? '0' : n.toLocaleString('en-US');
    });
    this.handlebars.registerHelper('format_date', (timestamp: unknown) => {
      const n = Number(timestamp);
      if (isNaN(n)) return '';
      return new Date(n * 1000).toISOString();
    });
    this.handlebars.registerHelper('relative_time', (timestamp: unknown) => {
      const n = Number(timestamp);
      if (isNaN(n)) return '';
      const diff = Math.floor(Date.now() / 1000) - n;
      if (diff < 60) return `${diff}s ago`;
      if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
      if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
      return `${Math.floor(diff / 86400)}d ago`;
    });

    // JSON helper
    this.handlebars.registerHelper('json', (obj: unknown) => {
      try {
        return JSON.stringify(obj, null, 2);
      } catch {
        return String(obj);
      }
    });

    // Pad helpers
    this.handlebars.registerHelper('pad_start', (str: unknown, len: unknown, char: unknown) =>
      String(str ?? '').padStart(Number(len) || 0, String(char ?? ' '))
    );
    this.handlebars.registerHelper('pad_end', (str: unknown, len: unknown, char: unknown) =>
      String(str ?? '').padEnd(Number(len) || 0, String(char ?? ' '))
    );

    // Logic helpers
    this.handlebars.registerHelper('and', function (this: unknown, ...args: unknown[]) {
      // Last arg is Handlebars options
      const values = args.slice(0, -1);
      return values.every(Boolean);
    });
    this.handlebars.registerHelper('or', function (this: unknown, ...args: unknown[]) {
      const values = args.slice(0, -1);
      return values.some(Boolean);
    });
    this.handlebars.registerHelper('not', (val: unknown) => !val);

    // Default value
    this.handlebars.registerHelper('default', (val: unknown, fallback: unknown) =>
      val ?? fallback
    );

    // Coerce to number
    this.handlebars.registerHelper('to_number', (val: unknown) => {
      const n = Number(val);
      return isNaN(n) ? 0 : n;
    });
  }
}
