import type { LogContext, StructuredLogger } from "./types.js";

export class JsonConsoleLogger implements StructuredLogger {
  public info(context: LogContext, message?: string): void { console.info(JSON.stringify(withMessage(context, message))); }
  public warn(context: LogContext, message?: string): void { console.warn(JSON.stringify(withMessage(context, message))); }
  public error(context: LogContext, message?: string): void { console.error(JSON.stringify(withMessage(context, message))); }
}

function withMessage(context: LogContext, message: string | undefined): LogContext {
  return message === undefined ? context : { ...context, message };
}
