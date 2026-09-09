export interface LogContext {
  runId?: string;
  listingId?: string;
  stage?: string;
  event: string;
  status?: string;
  durationMs?: number;
  errorCode?: string;
  [key: string]: unknown;
}

export interface StructuredLogger {
  info(context: LogContext, message?: string): void;
  warn(context: LogContext, message?: string): void;
  error(context: LogContext, message?: string): void;
}
