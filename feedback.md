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

### 6. Workaround: forced restart every 15 min for relay disconnects
- Symptom: `relay.snort.social` (and occasionally others) keeps disconnecting/reconnecting in the logs (`"Relay disconnected — auto-reconnect enabled"` lines). Reconnect logic exists but doesn't seem to fully recover the subscription state — long-term, the bot may stop receiving events from flapping relays.
- Temporary workaround installed: a systemd timer that restarts the service every 15 min.
  - `/etc/systemd/system/pipelinostr-restart.service` (oneshot, runs `systemctl restart pipelinostr.service`)
  - `/etc/systemd/system/pipelinostr-restart.timer` (OnBootSec=15min, OnUnitActiveSec=15min)
- Cost: every restart drops ~15-20 s of inbound events.
- Real fix to investigate: relay reconnection logic in `src/inbound/nostr.ts` — likely needs to re-issue REQ subscriptions after a reconnect, and possibly back off failing relays instead of hammering them.
- To remove the workaround:
  - `sudo systemctl disable --now pipelinostr-restart.timer`
  - `sudo rm /etc/systemd/system/pipelinostr-restart.{service,timer}`
  - `sudo systemctl daemon-reload`

## Findings to add during this QA pass

### 7. Regression v2: no admin startup notification (present in v1)
- File: `src/index.ts` (v2) — no `nostr.admin_npub` config field, no startup DM.
- What happened: v2 boots silently. Admin has no way to know the bot is up unless they DM it and wait for a reply.
- Expected: v1 had `sendAdminStartupNotification(adminNpub, nostrDmHandler)` at `src/index.ts:1699-1745` (commit `f4dff92`). At end of `main()` (v1 line 1983-1986), if `config.nostr.admin_npub` was set, it sent a fire-and-forget DM containing: hostname, git branch@commit, network type+name (WiFi SSID or Ethernet), local IPs, public IP, ISO timestamp.
- Fix idea: port `sendAdminStartupNotification` to v2 (uses `nostr_dm` handler, no new handler needed). Helpers required: `getLocalIPs()` (`os.networkInterfaces()`), `getPublicIP()` (HTTP to e.g. `api.ipify.org`), `getNetworkInfo()` (WiFi SSID via `iw`/`nmcli` on Linux, or skip on non-WiFi), `getGitVersion()` (shell out to git in the install dir). Add `nostr.admin_npub` to the config schema. Call after `nostrListener.start()` in v2 `src/index.ts`, gated on the config field, fire-and-forget.
- Priority: low (pure observability). Deferred to next week per user.

<!-- Add new findings below as you test. Suggested format:

### N. Short title
- File / step: ...
- What happened: ...
- Expected: ...
- Fix idea: ...

-->
