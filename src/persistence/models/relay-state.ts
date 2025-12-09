export interface RelayState {
  url: string;
  status: 'active' | 'quarantined' | 'abandoned';
  consecutive_failures: number;
  last_success_at?: Date | undefined;
  last_failure_at?: Date | undefined;
  last_failure_reason?: string | undefined;
  quarantine_until?: Date | undefined;
  quarantine_level: number;
  total_events_received: number;
  total_events_sent: number;
  discovered_from: 'config' | 'discovery' | 'event';
  first_seen_at: Date;
  updated_at: Date;
}
