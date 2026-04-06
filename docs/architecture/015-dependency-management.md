# ADR-015: Handler dependency management

**Status:** Accepted
**Date:** 2026-04-06
**Context:** devA flagged that all handler dependencies are pulled on install regardless of usage. PipeliNostr has 45 handlers but a typical user enables 3-5.

## Problem

`npm install` downloads every handler's dependencies (pigpio-client, mongodb driver, nodemailer, etc.) even if the user only enables telegram and GPIO. On a Raspberry Pi, this wastes storage, compilation time, and may fail for platform-specific packages.

## Decision

**Handlers declare their dependencies. The CLI checks and prompts — never auto-installs. Install profiles for common setups. Workflows cannot declare npm dependencies.**

### Handler dependency manifest

Each handler declares what it needs:

```yaml
# config/handlers/gpio.yml
type: gpio
npm_dependencies:
  - pigpio-client
system_dependencies:
  - pigpio          # apt package
platforms:
  - linux/arm
  - linux/arm64
```

### Three tiers

**Tier 1 — Check and prompt (v2 day one)**

When enabling a handler, the CLI checks if dependencies are installed:

```bash
./scripts/pipelinostr.sh handler enable gpio
# → Missing: pigpio-client. Run: npm install pigpio-client
# → System dependency needed: sudo apt install pigpio
```

Clear, actionable message. No auto-install. The user runs the command themselves.

At startup, the handler registry (ADR-010) tries to dynamically import the dependency. If missing, the handler is marked unavailable with the same clear message.

**Tier 2 — Install profiles (v2 or later)**

Curated profiles for common setups:

```bash
./scripts/pipelinostr.sh install-profile messaging   # telegram, email, mastodon, bluesky
./scripts/pipelinostr.sh install-profile iot          # gpio, mqtt, serial, i2c
./scripts/pipelinostr.sh install-profile minimal      # http, file, nostr only
```

Each profile is a predefined list of npm packages. The CLI shows what will be installed before running.

**Tier 3 — Opt-in auto-install (later, if needed)**

```bash
./scripts/pipelinostr.sh handler enable gpio --install
```

The `--install` flag is never implicit. Prints what it will install, asks for confirmation.

### Core vs optional dependencies

| Category | Examples | In package.json as |
|---|---|---|
| **Core (always installed)** | nostr-tools, better-sqlite3, pino, yaml, handlebars, zod | `dependencies` |
| **Handler-specific (installed when needed)** | pigpio-client, mongodb, nodemailer, basic-ftp, handler SDKs | `optionalDependencies` |

**Heuristic:** if removing it breaks the app with zero handlers enabled, it's core. If it's only used inside one handler, it's optional.

### Workflow dependencies: rejected

Workflows **cannot** declare npm dependencies. Reasons:

- **Security.** A shared YAML file with `dependencies: [evil-package]` would trigger arbitrary code execution via npm postinstall scripts. This is a supply-chain attack vector.
- **Scope.** Libraries like morse-decoder belong in the handler's dependency manifest, not in user-authored YAML. The handler knows what it needs; the workflow just invokes the handler.

If a workflow needs a library, it goes through a handler that declares that library as its dependency.

## Rationale

- **No surprises.** The user sees exactly what will be installed before it happens. No magic that breaks silently on ARM with cryptic node-gyp errors.
- **Works offline.** After initial setup, enabling/disabling handlers doesn't require internet. Dependencies are already installed or clearly missing.
- **Clear error messages over magic.** "Missing: pigpio-client. Run: npm install pigpio-client" is more helpful than a silent auto-install that fails with a compilation error.
- **Security.** Only handler manifests (shipped with PipeliNostr, reviewed code) declare dependencies. User-authored YAML never triggers package installation.

## Discussion trail

**Reviewer input:**
- devA (package.json:57): "It makes no sense to pull pigpio-client if I'm running pipelinostr on a non-RPi. The same applies to most dependencies."

**Product context:**
PipeliNostr targets two deployment profiles (ADR-001): GPIO-capable SBCs where pigpio matters, and general-purpose machines where it's dead weight. A typical user enables 3-5 handlers out of 45.

**Christophe (product owner) input:**
"I feel like we should relate the dependencies to the handler. I enable gpio handler: it downloads the dependency." — Established the principle of handler-driven dependencies.

Also proposed workflow-level dependencies for libraries like morse-decoder. This was rejected after devC's security review.

**devC review:**
"Auto-install is too risky: non-deterministic builds, ARM compilation failures, no rollback." Proposed the three-tier model (check-and-prompt, install profiles, opt-in flag). "Workflow-level npm dependencies is a hard no — supply-chain attack vector." Recommended clear error messages over magic.

## Related ADRs

- [ADR-010 — Handler registry](010-handler-registry.md): Handlers that fail to load dependencies are marked unavailable (partial availability)
- [ADR-014 — Process lifecycle](014-process-lifecycle.md): Handler init failure doesn't crash the app
