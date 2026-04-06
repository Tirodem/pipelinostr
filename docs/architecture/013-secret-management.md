# ADR-013: Secret management and security model

**Status:** Accepted
**Date:** 2026-04-06
**Context:** devA and devB flagged multiple security issues. PipeliNostr runs on both home SBCs and public VPS — one security model must protect both.

## Problem

v1 has several security weaknesses: broken HMAC validation, secrets leaking into logs/DB, shell expansion in config (injection risk), and no file permission management. Security must be uniform across deployment profiles without adding manual steps for DIY users.

## Decision

**One security model for all deployments. All protections ship in v2. Automate everything that can be automated. Linux only — Windows is not a target platform.**

### Secret resolution

Two resolvers from day one:

```yaml
# Environment variable (simple, works everywhere)
bot_token: env:TELEGRAM_BOT_TOKEN

# File-based (more secure, for VPS / systemd setups)
bot_token: file:/run/credentials/telegram_bot_token
```

Both are explicit prefixes. No shell expansion (`${VAR}` syntax works with a deprecation warning during v2, rejected in v3).

### Resolver behavior

```typescript
const resolvers: Record<string, (ref: string) => string> = {
  'env': (name) => {
    const value = process.env[name];
    if (!value) throw new Error(`Secret env:${name} is not set`);
    return value;
  },
  'file': (path) => {
    if (!isAllowedPath(path)) throw new Error(`Secret file:${path} is outside allowed directories`);
    return fs.readFileSync(path, 'utf-8').trim();
  },
};
```

**Fail fast:** Missing env var or empty value = startup error with a clear message naming the variable. No silent `undefined`.

**Path restriction for `file:`:** Only allowed from `./secrets/`, `/run/credentials/`, or paths explicitly whitelisted in config. Prevents reading arbitrary files (e.g. `/etc/shadow`) from a crafted YAML.

**Secret rotation:** `file:` supports rotation (overwrite file, restart). `env:` does not (env vars fixed at process start). VPS users who need rotation should use `file:`.

### Secret redaction

Resolved secrets are wrapped in an opaque `Secret` type:

```typescript
class Secret {
  private value: string;
  constructor(value: string) { this.value = value; }
  unwrap(): string { return this.value; }
  toString(): string { return '[REDACTED]'; }
  toJSON(): string { return '[REDACTED]'; }
}
```

- Logs (Pino), DB writes, and event serialization see `[REDACTED]`
- Only handler `execute()` methods call `.unwrap()` to get the real value
- Secrets are never stored in `NormalizedEvent`, queue results, or workflow context

**Template boundary:** Secrets are used in handler configs (`bot_token`, `api_key`), not in Handlebars templates. The resolver runs at config load time, not at template render time. A secret value never enters the template engine. If a user writes `content: "{{ variables.token }}"` where `token` is a secret, the auditor (ADR-008) should warn.

### What's automatic (zero user effort)

| Protection | How | User action |
|---|---|---|
| Secret redaction in logs/DB | `Secret` opaque type, serializes to `[REDACTED]` | None |
| HMAC webhook validation | Fixed — proper hash computation + `crypto.timingSafeEqual()` | None |
| Secret stripped from event objects | Engine never passes raw secret values downstream | None |
| CORS headers | Single origin or `*`, per spec | None |
| Config file permissions | Install script sets `chmod 600 config/*.yml` (Linux only) | None |
| `${VAR}` deprecation warning | Engine warns at startup: "deprecated syntax, use env:VAR_NAME" | One-time migration |
| Secret access audit log | Debug-level: "Resolved secret env:TELEGRAM_BOT_TOKEN for handler telegram" (no value) | None |

### What requires user action

| Action | Who | When |
|---|---|---|
| Change `${VAR}` to `env:VAR` in config files | All users | v2 migration (mechanical, ~5 files). Grace period: `${VAR}` still works in v2 with warning, rejected in v3 |
| Optionally switch to `file:` for VPS deployments | VPS users who want tighter security or secret rotation | When they want to |

## Rationale

- **One security model.** A secret leaked on an Orange Pi is the same damage as on a VPS. Security can't be tiered by deployment profile.
- **Automatic by default.** The DIY user on a Raspberry Pi benefits from redaction, HMAC, and file permissions without knowing they exist.
- **`env:` + `file:` from day one.** Both are trivial to implement (two functions). Deferring `file:` means VPS users ship insecure, which contradicts the uniform model.
- **No shell expansion.** `${VAR}` is an injection vector. Explicit `env:` prefix does a direct `process.env` lookup — no shell involved, no parsing ambiguity.
- **Fail fast on missing secrets.** A clear startup error ("TELEGRAM_BOT_TOKEN is not set") is better than a cryptic runtime failure hours later.
- **Grace period for migration.** `${VAR}` still works in v2 with a deprecation warning. DIY users upgrading don't get a broken system on first boot.

## Discussion trail

**Reviewer input:**
- devB (webhook-server.ts:157): Timing side-channel on secret comparison — `crypto.timingSafeEqual` required.
- devB (webhook-server.ts:269): HMAC validation broken — compares raw header with plain secret.
- devB (webhook-server.ts:175): WebhookEvent includes raw secret, flows into logs and DB.
- devA (specs:185): "Provide secrets as files. Putting secrets in environment variables makes them vulnerable to stack-leak attacks."
- devA (specs:302): "Loading secrets into UNIX environment should be discouraged since it prevents access control."
- devA (loader.ts:29): "Parsing shell expansion is all kinds of wrong. Why not have explicit parsing methods (file:, env:)? This is a pentester's gold mine. See Log4Shell."

**Product context:**
PipeliNostr runs on home SBCs (low threat) and public VPS (higher threat). Security must protect both without burdening the DIY user. The Orange Pi user should benefit from all protections automatically.

**Christophe (product owner) input:**
"I'm OK with more security, but DIY users should not be pressed by too heavy security management." — Security must be invisible to the end user.

"What about VPS PipeliNostr?" — VPS deployments have a different threat model (public IP, shared machine). Security can't be deferred.

"We cannot do low security profile on Raspberry Pi and high security feature 6 months after for VPS." — Uniform security model established.

"I don't mind for PipeliNostr to not be Windows compliant. Linux is free, VM are a thing." — Linux-only target confirmed.

**devC review:**
"Make the default secure, make mistakes visible." Flagged: fail fast on missing env vars, restrict `file:` paths, grace period for `${VAR}` migration, secret rotation difference between `env:` and `file:`, and the need for a specified redaction wrapper. Confirmed direction is right.

## Related ADRs

- [ADR-005 — Storage port interface](005-storage-port.md): Secret resolver follows the same port/adapter pattern
- [ADR-008 — Workflow auditor](008-workflow-auditor.md): Could warn if a secret reference appears in a template variable
- [ADR-010 — Handler registry](010-handler-registry.md): Handlers receive secrets via config, call `.unwrap()` in execute()
