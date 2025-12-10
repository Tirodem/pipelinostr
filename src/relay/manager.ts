import { Relay } from 'nostr-tools/relay';
import { type Event as NostrEvent } from 'nostr-tools/pure';
import { logger } from '../persistence/logger.js';
import { getDatabase } from '../persistence/database.js';
import type { RelayState } from '../persistence/models/relay-state.js';
import { QuarantineManager, type QuarantineConfig } from './quarantine.js';
import { HealthChecker } from './health-checker.js';

export interface RelayManagerConfig {
  primaryRelays: string[];
  blacklist?: string[] | undefined;
  quarantine?: Partial<QuarantineConfig> | undefined;
}

interface ConnectedRelay {
  url: string;
  relay: Relay;
  status: 'connected' | 'connecting' | 'disconnected';
}

type RelayEventCallback = (event: NostrEvent, relayUrl: string) => void;
type RelayEoseCallback = (relayUrl: string) => void;

export class RelayManager {
  private config: RelayManagerConfig;
  private relays: Map<string, ConnectedRelay> = new Map();
  private quarantineManager: QuarantineManager;
  private healthChecker: HealthChecker;
  private eventCallbacks: RelayEventCallback[] = [];
  private eoseCallbacks: RelayEoseCallback[] = [];
  private reconnectTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(config: RelayManagerConfig) {
    this.config = config;
    this.quarantineManager = new QuarantineManager(config.quarantine);
    this.healthChecker = new HealthChecker();
  }

  async initialize(): Promise<void> {
    logger.info({ relayCount: this.config.primaryRelays.length }, 'Initializing relay manager');

    const db = getDatabase();

    // Register primary relays in database
    for (const url of this.config.primaryRelays) {
      if (this.isBlacklisted(url)) {
        logger.warn({ url }, 'Skipping blacklisted relay');
        continue;
      }

      const existing = db.getRelayState(url);
      if (!existing) {
        const now = new Date();
        db.upsertRelayState({
          url,
          status: 'active',
          consecutive_failures: 0,
          quarantine_level: 0,
          total_events_received: 0,
          total_events_sent: 0,
          discovered_from: 'config',
          first_seen_at: now,
          updated_at: now,
        });
      }
    }

    // Connect to active relays
    await this.connectToActiveRelays();
  }

  private async connectToActiveRelays(): Promise<void> {
    const db = getDatabase();
    const activeRelays = db.getActiveRelays();

    const connectPromises = activeRelays
      .filter((r) => !this.isBlacklisted(r.url))
      .map((r) => this.connectToRelay(r.url));

    await Promise.allSettled(connectPromises);

    const connectedCount = Array.from(this.relays.values()).filter((r) => r.status === 'connected').length;
    logger.info({ connected: connectedCount, total: activeRelays.length }, 'Relay connections established');
  }

  private async connectToRelay(url: string): Promise<void> {
    if (this.relays.has(url) && this.relays.get(url)?.status === 'connected') {
      return;
    }

    this.relays.set(url, { url, relay: null as unknown as Relay, status: 'connecting' });

    try {
      logger.debug({ url }, 'Connecting to relay');
      const relay = await Relay.connect(url);

      this.relays.set(url, { url, relay, status: 'connected' });

      // Record success
      const db = getDatabase();
      db.recordRelaySuccess(url);

      logger.info({ url }, 'Connected to relay');

      // Handle disconnection
      relay.onclose = () => {
        this.handleDisconnect(url);
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ url, error: errorMessage }, 'Failed to connect to relay');

      this.relays.delete(url);
      this.handleFailure(url, errorMessage);
    }
  }

  private handleDisconnect(url: string): void {
    logger.warn({ url }, 'Relay disconnected');

    const relayEntry = this.relays.get(url);
    if (relayEntry) {
      relayEntry.status = 'disconnected';
    }

    // Schedule reconnect
    this.scheduleReconnect(url);
  }

  private handleFailure(url: string, reason: string): void {
    const db = getDatabase();
    const state = db.getRelayState(url);

    if (!state) return;

    const newFailureCount = state.consecutive_failures + 1;
    const quarantineUntil = this.quarantineManager.calculateQuarantineEnd(newFailureCount);
    const quarantineLevel = this.quarantineManager.getQuarantineLevel(newFailureCount);

    db.recordRelayFailure(url, reason, quarantineUntil, quarantineLevel);

    if (quarantineUntil) {
      logger.warn(
        { url, failures: newFailureCount, quarantineUntil: quarantineUntil.toISOString() },
        'Relay quarantined'
      );
    }
  }

  private scheduleReconnect(url: string, delayMs = 30000): void {
    // Clear existing timer
    const existingTimer = this.reconnectTimers.get(url);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const db = getDatabase();
    const state = db.getRelayState(url);

    // Don't reconnect if quarantined
    if (state?.quarantine_until && new Date(state.quarantine_until) > new Date()) {
      logger.debug({ url, quarantineUntil: state.quarantine_until }, 'Relay in quarantine, skipping reconnect');
      return;
    }

    const timer = setTimeout(async () => {
      this.reconnectTimers.delete(url);
      await this.connectToRelay(url);
    }, delayMs);

    this.reconnectTimers.set(url, timer);
  }

  private isBlacklisted(url: string): boolean {
    return this.config.blacklist?.includes(url) ?? false;
  }

  // Event subscription
  onEvent(callback: RelayEventCallback): void {
    this.eventCallbacks.push(callback);
  }

  onEose(callback: RelayEoseCallback): void {
    this.eoseCallbacks.push(callback);
  }

  private notifyEvent(event: NostrEvent, relayUrl: string): void {
    for (const callback of this.eventCallbacks) {
      try {
        callback(event, relayUrl);
      } catch (error) {
        logger.error({ error }, 'Error in event callback');
      }
    }
  }

  private notifyEose(relayUrl: string): void {
    for (const callback of this.eoseCallbacks) {
      try {
        callback(relayUrl);
      } catch (error) {
        logger.error({ error }, 'Error in EOSE callback');
      }
    }
  }

  // Subscribe to events
  subscribe(filters: Array<Record<string, unknown>>): void {
    for (const [url, entry] of this.relays) {
      if (entry.status !== 'connected') continue;

      try {
        entry.relay.subscribe(filters as Parameters<Relay['subscribe']>[0], {
          onevent: (event: NostrEvent) => {
            const db = getDatabase();
            db.incrementRelayEventCount(url, 'received');
            this.notifyEvent(event, url);
          },
          oneose: () => {
            this.notifyEose(url);
          },
        });

        logger.debug({ url, filters }, 'Subscribed to relay');
      } catch (error) {
        logger.error({ url, error }, 'Failed to subscribe to relay');
      }
    }
  }

  // Publish event to all connected relays
  async publish(event: NostrEvent): Promise<{ successes: string[]; failures: string[] }> {
    const successes: string[] = [];
    const failures: string[] = [];

    const publishPromises = Array.from(this.relays.entries()).map(async ([url, entry]) => {
      if (entry.status !== 'connected') {
        failures.push(url);
        return;
      }

      try {
        await entry.relay.publish(event);
        const db = getDatabase();
        db.incrementRelayEventCount(url, 'sent');
        successes.push(url);
        logger.debug({ url, eventId: event.id }, 'Event published to relay');
      } catch (error) {
        failures.push(url);
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error({ url, error: errorMessage }, 'Failed to publish event');
      }
    });

    await Promise.allSettled(publishPromises);

    return { successes, failures };
  }

  // Health check all relays
  async runHealthChecks(): Promise<void> {
    const db = getDatabase();
    const allRelays = db.getAllRelayStates();

    for (const relayState of allRelays) {
      // Skip active and connected relays
      if (relayState.status === 'active' && this.relays.get(relayState.url)?.status === 'connected') {
        continue;
      }

      // Check quarantined relays if quarantine expired
      if (relayState.status === 'quarantined') {
        if (relayState.quarantine_until && new Date(relayState.quarantine_until) > new Date()) {
          continue;
        }
      }

      // Skip abandoned
      if (relayState.status === 'abandoned') {
        continue;
      }

      const result = await this.healthChecker.checkRelay(relayState.url);

      if (result.healthy) {
        db.recordRelaySuccess(relayState.url);
        logger.info({ url: relayState.url }, 'Quarantined relay recovered');
        await this.connectToRelay(relayState.url);
      }
    }
  }

  // Get relay statistics
  getStats(): {
    connected: number;
    total: number;
    quarantined: number;
    relays: Array<{ url: string; status: string; connected: boolean }>;
  } {
    const db = getDatabase();
    const allStates = db.getAllRelayStates();

    const relays = allStates.map((state) => ({
      url: state.url,
      status: state.status,
      connected: this.relays.get(state.url)?.status === 'connected',
    }));

    return {
      connected: relays.filter((r) => r.connected).length,
      total: relays.length,
      quarantined: relays.filter((r) => r.status === 'quarantined').length,
      relays,
    };
  }

  // Get connected relay URLs
  getConnectedRelays(): string[] {
    return Array.from(this.relays.entries())
      .filter(([, entry]) => entry.status === 'connected')
      .map(([url]) => url);
  }

  // Add a relay at runtime (used by discovery)
  async addRelay(url: string): Promise<boolean> {
    if (this.isBlacklisted(url)) {
      logger.warn({ url }, 'Cannot add blacklisted relay');
      return false;
    }

    if (this.relays.has(url) && this.relays.get(url)?.status === 'connected') {
      logger.debug({ url }, 'Relay already connected');
      return true;
    }

    try {
      await this.connectToRelay(url);
      return this.relays.get(url)?.status === 'connected';
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ url, error: errorMessage }, 'Failed to add relay');
      return false;
    }
  }

  // Shutdown
  async shutdown(): Promise<void> {
    logger.info('Shutting down relay manager');

    // Clear all reconnect timers
    for (const timer of this.reconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();

    // Close all connections
    for (const [url, entry] of this.relays) {
      if (entry.relay) {
        try {
          entry.relay.close();
          logger.debug({ url }, 'Relay connection closed');
        } catch (error) {
          logger.error({ url, error }, 'Error closing relay connection');
        }
      }
    }

    this.relays.clear();
    logger.info('Relay manager shutdown complete');
  }
}
