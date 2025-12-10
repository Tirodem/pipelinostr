export interface WorkflowExecution {
  id?: number | undefined;
  event_log_id?: number | null | undefined;
  workflow_id: string;
  action_id: string;
  action_type: string;
  started_at: Date;
  completed_at?: Date | undefined;
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
  attempt_number: number;
  input_data?: string | undefined;
  output_data?: string | undefined;
  error_message?: string | undefined;
  created_at: Date;
}
