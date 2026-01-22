// WebSocket polyfill for Node.js (required by nostr-tools)
import WebSocket from 'ws';
(globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket = WebSocket;

import { networkInterfaces, hostname } from 'os';
import { execSync } from 'child_process';
import { loadConfig, loadHandlerConfig } from './config/loader.js';
import { logger, setLogLevel } from './persistence/logger.js';
import { initDatabase, getDatabase } from './persistence/database.js';
import { RelayManager } from './relay/manager.js';
import { RelayDiscovery } from './relay/discovery.js';
import { NostrListener } from './inbound/nostr-listener.js';
import { WebhookServer, type WebhookServerConfig, type WebhookEvent } from './inbound/webhook-server.js';
import { ApiPollerManager, type ApiPollerManagerConfig, type PollerEvent } from './inbound/api-poller.js';
import { SchedulerManager, type SchedulerManagerConfig, type SchedulerEvent } from './inbound/scheduler.js';
import { WorkflowEngine } from './core/workflow-engine.js';
import { lcdDisplay } from './core/lcd-display.js';
import { createMorseListener, getMorseListener, type MorseDecodedEvent } from './services/morse-listener.js';
import { QueueWorker, enqueueNostrEvent, enqueueWebhookEvent } from './queue/queue-worker.js';
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
import { FileHandler } from './outbound/file.handler.js';
import { FtpHandler } from './outbound/ftp.handler.js';
import { SftpHandler } from './outbound/sftp.handler.js';
import { MongoDbHandler } from './outbound/mongodb.handler.js';
import { MysqlHandler } from './outbound/mysql.handler.js';
import { PostgresHandler } from './outbound/postgres.handler.js';
import { RedisHandler } from './outbound/redis.handler.js';
import { S3Handler } from './outbound/s3.handler.js';
import { BlueskyHandler } from './outbound/bluesky.handler.js';
import { LemmyHandler } from './outbound/lemmy.handler.js';
import { GitHubHandler } from './outbound/github.handler.js';
import { GitLabHandler } from './outbound/gitlab.handler.js';
import { SerialHandler } from './outbound/serial.handler.js';
import { GpioHandler } from './outbound/gpio.handler.js';
import { MqttHandler } from './outbound/mqtt.handler.js';
import { BleHandler } from './outbound/ble.handler.js';
import { UsbHidHandler } from './outbound/usb-hid.handler.js';
import { UsbPowerHandler } from './outbound/usb-power.handler.js';
import { I2cHandler } from './outbound/i2c.handler.js';
import { TraccarSmsHandler, type TraccarSmsHandlerOptions } from './outbound/traccar-sms.handler.js';
import { CalendarHandler, type CalendarHandlerOptions } from './outbound/calendar.handler.js';
import { BeBopHandler } from './outbound/bebop.handler.js';
import { OdooHandler, type OdooConfig } from './outbound/odoo.handler.js';
import { TTSHandler } from './outbound/tts.handler.js';
import { MorseAudioHandler } from './outbound/morse-audio.handler.js';
import { DPOHandler } from './outbound/dpo.handler.js';
import { ClaudeHandler, type ClaudeHandlerOptions } from './outbound/claude.handler.js';
import { WorkflowActivatorHandler } from './outbound/workflow-activator.handler.js';
import { SystemHandler } from './outbound/system.handler.js';
import { WorkflowDbHandler } from './outbound/workflow-db.handler.js';
import { QueueHandler } from './outbound/queue.handler.js';
import { WalletHandler, type WalletHandlerConfig } from './outbound/wallet.handler.js';
import type { PipelinostrConfig } from './config/schema.js';

interface AppState {
  config: PipelinostrConfig;
  relayManager: RelayManager;
  nostrListener: NostrListener;
  workflowEngine: WorkflowEngine;
  // Queue worker
  queueWorker?: QueueWorker | undefined;
  queueEnabled: boolean;
  // Relay discovery
  relayDiscovery?: RelayDiscovery | undefined;
  // Inbound handlers
  webhookServer?: WebhookServer;
  apiPoller?: ApiPollerManager;
  scheduler?: SchedulerManager;
  // Outbound handlers
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
    file?: FileHandler;
    ftp?: FtpHandler;
    sftp?: SftpHandler;
    mongodb?: MongoDbHandler;
    mysql?: MysqlHandler;
    postgres?: PostgresHandler;
    redis?: RedisHandler;
    s3?: S3Handler;
    bluesky?: BlueskyHandler;
    lemmy?: LemmyHandler;
    github?: GitHubHandler;
    gitlab?: GitLabHandler;
    serial?: SerialHandler;
    gpio?: GpioHandler;
    mqtt?: MqttHandler;
    ble?: BleHandler;
    usbHid?: UsbHidHandler;
    usbPower?: UsbPowerHandler;
    i2c?: I2cHandler;
    traccarSms?: TraccarSmsHandler;
    calendar?: CalendarHandler;
    bebop?: BeBopHandler;
    odoo?: OdooHandler;
    tts?: TTSHandler;
    morseAudio?: MorseAudioHandler;
    dpo?: DPOHandler;
    claude?: ClaudeHandler;
    workflowActivator?: WorkflowActivatorHandler;
    system?: SystemHandler;
    workflowDb?: WorkflowDbHandler;
    queue?: QueueHandler;
    wallet?: WalletHandler;
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
    dm_format: state.config.nostr.dm_format ?? 'nip04',  // 'nip04' (default) or 'nip17'
    dm_reply_match_format: state.config.nostr.dm_reply_match_format ?? true,  // Reply in same format as received
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

  // File Handler (optional, needs config)
  try {
    interface FileConfigFile {
      file?: {
        enabled?: boolean;
        output_dir?: string;
        max_file_size_mb?: number;
        allowed_formats?: string[];
      };
    }
    const fileConfig = await loadHandlerConfig<FileConfigFile>('file');
    if (fileConfig?.file?.enabled !== false) {
      state.handlers.file = new FileHandler({
        enabled: true,
        output_dir: fileConfig?.file?.output_dir || './data/files',
        max_file_size_mb: fileConfig?.file?.max_file_size_mb || 10,
        allowed_formats: fileConfig?.file?.allowed_formats || ['text', 'json', 'csv', 'binary'],
      });
      await state.handlers.file.initialize();
      state.workflowEngine.registerHandler('file', state.handlers.file);
      logger.info('File handler enabled');
    }
  } catch (error) {
    logger.debug('File handler not configured, skipping');
  }

  // FTP Handler (optional, needs config)
  try {
    interface FtpConfigFile {
      ftp?: {
        enabled?: boolean;
        host?: string;
        port?: number;
        user?: string;
        password?: string;
        secure?: boolean;
        timeout?: number;
      };
    }
    const ftpConfig = await loadHandlerConfig<FtpConfigFile>('ftp');
    if (
      ftpConfig?.ftp?.enabled !== false &&
      ftpConfig?.ftp?.host &&
      ftpConfig?.ftp?.user &&
      ftpConfig?.ftp?.password
    ) {
      state.handlers.ftp = new FtpHandler({
        enabled: true,
        host: ftpConfig.ftp.host,
        port: ftpConfig.ftp.port || 21,
        user: ftpConfig.ftp.user,
        password: ftpConfig.ftp.password,
        secure: ftpConfig.ftp.secure || false,
        timeout: ftpConfig.ftp.timeout || 30000,
      });
      await state.handlers.ftp.initialize();
      state.workflowEngine.registerHandler('ftp', state.handlers.ftp);
      logger.info('FTP handler enabled');
    }
  } catch (error) {
    logger.debug('FTP handler not configured, skipping');
  }

  // SFTP Handler (optional, needs config)
  try {
    interface SftpConfigFile {
      sftp?: {
        enabled?: boolean;
        host?: string;
        port?: number;
        username?: string;
        password?: string;
        private_key_path?: string;
        passphrase?: string;
        timeout?: number;
      };
    }
    const sftpConfig = await loadHandlerConfig<SftpConfigFile>('sftp');
    if (
      sftpConfig?.sftp?.enabled !== false &&
      sftpConfig?.sftp?.host &&
      sftpConfig?.sftp?.username &&
      (sftpConfig?.sftp?.password || sftpConfig?.sftp?.private_key_path)
    ) {
      state.handlers.sftp = new SftpHandler({
        enabled: true,
        host: sftpConfig.sftp.host,
        port: sftpConfig.sftp.port || 22,
        username: sftpConfig.sftp.username,
        password: sftpConfig.sftp.password,
        private_key_path: sftpConfig.sftp.private_key_path,
        passphrase: sftpConfig.sftp.passphrase,
        timeout: sftpConfig.sftp.timeout || 30000,
      });
      await state.handlers.sftp.initialize();
      state.workflowEngine.registerHandler('sftp', state.handlers.sftp);
      logger.info('SFTP handler enabled');
    }
  } catch (error) {
    logger.debug('SFTP handler not configured, skipping');
  }

  // MongoDB Handler (optional, needs config)
  logger.debug('Attempting to load MongoDB config...');
  try {
    interface MongoDbConfigFile {
      mongodb?: {
        enabled?: boolean;
        connection_string?: string;
        database?: string;
        default_collection?: string;
      };
    }
    const mongodbConfig = await loadHandlerConfig<MongoDbConfigFile>('mongodb');
    logger.debug({ configLoaded: !!mongodbConfig }, 'MongoDB config loaded');
    logger.debug({
      hasConfig: !!mongodbConfig,
      hasMongodbSection: !!mongodbConfig?.mongodb,
      enabled: mongodbConfig?.mongodb?.enabled,
      hasConnectionString: !!mongodbConfig?.mongodb?.connection_string,
      connectionStringValue: mongodbConfig?.mongodb?.connection_string ? '[REDACTED]' : 'undefined'
    }, 'MongoDB config debug');
    if (
      mongodbConfig?.mongodb?.enabled !== false &&
      mongodbConfig?.mongodb?.connection_string
    ) {
      logger.debug('Creating MongoDB handler...');
      state.handlers.mongodb = new MongoDbHandler({
        enabled: true,
        connection_string: mongodbConfig.mongodb.connection_string,
        database: mongodbConfig.mongodb.database || 'pipelinostr',
        default_collection: mongodbConfig.mongodb.default_collection || 'nostr_events',
      });
      logger.debug('Connecting to MongoDB...');
      await state.handlers.mongodb.initialize();
      state.workflowEngine.registerHandler('mongodb', state.handlers.mongodb);
      logger.info('MongoDB handler enabled');
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    logger.warn({ error: errorMessage, stack: errorStack, errorType: typeof error }, 'MongoDB handler failed to initialize');
  }

  // MySQL Handler (optional, needs config)
  try {
    interface MysqlConfigFile {
      mysql?: {
        enabled?: boolean;
        host?: string;
        port?: number;
        user?: string;
        password?: string;
        database?: string;
        connection_limit?: number;
        default_table?: string;
      };
    }
    const mysqlConfig = await loadHandlerConfig<MysqlConfigFile>('mysql');
    if (
      mysqlConfig?.mysql?.enabled !== false &&
      mysqlConfig?.mysql?.host &&
      mysqlConfig?.mysql?.user &&
      mysqlConfig?.mysql?.password &&
      mysqlConfig?.mysql?.database
    ) {
      state.handlers.mysql = new MysqlHandler({
        enabled: true,
        host: mysqlConfig.mysql.host,
        port: mysqlConfig.mysql.port || 3306,
        user: mysqlConfig.mysql.user,
        password: mysqlConfig.mysql.password,
        database: mysqlConfig.mysql.database,
        connection_limit: mysqlConfig.mysql.connection_limit || 10,
        default_table: mysqlConfig.mysql.default_table || 'nostr_events',
      });
      await state.handlers.mysql.initialize();
      state.workflowEngine.registerHandler('mysql', state.handlers.mysql);
      logger.info('MySQL handler enabled');
    }
  } catch (error) {
    logger.debug('MySQL handler not configured, skipping');
  }

  // PostgreSQL Handler (optional, needs config)
  try {
    interface PostgresConfigFile {
      postgres?: {
        enabled?: boolean;
        host?: string;
        port?: number;
        user?: string;
        password?: string;
        database?: string;
        ssl?: boolean;
        max_connections?: number;
        default_table?: string;
      };
    }
    const postgresConfig = await loadHandlerConfig<PostgresConfigFile>('postgres');
    if (
      postgresConfig?.postgres?.enabled !== false &&
      postgresConfig?.postgres?.host &&
      postgresConfig?.postgres?.user &&
      postgresConfig?.postgres?.password &&
      postgresConfig?.postgres?.database
    ) {
      state.handlers.postgres = new PostgresHandler({
        enabled: true,
        host: postgresConfig.postgres.host,
        port: postgresConfig.postgres.port || 5432,
        user: postgresConfig.postgres.user,
        password: postgresConfig.postgres.password,
        database: postgresConfig.postgres.database,
        ssl: postgresConfig.postgres.ssl || false,
        max_connections: postgresConfig.postgres.max_connections || 10,
        default_table: postgresConfig.postgres.default_table || 'nostr_events',
      });
      await state.handlers.postgres.initialize();
      state.workflowEngine.registerHandler('postgres', state.handlers.postgres);
      logger.info('PostgreSQL handler enabled');
    }
  } catch (error) {
    logger.debug('PostgreSQL handler not configured, skipping');
  }

  // Redis Handler (optional, needs config)
  try {
    interface RedisConfigFile {
      redis?: {
        enabled?: boolean;
        url?: string;
        password?: string;
        database?: number;
        key_prefix?: string;
      };
    }
    const redisConfig = await loadHandlerConfig<RedisConfigFile>('redis');
    if (redisConfig?.redis?.enabled !== false && redisConfig?.redis?.url) {
      state.handlers.redis = new RedisHandler({
        enabled: true,
        url: redisConfig.redis.url,
        password: redisConfig.redis.password,
        database: redisConfig.redis.database || 0,
        key_prefix: redisConfig.redis.key_prefix || 'pipelinostr',
      });
      await state.handlers.redis.initialize();
      state.workflowEngine.registerHandler('redis', state.handlers.redis);
      logger.info('Redis handler enabled');
    }
  } catch (error) {
    logger.debug('Redis handler not configured, skipping');
  }

  // S3 Handler (optional, needs config)
  try {
    interface S3ConfigFile {
      s3?: {
        enabled?: boolean;
        endpoint?: string;
        region?: string;
        access_key_id?: string;
        secret_access_key?: string;
        bucket?: string;
        force_path_style?: boolean;
        public_url_base?: string;
      };
    }
    const s3Config = await loadHandlerConfig<S3ConfigFile>('s3');
    if (
      s3Config?.s3?.enabled !== false &&
      s3Config?.s3?.access_key_id &&
      s3Config?.s3?.secret_access_key &&
      s3Config?.s3?.bucket
    ) {
      state.handlers.s3 = new S3Handler({
        enabled: true,
        endpoint: s3Config.s3.endpoint,
        region: s3Config.s3.region || 'us-east-1',
        access_key_id: s3Config.s3.access_key_id,
        secret_access_key: s3Config.s3.secret_access_key,
        bucket: s3Config.s3.bucket,
        force_path_style: s3Config.s3.force_path_style,
        public_url_base: s3Config.s3.public_url_base,
      });
      await state.handlers.s3.initialize();
      state.workflowEngine.registerHandler('s3', state.handlers.s3);
      logger.info('S3 handler enabled');
    }
  } catch (error) {
    logger.debug('S3 handler not configured, skipping');
  }

  // Bluesky Handler (optional, needs config)
  try {
    interface BlueskyConfigFile {
      bluesky?: {
        enabled?: boolean;
        service?: string;
        identifier?: string;
        password?: string;
      };
    }
    const blueskyConfig = await loadHandlerConfig<BlueskyConfigFile>('bluesky');
    if (
      blueskyConfig?.bluesky?.enabled !== false &&
      blueskyConfig?.bluesky?.identifier &&
      blueskyConfig?.bluesky?.password
    ) {
      state.handlers.bluesky = new BlueskyHandler({
        enabled: true,
        service: blueskyConfig.bluesky.service || 'https://bsky.social',
        identifier: blueskyConfig.bluesky.identifier,
        password: blueskyConfig.bluesky.password,
      });
      await state.handlers.bluesky.initialize();
      state.workflowEngine.registerHandler('bluesky', state.handlers.bluesky);
      logger.info('Bluesky handler enabled');
    }
  } catch (error) {
    logger.debug('Bluesky handler not configured, skipping');
  }

  // Lemmy Handler (optional, needs config)
  try {
    interface LemmyConfigFile {
      lemmy?: {
        enabled?: boolean;
        instance_url?: string;
        username?: string;
        password?: string;
        default_community?: string;
      };
    }
    const lemmyConfig = await loadHandlerConfig<LemmyConfigFile>('lemmy');
    if (
      lemmyConfig?.lemmy?.enabled !== false &&
      lemmyConfig?.lemmy?.instance_url &&
      lemmyConfig?.lemmy?.username &&
      lemmyConfig?.lemmy?.password
    ) {
      state.handlers.lemmy = new LemmyHandler({
        enabled: true,
        instance_url: lemmyConfig.lemmy.instance_url,
        username: lemmyConfig.lemmy.username,
        password: lemmyConfig.lemmy.password,
        default_community: lemmyConfig.lemmy.default_community,
      });
      await state.handlers.lemmy.initialize();
      state.workflowEngine.registerHandler('lemmy', state.handlers.lemmy);
      logger.info('Lemmy handler enabled');
    }
  } catch (error) {
    logger.debug('Lemmy handler not configured, skipping');
  }

  // GitHub Handler (optional, needs config)
  try {
    interface GitHubConfigFile {
      github?: {
        enabled?: boolean;
        token?: string;
        api_url?: string;
        default_owner?: string;
        default_repo?: string;
      };
    }
    const githubConfig = await loadHandlerConfig<GitHubConfigFile>('github');
    if (
      githubConfig?.github?.enabled !== false &&
      githubConfig?.github?.token
    ) {
      state.handlers.github = new GitHubHandler({
        enabled: true,
        token: githubConfig.github.token,
        api_url: githubConfig.github.api_url,
        default_owner: githubConfig.github.default_owner,
        default_repo: githubConfig.github.default_repo,
      });
      await state.handlers.github.initialize();
      state.workflowEngine.registerHandler('github', state.handlers.github);
      logger.info('GitHub handler enabled');
    }
  } catch (error) {
    logger.debug('GitHub handler not configured, skipping');
  }

  // GitLab Handler (optional, needs config)
  try {
    interface GitLabConfigFile {
      gitlab?: {
        enabled?: boolean;
        token?: string;
        api_url?: string;
        default_project?: string;
      };
    }
    const gitlabConfig = await loadHandlerConfig<GitLabConfigFile>('gitlab');
    if (
      gitlabConfig?.gitlab?.enabled !== false &&
      gitlabConfig?.gitlab?.token
    ) {
      state.handlers.gitlab = new GitLabHandler({
        enabled: true,
        token: gitlabConfig.gitlab.token,
        api_url: gitlabConfig.gitlab.api_url,
        default_project: gitlabConfig.gitlab.default_project,
      });
      await state.handlers.gitlab.initialize();
      state.workflowEngine.registerHandler('gitlab', state.handlers.gitlab);
      logger.info('GitLab handler enabled');
    }
  } catch (error) {
    logger.debug('GitLab handler not configured, skipping');
  }

  // Serial Handler (optional, needs config)
  try {
    interface SerialConfigFile {
      serial?: {
        enabled?: boolean;
        port?: string;
        baudrate?: number;
        databits?: 5 | 6 | 7 | 8;
        stopbits?: 1 | 1.5 | 2;
        parity?: 'none' | 'even' | 'odd' | 'mark' | 'space';
        rtscts?: boolean;
        xon?: boolean;
        xoff?: boolean;
      };
    }
    const serialConfig = await loadHandlerConfig<SerialConfigFile>('serial');
    if (
      serialConfig?.serial?.enabled !== false &&
      serialConfig?.serial?.port
    ) {
      state.handlers.serial = new SerialHandler({
        enabled: true,
        port: serialConfig.serial.port,
        baudrate: serialConfig.serial.baudrate,
        databits: serialConfig.serial.databits,
        stopbits: serialConfig.serial.stopbits,
        parity: serialConfig.serial.parity,
        rtscts: serialConfig.serial.rtscts,
        xon: serialConfig.serial.xon,
        xoff: serialConfig.serial.xoff,
      });
      await state.handlers.serial.initialize();
      state.workflowEngine.registerHandler('serial', state.handlers.serial);
      logger.info('Serial handler enabled');
    }
  } catch (error) {
    logger.debug('Serial handler not configured, skipping');
  }

  // GPIO Handler (optional, needs config)
  try {
    interface GpioConfigFile {
      gpio?: {
        enabled?: boolean;
        pins?: Record<string, number>;
        default_direction?: 'in' | 'out';
        active_low?: boolean;
      };
    }
    const gpioConfig = await loadHandlerConfig<GpioConfigFile>('gpio');
    if (gpioConfig?.gpio?.enabled !== false) {
      state.handlers.gpio = new GpioHandler({
        enabled: true,
        pins: gpioConfig?.gpio?.pins,
        default_direction: gpioConfig?.gpio?.default_direction,
        active_low: gpioConfig?.gpio?.active_low,
      });
      await state.handlers.gpio.initialize();
      state.workflowEngine.registerHandler('gpio', state.handlers.gpio);
      logger.info('GPIO handler enabled');
    }
  } catch (error) {
    logger.debug('GPIO handler not configured, skipping');
  }

  // MQTT Handler (optional, needs config)
  try {
    interface MqttConfigFile {
      mqtt?: {
        enabled?: boolean;
        broker_url?: string;
        username?: string;
        password?: string;
        client_id?: string;
        keepalive?: number;
        clean?: boolean;
        reconnect_period?: number;
        connect_timeout?: number;
        default_topic?: string;
        topic_prefix?: string;
      };
    }
    const mqttConfig = await loadHandlerConfig<MqttConfigFile>('mqtt');
    if (
      mqttConfig?.mqtt?.enabled !== false &&
      mqttConfig?.mqtt?.broker_url
    ) {
      state.handlers.mqtt = new MqttHandler({
        enabled: true,
        broker_url: mqttConfig.mqtt.broker_url,
        username: mqttConfig.mqtt.username,
        password: mqttConfig.mqtt.password,
        client_id: mqttConfig.mqtt.client_id,
        keepalive: mqttConfig.mqtt.keepalive,
        clean: mqttConfig.mqtt.clean,
        reconnect_period: mqttConfig.mqtt.reconnect_period,
        connect_timeout: mqttConfig.mqtt.connect_timeout,
        default_topic: mqttConfig.mqtt.default_topic,
        topic_prefix: mqttConfig.mqtt.topic_prefix,
      });
      await state.handlers.mqtt.initialize();
      state.workflowEngine.registerHandler('mqtt', state.handlers.mqtt);
      logger.info('MQTT handler enabled');
    }
  } catch (error) {
    logger.debug('MQTT handler not configured, skipping');
  }

  // BLE Handler (optional, needs config)
  try {
    interface BleConfigFile {
      ble?: {
        enabled?: boolean;
        devices?: Record<string, {
          address?: string;
          service_uuid?: string;
          characteristic_uuid?: string;
        }>;
        scan_timeout?: number;
        connect_timeout?: number;
      };
    }
    const bleConfig = await loadHandlerConfig<BleConfigFile>('ble');
    if (bleConfig?.ble?.enabled !== false) {
      state.handlers.ble = new BleHandler({
        enabled: true,
        devices: bleConfig?.ble?.devices,
        scan_timeout: bleConfig?.ble?.scan_timeout,
        connect_timeout: bleConfig?.ble?.connect_timeout,
      });
      await state.handlers.ble.initialize();
      state.workflowEngine.registerHandler('ble', state.handlers.ble);
      logger.info('BLE handler enabled');
    }
  } catch (error) {
    logger.debug('BLE handler not configured, skipping');
  }

  // USB HID Handler (optional, needs config)
  try {
    interface UsbHidConfigFile {
      usb_hid?: {
        enabled?: boolean;
        devices?: Record<string, {
          vendor_id: number;
          product_id: number;
          usage_page?: number;
          usage?: number;
          interface_number?: number;
        }>;
      };
    }
    const usbHidConfig = await loadHandlerConfig<UsbHidConfigFile>('usb-hid');
    if (usbHidConfig?.usb_hid?.enabled !== false) {
      state.handlers.usbHid = new UsbHidHandler({
        enabled: true,
        devices: usbHidConfig?.usb_hid?.devices,
      });
      await state.handlers.usbHid.initialize();
      state.workflowEngine.registerHandler('usb_hid', state.handlers.usbHid);
      logger.info('USB HID handler enabled');
    }
  } catch (error) {
    logger.debug('USB HID handler not configured, skipping');
  }

  // I2C Handler (optional, needs config)
  try {
    interface I2cConfigFile {
      i2c?: {
        enabled?: boolean;
        bus_number?: number;
        devices?: Record<string, {
          address: number;
          description?: string;
        }>;
      };
    }
    const i2cConfig = await loadHandlerConfig<I2cConfigFile>('i2c');
    if (i2cConfig?.i2c?.enabled !== false) {
      state.handlers.i2c = new I2cHandler({
        enabled: true,
        bus_number: i2cConfig?.i2c?.bus_number,
        devices: i2cConfig?.i2c?.devices,
      });
      await state.handlers.i2c.initialize();
      state.workflowEngine.registerHandler('i2c', state.handlers.i2c);
      logger.info('I2C handler enabled');
    }
  } catch (error) {
    logger.debug('I2C handler not configured, skipping');
  }

  // USB Power Handler (optional, needs config)
  try {
    interface UsbPowerConfigFile {
      usb_power?: {
        enabled?: boolean;
        default_hub?: string;
        ports?: Record<string, { hub: string; port: number }>;
      };
    }
    const usbPowerConfig = await loadHandlerConfig<UsbPowerConfigFile>('usb-power');
    if (usbPowerConfig?.usb_power?.enabled !== false) {
      state.handlers.usbPower = new UsbPowerHandler({
        enabled: true,
        default_hub: usbPowerConfig?.usb_power?.default_hub,
        ports: usbPowerConfig?.usb_power?.ports,
      });
      await state.handlers.usbPower.initialize();
      state.workflowEngine.registerHandler('usb_power', state.handlers.usbPower);
      logger.info('USB Power handler enabled');
    }
  } catch (error) {
    logger.debug('USB Power handler not configured, skipping');
  }

  // Traccar SMS Handler (optional, needs config)
  try {
    interface TraccarSmsConfigFile {
      traccar_sms?: {
        enabled?: boolean;
        gateway_url?: string;
        token?: string;
        default_sender?: string;
      };
    }
    const traccarSmsConfig = await loadHandlerConfig<TraccarSmsConfigFile>('traccar-sms');
    if (
      traccarSmsConfig?.traccar_sms?.enabled !== false &&
      traccarSmsConfig?.traccar_sms?.gateway_url &&
      traccarSmsConfig?.traccar_sms?.token
    ) {
      const traccarSmsOptions: TraccarSmsHandlerOptions = {
        gatewayUrl: traccarSmsConfig.traccar_sms.gateway_url,
        token: traccarSmsConfig.traccar_sms.token,
        defaultSender: traccarSmsConfig.traccar_sms.default_sender,
      };

      state.handlers.traccarSms = new TraccarSmsHandler(traccarSmsOptions);
      await state.handlers.traccarSms.initialize();
      state.workflowEngine.registerHandler('traccar_sms', state.handlers.traccarSms);
      logger.info('Traccar SMS handler enabled');
    }
  } catch (error) {
    logger.debug('Traccar SMS handler not configured, skipping');
  }

  // Calendar Handler
  try {
    const calendarConfig = await loadHandlerConfig<{
      calendar: {
        enabled: boolean;
        host: string;
        port: number;
        secure?: boolean;
        auth: { user: string; pass: string };
        from?: { name?: string; address: string };
        organizer?: { name?: string; email: string };
      };
    }>('calendar');

    if (calendarConfig?.calendar?.enabled) {
      const cal = calendarConfig.calendar;
      const calendarOptions: CalendarHandlerOptions = {
        host: cal.host,
        port: cal.port,
        secure: cal.secure,
        auth: cal.auth,
        from: cal.from,
        organizer: cal.organizer,
      };

      state.handlers.calendar = new CalendarHandler(calendarOptions);
      await state.handlers.calendar.initialize();
      state.workflowEngine.registerHandler('calendar', state.handlers.calendar);
      logger.info('Calendar handler enabled');
    }
  } catch (error) {
    logger.debug('Calendar handler not configured, skipping');
  }

  // be-BOP Parser Handler (always available, no config needed)
  state.handlers.bebop = new BeBopHandler();
  await state.handlers.bebop.initialize();
  state.workflowEngine.registerHandler('bebop_parser', state.handlers.bebop);
  logger.info('be-BOP parser handler enabled');

  // Odoo Handler (optional, needs config)
  try {
    interface OdooConfigFile {
      odoo?: {
        enabled?: boolean;
        url?: string;
        database?: string;
        username?: string;
        api_key?: string;
        default_partner_id?: number;
        default_partner_name?: string;
      };
    }
    const odooConfig = await loadHandlerConfig<OdooConfigFile>('odoo');
    if (
      odooConfig?.odoo?.enabled !== false &&
      odooConfig?.odoo?.url &&
      odooConfig?.odoo?.database &&
      odooConfig?.odoo?.username &&
      odooConfig?.odoo?.api_key
    ) {
      const odooOptions: OdooConfig = {
        url: odooConfig.odoo.url,
        database: odooConfig.odoo.database,
        username: odooConfig.odoo.username,
        api_key: odooConfig.odoo.api_key,
      };
      if (odooConfig.odoo.default_partner_id !== undefined) {
        odooOptions.default_partner_id = odooConfig.odoo.default_partner_id;
      }
      if (odooConfig.odoo.default_partner_name !== undefined) {
        odooOptions.default_partner_name = odooConfig.odoo.default_partner_name;
      }

      state.handlers.odoo = new OdooHandler(odooOptions);
      await state.handlers.odoo.initialize();
      state.workflowEngine.registerHandler('odoo', state.handlers.odoo);
      logger.info('Odoo handler enabled');
    }
  } catch (error) {
    logger.debug('Odoo handler not configured, skipping');
  }

  // TTS Handler (optional, needs config)
  try {
    interface TTSConfigFile {
      tts?: {
        enabled?: boolean;
        engine?: 'piper' | 'espeak';
        piper_path?: string;
        piper_model?: string;
        espeak_voice?: string;
        output_dir?: string;
      };
    }
    const ttsConfig = await loadHandlerConfig<TTSConfigFile>('tts');
    if (ttsConfig?.tts?.enabled !== false) {
      state.handlers.tts = new TTSHandler({
        engine: ttsConfig?.tts?.engine ?? 'piper',
        piperPath: ttsConfig?.tts?.piper_path,
        piperModel: ttsConfig?.tts?.piper_model,
        espeakVoice: ttsConfig?.tts?.espeak_voice,
        outputDir: ttsConfig?.tts?.output_dir,
      });
      await state.handlers.tts.initialize();
      state.workflowEngine.registerHandler('tts', state.handlers.tts);
      logger.info('TTS handler enabled');
    }
  } catch (error) {
    logger.debug('TTS handler not configured, skipping');
  }

  // Morse Audio Handler (always available, no config needed)
  state.handlers.morseAudio = new MorseAudioHandler({
    outputDir: './data/morse-audio',
  });
  await state.handlers.morseAudio.initialize();
  state.workflowEngine.registerHandler('morse_audio', state.handlers.morseAudio);
  logger.info('Morse Audio handler enabled');

  // DPO Report Handler (always available, no config needed)
  state.handlers.dpo = new DPOHandler();
  await state.handlers.dpo.initialize();
  state.workflowEngine.registerHandler('dpo_report', state.handlers.dpo);
  logger.info('DPO report handler enabled');

  // Claude Handler (optional, needs API key)
  try {
    interface ClaudeConfigFile {
      claude?: {
        enabled?: boolean;
        api_key?: string;
        model?: string;
        max_tokens?: number;
        allowed_handlers?: string[];
      };
    }
    const claudeConfig = await loadHandlerConfig<ClaudeConfigFile>('claude');
    if (
      claudeConfig?.claude?.enabled !== false &&
      claudeConfig?.claude?.api_key
    ) {
      const claudeOptions: ClaudeHandlerOptions = {
        apiKey: claudeConfig.claude.api_key,
        model: claudeConfig.claude.model,
        maxTokens: claudeConfig.claude.max_tokens,
        allowedHandlers: claudeConfig.claude.allowed_handlers,
      };

      state.handlers.claude = new ClaudeHandler(claudeOptions);
      await state.handlers.claude.initialize();
      state.workflowEngine.registerHandler('claude', state.handlers.claude);
      logger.info({ model: claudeConfig.claude.model ?? 'claude-3-5-sonnet-20241022' }, 'Claude handler enabled');
    }
  } catch (error) {
    logger.debug('Claude handler not configured, skipping');
  }

  // Workflow Activator Handler (always available, works with Claude handler)
  state.handlers.workflowActivator = new WorkflowActivatorHandler();
  await state.handlers.workflowActivator.initialize();
  state.workflowEngine.registerHandler('workflow_activator', state.handlers.workflowActivator);
  logger.info('Workflow activator handler enabled');

  // System Handler (always available, provides system status)
  state.handlers.system = new SystemHandler({ workflowsDir: './config/workflows' });
  await state.handlers.system.initialize();
  // Pass registered handler names for status reporting
  state.handlers.system.setRegisteredHandlers(Array.from(state.workflowEngine.getStats().handlers));
  state.workflowEngine.registerHandler('system', state.handlers.system);
  logger.info('System handler enabled');

  // Workflow DB Handler (always available, provides persistent state for workflows)
  state.handlers.workflowDb = new WorkflowDbHandler({ enabled: true });
  await state.handlers.workflowDb.initialize();
  state.workflowEngine.registerHandler('workflow_db', state.handlers.workflowDb);
  logger.info('Workflow DB handler enabled');

  // Queue Handler (always available, allows scheduling internal poll events)
  state.handlers.queue = new QueueHandler({ enabled: true });
  await state.handlers.queue.initialize();
  state.workflowEngine.registerHandler('queue', state.handlers.queue);
  logger.info('Queue handler enabled');

  // Wallet Handler (optional, needs xpub config)
  interface WalletConfigFile {
    wallet?: {
      enabled?: boolean;
      xpub?: string;
      mempool_api?: string;
      rate_limit_seconds?: number;
      confirmations_notify?: number;
      network?: 'mainnet' | 'testnet';
      ftp?: {
        host: string;
        port?: number;
        user: string;
        password: string;
        secure?: boolean;
        remote_path: string;
        public_url: string;
      };
    };
  }
  try {
    const walletConfig = await loadHandlerConfig<WalletConfigFile>('wallet');
    if (walletConfig?.wallet?.enabled && walletConfig.wallet.xpub) {
      const walletOptions: WalletHandlerConfig = {
        xpub: walletConfig.wallet.xpub,
      };
      if (walletConfig.wallet.mempool_api) walletOptions.mempool_api = walletConfig.wallet.mempool_api;
      if (walletConfig.wallet.rate_limit_seconds !== undefined) walletOptions.rate_limit_seconds = walletConfig.wallet.rate_limit_seconds;
      if (walletConfig.wallet.confirmations_notify !== undefined) walletOptions.confirmations_notify = walletConfig.wallet.confirmations_notify;
      if (walletConfig.wallet.network) walletOptions.network = walletConfig.wallet.network;
      if (walletConfig.wallet.ftp) walletOptions.ftp = walletConfig.wallet.ftp;

      state.handlers.wallet = new WalletHandler(walletOptions);
      await state.handlers.wallet.initialize();
      state.workflowEngine.registerHandler('wallet', state.handlers.wallet);
      logger.info('Wallet handler enabled');
    }
  } catch {
    logger.debug('Wallet handler not configured, skipping');
  }
}

// Helper to convert inbound events to ProcessedEvent-like format for workflow engine
function createInboundEvent(source: string, data: WebhookEvent | PollerEvent | SchedulerEvent): {
  id: string;
  pubkey: string;
  pubkeyNpub: string;
  kind: number;
  created_at: number;
  tags: string[][];
  sig: string;
  rawContent: string;
  decryptedContent?: string;
  encryptionType: 'none';
  isEncrypted: boolean;
  isFromWhitelist: boolean;
  relayUrl: string;
} {
  const content = JSON.stringify(data);
  return {
    id: data.id,
    pubkey: source,
    pubkeyNpub: source,
    kind: source === 'webhook' ? 20000 : source === 'api_poller' ? 20001 : 20002,
    created_at: Math.floor(data.timestamp / 1000),
    tags: [['source', source]],
    sig: '',
    rawContent: content,
    decryptedContent: content,
    encryptionType: 'none',
    isEncrypted: false,
    isFromWhitelist: true, // Inbound events bypass whitelist
    relayUrl: source,
  };
}

/**
 * Create an inbound event from decoded Morse code
 */
function createMorseEvent(data: MorseDecodedEvent): {
  id: string;
  pubkey: string;
  pubkeyNpub: string;
  kind: number;
  created_at: number;
  tags: string[][];
  sig: string;
  rawContent: string;
  decryptedContent?: string;
  encryptionType: 'none';
  isEncrypted: boolean;
  isFromWhitelist: boolean;
  relayUrl: string;
} {
  const id = `morse-${data.timestamp.getTime()}`;
  return {
    id,
    pubkey: 'morse_listener',
    pubkeyNpub: 'morse_listener',
    kind: 20003, // Custom kind for morse events
    created_at: Math.floor(data.timestamp.getTime() / 1000),
    tags: [['source', 'morse_listener'], ['raw', data.raw]],
    sig: '',
    rawContent: data.text,
    decryptedContent: data.text,
    encryptionType: 'none',
    isEncrypted: false,
    isFromWhitelist: true, // Morse events bypass whitelist
    relayUrl: 'morse_listener',
  };
}

async function initializeInboundHandlers(
  state: AppState,
  workflowEngine: WorkflowEngine
): Promise<void> {
  // Webhook Server
  try {
    interface WebhookConfigFile {
      webhook?: WebhookServerConfig;
    }
    const webhookConfig = await loadHandlerConfig<WebhookConfigFile>('webhook');
    if (webhookConfig?.webhook?.enabled) {
      state.webhookServer = new WebhookServer(webhookConfig.webhook);

      // Connect to workflow engine (with or without queue)
      state.webhookServer.onWebhook(async (event: WebhookEvent) => {
        if (state.queueEnabled && state.queueWorker) {
          // Enqueue for async processing
          const queueId = enqueueWebhookEvent({
            id: event.id,
            webhookId: event.webhookId,
            method: event.method,
            path: event.path,
            headers: event.headers as Record<string, string>,
            body: event.body,
            timestamp: event.timestamp,
          });
          logger.debug({ webhookId: event.webhookId, queueId }, 'Webhook event enqueued');
        } else {
          // Process directly (legacy mode)
          const processedEvent = createInboundEvent('webhook', event);
          const results = await workflowEngine.processEvent(processedEvent);

          for (const result of results) {
            if (result.success) {
              logger.info(
                { workflowId: result.workflowId, source: 'webhook', webhookId: event.webhookId },
                'Webhook workflow executed'
              );
            } else {
              logger.error(
                { workflowId: result.workflowId, error: result.error },
                'Webhook workflow failed'
              );
            }
          }
        }
      });

      await state.webhookServer.start();
      logger.info('Webhook server enabled');
    }
  } catch (error) {
    logger.debug('Webhook server not configured, skipping');
  }

  // API Poller
  try {
    interface ApiPollerConfigFile {
      api_poller?: ApiPollerManagerConfig;
    }
    const pollerConfig = await loadHandlerConfig<ApiPollerConfigFile>('api-poller');
    if (pollerConfig?.api_poller?.enabled) {
      state.apiPoller = new ApiPollerManager(pollerConfig.api_poller);

      // Connect to workflow engine
      state.apiPoller.onPoll(async (event: PollerEvent) => {
        const processedEvent = createInboundEvent('api_poller', event);
        const results = await workflowEngine.processEvent(processedEvent);

        for (const result of results) {
          if (result.success) {
            logger.info(
              { workflowId: result.workflowId, source: 'api_poller', pollerId: event.pollerId },
              'Poller workflow executed'
            );
          } else {
            logger.error(
              { workflowId: result.workflowId, error: result.error },
              'Poller workflow failed'
            );
          }
        }
      });

      await state.apiPoller.start();
      logger.info('API Poller enabled');
    }
  } catch (error) {
    logger.debug('API Poller not configured, skipping');
  }

  // Scheduler
  try {
    interface SchedulerConfigFile {
      scheduler?: SchedulerManagerConfig;
    }
    const schedulerConfig = await loadHandlerConfig<SchedulerConfigFile>('scheduler');
    if (schedulerConfig?.scheduler?.enabled) {
      state.scheduler = new SchedulerManager(schedulerConfig.scheduler);

      // Connect to workflow engine
      state.scheduler.onSchedule(async (event: SchedulerEvent) => {
        const processedEvent = createInboundEvent('scheduler', event);
        const results = await workflowEngine.processEvent(processedEvent);

        for (const result of results) {
          if (result.success) {
            logger.info(
              { workflowId: result.workflowId, source: 'scheduler', scheduleId: event.scheduleId },
              'Scheduled workflow executed'
            );
          } else {
            logger.error(
              { workflowId: result.workflowId, error: result.error },
              'Scheduled workflow failed'
            );
          }
        }
      });

      await state.scheduler.start();
      logger.info('Scheduler enabled');
    }
  } catch (error) {
    logger.debug('Scheduler not configured, skipping');
  }

  // Morse Listener
  try {
    const config = await loadConfig();
    if (config.morse_listener?.enabled) {
      const morseListener = createMorseListener({
        enabled: true,
        ...(config.morse_listener.device && { device: config.morse_listener.device }),
        ...(config.morse_listener.frequency && { frequency: config.morse_listener.frequency }),
        ...(config.morse_listener.threshold && { threshold: config.morse_listener.threshold }),
        ...(config.morse_listener.sample_rate && { sample_rate: config.morse_listener.sample_rate }),
      });

      // Connect to workflow engine
      morseListener.on('decoded', async (event: MorseDecodedEvent) => {
        const processedEvent = createMorseEvent(event);
        const results = await workflowEngine.processEvent(processedEvent);

        for (const result of results) {
          if (result.success) {
            logger.info(
              { workflowId: result.workflowId, source: 'morse_listener', text: event.text },
              'Morse workflow executed'
            );
          } else {
            logger.error(
              { workflowId: result.workflowId, error: result.error },
              'Morse workflow failed'
            );
          }
        }
      });

      await morseListener.start();
      logger.info(
        { device: config.morse_listener.device, frequency: config.morse_listener.frequency },
        'Morse listener enabled'
      );
    }
  } catch (error) {
    logger.debug('Morse listener not configured, skipping');
  }
}

/**
 * Get local IP addresses (non-internal IPv4)
 */
function getLocalIPs(): string[] {
  const interfaces = networkInterfaces();
  const ips: string[] = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return ips;
}

/**
 * Get network connection name (WiFi SSID or Ethernet connection name)
 * Returns: { type: 'wifi' | 'ethernet', name: string } or null
 */
function getNetworkInfo(): { type: 'wifi' | 'ethernet'; name: string } | null {
  // Try WiFi first with iwgetid
  try {
    const ssid = execSync('iwgetid -r 2>/dev/null', { encoding: 'utf8', timeout: 2000 }).trim();
    if (ssid) return { type: 'wifi', name: ssid };
  } catch {
    // iwgetid not available or no WiFi
  }

  // Try nmcli for both WiFi and Ethernet
  try {
    // Get active connections with their types
    const output = execSync('nmcli -t -f NAME,TYPE,DEVICE connection show --active 2>/dev/null', { encoding: 'utf8', timeout: 2000 });
    const lines = output.trim().split('\n').filter(line => line.length > 0);

    for (const line of lines) {
      const parts = line.split(':');
      if (parts.length >= 3) {
        const name = parts[0] ?? '';
        const connType = parts[1] ?? '';
        if (name && (connType === '802-11-wireless' || connType === 'wifi')) {
          return { type: 'wifi', name };
        }
        if (name && (connType === '802-3-ethernet' || connType === 'ethernet')) {
          return { type: 'ethernet', name };
        }
      }
    }
  } catch {
    // nmcli not available
  }

  // Fallback: check if we have an active ethernet interface
  const interfaces = networkInterfaces();
  for (const [ifname, addrs] of Object.entries(interfaces)) {
    if (addrs && addrs.some(a => a.family === 'IPv4' && !a.internal)) {
      // Common ethernet interface name patterns
      if (ifname.startsWith('eth') || ifname.startsWith('enp') || ifname.startsWith('eno')) {
        return { type: 'ethernet', name: ifname };
      }
    }
  }

  return null;
}

/**
 * Get git version info (branch + short commit hash)
 */
function getGitVersion(): { branch: string; commit: string } | null {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD 2>/dev/null', { encoding: 'utf8', timeout: 2000 }).trim();
    const commit = execSync('git rev-parse --short HEAD 2>/dev/null', { encoding: 'utf8', timeout: 2000 }).trim();
    if (branch && commit) {
      return { branch, commit };
    }
  } catch {
    // Git not available or not a git repo
  }
  return null;
}

/**
 * Get public IP address via external API
 */
async function getPublicIP(): Promise<string | null> {
  try {
    const response = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(5000) });
    if (response.ok) {
      const data = await response.json() as { ip: string };
      return data.ip;
    }
  } catch {
    // Ignore errors, public IP is optional
  }
  return null;
}

/**
 * Send startup notification to admin via DM
 */
async function sendAdminStartupNotification(
  adminNpub: string,
  nostrDmHandler: NostrDmHandler
): Promise<void> {
  try {
    const localIPs = getLocalIPs();
    const publicIP = await getPublicIP();
    const networkInfo = getNetworkInfo();
    const gitVersion = getGitVersion();
    const host = hostname();
    const timestamp = new Date().toISOString();

    // Format network info with type indicator
    let networkLine: string | null = null;
    if (networkInfo) {
      const typeLabel = networkInfo.type === 'wifi' ? 'WiFi' : 'Ethernet';
      networkLine = `Network: ${networkInfo.name} (${typeLabel})`;
    }

    // Format git version
    let versionLine: string | null = null;
    if (gitVersion) {
      versionLine = `Version: ${gitVersion.branch}@${gitVersion.commit}`;
    }

    const message = [
      `PipeliNostr started`,
      ``,
      `Hostname: ${host}`,
      ...(versionLine ? [versionLine] : []),
      ...(networkLine ? [networkLine] : []),
      `Local IP: ${localIPs.length > 0 ? localIPs.join(', ') : 'N/A'}`,
      `Public IP: ${publicIP ?? 'N/A'}`,
      `Time: ${timestamp}`,
    ].join('\n');

    await nostrDmHandler.execute({
      to: adminNpub,
      content: message,
    }, {});

    logger.info({ adminNpub: adminNpub.slice(0, 20) + '...' }, 'Admin startup notification sent');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn({ error: errorMessage }, 'Failed to send admin startup notification');
  }
}

async function main(): Promise<void> {
  logger.info('Starting PipeliNostr...');

  try {
    // Load configuration
    const config = await loadConfig();

    // Apply log level from config
    setLogLevel(config.logging.level);

    logger.info({ name: config.pipelinostr.name, version: config.pipelinostr.version }, 'Configuration loaded');

    // Validate private key
    const privateKey = config.nostr.private_key;
    if (!privateKey) {
      throw new Error('NOSTR_PRIVATE_KEY is required');
    }

    // Initialize database
    await initDatabase(config.database.path);
    logger.info({ path: config.database.path }, 'Database initialized');

    // Initialize LCD display (if configured)
    if (config.lcd?.enabled) {
      await lcdDisplay.initialize({
        enabled: true,
        ...(config.lcd.i2c_bus !== undefined && { i2c_bus: config.lcd.i2c_bus }),
        ...(config.lcd.i2c_address !== undefined && { i2c_address: config.lcd.i2c_address }),
        ...(config.lcd.npub_names && { npub_names: config.lcd.npub_names }),
      });
    }

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

    // Set relay URLs for LCD profile fetching
    if (config.lcd?.enabled) {
      lcdDisplay.setRelayUrls(config.relays.primary);
    }

    // Initialize relay discovery (if enabled)
    let relayDiscovery: RelayDiscovery | undefined;
    if (config.relays.discovery?.enabled) {
      const discoveryConfig = config.relays.discovery;
      relayDiscovery = new RelayDiscovery(
        {
          enabled: discoveryConfig.enabled,
          ...(discoveryConfig.sources && { sources: discoveryConfig.sources }),
          ...(discoveryConfig.max_relays && { max_relays: discoveryConfig.max_relays }),
          ...(discoveryConfig.refresh_interval && { refresh_interval: discoveryConfig.refresh_interval }),
        },
        config.relays.blacklist ?? []
      );
      relayDiscovery.setRelayManager(relayManager);

      // Initial discovery
      const result = await relayDiscovery.discoverRelays();
      logger.info(
        { discovered: result.discovered, added: result.added },
        'Initial relay discovery completed'
      );

      // Start auto-discovery
      relayDiscovery.startAutoDiscovery();
    }

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

    // Configure error notification if enabled
    if (config.workflows?.error_notification?.enabled) {
      workflowEngine.setErrorNotificationConfig({
        enabled: true,
        dm_triggers_only: config.workflows.error_notification.dm_triggers_only ?? true,
      });
    }

    // Initialize Nostr listener
    const nostrListener = new NostrListener(
      {
        privateKey,
        whitelist: {
          enabled: config.whitelist.enabled,
          npubs: config.whitelist.npubs ?? [],
        },
        zapRecipients: config.nostr.zapRecipients,
      },
      relayManager
    );

    // Check if queue is enabled
    const queueEnabled = config.queue?.enabled ?? false;

    // Build app state
    const state: AppState = {
      config,
      relayManager,
      nostrListener,
      workflowEngine,
      queueEnabled,
      relayDiscovery,
      handlers: {
        http: undefined as unknown as HttpHandler,
        nostrDm: undefined as unknown as NostrDmHandler,
        nostrNote: undefined as unknown as NostrNoteHandler,
      },
    };
    appState = state;

    // Initialize handlers
    await initializeHandlers(state, privateKey);

    // Initialize inbound handlers
    await initializeInboundHandlers(state, workflowEngine);

    // Initialize queue worker if enabled
    if (queueEnabled) {
      const queueWorker = new QueueWorker(workflowEngine, {
        pollIntervalMs: config.queue?.poll_interval_ms ?? 1000,
        concurrency: config.queue?.concurrency ?? 1,
        stuckTimeoutMinutes: config.queue?.stuck_timeout_minutes ?? 10,
        cleanupDays: config.queue?.cleanup_days ?? 7,
        cleanupInterval: config.queue?.cleanup_interval ?? 100,
        enabled: true,
      });
      state.queueWorker = queueWorker;

      // Configure hook recorder to log hook executions in the queue history
      workflowEngine.setHookRecorder((hookType, parentWorkflowId, parentWorkflowName, targetWorkflowId, targetWorkflowName, success, error, context) => {
        const db = getDatabase();
        const eventId = `hook_${parentWorkflowId}_${hookType}_${Date.now()}`;
        db.recordHookExecution(
          {
            hookType,
            parentWorkflowId,
            parentWorkflowName,
            targetWorkflowId,
          },
          eventId,
          success ? 'completed' : 'failed',
          targetWorkflowId,
          targetWorkflowName,
          error,
          context ? { trigger: context.trigger, match: context.match } : undefined
        );
        logger.debug({ hookType, parentId: parentWorkflowId, targetId: targetWorkflowId, success }, 'Hook execution recorded');
      });

      await queueWorker.start();
      logger.info('Queue worker started');
    }

    // Connect listener to workflow engine (with or without queue)
    nostrListener.onEvent(async (event) => {
      logger.debug(
        { eventId: event.id, kind: event.kind, from: event.pubkeyNpub.slice(0, 20) },
        'Event received'
      );

      if (state.queueEnabled && state.queueWorker) {
        // Enqueue for async processing
        const queueId = enqueueNostrEvent(event);
        logger.debug({ eventId: event.id, queueId }, 'Event enqueued');
      } else {
        // Process directly (legacy mode)
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
      }
    });

    // Start listening
    nostrListener.start();

    // Log stats
    const relayStats = relayManager.getStats();
    const workflowStats = workflowEngine.getStats();
    const queueStats = queueEnabled ? getDatabase().getQueueStats() : null;
    logger.info(
      {
        relays: `${relayStats.connected}/${relayStats.total}`,
        workflows: `${workflowStats.enabledWorkflows}/${workflowStats.totalWorkflows}`,
        handlers: workflowStats.handlers,
        publicKey: nostrListener.getPublicKeyNpub(),
        queueEnabled,
        ...(queueStats && { queuePending: queueStats.pending }),
      },
      'PipeliNostr started successfully'
    );

    // Send admin startup notification if configured
    if (config.nostr.admin_npub && state.handlers.nostrDm) {
      // Don't await - let it run in background to not block startup
      sendAdminStartupNotification(config.nostr.admin_npub, state.handlers.nostrDm);
    }

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
    // Stop queue worker first (let it finish processing)
    if (appState.queueWorker) {
      logger.info('Stopping queue worker...');
      await appState.queueWorker.stop();
    }

    // Stop relay discovery
    if (appState.relayDiscovery) {
      appState.relayDiscovery.stopAutoDiscovery();
    }

    // Shutdown inbound handlers
    if (appState.webhookServer) {
      await appState.webhookServer.shutdown();
    }
    if (appState.apiPoller) {
      await appState.apiPoller.shutdown();
    }
    if (appState.scheduler) {
      await appState.scheduler.shutdown();
    }

    // Shutdown outbound handlers
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
    if (appState.handlers.file) {
      await appState.handlers.file.shutdown();
    }
    if (appState.handlers.ftp) {
      await appState.handlers.ftp.shutdown();
    }
    if (appState.handlers.sftp) {
      await appState.handlers.sftp.shutdown();
    }
    if (appState.handlers.mongodb) {
      await appState.handlers.mongodb.shutdown();
    }
    if (appState.handlers.mysql) {
      await appState.handlers.mysql.shutdown();
    }
    if (appState.handlers.postgres) {
      await appState.handlers.postgres.shutdown();
    }
    if (appState.handlers.redis) {
      await appState.handlers.redis.shutdown();
    }
    if (appState.handlers.s3) {
      await appState.handlers.s3.shutdown();
    }
    if (appState.handlers.bluesky) {
      await appState.handlers.bluesky.shutdown();
    }
    if (appState.handlers.lemmy) {
      await appState.handlers.lemmy.shutdown();
    }
    if (appState.handlers.github) {
      await appState.handlers.github.shutdown();
    }
    if (appState.handlers.gitlab) {
      await appState.handlers.gitlab.shutdown();
    }
    if (appState.handlers.serial) {
      await appState.handlers.serial.shutdown();
    }
    if (appState.handlers.gpio) {
      await appState.handlers.gpio.shutdown();
    }
    if (appState.handlers.mqtt) {
      await appState.handlers.mqtt.shutdown();
    }
    if (appState.handlers.ble) {
      await appState.handlers.ble.shutdown();
    }
    if (appState.handlers.usbHid) {
      await appState.handlers.usbHid.shutdown();
    }
    if (appState.handlers.usbPower) {
      await appState.handlers.usbPower.shutdown();
    }
    if (appState.handlers.i2c) {
      await appState.handlers.i2c.shutdown();
    }
    if (appState.handlers.traccarSms) {
      await appState.handlers.traccarSms.shutdown();
    }
    if (appState.handlers.calendar) {
      await appState.handlers.calendar.shutdown();
    }
    if (appState.handlers.bebop) {
      await appState.handlers.bebop.shutdown();
    }
    if (appState.handlers.odoo) {
      await appState.handlers.odoo.shutdown();
    }
    if (appState.handlers.morseAudio) {
      await appState.handlers.morseAudio.shutdown();
    }
    if (appState.handlers.dpo) {
      await appState.handlers.dpo.shutdown();
    }
    if (appState.handlers.claude) {
      await appState.handlers.claude.shutdown();
    }
    if (appState.handlers.workflowActivator) {
      await appState.handlers.workflowActivator.shutdown();
    }
    if (appState.handlers.system) {
      await appState.handlers.system.shutdown();
    }
    await appState.handlers.http.shutdown();
    await appState.handlers.nostrDm.shutdown();
    await appState.handlers.nostrNote.shutdown();

    // Shutdown relay manager
    await appState.relayManager.shutdown();

    // Shutdown LCD display
    await lcdDisplay.shutdown();

    // Shutdown Morse listener
    const morseListener = getMorseListener();
    if (morseListener?.isRunning()) {
      morseListener.stop();
    }

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
