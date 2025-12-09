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
