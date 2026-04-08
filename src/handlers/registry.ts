/**
 * Handler registry (ADR-010)
 *
 * Instance-based (not singleton). Owned by the app, not global.
 * Auto-discovers handlers by scanning the handlers directory.
 * Graceful degradation: one handler failure doesn't crash the app.
 */

import fs from 'node:fs';
import path from 'node:path';
import { BaseHandler } from './base.js';
import { Secret } from '../config/secrets.js';
import { ensureSystemDeps, type SystemDependency } from '../utils/system-deps.js';
import type { Logger } from 'pino';

/** Constructor type that includes static properties from BaseHandler */
interface HandlerConstructor {
  new (): BaseHandler;
  type: string;
  configSchema?: import('zod').ZodType<unknown>;
  npmDependencies?: string[];
  systemDeps?: SystemDependency[];
  platforms?: string[];
}

export type HandlerStatus = 'available' | 'unavailable' | 'disabled';

export interface RegisteredHandler {
  instance: BaseHandler;
  status: HandlerStatus;
  error?: string;
}

export class HandlerRegistry {
  private handlers = new Map<string, RegisteredHandler>();

  constructor(private logger: Logger) {}

  /**
   * Load all handler modules from a directory.
   * Handlers that fail to import are skipped with a warning.
   */
  async discoverHandlers(handlersDir: string): Promise<void> {
    const files = fs.readdirSync(handlersDir)
      .filter((f) => f.endsWith('.ts') || f.endsWith('.js'))
      .filter((f) => f !== 'base.ts' && f !== 'base.js' && f !== 'registry.ts' && f !== 'registry.js' && f !== 'index.ts' && f !== 'index.js');

    for (const file of files) {
      const modulePath = path.join(handlersDir, file);
      try {
        const mod = await import(modulePath);
        const HandlerClass = this.findHandlerClass(mod);
        if (HandlerClass) {
          const type = HandlerClass.type;
          if (!type) {
            this.logger.warn({ file }, 'Handler class missing static type property, skipping');
            continue;
          }
          const instance = new HandlerClass() as BaseHandler;
          this.handlers.set(type, { instance, status: 'disabled' });
          this.logger.debug({ type, file }, 'Handler discovered');
        }
      } catch (err) {
        this.logger.warn({ file, error: (err as Error).message }, 'Failed to import handler, skipping');
      }
    }
  }

  /**
   * Initialize enabled handlers with their configs.
   * Failed inits mark the handler as unavailable, not crash the app.
   */
  async initializeAll(handlerConfigs: Record<string, Record<string, unknown>>): Promise<string[]> {
    const unavailable: string[] = [];

    for (const [type, config] of Object.entries(handlerConfigs)) {
      const registered = this.handlers.get(type);
      if (!registered) {
        this.logger.warn({ type }, 'Handler config found but no handler implementation discovered');
        unavailable.push(type);
        continue;
      }

      // Validate config with Zod schema if available
      // Unwrap Secret values for validation (schemas expect strings)
      const HandlerClass = registered.instance.constructor as HandlerConstructor;
      if (HandlerClass.configSchema) {
        const configForValidation = unwrapSecrets(config);
        const result = HandlerClass.configSchema.safeParse(configForValidation);
        if (!result.success) {
          const errorMsg = `Config validation failed: ${result.error.message}`;
          this.logger.warn({ type, error: errorMsg }, 'Handler config invalid, marking unavailable');
          registered.status = 'unavailable';
          registered.error = errorMsg;
          unavailable.push(type);
          continue;
        }
      }

      // Check npm dependencies
      if (HandlerClass.npmDependencies) {
        const missing = this.checkDependencies(HandlerClass.npmDependencies);
        if (missing.length > 0) {
          const errorMsg = `Missing packages: ${missing.join(', ')}. Run: npm install ${missing.join(' ')}`;
          this.logger.warn({ type, missing }, errorMsg);
          registered.status = 'unavailable';
          registered.error = errorMsg;
          unavailable.push(type);
          continue;
        }
      }

      // Check system dependencies (installed by setup wizard, not at runtime)
      if (HandlerClass.systemDeps?.length) {
        const { missing } = await ensureSystemDeps(HandlerClass.systemDeps, false, this.logger);

        const requiredMissing = missing.filter((bin) =>
          HandlerClass.systemDeps!.find((d) => d.binary === bin && !d.optional)
        );
        if (requiredMissing.length > 0) {
          const cmds = HandlerClass.systemDeps!
            .filter((d) => requiredMissing.includes(d.binary) && d.packages.apt)
            .map((d) => `sudo apt-get install ${d.packages.apt}`)
            .join(', ');
          const errorMsg = `Missing system dependency: ${requiredMissing.join(', ')}. Install with: ${cmds}`;
          this.logger.warn({ type, missing: requiredMissing }, errorMsg);
          registered.status = 'unavailable';
          registered.error = errorMsg;
          unavailable.push(type);
          continue;
        }
      }

      try {
        // Unwrap secrets for handler initialization — libraries need plain strings
        // (e.g. nodemailer's DNS resolver does typeof === 'string' checks)
        const initConfig = unwrapSecrets(config) as Record<string, unknown>;
        await registered.instance.initialize(initConfig);
        registered.status = 'available';
        this.logger.info({ type }, 'Handler initialized');
      } catch (err) {
        const errorMsg = (err as Error).message;
        this.logger.warn({ type, error: errorMsg }, 'Handler failed to initialize, marking unavailable');
        registered.status = 'unavailable';
        registered.error = errorMsg;
        unavailable.push(type);
      }
    }

    // Auto-initialize zero-config handlers (no YAML config file needed)
    for (const [type, registered] of this.handlers) {
      if (registered.status !== 'disabled') continue;

      const Ctor = registered.instance.constructor as HandlerConstructor;
      if (Ctor.npmDependencies?.length) continue;
      // Skip auto-init for handlers with required system deps
      const hasRequiredSystemDeps = Ctor.systemDeps?.some((d) => !d.optional);
      if (hasRequiredSystemDeps) continue;

      // Check if schema accepts minimal config (no required fields beyond enabled)
      if (Ctor.configSchema) {
        const result = Ctor.configSchema.safeParse({ enabled: true });
        if (!result.success) continue;
      }

      try {
        await registered.instance.initialize({ enabled: true });
        registered.status = 'available';
        this.logger.info({ type }, 'Handler auto-initialized (zero-config)');
      } catch {
        // Silent — handler not needed, just couldn't auto-init
      }
    }

    return unavailable;
  }

  /**
   * Get a handler by type. Returns undefined if not found or unavailable.
   */
  get(type: string): BaseHandler | undefined {
    const registered = this.handlers.get(type);
    if (!registered || registered.status !== 'available') return undefined;
    return registered.instance;
  }

  /**
   * Get handler status info (for admin/status commands).
   */
  getStatus(type: string): RegisteredHandler | undefined {
    return this.handlers.get(type);
  }

  /**
   * List all registered handlers with their status.
   */
  listAll(): Map<string, RegisteredHandler> {
    return new Map(this.handlers);
  }

  /**
   * Shutdown all initialized handlers (ADR-014).
   * Each handler gets its own timeout. One stuck handler doesn't block others.
   */
  async shutdownAll(timeoutMs = 5000): Promise<void> {
    const shutdownPromises = Array.from(this.handlers.entries())
      .filter(([, h]) => h.status === 'available')
      .map(async ([type, handler]) => {
        try {
          await Promise.race([
            handler.instance.shutdown(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Shutdown timeout')), timeoutMs)
            ),
          ]);
          this.logger.debug({ type }, 'Handler shut down');
        } catch (err) {
          this.logger.warn({ type, error: (err as Error).message }, 'Handler shutdown failed or timed out');
        }
      });

    await Promise.all(shutdownPromises);
  }

  private findHandlerClass(mod: Record<string, unknown>): HandlerConstructor | null {
    for (const exported of Object.values(mod)) {
      if (
        typeof exported === 'function' &&
        exported.prototype instanceof BaseHandler &&
        'type' in (exported as unknown as Record<string, unknown>)
      ) {
        return exported as unknown as HandlerConstructor;
      }
    }
    return null;
  }

  private checkDependencies(deps: string[]): string[] {
    const missing: string[] = [];
    for (const dep of deps) {
      try {
        // ESM-compatible: check if package directory exists in node_modules
        const depPath = path.join(process.cwd(), 'node_modules', dep);
        if (!fs.existsSync(depPath)) missing.push(dep);
      } catch {
        missing.push(dep);
      }
    }
    return missing;
  }
}

/**
 * Unwrap Secret values in a config object for Zod validation.
 * Schemas expect plain strings, not Secret wrappers.
 */
function unwrapSecrets(obj: unknown): unknown {
  if (obj != null && typeof (obj as any).unwrap === 'function') return (obj as any).unwrap();
  if (Array.isArray(obj)) return obj.map(unwrapSecrets);
  // Only recurse into plain objects ({}).
  // Class instances (_crypto, _stateStorage, etc.) are passed through untouched —
  // they can't contain secrets and reconstructing them via Object.entries()
  // would destroy their prototype chain and methods.
  if (obj !== null && typeof obj === 'object' && Object.getPrototypeOf(obj) === Object.prototype) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = unwrapSecrets(value);
    }
    return result;
  }
  return obj;
}
