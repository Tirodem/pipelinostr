/**
 * Secret management (ADR-013)
 *
 * Resolvers: env:VAR_NAME, file:/path/to/secret
 * Secret opaque type: serializes to [REDACTED], unwrap() for real value.
 * Fail-fast on missing values. Path restriction on file:.
 */

import fs from 'node:fs';
import path from 'node:path';

// --- Opaque Secret type ---
//
// A Secret behaves like a string for all operations (.replace(), .trim(),
// .startsWith(), etc.) but serializes to [REDACTED] in logs and JSON.
// Handlers never need to know about Secret — they just use it as a string.

export class Secret {
  private readonly _value: string;

  constructor(value: string) {
    this._value = value;
  }

  /** Get the real secret value explicitly. */
  unwrap(): string {
    return this._value;
  }

  /** Serializes to [REDACTED] — prevents leaks in logs/JSON. */
  toString(): string {
    return '[REDACTED]';
  }

  toJSON(): string {
    return '[REDACTED]';
  }

  [Symbol.toPrimitive](): string {
    return '[REDACTED]';
  }

  /**
   * Create a Secret that behaves like a string via Proxy.
   * All string methods (.replace, .trim, .startsWith, etc.) work transparently.
   * toString/toJSON/template literals return [REDACTED].
   */
  static create(value: string): Secret {
    const secret = new Secret(value);
    return new Proxy(secret, {
      get(target, prop) {
        // Redaction
        if (prop === 'toString' || prop === 'toJSON') return () => '[REDACTED]';
        if (prop === Symbol.toPrimitive) return () => '[REDACTED]';
        // Secret API
        if (prop === 'unwrap') return () => target._value;
        if (prop === '_value') return target._value;
        // instanceof support
        if (prop === Symbol.hasInstance) return undefined;
        // Delegate string methods to the underlying value
        const val = target._value as unknown as Record<string | symbol, unknown>;
        const member = val[prop];
        if (typeof member === 'function') return (member as Function).bind(target._value);
        return member;
      },
    });
  }
}

// --- Allowed directories for file: resolver ---

const DEFAULT_ALLOWED_DIRS = [
  '/run/credentials',
  '/run/secrets',
];

// --- Resolver ---

export interface SecretResolverOptions {
  allowedFileDirs?: string[];
  /** Base directory for relative paths (project root) */
  baseDir?: string;
}

export class SecretResolver {
  private allowedDirs: string[];
  private baseDir: string;

  constructor(options: SecretResolverOptions = {}) {
    this.baseDir = options.baseDir ?? process.cwd();
    this.allowedDirs = [
      ...DEFAULT_ALLOWED_DIRS,
      path.resolve(this.baseDir, 'secrets'),
      ...(options.allowedFileDirs ?? []),
    ];
  }

  /**
   * Resolve a secret reference string.
   * - "env:VAR_NAME" → reads process.env.VAR_NAME
   * - "file:/path/to/secret" → reads file content
   * - "${VAR}" → deprecated syntax, warns and resolves as env (grace period)
   * - Anything else → returned as-is (not a secret)
   */
  resolve(ref: string): string | Secret {
    if (ref.startsWith('env:')) {
      return this.resolveEnv(ref.slice(4));
    }

    if (ref.startsWith('file:')) {
      return this.resolveFile(ref.slice(5));
    }

    // Deprecated ${VAR} syntax — grace period (ADR-013)
    const legacyMatch = ref.match(/^\$\{([^}]+)\}$/);
    if (legacyMatch) {
      const varName = legacyMatch[1]!;
      console.warn(
        `[SECURITY] Deprecated secret syntax: \${${varName}}. ` +
        `Use env:${varName} instead. Support will be removed in v3.`
      );
      return this.resolveEnv(varName);
    }

    // Not a secret reference — return as-is (plain config value)
    return ref;
  }

  /**
   * Resolve all secret references in a config object (deep).
   * Strings starting with env: or file: become Secret objects.
   */
  resolveAll(obj: unknown): unknown {
    if (typeof obj === 'string') {
      return this.resolve(obj);
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => this.resolveAll(item));
    }
    if (obj !== null && typeof obj === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        result[key] = this.resolveAll(value);
      }
      return result;
    }
    return obj;
  }

  private resolveEnv(name: string): Secret {
    const value = process.env[name];
    if (!value) {
      throw new Error(
        `Secret env:${name} is not set. ` +
        `Add ${name}=<value> to your .env file or environment.`
      );
    }
    return Secret.create(value);
  }

  private resolveFile(filePath: string): Secret {
    const resolved = path.resolve(filePath);

    // Security: restrict to allowed directories
    const isAllowed = this.allowedDirs.some((dir) =>
      resolved.startsWith(path.resolve(dir))
    );
    if (!isAllowed) {
      throw new Error(
        `Secret file:${filePath} is outside allowed directories. ` +
        `Allowed: ${this.allowedDirs.join(', ')}`
      );
    }

    if (!fs.existsSync(resolved)) {
      throw new Error(
        `Secret file:${filePath} does not exist.`
      );
    }

    const value = fs.readFileSync(resolved, 'utf-8').trim();
    if (!value) {
      throw new Error(
        `Secret file:${filePath} is empty.`
      );
    }

    return Secret.create(value);
  }
}
