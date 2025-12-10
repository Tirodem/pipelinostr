/**
 * API Poller - Polling périodique d'APIs externes
 * Déclenche des workflows quand de nouvelles données sont détectées
 */

import { logger } from '../persistence/logger.js';

export interface PollerEvent {
  // Metadata
  id: string;
  source: 'api_poller';
  timestamp: number;

  // Poller info
  pollerId: string;
  pollerName: string;

  // Response
  status: number;
  headers: Record<string, string>;
  data: unknown;
  rawData: string;

  // Change detection
  hasChanged: boolean;
  previousHash?: string | undefined;
  currentHash: string;
}

export type PollerCallback = (event: PollerEvent) => void | Promise<void>;

export interface ApiPollerConfig {
  id: string;
  name: string;
  url: string;
  method?: string | undefined;
  headers?: Record<string, string> | undefined;
  body?: unknown | undefined;
  interval: number; // ms
  timeout?: number | undefined;
  enabled?: boolean | undefined;

  // Change detection
  change_detection?: {
    enabled?: boolean | undefined;
    mode?: 'hash' | 'json_path' | 'status' | undefined;
    json_path?: string | undefined; // e.g., "$.data.items[*].id"
  } | undefined;

  // Transform
  response_type?: 'json' | 'text' | 'auto' | undefined;
}

export interface ApiPollerManagerConfig {
  enabled: boolean;
  pollers?: ApiPollerConfig[] | undefined;
  default_timeout?: number | undefined;
}

interface PollerState {
  config: ApiPollerConfig;
  timer: NodeJS.Timeout | null;
  lastHash: string | null;
  lastPoll: number;
  isPolling: boolean;
}

export class ApiPollerManager {
  private config: ApiPollerManagerConfig;
  private pollers: Map<string, PollerState> = new Map();
  private callbacks: PollerCallback[] = [];
  private eventCounter = 0;

  constructor(config: ApiPollerManagerConfig) {
    this.config = config;
  }

  onPoll(callback: PollerCallback): void {
    this.callbacks.push(callback);
  }

  async start(): Promise<void> {
    if (!this.config.enabled) {
      logger.debug('[API Poller] Polling disabled');
      return;
    }

    if (!this.config.pollers || this.config.pollers.length === 0) {
      logger.debug('[API Poller] No pollers configured');
      return;
    }

    for (const pollerConfig of this.config.pollers) {
      if (pollerConfig.enabled === false) {
        continue;
      }

      const state: PollerState = {
        config: pollerConfig,
        timer: null,
        lastHash: null,
        lastPoll: 0,
        isPolling: false,
      };

      this.pollers.set(pollerConfig.id, state);

      // Start polling
      this.scheduleNextPoll(state);
      logger.info(
        { pollerId: pollerConfig.id, interval: pollerConfig.interval, url: pollerConfig.url },
        '[API Poller] Poller started'
      );
    }

    logger.info({ count: this.pollers.size }, '[API Poller] Manager started');
  }

  private scheduleNextPoll(state: PollerState): void {
    if (state.timer) {
      clearTimeout(state.timer);
    }

    state.timer = setTimeout(async () => {
      await this.poll(state);
      this.scheduleNextPoll(state);
    }, state.config.interval);
  }

  private async poll(state: PollerState): Promise<void> {
    if (state.isPolling) {
      logger.warn({ pollerId: state.config.id }, '[API Poller] Previous poll still running, skipping');
      return;
    }

    state.isPolling = true;
    const startTime = Date.now();

    try {
      const timeout = state.config.timeout || this.config.default_timeout || 30000;

      // Build request options
      const options: RequestInit = {
        method: state.config.method || 'GET',
        headers: state.config.headers || {},
        signal: AbortSignal.timeout(timeout),
      };

      if (state.config.body && options.method !== 'GET') {
        if (typeof state.config.body === 'object') {
          options.body = JSON.stringify(state.config.body);
          (options.headers as Record<string, string>)['Content-Type'] = 'application/json';
        } else {
          options.body = String(state.config.body);
        }
      }

      // Execute request
      const response = await fetch(state.config.url, options);
      const rawData = await response.text();

      // Parse response
      let data: unknown = rawData;
      const contentType = response.headers.get('content-type') || '';
      const responseType = state.config.response_type || 'auto';

      if (responseType === 'json' || (responseType === 'auto' && contentType.includes('application/json'))) {
        try {
          data = JSON.parse(rawData);
        } catch {
          // Keep as text
        }
      }

      // Calculate hash for change detection
      const currentHash = this.calculateHash(rawData);
      const hasChanged = state.lastHash !== null && state.lastHash !== currentHash;

      // Check if we should trigger based on change detection config
      const changeConfig = state.config.change_detection;
      let shouldTrigger = true;

      if (changeConfig?.enabled !== false) {
        const mode = changeConfig?.mode || 'hash';

        if (mode === 'hash') {
          // Only trigger if content changed
          shouldTrigger = state.lastHash === null || hasChanged;
        } else if (mode === 'json_path' && changeConfig?.json_path) {
          // Check specific JSON path for changes
          const pathValue = this.extractJsonPath(data, changeConfig.json_path);
          const pathHash = this.calculateHash(JSON.stringify(pathValue));
          shouldTrigger = state.lastHash === null || state.lastHash !== pathHash;
        } else if (mode === 'status') {
          // Always trigger, include status in event
          shouldTrigger = true;
        }
      }

      if (shouldTrigger) {
        // Build event
        const event: PollerEvent = {
          id: `poll_${Date.now()}_${++this.eventCounter}`,
          source: 'api_poller',
          timestamp: Date.now(),
          pollerId: state.config.id,
          pollerName: state.config.name,
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          data,
          rawData,
          hasChanged,
          previousHash: state.lastHash || undefined,
          currentHash,
        };

        // Process callbacks
        for (const callback of this.callbacks) {
          try {
            await callback(event);
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error({ error: errorMessage, pollerId: state.config.id }, '[API Poller] Callback error');
          }
        }

        logger.debug(
          {
            pollerId: state.config.id,
            status: response.status,
            duration: Date.now() - startTime,
            changed: hasChanged,
          },
          '[API Poller] Poll completed'
        );
      }

      // Update state
      state.lastHash = currentHash;
      state.lastPoll = Date.now();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(
        { error: errorMessage, pollerId: state.config.id, url: state.config.url },
        '[API Poller] Poll failed'
      );
    } finally {
      state.isPolling = false;
    }
  }

  private calculateHash(data: string): string {
    // Simple hash for change detection
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(16);
  }

  private extractJsonPath(data: unknown, path: string): unknown {
    // Simple JSON path implementation (supports $.key.subkey and $.array[*].key)
    if (!path.startsWith('$.')) {
      return data;
    }

    const parts = path.slice(2).split('.');
    let current: unknown = data;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }

      // Handle array notation [*]
      if (part.includes('[*]')) {
        const key = part.replace('[*]', '');
        if (key) {
          current = (current as Record<string, unknown>)[key];
        }
        if (Array.isArray(current)) {
          // Return array of values for next key
          continue;
        }
      } else if (part.includes('[')) {
        // Handle specific index [0]
        const match = part.match(/^(\w+)\[(\d+)\]$/);
        if (match && match[1] && match[2]) {
          const key = match[1];
          const index = match[2];
          current = (current as Record<string, unknown>)[key];
          if (Array.isArray(current)) {
            current = current[parseInt(index, 10)];
          }
        }
      } else {
        // Regular key
        if (Array.isArray(current)) {
          current = current.map((item) => (item as Record<string, unknown>)[part]);
        } else {
          current = (current as Record<string, unknown>)[part];
        }
      }
    }

    return current;
  }

  getPollers(): ApiPollerConfig[] {
    return Array.from(this.pollers.values()).map((state) => state.config);
  }

  getPollerStats(): Record<string, { lastPoll: number; isPolling: boolean }> {
    const stats: Record<string, { lastPoll: number; isPolling: boolean }> = {};
    for (const [id, state] of this.pollers) {
      stats[id] = {
        lastPoll: state.lastPoll,
        isPolling: state.isPolling,
      };
    }
    return stats;
  }

  async triggerPoll(pollerId: string): Promise<void> {
    const state = this.pollers.get(pollerId);
    if (state) {
      await this.poll(state);
    }
  }

  async shutdown(): Promise<void> {
    for (const [, state] of this.pollers) {
      if (state.timer) {
        clearTimeout(state.timer);
      }
    }
    this.pollers.clear();
    logger.info('[API Poller] Manager stopped');
  }
}
