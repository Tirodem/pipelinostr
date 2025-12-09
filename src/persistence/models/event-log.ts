export interface EventLog {
  id?: number;
  received_at: Date;
  workflow_matched_at?: Date;
  workflow_started_at?: Date;
  workflow_completed_at?: Date;
  source_type: string;
  source_identifier?: string;
  source_raw?: string;
  workflow_id?: string;
  workflow_name?: string;
  status: 'received' | 'matched' | 'processing' | 'success' | 'success_with_retry' | 'pending_with_retry' | 'fail_after_retries' | 'no_match';
  retry_count: number;
  error_message?: string;
  target_type?: string;
  target_identifier?: string;
  target_response?: string;
  created_at: Date;
}
