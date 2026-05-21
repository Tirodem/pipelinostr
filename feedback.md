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

## Findings to add during this QA pass

<!-- Add new findings below as you test. Suggested format:

### N. Short title
- File / step: ...
- What happened: ...
- Expected: ...
- Fix idea: ...

-->
