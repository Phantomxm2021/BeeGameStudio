/**
 * ErrorLogger - Comprehensive error logging utility
 * 
 * Provides structured logging with support for log levels and categories
 * to help diagnose issues across the markdown rendering pipeline.
 * 
 * Requirements: 5.1, 7.1, 7.3
 */

/**
 * Log severity levels
 */
export type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';

/**
 * Log categories for different parts of the system
 */
export type LogCategory = 'transmission' | 'validation' | 'rendering' | 'persistence';

/**
 * Structured log context
 */
export interface LogContext {
  messageId?: string;
  taskId?: string;
  content?: string;
  error?: Error | string;
  timestamp: number;
  [key: string]: unknown;
}

/**
 * Complete log entry structure
 */
export interface ErrorLog {
  level: LogLevel;
  category: LogCategory;
  message: string;
  context: LogContext;
}

/**
 * ErrorLogger class
 * Provides structured logging with level and category support
 */
export class ErrorLogger {
  private readonly LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3
  };

  private readonly LOG_LEVEL_COLORS: Record<LogLevel, string> = {
    DEBUG: '#6B7280', // gray
    INFO: '#3B82F6',  // blue
    WARN: '#F59E0B',  // amber
    ERROR: '#EF4444'  // red
  };

  private readonly CATEGORY_EMOJIS: Record<LogCategory, string> = {
    transmission: '📡',
    validation: '✓',
    rendering: '🎨',
    persistence: '💾'
  };

  private minLogLevel: LogLevel = 'INFO';

  /**
   * Set the minimum log level to display
   * Logs below this level will be filtered out
   * 
   * @param level - Minimum log level (DEBUG, INFO, WARN, ERROR)
   */
  setMinLogLevel(level: LogLevel): void {
    this.minLogLevel = level;
  }

  /**
   * Log an error message
   * 
   * @param category - Log category
   * @param message - Error message
   * @param context - Additional context information
   */
  error(category: LogCategory, message: string, context: Partial<LogContext> = {}): void {
    this.log('ERROR', category, message, context);
  }

  /**
   * Log a warning message
   * 
   * @param category - Log category
   * @param message - Warning message
   * @param context - Additional context information
   */
  warn(category: LogCategory, message: string, context: Partial<LogContext> = {}): void {
    this.log('WARN', category, message, context);
  }

  /**
   * Log an info message
   * 
   * @param category - Log category
   * @param message - Info message
   * @param context - Additional context information
   */
  info(category: LogCategory, message: string, context: Partial<LogContext> = {}): void {
    this.log('INFO', category, message, context);
  }

  /**
   * Log a debug message
   * 
   * @param category - Log category
   * @param message - Debug message
   * @param context - Additional context information
   */
  debug(category: LogCategory, message: string, context: Partial<LogContext> = {}): void {
    this.log('DEBUG', category, message, context);
  }

  /**
   * Core logging method
   * 
   * @param level - Log level
   * @param category - Log category
   * @param message - Log message
   * @param context - Additional context information
   */
  private log(
    level: LogLevel,
    category: LogCategory,
    message: string,
    context: Partial<LogContext> = {}
  ): void {
    // Filter based on minimum log level
    if (this.LOG_LEVEL_PRIORITY[level] < this.LOG_LEVEL_PRIORITY[this.minLogLevel]) {
      return;
    }

    // Build complete log entry
    const logEntry: ErrorLog = {
      level,
      category,
      message,
      context: {
        ...context,
        timestamp: context.timestamp || Date.now()
      }
    };

    // Format and output to console
    this.outputToConsole(logEntry);
  }

  /**
   * Output formatted log to console
   * 
   * @param logEntry - The log entry to output
   */
  private outputToConsole(logEntry: ErrorLog): void {
    const { level, category, message, context } = logEntry;

    const emoji = this.CATEGORY_EMOJIS[category];
    const color = this.LOG_LEVEL_COLORS[level];
    const timestamp = new Date(context.timestamp).toISOString();

    // Format the log prefix
    const prefix = `[${timestamp}] ${emoji} [${category.toUpperCase()}] [${level}]`;

    // Choose console method based on level
    const consoleMethod = level === 'ERROR' ? console.error :
      level === 'WARN' ? console.warn :
        level === 'DEBUG' ? console.debug :
          console.log;

    // Output with styling
    consoleMethod(
      `%c${prefix}%c ${message}`,
      `color: ${color}; font-weight: bold;`,
      'color: inherit;'
    );

    // Output context if present (excluding timestamp)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { timestamp: _ts, ...contextWithoutTimestamp } = context;
    if (Object.keys(contextWithoutTimestamp).length > 0) {
      consoleMethod('Context:', contextWithoutTimestamp);
    }
  }
}

// Export singleton instance
export const errorLogger = new ErrorLogger();

// Export class for testing
export { ErrorLogger as ErrorLoggerClass };
