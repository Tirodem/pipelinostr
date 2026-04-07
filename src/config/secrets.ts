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

export class Secret {
  private readonly value: string;

  constructor(value: string) {
    this.value = value;
    // Freeze to prevent tampering
    Object.freeze(this);
  }

  /** Get the real secret value. Only call inside handler execute(). */
  unwrap(): string {
    return this.value;
  }

  toString(): string {
    return '[REDACTED]';
  }

  toJSON(): string {
    return '[REDACTED]';
  }

  // Prevent leaking via template literals
  [Symbol.toPrimitive](): string {
    return '[REDACTED]';
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
    return new Secret(value);
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

    return new Secret(value);
  }
}
