export interface EventLog {
  id?: number | undefined;
  received_at: Date;
  workflow_matched_at?: Date | undefined;
  workflow_started_at?: Date | undefined;
  workflow_completed_at?: Date | undefined;
  source_type: string;
  source_identifier?: string | undefined;
  source_raw?: string | undefined;
  workflow_id?: string | undefined;
  workflow_name?: string | undefined;
  status: 'received' | 'matched' | 'processing' | 'success' | 'success_with_retry' | 'pending_with_retry' | 'fail_after_retries' | 'no_match';
  retry_count: number;
  error_message?: string | undefined;
  target_type?: string | undefined;
  target_identifier?: string | undefined;
  target_response?: string | undefined;
  created_at: Date;
}
