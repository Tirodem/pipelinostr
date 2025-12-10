import { logger } from '../persistence/logger.js';
import { getDatabase } from '../persistence/database.js';
import type { RelayManager } from './manager.js';

export interface DiscoveryConfig {
  enabled: boolean;
  sources?: string[];
  max_relays?: number;
  refresh_interval?: number; // seconds
}

export interface DiscoveryResult {
  discovered: number;
  added: number;
  skipped: number;
  relays: string[];
}

const DEFAULT_SOURCE = 'https://api.nostr.watch/v1/online';
const DEFAULT_MAX_RELAYS = 10;
const DEFAULT_REFRESH_INTERVAL = 3600; // 1 hour

export class RelayDiscovery {
  private config: DiscoveryConfig;
  private relayManager: RelayManager | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private blacklist: string[] = [];

  constructor(config: DiscoveryConfig, blacklist: string[] = []) {
    this.config = config;
    this.blacklist = blacklist;
  }

  setRelayManager(relayManager: RelayManager): void {
    this.relayManager = relayManager;
  }

  /**
   * Fetch relay list from nostr.watch API
   */
  async fetchFromSource(sourceUrl: string): Promise<string[]> {
    try {
      logger.debug({ source: sourceUrl }, 'Fetching relays from source');

      const response = await fetch(sourceUrl, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'PipeliNostr/1.0',
        },
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data: unknown = await response.json();

      // nostr.watch returns an array of relay URLs
      if (Array.isArray(data)) {
        const relays = data.filter((url): url is string =>
          typeof url === 'string' && url.startsWith('wss://')
        );
        logger.debug({ source: sourceUrl, count: relays.length }, 'Fetched relays from source');
        return relays;
      }

      // Some APIs might return { relays: [...] }
      if (typeof data === 'object' && data !== null && 'relays' in data && Array.isArray((data as { relays: unknown }).relays)) {
        const relays = ((data as { relays: unknown[] }).relays).filter((url): url is string =>
          typeof url === 'string' && url.startsWith('wss://')
        );
        return relays;
      }

      logger.warn({ source: sourceUrl }, 'Unexpected response format from relay source');
      return [];
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ source: sourceUrl, error: errorMessage }, 'Failed to fetch relays from source');
      return [];
    }
  }

  /**
   * Discover new relays from all configured sources
   */
  async discoverRelays(): Promise<DiscoveryResult> {
    if (!this.config.enabled) {
      return { discovered: 0, added: 0, skipped: 0, relays: [] };
    }

    const sources = this.config.sources?.length ? this.config.sources : [DEFAULT_SOURCE];
    const maxRelays = this.config.max_relays ?? DEFAULT_MAX_RELAYS;
    const db = getDatabase();

    // Get all known relay URLs
    const knownRelays = new Set(db.getAllRelayStates().map((r) => r.url));

    // Fetch from all sources
    const allDiscovered: string[] = [];
    for (const source of sources) {
      const relays = await this.fetchFromSource(source);
      allDiscovered.push(...relays);
    }

    // Deduplicate
    const uniqueDiscovered = [...new Set(allDiscovered)];

    // Filter out known, blacklisted relays
    const newRelays = uniqueDiscovered.filter((url) => {
      if (knownRelays.has(url)) return false;
      if (this.blacklist.includes(url)) return false;
      return true;
    });

    // Limit to max_relays
    const relaysToAdd = newRelays.slice(0, maxRelays);

    logger.info(
      {
        discovered: uniqueDiscovered.length,
        new: newRelays.length,
        adding: relaysToAdd.length,
        maxRelays,
      },
      'Relay discovery completed'
    );

    // Add new relays
    let added = 0;
    for (const url of relaysToAdd) {
      const success = await this.addRelay(url);
      if (success) added++;
    }

    return {
      discovered: uniqueDiscovered.length,
      added,
      skipped: newRelays.length - added,
      relays: relaysToAdd,
    };
  }

  /**
   * Add a discovered relay to the system
   */
  private async addRelay(url: string): Promise<boolean> {
    try {
      const db = getDatabase();
      const now = new Date();

      // Add to database
      db.upsertRelayState({
        url,
        status: 'active',
        consecutive_failures: 0,
        quarantine_level: 0,
        total_events_received: 0,
        total_events_sent: 0,
        discovered_from: 'discovery',
        first_seen_at: now,
        updated_at: now,
      });

      // Connect via relay manager if available
      if (this.relayManager) {
        await this.relayManager.addRelay(url);
      }

      logger.info({ url }, 'Added discovered relay');
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ url, error: errorMessage }, 'Failed to add discovered relay');
      return false;
    }
  }

  /**
   * Start automatic discovery on interval
   */
  startAutoDiscovery(): void {
    if (!this.config.enabled) {
      logger.debug('Relay discovery disabled, skipping auto-discovery');
      return;
    }

    const intervalMs = (this.config.refresh_interval ?? DEFAULT_REFRESH_INTERVAL) * 1000;

    logger.info(
      { intervalSeconds: intervalMs / 1000 },
      'Starting automatic relay discovery'
    );

    this.refreshTimer = setInterval(async () => {
      try {
        await this.discoverRelays();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error({ error: errorMessage }, 'Auto-discovery failed');
      }
    }, intervalMs);
  }

  /**
   * Stop automatic discovery
   */
  stopAutoDiscovery(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
      logger.debug('Stopped automatic relay discovery');
    }
  }

  /**
   * Check if discovery is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }
}
