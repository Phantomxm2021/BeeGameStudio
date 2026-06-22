/**
 * ErrorLogger Unit Tests
 * 
 * Tests for the ErrorLogger utility
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ErrorLoggerClass } from './errorLogger';

describe('ErrorLogger', () => {
  let logger: ErrorLoggerClass;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleDebugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logger = new ErrorLoggerClass();

    // Clear all mocks
    vi.clearAllMocks();

    // Spy on console methods
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => { });
    consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => { });
  });

  describe('Log Level Support', () => {
    it('should log ERROR messages', () => {
      logger.error('rendering', 'Test error message');

      expect(consoleErrorSpy).toHaveBeenCalled();
      const call = consoleErrorSpy.mock.calls[0];
      expect(call[0]).toContain('[RENDERING]');
      expect(call[0]).toContain('[ERROR]');
      expect(call[0]).toContain('Test error message');
    });

    it('should log WARN messages', () => {
      logger.warn('validation', 'Test warning message');

      expect(consoleWarnSpy).toHaveBeenCalled();
      const call = consoleWarnSpy.mock.calls[0];
      expect(call[0]).toContain('[VALIDATION]');
      expect(call[0]).toContain('[WARN]');
      expect(call[0]).toContain('Test warning message');
    });

    it('should log INFO messages', () => {
      logger.info('transmission', 'Test info message');

      expect(consoleLogSpy).toHaveBeenCalled();
      const call = consoleLogSpy.mock.calls[0];
      expect(call[0]).toContain('[TRANSMISSION]');
      expect(call[0]).toContain('[INFO]');
      expect(call[0]).toContain('Test info message');
    });

    it('should log DEBUG messages when min level is DEBUG', () => {
      logger.setMinLogLevel('DEBUG');
      logger.debug('persistence', 'Test debug message');

      expect(consoleDebugSpy).toHaveBeenCalled();
      const call = consoleDebugSpy.mock.calls[0];
      expect(call[0]).toContain('[PERSISTENCE]');
      expect(call[0]).toContain('[DEBUG]');
      expect(call[0]).toContain('Test debug message');
    });

    it('should filter DEBUG messages when min level is INFO', () => {
      logger.setMinLogLevel('INFO');
      logger.debug('rendering', 'This should not appear');

      expect(consoleDebugSpy).not.toHaveBeenCalled();
    });

    it('should filter INFO and DEBUG messages when min level is WARN', () => {
      logger.setMinLogLevel('WARN');

      logger.info('rendering', 'This should not appear');
      logger.debug('rendering', 'This should not appear');

      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(consoleDebugSpy).not.toHaveBeenCalled();
    });

    it('should only log ERROR messages when min level is ERROR', () => {
      logger.setMinLogLevel('ERROR');

      logger.warn('rendering', 'This should not appear');
      logger.info('rendering', 'This should not appear');
      logger.debug('rendering', 'This should not appear');

      expect(consoleWarnSpy).not.toHaveBeenCalled();
      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(consoleDebugSpy).not.toHaveBeenCalled();
    });
  });

  describe('Category-Based Logging', () => {
    it('should support transmission category', () => {
      logger.error('transmission', 'WebSocket error');

      expect(consoleErrorSpy).toHaveBeenCalled();
      const call = consoleErrorSpy.mock.calls[0];
      expect(call[0]).toContain('[TRANSMISSION]');
      expect(call[0]).toContain('📡');
    });

    it('should support validation category', () => {
      logger.error('validation', 'Validation error');

      expect(consoleErrorSpy).toHaveBeenCalled();
      const call = consoleErrorSpy.mock.calls[0];
      expect(call[0]).toContain('[VALIDATION]');
      expect(call[0]).toContain('✓');
    });

    it('should support rendering category', () => {
      logger.error('rendering', 'Rendering error');

      expect(consoleErrorSpy).toHaveBeenCalled();
      const call = consoleErrorSpy.mock.calls[0];
      expect(call[0]).toContain('[RENDERING]');
      expect(call[0]).toContain('🎨');
    });

    it('should support persistence category', () => {
      logger.error('persistence', 'Storage error');

      expect(consoleErrorSpy).toHaveBeenCalled();
      const call = consoleErrorSpy.mock.calls[0];
      expect(call[0]).toContain('[PERSISTENCE]');
      expect(call[0]).toContain('💾');
    });
  });

  describe('Structured Log Format with Context', () => {
    it('should include timestamp in log output', () => {
      const timestamp = Date.now();
      logger.error('rendering', 'Test message', { timestamp });

      expect(consoleErrorSpy).toHaveBeenCalled();
      const call = consoleErrorSpy.mock.calls[0];
      expect(call[0]).toContain(new Date(timestamp).toISOString());
    });

    it('should log context with messageId', () => {
      logger.error('rendering', 'Test message', { messageId: 'msg-123' });

      expect(consoleErrorSpy).toHaveBeenCalledTimes(2);
      const contextCall = consoleErrorSpy.mock.calls[1];
      expect(contextCall[0]).toBe('Context:');
      expect(contextCall[1]).toHaveProperty('messageId', 'msg-123');
    });

    it('should log context with taskId', () => {
      logger.error('validation', 'Test message', { taskId: 'task-456' });

      expect(consoleErrorSpy).toHaveBeenCalledTimes(2);
      const contextCall = consoleErrorSpy.mock.calls[1];
      expect(contextCall[1]).toHaveProperty('taskId', 'task-456');
    });

    it('should log context with content preview', () => {
      const content = 'Some markdown content';
      logger.error('rendering', 'Test message', { content });

      expect(consoleErrorSpy).toHaveBeenCalledTimes(2);
      const contextCall = consoleErrorSpy.mock.calls[1];
      expect(contextCall[1]).toHaveProperty('content', content);
    });

    it('should log context with error object', () => {
      const error = new Error('Test error');
      logger.error('rendering', 'Test message', { error });

      expect(consoleErrorSpy).toHaveBeenCalledTimes(2);
      const contextCall = consoleErrorSpy.mock.calls[1];
      expect(contextCall[1]).toHaveProperty('error', error);
    });

    it('should log context with multiple fields', () => {
      logger.error('rendering', 'Test message', {
        messageId: 'msg-123',
        taskId: 'task-456',
        content: 'Some content',
        error: new Error('Test error')
      });

      expect(consoleErrorSpy).toHaveBeenCalledTimes(2);
      const contextCall = consoleErrorSpy.mock.calls[1];
      expect(contextCall[1]).toHaveProperty('messageId', 'msg-123');
      expect(contextCall[1]).toHaveProperty('taskId', 'task-456');
      expect(contextCall[1]).toHaveProperty('content', 'Some content');
      expect(contextCall[1]).toHaveProperty('error');
    });

    it('should not log context when empty', () => {
      logger.error('rendering', 'Test message', {});

      // Should only be called once for the main message, not for context
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });

    it('should exclude timestamp from context output', () => {
      const timestamp = Date.now();
      logger.error('rendering', 'Test message', {
        timestamp,
        messageId: 'msg-123'
      });

      expect(consoleErrorSpy).toHaveBeenCalledTimes(2);
      const contextCall = consoleErrorSpy.mock.calls[1];
      expect(contextCall[1]).not.toHaveProperty('timestamp');
      expect(contextCall[1]).toHaveProperty('messageId', 'msg-123');
    });
  });

  describe('Console Output with Formatting', () => {
    it('should use console.error for ERROR level', () => {
      logger.error('rendering', 'Test error');

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(consoleWarnSpy).not.toHaveBeenCalled();
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should use console.warn for WARN level', () => {
      logger.warn('rendering', 'Test warning');

      expect(consoleWarnSpy).toHaveBeenCalled();
      expect(consoleErrorSpy).not.toHaveBeenCalled();
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should use console.log for INFO level', () => {
      logger.info('rendering', 'Test info');

      expect(consoleLogSpy).toHaveBeenCalled();
      expect(consoleErrorSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('should use console.debug for DEBUG level', () => {
      logger.setMinLogLevel('DEBUG');
      logger.debug('rendering', 'Test debug');

      expect(consoleDebugSpy).toHaveBeenCalled();
      expect(consoleErrorSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).not.toHaveBeenCalled();
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should apply color styling to log output', () => {
      logger.error('rendering', 'Test message');

      const call = consoleErrorSpy.mock.calls[0];
      // Check that styling is applied (second argument contains color)
      expect(call[1]).toContain('color:');
      expect(call[1]).toContain('#EF4444'); // ERROR color
    });
  });
});
