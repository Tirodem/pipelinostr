import Ajv from 'ajv';

export interface PipelinostrConfig {
  pipelinostr: {
    name: string;
    version: string;
  };
  nostr: {
    private_key?: string;
    private_key_file?: string;
    zapRecipients?: string[];
    dm_format?: 'nip04' | 'nip17';  // Default DM format: 'nip04' (legacy) or 'nip17' (modern)
    dm_reply_match_format?: boolean;  // If true, reply to DMs in the same format as received (default: true)
    admin_npub?: string;  // If set, sends a DM on startup with IP/hostname info
  };
  whitelist: {
    enabled: boolean;
    npubs?: string[];
    file?: string;
  };
  relays: {
    primary: string[];
    blacklist?: string[];
    discovery?: {
      enabled: boolean;
      sources?: string[];
      max_relays?: number;
      refresh_interval?: number;
      auto_add_from_events?: boolean;
    };
    quarantine?: {
      enabled: boolean;
      thresholds?: Array<{
        failures: number;
        duration: string;
      }>;
      max_quarantine_duration?: string;
      health_check_interval?: string;
    };
  };
  api?: {
    enabled: boolean;
    port: number;
    host: string;
    auth?: {
      methods?: Array<{
        type: 'api_key' | 'jwt' | 'nostr_signature';
        header?: string;
        keys?: string[];
        secret?: string;
        algorithm?: string;
        enabled?: boolean;
      }>;
    };
    rate_limit?: {
      enabled: boolean;
      window_ms: number;
      max_requests: number;
    };
  };
  database: {
    path: string;
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    files?: {
      general?: string;
      events?: string;
      workflows?: string;
      relays?: string;
    };
    rotation?: {
      max_size?: string;
      max_files?: number;
    };
  };
  retry?: {
    max_attempts: number;
    backoff: {
      type: 'exponential' | 'linear' | 'fixed';
      initial_delay_ms: number;
      multiplier?: number;
      max_delay_ms: number;
    };
  };
  queue?: {
    enabled: boolean;
    poll_interval_ms?: number;
    concurrency?: number;
    stuck_timeout_minutes?: number;
    cleanup_days?: number;
    cleanup_interval?: number;
  };
  lcd?: {
    enabled: boolean;
    i2c_bus?: number;
    i2c_address?: number;
    npub_names?: Record<string, string>;
  };
  morse_listener?: {
    enabled: boolean;
    device?: string;         // ALSA device (e.g., "plughw:3,0")
    frequency?: number;      // Target frequency in Hz (default: 800)
    threshold?: number;      // Detection threshold (0-1, default: 0.3)
    sample_rate?: number;    // Sample rate (default: 44100)
  };
  workflows?: {
    error_notification?: {
      enabled: boolean;
      dm_triggers_only?: boolean;  // Only notify if trigger was a Nostr DM (kind 4/1059), default: true
    };
  };
}

const configSchema = {
  type: 'object',
  properties: {
    pipelinostr: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        version: { type: 'string' },
      },
      required: ['name', 'version'],
      additionalProperties: false,
    },
    nostr: {
      type: 'object',
      properties: {
        private_key: { type: 'string' },
        private_key_file: { type: 'string' },
        zapRecipients: { type: 'array', items: { type: 'string' } },
        dm_format: { type: 'string', enum: ['nip04', 'nip17'] },
        dm_reply_match_format: { type: 'boolean' },
        admin_npub: { type: 'string' },
      },
      additionalProperties: false,
    },
    whitelist: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        npubs: { type: 'array', items: { type: 'string' } },
        file: { type: 'string' },
      },
      required: ['enabled'],
      additionalProperties: false,
    },
    relays: {
      type: 'object',
      properties: {
        primary: { type: 'array', items: { type: 'string' } },
        blacklist: { type: 'array', items: { type: 'string' } },
        discovery: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
            sources: { type: 'array', items: { type: 'string' } },
            max_relays: { type: 'integer' },
            refresh_interval: { type: 'integer' },
            auto_add_from_events: { type: 'boolean' },
          },
          required: ['enabled'],
        },
        quarantine: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
            thresholds: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  failures: { type: 'integer' },
                  duration: { type: 'string' },
                },
                required: ['failures', 'duration'],
              },
            },
            max_quarantine_duration: { type: 'string' },
            health_check_interval: { type: 'string' },
          },
          required: ['enabled'],
        },
      },
      required: ['primary'],
    },
    api: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        port: { type: 'integer' },
        host: { type: 'string' },
        auth: {
          type: 'object',
          properties: {
            methods: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['api_key', 'jwt', 'nostr_signature'] },
                  header: { type: 'string' },
                  keys: { type: 'array', items: { type: 'string' } },
                  secret: { type: 'string' },
                  algorithm: { type: 'string' },
                  enabled: { type: 'boolean' },
                },
                required: ['type'],
              },
            },
          },
        },
        rate_limit: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
            window_ms: { type: 'integer' },
            max_requests: { type: 'integer' },
          },
          required: ['enabled', 'window_ms', 'max_requests'],
        },
      },
      required: ['enabled', 'port', 'host'],
    },
    database: {
      type: 'object',
      properties: {
        path: { type: 'string' },
      },
      required: ['path'],
    },
    logging: {
      type: 'object',
      properties: {
        level: { type: 'string', enum: ['debug', 'info', 'warn', 'error'] },
        files: {
          type: 'object',
          properties: {
            general: { type: 'string' },
            events: { type: 'string' },
            workflows: { type: 'string' },
            relays: { type: 'string' },
          },
        },
        rotation: {
          type: 'object',
          properties: {
            max_size: { type: 'string' },
            max_files: { type: 'integer' },
          },
        },
      },
      required: ['level'],
    },
    retry: {
      type: 'object',
      properties: {
        max_attempts: { type: 'integer' },
        backoff: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['exponential', 'linear', 'fixed'] },
            initial_delay_ms: { type: 'integer' },
            multiplier: { type: 'number' },
            max_delay_ms: { type: 'integer' },
          },
          required: ['type', 'initial_delay_ms', 'max_delay_ms'],
        },
      },
      required: ['max_attempts', 'backoff'],
    },
    queue: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        poll_interval_ms: { type: 'integer' },
        concurrency: { type: 'integer' },
        stuck_timeout_minutes: { type: 'integer' },
        cleanup_days: { type: 'integer' },
        cleanup_interval: { type: 'integer' },
      },
      required: ['enabled'],
    },
    lcd: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        i2c_bus: { type: 'integer' },
        i2c_address: { type: 'integer' },
        npub_names: { type: 'object', additionalProperties: { type: 'string' } },
      },
      required: ['enabled'],
    },
    morse_listener: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        device: { type: 'string' },
        frequency: { type: 'integer' },
        threshold: { type: 'number' },
        sample_rate: { type: 'integer' },
      },
      required: ['enabled'],
    },
    workflows: {
      type: 'object',
      properties: {
        error_notification: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
            dm_triggers_only: { type: 'boolean' },
          },
          required: ['enabled'],
        },
      },
    },
  },
  required: ['pipelinostr', 'nostr', 'whitelist', 'relays', 'database', 'logging'],
  additionalProperties: false,
} as const;

const ajv = new Ajv.default({ allErrors: true, useDefaults: true });
const validate = ajv.compile(configSchema);

export function validateConfig(config: unknown): PipelinostrConfig {
  if (validate(config)) {
    return config as PipelinostrConfig;
  }
  throw new Error(`Invalid configuration: ${JSON.stringify(validate.errors, null, 2)}`);
}
