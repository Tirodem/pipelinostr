import { loadConfig, loadHandlerConfig } from './config/loader.js';
import { logger } from './persistence/logger.js';
import { initDatabase, getDatabase } from './persistence/database.js';
import { RelayManager } from './relay/manager.js';
import { NostrListener } from './inbound/nostr-listener.js';
import { WorkflowEngine } from './core/workflow-engine.js';
import { EmailHandler, type EmailHandlerOptions } from './outbound/email.handler.js';
import { HttpHandler } from './outbound/http.handler.js';
import { NostrDmHandler, NostrNoteHandler } from './outbound/nostr.handler.js';
import { TelegramHandler, type TelegramHandlerOptions } from './outbound/telegram.handler.js';
import { SlackHandler, type SlackHandlerOptions } from './outbound/slack.handler.js';
import { ZulipHandler, type ZulipHandlerOptions } from './outbound/zulip.handler.js';
import { WhatsAppHandler, type WhatsAppHandlerOptions } from './outbound/whatsapp.handler.js';
import { SignalHandler, type SignalHandlerOptions } from './outbound/signal.handler.js';
import { DiscordHandler, type DiscordHandlerOptions } from './outbound/discord.handler.js';
import { TwitterHandler, type TwitterHandlerOptions } from './outbound/twitter.handler.js';
import { MatrixHandler, type MatrixHandlerOptions } from './outbound/matrix.handler.js';
import { MastodonHandler, type MastodonHandlerOptions } from './outbound/mastodon.handler.js';
import type { PipelinostrConfig } from './config/schema.js';

interface AppState {
  config: PipelinostrConfig;
  relayManager: RelayManager;
  nostrListener: NostrListener;
  workflowEngine: WorkflowEngine;
  handlers: {
    email?: EmailHandler;
    http: HttpHandler;
    nostrDm: NostrDmHandler;
    nostrNote: NostrNoteHandler;
    telegram?: TelegramHandler;
    slack?: SlackHandler;
    zulip?: ZulipHandler;
    whatsapp?: WhatsAppHandler;
    signal?: SignalHandler;
    discord?: DiscordHandler;
    twitter?: TwitterHandler;
    matrix?: MatrixHandler;
    mastodon?: MastodonHandler;
  };
}

let appState: AppState | null = null;

async function initializeHandlers(
  state: AppState,
  privateKey: string
): Promise<void> {
  // HTTP Handler (always available)
  state.handlers.http = new HttpHandler();
  await state.handlers.http.initialize();
  state.workflowEngine.registerHandler('http', state.handlers.http);

  // Nostr Handlers
  const nostrOptions = {
    privateKey,
    relayManager: state.relayManager,
  };

  state.handlers.nostrDm = new NostrDmHandler(nostrOptions);
  await state.handlers.nostrDm.initialize();
  state.workflowEngine.registerHandler('nostr_dm', state.handlers.nostrDm);

  state.handlers.nostrNote = new NostrNoteHandler(nostrOptions);
  await state.handlers.nostrNote.initialize();
  state.workflowEngine.registerHandler('nostr_note', state.handlers.nostrNote);

  // Email Handler (optional, needs config)
  try {
    interface EmailConfigFile {
      email?: {
        enabled?: boolean;
        smtp?: {
          host: string;
          port: number;
          secure?: boolean;
          auth: { user: string; pass: string };
        };
        from?: { name?: string; address: string };
      };
    }
    const emailConfig = await loadHandlerConfig<EmailConfigFile>('email');
    if (emailConfig?.email?.enabled !== false && emailConfig?.email?.smtp) {
      const smtp = emailConfig.email.smtp;
      const emailOptions: EmailHandlerOptions = {
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure ?? false,
        auth: smtp.auth,
        from: emailConfig.email.from,
      };

      state.handlers.email = new EmailHandler(emailOptions);
      await state.handlers.email.initialize();
      state.workflowEngine.registerHandler('email', state.handlers.email);
      logger.info('Email handler enabled');
    }
  } catch (error) {
    logger.debug('Email handler not configured, skipping');
  }

  // Telegram Handler (optional, needs config)
  try {
    interface TelegramConfigFile {
      telegram?: {
        enabled?: boolean;
        bot_token?: string;
        default_chat_id?: string;
      };
    }
    const telegramConfig = await loadHandlerConfig<TelegramConfigFile>('telegram');
    if (telegramConfig?.telegram?.enabled !== false && telegramConfig?.telegram?.bot_token) {
      const telegramOptions: TelegramHandlerOptions = {
        botToken: telegramConfig.telegram.bot_token,
        defaultChatId: telegramConfig.telegram.default_chat_id,
      };

      state.handlers.telegram = new TelegramHandler(telegramOptions);
      await state.handlers.telegram.initialize();
      state.workflowEngine.registerHandler('telegram', state.handlers.telegram);
      logger.info('Telegram handler enabled');
    }
  } catch (error) {
    logger.debug('Telegram handler not configured, skipping');
  }

  // Slack Handler (optional, needs config)
  try {
    interface SlackConfigFile {
      slack?: {
        enabled?: boolean;
        webhook_url?: string;
        bot_token?: string;
        default_channel?: string;
      };
    }
    const slackConfig = await loadHandlerConfig<SlackConfigFile>('slack');
    if (slackConfig?.slack?.enabled !== false && (slackConfig?.slack?.webhook_url || slackConfig?.slack?.bot_token)) {
      const slackOptions: SlackHandlerOptions = {
        webhookUrl: slackConfig.slack.webhook_url,
        botToken: slackConfig.slack.bot_token,
        defaultChannel: slackConfig.slack.default_channel,
      };

      state.handlers.slack = new SlackHandler(slackOptions);
      await state.handlers.slack.initialize();
      state.workflowEngine.registerHandler('slack', state.handlers.slack);
      logger.info('Slack handler enabled');
    }
  } catch (error) {
    logger.debug('Slack handler not configured, skipping');
  }

  // Zulip Handler (optional, needs config)
  try {
    interface ZulipConfigFile {
      zulip?: {
        enabled?: boolean;
        site_url?: string;
        email?: string;
        api_key?: string;
        default_stream?: string;
        default_topic?: string;
      };
    }
    const zulipConfig = await loadHandlerConfig<ZulipConfigFile>('zulip');
    if (
      zulipConfig?.zulip?.enabled !== false &&
      zulipConfig?.zulip?.site_url &&
      zulipConfig?.zulip?.email &&
      zulipConfig?.zulip?.api_key
    ) {
      const zulipOptions: ZulipHandlerOptions = {
        siteUrl: zulipConfig.zulip.site_url,
        email: zulipConfig.zulip.email,
        apiKey: zulipConfig.zulip.api_key,
        defaultStream: zulipConfig.zulip.default_stream,
        defaultTopic: zulipConfig.zulip.default_topic,
      };

      state.handlers.zulip = new ZulipHandler(zulipOptions);
      await state.handlers.zulip.initialize();
      state.workflowEngine.registerHandler('zulip', state.handlers.zulip);
      logger.info('Zulip handler enabled');
    }
  } catch (error) {
    logger.debug('Zulip handler not configured, skipping');
  }

  // Get handler types used by enabled workflows (for lazy daemon initialization)
  const usedHandlerTypes = state.workflowEngine.getUsedHandlerTypes();

  // WhatsApp Handler (daemon-based, only start if used by workflows)
  if (usedHandlerTypes.has('whatsapp')) {
    try {
      interface WhatsAppConfigFile {
        whatsapp?: {
          enabled?: boolean;
          session_dir?: string;
          headless?: boolean;
          puppeteer_args?: string[];
        };
      }
      const whatsappConfig = await loadHandlerConfig<WhatsAppConfigFile>('whatsapp');
      if (whatsappConfig?.whatsapp?.enabled !== false) {
        const whatsappOptions: WhatsAppHandlerOptions = {
          sessionDir: whatsappConfig?.whatsapp?.session_dir,
          headless: whatsappConfig?.whatsapp?.headless,
          puppeteerArgs: whatsappConfig?.whatsapp?.puppeteer_args,
        };

        logger.info('WhatsApp handler needed by workflows, starting daemon...');
        state.handlers.whatsapp = new WhatsAppHandler(whatsappOptions);
        await state.handlers.whatsapp.initialize();
        state.workflowEngine.registerHandler('whatsapp', state.handlers.whatsapp);
        logger.info('WhatsApp handler enabled (daemon running)');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage }, 'Failed to initialize WhatsApp handler');
    }
  } else {
    logger.debug('WhatsApp handler not used by any workflow, daemon not started');
  }

  // Signal Handler (daemon-based, only start if used by workflows)
  if (usedHandlerTypes.has('signal')) {
    try {
      interface SignalConfigFile {
        signal?: {
          enabled?: boolean;
          phone_number?: string;
          signal_cli_bin?: string;
          config_dir?: string;
        };
      }
      const signalConfig = await loadHandlerConfig<SignalConfigFile>('signal');
      if (signalConfig?.signal?.enabled !== false && signalConfig?.signal?.phone_number) {
        const signalOptions: SignalHandlerOptions = {
          phoneNumber: signalConfig.signal.phone_number,
          signalCliBin: signalConfig.signal.signal_cli_bin,
          configDir: signalConfig.signal.config_dir,
        };

        logger.info('Signal handler needed by workflows, starting daemon...');
        state.handlers.signal = new SignalHandler(signalOptions);
        await state.handlers.signal.initialize();
        state.workflowEngine.registerHandler('signal', state.handlers.signal);
        logger.info('Signal handler enabled (daemon running)');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage }, 'Failed to initialize Signal handler');
    }
  } else {
    logger.debug('Signal handler not used by any workflow, daemon not started');
  }

  // Discord Handler (optional, needs config)
  try {
    interface DiscordConfigFile {
      discord?: {
        enabled?: boolean;
        webhook_url?: string;
        bot_token?: string;
        default_channel_id?: string;
      };
    }
    const discordConfig = await loadHandlerConfig<DiscordConfigFile>('discord');
    if (discordConfig?.discord?.enabled !== false && (discordConfig?.discord?.webhook_url || discordConfig?.discord?.bot_token)) {
      const discordOptions: DiscordHandlerOptions = {
        webhookUrl: discordConfig.discord.webhook_url,
        botToken: discordConfig.discord.bot_token,
        defaultChannelId: discordConfig.discord.default_channel_id,
      };

      state.handlers.discord = new DiscordHandler(discordOptions);
      await state.handlers.discord.initialize();
      state.workflowEngine.registerHandler('discord', state.handlers.discord);
      logger.info('Discord handler enabled');
    }
  } catch (error) {
    logger.debug('Discord handler not configured, skipping');
  }

  // Twitter/X Handler (optional, needs config)
  try {
    interface TwitterConfigFile {
      twitter?: {
        enabled?: boolean;
        api_key?: string;
        api_secret?: string;
        access_token?: string;
        access_token_secret?: string;
      };
    }
    const twitterConfig = await loadHandlerConfig<TwitterConfigFile>('twitter');
    if (
      twitterConfig?.twitter?.enabled !== false &&
      twitterConfig?.twitter?.api_key &&
      twitterConfig?.twitter?.api_secret &&
      twitterConfig?.twitter?.access_token &&
      twitterConfig?.twitter?.access_token_secret
    ) {
      const twitterOptions: TwitterHandlerOptions = {
        apiKey: twitterConfig.twitter.api_key,
        apiSecret: twitterConfig.twitter.api_secret,
        accessToken: twitterConfig.twitter.access_token,
        accessTokenSecret: twitterConfig.twitter.access_token_secret,
      };

      state.handlers.twitter = new TwitterHandler(twitterOptions);
      await state.handlers.twitter.initialize();
      state.workflowEngine.registerHandler('twitter', state.handlers.twitter);
      logger.info('Twitter handler enabled');
    }
  } catch (error) {
    logger.debug('Twitter handler not configured, skipping');
  }

  // Matrix Handler (optional, needs config)
  try {
    interface MatrixConfigFile {
      matrix?: {
        enabled?: boolean;
        homeserver_url?: string;
        access_token?: string;
        default_room_id?: string;
      };
    }
    const matrixConfig = await loadHandlerConfig<MatrixConfigFile>('matrix');
    if (
      matrixConfig?.matrix?.enabled !== false &&
      matrixConfig?.matrix?.homeserver_url &&
      matrixConfig?.matrix?.access_token
    ) {
      const matrixOptions: MatrixHandlerOptions = {
        homeserverUrl: matrixConfig.matrix.homeserver_url,
        accessToken: matrixConfig.matrix.access_token,
        defaultRoomId: matrixConfig.matrix.default_room_id,
      };

      state.handlers.matrix = new MatrixHandler(matrixOptions);
      await state.handlers.matrix.initialize();
      state.workflowEngine.registerHandler('matrix', state.handlers.matrix);
      logger.info('Matrix handler enabled');
    }
  } catch (error) {
    logger.debug('Matrix handler not configured, skipping');
  }

  // Mastodon Handler (optional, needs config)
  try {
    interface MastodonConfigFile {
      mastodon?: {
        enabled?: boolean;
        instance_url?: string;
        access_token?: string;
      };
    }
    const mastodonConfig = await loadHandlerConfig<MastodonConfigFile>('mastodon');
    if (
      mastodonConfig?.mastodon?.enabled !== false &&
      mastodonConfig?.mastodon?.instance_url &&
      mastodonConfig?.mastodon?.access_token
    ) {
      const mastodonOptions: MastodonHandlerOptions = {
        instanceUrl: mastodonConfig.mastodon.instance_url,
        accessToken: mastodonConfig.mastodon.access_token,
      };

      state.handlers.mastodon = new MastodonHandler(mastodonOptions);
      await state.handlers.mastodon.initialize();
      state.workflowEngine.registerHandler('mastodon', state.handlers.mastodon);
      logger.info('Mastodon handler enabled');
    }
  } catch (error) {
    logger.debug('Mastodon handler not configured, skipping');
  }
}

async function main(): Promise<void> {
  logger.info('Starting PipeliNostr...');

  try {
    // Load configuration
    const config = await loadConfig();
    logger.info({ name: config.pipelinostr.name, version: config.pipelinostr.version }, 'Configuration loaded');

    // Validate private key
    const privateKey = config.nostr.private_key;
    if (!privateKey) {
      throw new Error('NOSTR_PRIVATE_KEY is required');
    }

    // Initialize database
    initDatabase(config.database.path);
    logger.info({ path: config.database.path }, 'Database initialized');

    // Initialize relay manager
    const relayManager = new RelayManager({
      primaryRelays: config.relays.primary,
      ...(config.relays.blacklist && { blacklist: config.relays.blacklist }),
      ...(config.relays.quarantine && {
        quarantine: {
          enabled: config.relays.quarantine.enabled,
          ...(config.relays.quarantine.thresholds && { thresholds: config.relays.quarantine.thresholds }),
          ...(config.relays.quarantine.max_quarantine_duration && {
            maxQuarantineDuration: config.relays.quarantine.max_quarantine_duration,
          }),
          ...(config.relays.quarantine.health_check_interval && {
            healthCheckInterval: config.relays.quarantine.health_check_interval,
          }),
        },
      }),
    });
    await relayManager.initialize();

    // Initialize workflow engine
    const workflowEngine = new WorkflowEngine({
      whitelistNpubs: config.whitelist.npubs ?? [],
      ...(config.retry && {
        retryConfig: {
          maxAttempts: config.retry.max_attempts,
          backoff: {
            type: config.retry.backoff.type,
            initialDelayMs: config.retry.backoff.initial_delay_ms,
            multiplier: config.retry.backoff.multiplier ?? 2,
            maxDelayMs: config.retry.backoff.max_delay_ms,
          },
        },
      }),
    });
    await workflowEngine.initialize();

    // Initialize Nostr listener
    const nostrListener = new NostrListener(
      {
        privateKey,
        whitelist: {
          enabled: config.whitelist.enabled,
          npubs: config.whitelist.npubs ?? [],
        },
      },
      relayManager
    );

    // Build app state
    appState = {
      config,
      relayManager,
      nostrListener,
      workflowEngine,
      handlers: {
        http: undefined as unknown as HttpHandler,
        nostrDm: undefined as unknown as NostrDmHandler,
        nostrNote: undefined as unknown as NostrNoteHandler,
      },
    };

    // Initialize handlers
    await initializeHandlers(appState, privateKey);

    // Connect listener to workflow engine
    nostrListener.onEvent(async (event) => {
      logger.debug(
        { eventId: event.id, kind: event.kind, from: event.pubkeyNpub.slice(0, 20) },
        'Event received'
      );

      // Process through workflow engine
      const results = await workflowEngine.processEvent(event);

      if (results.length > 0) {
        for (const result of results) {
          if (result.success) {
            logger.info(
              { workflowId: result.workflowId, actions: result.actionsExecuted },
              'Workflow executed successfully'
            );
          } else {
            logger.error(
              { workflowId: result.workflowId, error: result.error },
              'Workflow execution failed'
            );
          }
        }
      }
    });

    // Start listening
    nostrListener.start();

    // Log stats
    const relayStats = relayManager.getStats();
    const workflowStats = workflowEngine.getStats();
    logger.info(
      {
        relays: `${relayStats.connected}/${relayStats.total}`,
        workflows: `${workflowStats.enabledWorkflows}/${workflowStats.totalWorkflows}`,
        handlers: workflowStats.handlers,
        publicKey: nostrListener.getPublicKeyNpub(),
      },
      'PipeliNostr started successfully'
    );

    // Keep process running
    await new Promise(() => {});
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.fatal({ error: errorMessage }, 'Failed to start PipeliNostr');
    process.exit(1);
  }
}

async function shutdown(): Promise<void> {
  logger.info('Shutting down PipeliNostr...');

  if (appState) {
    // Shutdown handlers
    if (appState.handlers.email) {
      await appState.handlers.email.shutdown();
    }
    if (appState.handlers.telegram) {
      await appState.handlers.telegram.shutdown();
    }
    if (appState.handlers.slack) {
      await appState.handlers.slack.shutdown();
    }
    if (appState.handlers.zulip) {
      await appState.handlers.zulip.shutdown();
    }
    if (appState.handlers.whatsapp) {
      await appState.handlers.whatsapp.shutdown();
    }
    if (appState.handlers.signal) {
      await appState.handlers.signal.shutdown();
    }
    if (appState.handlers.discord) {
      await appState.handlers.discord.shutdown();
    }
    if (appState.handlers.twitter) {
      await appState.handlers.twitter.shutdown();
    }
    if (appState.handlers.matrix) {
      await appState.handlers.matrix.shutdown();
    }
    if (appState.handlers.mastodon) {
      await appState.handlers.mastodon.shutdown();
    }
    await appState.handlers.http.shutdown();
    await appState.handlers.nostrDm.shutdown();
    await appState.handlers.nostrNote.shutdown();

    // Shutdown relay manager
    await appState.relayManager.shutdown();

    // Close database
    getDatabase().close();
  }

  logger.info('PipeliNostr shut down complete');
  process.exit(0);
}

// Graceful shutdown handlers
process.on('SIGINT', () => {
  logger.info('Received SIGINT');
  shutdown();
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM');
  shutdown();
});

process.on('uncaughtException', (error) => {
  logger.fatal({ error: error.message, stack: error.stack }, 'Uncaught exception');
  shutdown();
});

process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Unhandled rejection');
  shutdown();
});

// Start application
main();
