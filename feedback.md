# PipeliNostr v2 — QA feedback

Branch: `v2-qa` — used to log issues found while testing the v2 install on a fresh VPS.

## Findings so far

### 1. Wizard "Bot npub" screen is confusing
- File: `scripts/setup-wizard.sh:151-152`
- After pasting the bot's nsec, the wizard shows a msgbox `"Bot npub: <npub>"` with only an OK button.
- User read it as an input prompt asking them to paste a npub.
- Fix idea: change title/text to make it explicit, e.g. `"Bot npub (derived from your nsec) — press OK to continue: <npub>"`.

### 2. npm install / npm run build failures are silent during install
- File: `scripts/setup-wizard.sh:1532` and `:1535`
- Both commands redirect stdout+stderr to `/dev/null`. When they fail, the wizard reports "Done!" but `/opt/pipelinostr/dist/` and `/opt/pipelinostr/node_modules/` are missing.
- Symptom: service boot loops with `MODULE_NOT_FOUND` on `dist/index.js`, with no clue why.
- Fix idea: tee output to `/opt/pipelinostr/logs/install.log`, and check the exit code — abort the wizard with a readable error instead of pretending success.
- Same pattern in `scripts/create-service.sh:81` (`npm install --production --silent 2>/dev/null`).

### 3. `ensure_node_and_repo` short-circuit may hide a broken install
- File: `scripts/setup-wizard.sh:1505`
- Skips re-running if `$INSTALL_DIR/node_modules/.package-lock.json` exists. If a prior run left a partial node_modules, this returns early without rebuilding.
- Fix idea: also require `$INSTALL_DIR/dist/index.js` before short-circuiting.

### 4. `npm run build` OOMs on small VPS — no NODE_OPTIONS heap bump
- File: `scripts/setup-wizard.sh:1535`
- On a 416 MB RAM VPS (with 2 GB swap correctly added by `ensure_swap`), `tsc` hit the default Node heap ceiling (~512 MB) and aborted with `FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory`. Swap was barely touched — the abort came from Node's own limit, not the kernel OOM-killer.
- Manual workaround: `NODE_OPTIONS="--max-old-space-size=1024" npm run build` succeeded.
- Fix idea: prefix the wizard's build line with `NODE_OPTIONS="--max-old-space-size=1024"` (or 1536 to be safer). Without this, low-RAM installs silently fail and the service ends up boot-looping with `MODULE_NOT_FOUND` (see finding #2).

### 5. GPIO handler logs noisy warning when no pigpiod present
- Log line: `Unable to connect to pigpiod. No retry timeout option was specified. Verify that daemon is running from localhost:8888.`
- Happens on any non-Raspberry-Pi host where the `gpio` handler is enabled (default in workflows that reference it).
- Cosmetic but spammy on startup.
- Fix idea: in the GPIO handler init, skip connection attempts if `GPIO_DISABLED=1` or if no pigpiod socket is detected, and downgrade the warning.

## Findings to add during this QA pass

<!-- Add new findings below as you test. Suggested format:

### N. Short title
- File / step: ...
- What happened: ...
- Expected: ...
- Fix idea: ...

-->
