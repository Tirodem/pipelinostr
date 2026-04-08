/**
 * PipeliNostr setup wizard
 *
 * Interactive first-run configuration.
 * Guides user through: nostr key, relays, handler selection, secrets.
 * Generates .env + config/config.yml + enabled handler configs.
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import YAML from 'yaml';
import {
  CONFIG_DIR, HANDLERS_CONFIG_DIR,
  ENV_PATH, CONFIG_PATH, WORKFLOWS_DIR, WORKFLOWS_EXAMPLES_DIR, DATA_DIR, LOGS_DIR,
} from '../utils/paths.js';

// --- Handler definitions ---

interface HandlerDef {
  name: string;
  type: string;
  description: string;
  secrets: SecretField[];
  config: Record<string, unknown>;
}

interface SecretField {
  envVar: string;
  prompt: string;
  required: boolean;
}

const HANDLERS: HandlerDef[] = [
  {
    name: 'Telegram',
    type: 'telegram',
    description: 'Send messages via Telegram bot',
    secrets: [
      { envVar: 'TELEGRAM_BOT_TOKEN', prompt: 'Telegram bot token (from @BotFather)', required: true },
      { envVar: 'TELEGRAM_CHAT_ID', prompt: 'Default chat ID (optional)', required: false },
    ],
    config: {
      enabled: true,
      bot_token: 'env:TELEGRAM_BOT_TOKEN',
      default_chat_id: 'env:TELEGRAM_CHAT_ID',
    },
  },
  {
    name: 'Email',
    type: 'email',
    description: 'Send emails via SMTP',
    secrets: [
      { envVar: 'SMTP_HOST', prompt: 'SMTP host (e.g. smtp.gmail.com)', required: true },
      { envVar: 'SMTP_PORT', prompt: 'SMTP port (465 for SSL, 587 for TLS)', required: true },
      { envVar: 'SMTP_USER', prompt: 'SMTP username/email', required: true },
      { envVar: 'SMTP_PASS', prompt: 'SMTP password or app password', required: true },
    ],
    config: {
      enabled: true,
      host: 'env:SMTP_HOST',
      port: 587,
      auth: { user: 'env:SMTP_USER', pass: 'env:SMTP_PASS' },
    },
  },
  {
    name: 'Zulip',
    type: 'zulip',
    description: 'Send messages to Zulip',
    secrets: [
      { envVar: 'ZULIP_SITE_URL', prompt: 'Zulip site URL (e.g. https://your-org.zulipchat.com)', required: true },
      { envVar: 'ZULIP_EMAIL', prompt: 'Zulip bot email', required: true },
      { envVar: 'ZULIP_API_KEY', prompt: 'Zulip API key', required: true },
    ],
    config: {
      enabled: true,
      site_url: 'env:ZULIP_SITE_URL',
      email: 'env:ZULIP_EMAIL',
      api_key: 'env:ZULIP_API_KEY',
    },
  },
  {
    name: 'Mastodon',
    type: 'mastodon',
    description: 'Post toots on Mastodon',
    secrets: [
      { envVar: 'MASTODON_INSTANCE_URL', prompt: 'Instance URL (e.g. https://mastodon.social)', required: true },
      { envVar: 'MASTODON_ACCESS_TOKEN', prompt: 'Access token (from Settings > Development)', required: true },
    ],
    config: {
      enabled: true,
      instance_url: 'env:MASTODON_INSTANCE_URL',
      access_token: 'env:MASTODON_ACCESS_TOKEN',
    },
  },
  {
    name: 'Bluesky',
    type: 'bluesky',
    description: 'Post on Bluesky',
    secrets: [
      { envVar: 'BLUESKY_IDENTIFIER', prompt: 'Bluesky handle (e.g. user.bsky.social)', required: true },
      { envVar: 'BLUESKY_PASSWORD', prompt: 'App password (from Settings > App Passwords)', required: true },
    ],
    config: {
      enabled: true,
      identifier: 'env:BLUESKY_IDENTIFIER',
      password: 'env:BLUESKY_PASSWORD',
    },
  },
  {
    name: 'Discord',
    type: 'discord',
    description: 'Send messages via Discord webhook',
    secrets: [
      { envVar: 'DISCORD_WEBHOOK_URL', prompt: 'Discord webhook URL', required: true },
    ],
    config: {
      enabled: true,
      webhook_url: 'env:DISCORD_WEBHOOK_URL',
    },
  },
  {
    name: 'Slack',
    type: 'slack',
    description: 'Send messages via Slack webhook',
    secrets: [
      { envVar: 'SLACK_WEBHOOK_URL', prompt: 'Slack incoming webhook URL', required: true },
    ],
    config: {
      enabled: true,
      webhook_url: 'env:SLACK_WEBHOOK_URL',
    },
  },
  {
    name: 'Claude (AI)',
    type: 'claude',
    description: 'AI chat via Anthropic API',
    secrets: [
      { envVar: 'ANTHROPIC_API_KEY', prompt: 'Anthropic API key', required: true },
    ],
    config: {
      enabled: true,
      api_key: 'env:ANTHROPIC_API_KEY',
    },
  },
  {
    name: 'GPIO',
    type: 'gpio',
    description: 'Raspberry Pi GPIO control (requires pigpio)',
    secrets: [],
    config: { enabled: true },
  },
  {
    name: 'ntfy',
    type: 'ntfy',
    description: 'Push notifications via ntfy.sh',
    secrets: [
      { envVar: 'NTFY_TOPIC', prompt: 'ntfy topic name', required: true },
    ],
    config: {
      enabled: true,
      server_url: 'https://ntfy.sh',
      default_topic: 'env:NTFY_TOPIC',
    },
  },
];

// Always-available handlers (no secrets needed)
const AUTO_HANDLERS = ['http', 'file', 'nostr_dm', 'nostr_note', 'workflow_db', 'system'];

// --- Readline helper ---

function createPrompt(): { ask: (q: string) => Promise<string>; askSecret: (q: string) => Promise<string>; askYesNo: (q: string, def?: boolean) => Promise<boolean>; close: () => void } {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const ask = (question: string): Promise<string> =>
    new Promise((resolve) => rl.question(question, resolve));

  const askSecret = (question: string): Promise<string> =>
    new Promise((resolve) => {
      // Note: actual masking would need raw mode, this is good enough
      rl.question(question, (answer) => resolve(answer.trim()));
    });

  const askYesNo = async (question: string, defaultYes = true): Promise<boolean> => {
    const hint = defaultYes ? '[Y/n]' : '[y/N]';
    const answer = await ask(`${question} ${hint} `);
    if (!answer) return defaultYes;
    return answer.toLowerCase().startsWith('y');
  };

  const close = () => rl.close();

  return { ask, askSecret, askYesNo, close };
}

// --- Main wizard ---

export async function runSetup(): Promise<void> {
  const prompt = createPrompt();

  console.log(`
\x1b[36m╔══════════════════════════════════════╗
║     PipeliNostr v2 Setup Wizard      ║
╚══════════════════════════════════════╝\x1b[0m
`);

  // Check if already configured
  if (fs.existsSync(CONFIG_PATH)) {
    const overwrite = await prompt.askYesNo('  Config already exists. Overwrite?', false);
    if (!overwrite) {
      console.log('  Setup cancelled.');
      prompt.close();
      return;
    }
  }

  // --- Step 1: Nostr ---
  console.log('\x1b[33m  Step 1/4: Nostr Configuration\x1b[0m\n');

  const privateKey = await prompt.askSecret('  Nostr private key (nsec or hex): ');
  if (!privateKey) {
    console.log('  Private key is required. Setup cancelled.');
    prompt.close();
    return;
  }

  const relaysInput = await prompt.ask('  Relays (comma-separated, or Enter for defaults): ');
  const relays = relaysInput
    ? relaysInput.split(',').map((r) => r.trim()).filter(Boolean)
    : ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.nostr.band', 'wss://nostr.wine', 'wss://relay.snort.social'];

  const whitelistInput = await prompt.ask('  Whitelisted npubs (comma-separated, or * for all): ');
  const whitelist = whitelistInput
    ? whitelistInput.split(',').map((n) => n.trim()).filter(Boolean)
    : ['*'];

  // --- Step 2: Handler selection ---
  console.log('\n\x1b[33m  Step 2/4: Choose Handlers\x1b[0m\n');
  console.log('  Core handlers (always enabled): HTTP, File, Nostr DM, System\n');

  const selectedHandlers: HandlerDef[] = [];

  for (const handler of HANDLERS) {
    const enable = await prompt.askYesNo(`  Enable ${handler.name}? (${handler.description})`);
    if (enable) selectedHandlers.push(handler);
  }

  // --- Step 3: Secrets ---
  const envVars: Record<string, string> = {};
  envVars.NOSTR_PRIVATE_KEY = privateKey;

  if (selectedHandlers.length > 0) {
    console.log('\n\x1b[33m  Step 3/4: Handler Configuration\x1b[0m\n');

    for (const handler of selectedHandlers) {
      if (handler.secrets.length === 0) continue;

      console.log(`\n  \x1b[36m${handler.name}:\x1b[0m`);
      for (const secret of handler.secrets) {
        const value = await prompt.askSecret(`    ${secret.prompt}: `);
        if (value) {
          envVars[secret.envVar] = value;
        } else if (secret.required) {
          console.log(`    Skipped (required) — ${handler.name} may not work.`);
        }
      }
    }
  } else {
    console.log('\n\x1b[33m  Step 3/4: No additional handlers selected, skipping.\x1b[0m');
  }

  // --- Step 4: Queue & Webhook ---
  console.log('\n\x1b[33m  Step 4/4: Advanced Options\x1b[0m\n');

  const enableQueue = await prompt.askYesNo('  Enable event queue? (retry on failure)');
  const enableWebhook = await prompt.askYesNo('  Enable webhook server? (receive HTTP events)', false);
  let webhookPort = 3000;
  if (enableWebhook) {
    const portInput = await prompt.ask('    Webhook port [3000]: ');
    if (portInput) webhookPort = parseInt(portInput, 10) || 3000;
  }

  prompt.close();

  // --- Write files ---
  console.log('\n\x1b[33m  Writing configuration...\x1b[0m\n');

  // Ensure directories
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.mkdirSync(HANDLERS_CONFIG_DIR, { recursive: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(LOGS_DIR, { recursive: true });

  // Write .env
  const envContent = Object.entries(envVars)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n') + '\n';
  fs.writeFileSync(ENV_PATH, envContent, { mode: 0o600 });
  console.log('  Created .env (chmod 600)');

  // Write config.yml
  const config: Record<string, unknown> = {
    nostr: {
      private_key: 'env:NOSTR_PRIVATE_KEY',
      relays,
      whitelist,
    },
    database: {
      path: 'data/pipelinostr.db',
    },
    queue: {
      enabled: enableQueue,
      poll_interval_ms: 1000,
    },
    log_level: 'info',
    max_hook_depth: 10,
  };

  if (enableWebhook) {
    config.webhook = { enabled: true, port: webhookPort };
  }

  fs.writeFileSync(CONFIG_PATH, YAML.stringify(config, { lineWidth: 0 }));
  console.log('  Created config/config.yml');

  // Write handler configs
  for (const type of AUTO_HANDLERS) {
    const handlerConfig = { enabled: true };
    const filePath = path.join(HANDLERS_CONFIG_DIR, `${type}.yml`);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, YAML.stringify(handlerConfig, { lineWidth: 0 }));
    }
  }
  console.log(`  Created ${AUTO_HANDLERS.length} core handler configs`);

  for (const handler of selectedHandlers) {
    const filePath = path.join(HANDLERS_CONFIG_DIR, `${handler.type}.yml`);
    fs.writeFileSync(filePath, YAML.stringify(handler.config, { lineWidth: 0 }));
    console.log(`  Created config/handlers/${handler.type}.yml`);
  }

  // Deploy default workflows: system commands + auto-reply + dpo
  fs.mkdirSync(WORKFLOWS_DIR, { recursive: true });

  const allExamples = fs.existsSync(WORKFLOWS_EXAMPLES_DIR)
    ? fs.readdirSync(WORKFLOWS_EXAMPLES_DIR).filter((f) => f.endsWith('.yml.example'))
    : [];

  // System workflows (pipelinostr-*) + essential workflows deployed enabled
  const defaultEnabled = ['auto-reply', 'dpo-command'];

  for (const example of allExamples) {
    const wfId = example.replace('.yml.example', '');
    const isSystem = wfId.startsWith('pipelinostr-');
    const isDefault = defaultEnabled.includes(wfId);

    if (!isSystem && !isDefault) continue;

    const src = path.join(WORKFLOWS_EXAMPLES_DIR, example);
    const dst = path.join(WORKFLOWS_DIR, `${wfId}.yml`);
    if (fs.existsSync(dst)) continue;

    const content = YAML.parse(fs.readFileSync(src, 'utf-8')) as Record<string, unknown>;
    content.enabled = true;
    fs.writeFileSync(dst, YAML.stringify(content, { lineWidth: 0 }));
  }
  console.log('  Deployed system + default workflows');

  // --- Done ---
  console.log(`
\x1b[32m  Setup complete!\x1b[0m

  Next steps:
    npm run build          Build PipeliNostr
    npm start              Start PipeliNostr

  Manage workflows:
    ./scripts/pipelinostr.sh workflow load-missing
    ./scripts/pipelinostr.sh workflow enable <id>
    ./scripts/pipelinostr.sh workflow list

  Your public key will be displayed at startup.
  Share it so people can send you DMs!
`);
}

// Run if called directly
runSetup().catch(console.error);
