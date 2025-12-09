export interface RelayState {
  url: string;
  status: 'active' | 'quarantined' | 'abandoned';
  consecutive_failures: number;
  last_success_at?: Date;
  last_failure_at?: Date;
  last_failure_reason?: string;
  quarantine_until?: Date;
  quarantine_level: number;
  total_events_received: number;
  total_events_sent: number;
  discovered_from: 'config' | 'discovery' | 'event';
  first_seen_at: Date;
  updated_at: Date;
}
