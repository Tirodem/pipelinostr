export interface HandlerResult {
  success: boolean;
  data?: Record<string, unknown> | undefined;
  error?: string | undefined;
}

export interface HandlerConfig {
  [key: string]: unknown;
}

export interface Handler {
  readonly name: string;
  readonly type: string;

  initialize(): Promise<void>;
  execute(config: HandlerConfig, context: Record<string, unknown>): Promise<HandlerResult>;
  shutdown(): Promise<void>;
}
