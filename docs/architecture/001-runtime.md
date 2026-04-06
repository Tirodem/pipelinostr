# ADR-001: Runtime choice

**Status:** Accepted
**Date:** 2026-04-06
**Context:** v2 refactor based on devA/devB code review

## Problem

What runtime to use for PipeliNostr v2?

## Options considered

| Option | Pros | Cons |
|--------|------|------|
| **Node.js LTS** | Every npm package works, battle-tested, huge community, already on prod server | Needs `npm install` + build step, no built-in SQLite |
| **Bun** | Built-in SQLite, single binary output, faster startup, built-in test runner | `nostr-tools` "likely fine" (not guaranteed), `pigpio-client` untested, younger ecosystem |

## Decision

**Node.js LTS (currently 22)**

## Rationale

- **Zero risk on critical dependencies across both deployment targets.** PipeliNostr targets two co-equal deployment profiles: (1) GPIO-capable SBCs (Raspberry Pi, Orange Pi) for DIY/IoT use, and (2) general-purpose machines for heavier workloads. The runtime must support both without bifurcation. `nostr-tools` is the backbone of PipeliNostr — "likely fine" on Bun is not engineering, it's hope. `pigpio-client` is the reason Raspberry Pi exists as a deployment target. Losing it doesn't degrade a handler — it eliminates an entire deployment scenario.
- **Startup time is irrelevant.** PipeliNostr is a long-running daemon that starts once and runs for weeks. Bun's 50ms vs Node's 500ms startup is meaningless. Any startup under 10 seconds is acceptable for QA cycles and demos. Both runtimes meet this.
- **Deployment is already solved.** `rebuild.sh` wraps `git pull + npm install + build` in one command. A systemd service makes `systemctl start pipelinostr` equivalent UX to `./pipelinostr`. Single binary distribution is not a current need. Can be evaluated if PipeliNostr is distributed to low-technical DIY users who can't run `rebuild.sh` or set up a service.
- **Migration path stays open.** The codebase is TypeScript either way. Switching to Bun later is mechanical, not architectural.
- **Target current Node.js LTS.** Defer major version upgrades until native dependencies (better-sqlite3) confirm compatibility.

## Discussion trail

**Reviewer input:**
- devA (README:77): "Why not ship a single executable? e.g. bun.com/docs/bundler/executables"
- devA (package.json:57): "It makes no sense to pull pigpio-client if I'm running pipelinostr on [a non-RPi]"

**Product context:**
PipeliNostr targets two co-equal deployment profiles: (1) GPIO-capable SBCs (Raspberry Pi, Orange Pi) for DIY/IoT/lab use — where GPIO integration is the main reason to choose this hardware over a cheaper old computer, and (2) general-purpose machines (old laptops, NUCs, VPS) for heavier workloads without GPIO. One-command deployment is achievable with Node.js through scripts (`rebuild.sh`) or by running PipeliNostr as a systemd service. Core features relying on `nostr-tools` (event signing, NIP-04/NIP-17 encryption, relay communication) and `pigpio-client` (GPIO hardware control on ARM SBCs) have no guaranteed compatibility with Bun. Losing GPIO support would eliminate the first deployment profile entirely — not degrade a feature, but remove a product scenario.

**Claude proposal:**
Initially recommended Bun, citing built-in SQLite, single binary, and faster startup.

**Christophe (product owner) objection:**
"If pigpio-client needs testing and nostr-tools is 'likely fine' only, it's a dev-diva wish, not a real recommendation. If the best move is to take a bet that'll need workarounds, how can this be the best move?"

**Turning point:**
When challenged on sincerity ("And if now I say 'I like Bun', you'll say 'my corrected recommendation: Bun'?"), Claude confirmed the Node.js recommendation stands regardless of preference — driven by the two dependency risks, not by pleasing the product owner.

**Decision:**
Node.js. The single binary concern is valid in theory but irrelevant given the current deployment setup. Can be revisited when PipeliNostr is distributed to low-technical DIY users who can't run `rebuild.sh` or set up a service.
