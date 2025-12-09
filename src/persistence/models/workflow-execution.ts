export interface WorkflowExecution {
  id?: number;
  event_log_id: number;
  workflow_id: string;
  action_id: string;
  action_type: string;
  started_at: Date;
  completed_at?: Date;
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
  attempt_number: number;
  input_data?: string;
  output_data?: string;
  error_message?: string;
  created_at: Date;
}
