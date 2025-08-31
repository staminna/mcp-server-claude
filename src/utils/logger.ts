// STDIO Compliant Logging System using stderr for MCP protocol compliance

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

export interface LogContext {
  operation?: string | undefined;
  collection?: string | undefined;
  itemId?: string | number | undefined;
  userId?: string | undefined;
  duration?: number | undefined;
  requestId?: string | undefined;
  [key: string]: any;
}

export class Logger {
  private static instance: Logger;
  private logLevel: LogLevel = LogLevel.INFO;
  private startTimes: Map<string, number> = new Map();

  private constructor() {
    // Set log level from environment
    const envLevel = process.env.LOG_LEVEL?.toUpperCase();
    if (envLevel && envLevel in LogLevel) {
      this.logLevel = LogLevel[envLevel as keyof typeof LogLevel];
    }
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.logLevel;
  }

  private formatMessage(level: string, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString();
    const baseLog = {
      timestamp,
      level,
      message,
      pid: process.pid,
      ...context
    };

    return JSON.stringify(baseLog);
  }

  private writeLog(level: LogLevel, message: string, context?: LogContext): void {
    if (!this.shouldLog(level)) return;

    const levelName = LogLevel[level];
    const formattedMessage = this.formatMessage(levelName, message, context);
    
    // Use stderr to avoid interfering with MCP protocol on stdout
    process.stderr.write(formattedMessage + '\n');
  }

  debug(message: string, context?: LogContext): void {
    this.writeLog(LogLevel.DEBUG, message, context);
  }

  info(message: string, context?: LogContext): void {
    this.writeLog(LogLevel.INFO, message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.writeLog(LogLevel.WARN, message, context);
  }

  error(message: string, context?: LogContext): void {
    this.writeLog(LogLevel.ERROR, message, context);
  }

  // Performance timing utilities
  startTimer(operationId: string): void {
    this.startTimes.set(operationId, Date.now());
  }

  endTimer(operationId: string, message?: string, context?: LogContext): number {
    const startTime = this.startTimes.get(operationId);
    if (!startTime) {
      this.warn('Timer not found for operation', { operationId });
      return 0;
    }

    const duration = Date.now() - startTime;
    this.startTimes.delete(operationId);

    if (message) {
      this.info(message, { ...context, duration, operationId });
    }

    return duration;
  }

  // Structured logging for API operations
  apiRequest(method: string, url: string, context?: LogContext): void {
    this.info('API Request', {
      ...context,
      method,
      url,
      type: 'api_request'
    });
  }

  apiResponse(method: string, url: string, status: number, duration: number, context?: LogContext): void {
    const level = status >= 400 ? LogLevel.ERROR : LogLevel.INFO;
    this.writeLog(level, 'API Response', {
      ...context,
      method,
      url,
      status,
      duration,
      type: 'api_response'
    });
  }

  apiError(method: string, url: string, error: Error, context?: LogContext): void {
    this.error('API Error', {
      ...context,
      method,
      url,
      error: error.message,
      stack: error.stack,
      type: 'api_error'
    });
  }

  // WebSocket logging
  websocketEvent(event: string, context?: LogContext): void {
    this.info('WebSocket Event', {
      ...context,
      event,
      type: 'websocket_event'
    });
  }

  websocketError(error: Error, context?: LogContext): void {
    this.error('WebSocket Error', {
      ...context,
      error: error.message,
      stack: error.stack,
      type: 'websocket_error'
    });
  }

  // Tool execution logging
  toolStart(toolName: string, args: any, context?: LogContext): void {
    this.info('Tool Execution Started', {
      ...context,
      toolName,
      args: JSON.stringify(args),
      type: 'tool_start'
    });
  }

  toolEnd(toolName: string, duration: number, success: boolean, context?: LogContext): void {
    const level = success ? LogLevel.INFO : LogLevel.ERROR;
    this.writeLog(level, 'Tool Execution Completed', {
      ...context,
      toolName,
      duration,
      success,
      type: 'tool_end'
    });
  }

  toolError(toolName: string, error: Error, context?: LogContext): void {
    this.error('Tool Execution Error', {
      ...context,
      toolName,
      error: error.message,
      stack: error.stack,
      type: 'tool_error'
    });
  }
}

// Export singleton instance
export const logger = Logger.getInstance();

// Convenience functions for backward compatibility
export function log(message: string, context?: LogContext): void {
  logger.info(message, context);
}

export function logError(message: string, error?: Error, context?: LogContext): void {
  logger.error(message, {
    ...context,
    error: error?.message,
    stack: error?.stack
  });
}
