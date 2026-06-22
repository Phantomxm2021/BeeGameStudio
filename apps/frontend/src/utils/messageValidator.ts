/**
 * Message Validator
 * 
 * Validates and sanitizes incoming WebSocket messages before storing.
 * Detects data corruption patterns and attempts content repair.
 * 
 * This module is a critical part of the error handling pipeline, ensuring that
 * all messages received from the WebSocket connection are properly validated
 * before being stored in the chat store. It prevents corrupted or malicious
 * data from breaking the rendering pipeline.
 * 
 * Key Features:
 * - Schema validation for all message types
 * - Content sanitization to remove harmful scripts
 * - Data corruption detection (broken tables, unclosed code blocks, etc.)
 * - Automatic content repair for common corruption patterns
 * - Comprehensive error logging for debugging
 * 
 * Requirements: 1.3, 6.1, 6.2, 6.3, 6.4
 */

import type { WebSocketMessage, WebSocketMessageType } from '../types/message';
import { errorLogger } from './errorLogger';

/**
 * Validation error details
 * 
 * Represents a single validation error or warning found during message validation.
 * Includes the field that failed validation, a human-readable message, severity level,
 * and optionally a suggested fix.
 */
export interface ValidationError {
  /** The field name that failed validation */
  field: string;
  /** Human-readable error message */
  message: string;
  /** Severity level: 'error' blocks processing, 'warning' allows processing */
  severity: 'error' | 'warning';
  /** Optional suggestion for how to fix the error */
  suggestedFix?: string;
}

/**
 * Result of message validation
 * 
 * Contains the validation status, any errors/warnings found, the sanitized message
 * (if validation passed), and whether data corruption was detected.
 */
export interface ValidationResult {
  /** Whether the message passed validation */
  isValid: boolean;
  /** Array of validation errors (blocks processing) */
  errors: ValidationError[];
  /** Array of validation warnings (allows processing) */
  warnings: ValidationError[];
  /** Sanitized version of the message (only if isValid is true) */
  sanitizedMessage?: WebSocketMessage;
  /** Whether data corruption patterns were detected in the content */
  corruptionDetected: boolean;
}

/**
 * MessageValidator class
 * 
 * Provides validation, sanitization, and repair functionality for WebSocket messages.
 * This is the primary entry point for validating all incoming WebSocket messages
 * before they are stored in the application state.
 * 
 * Usage:
 * ```typescript
 * const validator = new MessageValidator();
 * const result = validator.validateMessage(rawMessage);
 * if (result.isValid) {
 *   store.addMessage(result.sanitizedMessage);
 * } else {
 *   console.error('Validation failed:', result.errors);
 * }
 * ```
 */
console.log("[MessageValidator] VERSION 1.4.1 (Phase 2 Hotfix) LOADED");

export class MessageValidator {
  /** List of valid message types accepted by the system */
  private readonly VALID_MESSAGE_TYPES: WebSocketMessageType[] = [
    'token',
    'agent_message',
    'thought',
    'status',
    'tool_start',
    'tool_end',
    'usage',
    'pipeline_update',
    'human_gate',
    'artifact_created',
    'context_update',
    'error',
    'error_paused',
    'plan_approved',
    'p2p_route',
    'phase_update',
    'project_renamed'
  ];

  private readonly VALID_STATUS_VALUES = ['queued', 'running', 'resuming', 'paused', 'finished', 'failed', 'stopped'] as const;

  /**
   * Validates a WebSocket message structure and content
   * 
   * Performs comprehensive validation including:
   * - Type checking for all fields
   * - Required field validation
   * - Content sanitization
   * - Corruption detection
   * 
   * @param message - The WebSocket message to validate (can be any type)
   * @returns ValidationResult with validation status, errors, warnings, and sanitized message
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  validateMessage(message: any): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];
    let corruptionDetected = false;

    // Check if message is an object
    if (!message || typeof message !== 'object') {
      const error = {
        field: 'message',
        message: 'Message must be an object',
        severity: 'error' as const
      };
      errors.push(error);

      // Log validation error
      errorLogger.error('validation', 'Invalid message type received', {
        error: 'Message must be an object',
        messageType: typeof message
      });

      return {
        isValid: false,
        errors,
        warnings,
        corruptionDetected: false
      };
    }

    // Validate required field: type
    if (!message.type) {
      errors.push({
        field: 'type',
        message: 'Message type is required',
        severity: 'error'
      });
    } else if (!this.VALID_MESSAGE_TYPES.includes(message.type)) {
      errors.push({
        field: 'type',
        message: `Invalid message type: ${message.type}`,
        severity: 'error',
        suggestedFix: `Use one of: ${this.VALID_MESSAGE_TYPES.join(', ')}`
      });
    }

    // Validate required field: task_id (optional for some types)
    const typesRequiringTaskId: WebSocketMessageType[] = ['token', 'agent_message', 'thought', 'status', 'tool_start', 'tool_end', 'error_paused'];
    const isTaskIdRequired = typesRequiringTaskId.includes(message.type);

    if (isTaskIdRequired && !message.task_id) {
      warnings.push({
        field: 'task_id',
        message: `Task ID is missing for message type: ${message.type}. This might cause mapping issues.`,
        severity: 'warning'
      });
      // For now, don't block on missing task_id to prevent system lockout
      // but log it clearly
      console.warn(`[MessageValidator] Missing task_id for ${message.type}`, message);
    } else if (message.task_id && typeof message.task_id !== 'string') {
      errors.push({
        field: 'task_id',
        message: 'Task ID must be a string',
        severity: 'error'
      });
    }


    // Validate content field if present
    if (message.content !== undefined) {
      if (typeof message.content !== 'string') {
        errors.push({
          field: 'content',
          message: 'Content must be a string',
          severity: 'error'
        });
      } else {
        // Check for corruption in content
        if (this.detectCorruption(message.content)) {
          corruptionDetected = true;
          warnings.push({
            field: 'content',
            message: 'Potential data corruption detected in content',
            severity: 'warning',
            suggestedFix: 'Content may need repair'
          });
        }
      }
    }

    if (message.type === 'status') {
      if (!message.status || typeof message.status !== 'string') {
        errors.push({
          field: 'status',
          message: 'status field is required for status messages',
          severity: 'error'
        });
      } else if (!this.VALID_STATUS_VALUES.includes(message.status)) {
        errors.push({
          field: 'status',
          message: `Invalid status value: ${message.status}`,
          severity: 'error',
          suggestedFix: `Use one of: ${this.VALID_STATUS_VALUES.join(', ')}`
        });
      }
    }

    // Validate sender field if present
    if (message.sender !== undefined && typeof message.sender !== 'string') {
      errors.push({
        field: 'sender',
        message: 'Sender must be a string',
        severity: 'error'
      });
    }

    // Validate tool field if present
    if (message.tool !== undefined && typeof message.tool !== 'string') {
      errors.push({
        field: 'tool',
        message: 'Tool must be a string',
        severity: 'error'
      });
    }

    // Validate output field if present
    if (message.output !== undefined && typeof message.output !== 'string') {
      errors.push({
        field: 'output',
        message: 'Output must be a string',
        severity: 'error'
      });
    }

    // Validate error field if present
    if (message.error !== undefined && typeof message.error !== 'string') {
      errors.push({
        field: 'error',
        message: 'Error must be a string',
        severity: 'error'
      });
    }

    // Validate usage field if present
    if (message.usage !== undefined) {
      if (typeof message.usage !== 'object' || message.usage === null) {
        errors.push({
          field: 'usage',
          message: 'Usage must be a non-null object',
          severity: 'error'
        });
      } else {
        // Validate usage fields (make optional to be safe)
        if (message.usage.prompt_tokens !== undefined && typeof message.usage.prompt_tokens !== 'number') {
          errors.push({
            field: 'usage.prompt_tokens',
            message: 'prompt_tokens must be a number',
            severity: 'error'
          });
        }
        if (message.usage.completion_tokens !== undefined && typeof message.usage.completion_tokens !== 'number') {
          errors.push({
            field: 'usage.completion_tokens',
            message: 'completion_tokens must be a number',
            severity: 'error'
          });
        }
        if (message.usage.total_tokens !== undefined && typeof message.usage.total_tokens !== 'number') {
          errors.push({
            field: 'usage.total_tokens',
            message: 'total_tokens must be a number',
            severity: 'error'
          });
        }
      }
    }

    if (message.context !== undefined) {
      if (typeof message.context !== 'object' || message.context === null) {
        errors.push({
          field: 'context',
          message: 'Context must be a non-null object',
          severity: 'error'
        });
      } else {
        for (const field of ['bundle_id', 'phase', 'status', 'summary', 'failure_reason']) {
          if (message.context[field] !== undefined && typeof message.context[field] !== 'string') {
            errors.push({
              field: `context.${field}`,
              message: `${field} must be a string`,
              severity: 'error'
            });
          }
        }
        for (const field of ['blackboard_record_count', 'memory_hits']) {
          if (message.context[field] !== undefined && typeof message.context[field] !== 'number') {
            errors.push({
              field: `context.${field}`,
              message: `${field} must be a number`,
              severity: 'error'
            });
          }
        }
      }
    }

    // If validation passed, sanitize the message
    const isValid = errors.length === 0;
    let sanitizedMessage: WebSocketMessage | undefined;

    if (isValid) {
      sanitizedMessage = {
        ...message,
        content: message.content ? this.sanitizeContent(message.content) : undefined,
        error: message.error ? this.sanitizeContent(message.error) : undefined,
        output: message.output ? this.sanitizeContent(message.output) : undefined
      };

      // Log warnings if corruption was detected
      if (corruptionDetected || warnings.length > 0) {
        errorLogger.warn('validation', 'Message validation warnings occurred', {
          taskId: message.task_id,
          messageType: message.type,
          warnings: warnings.map(w => w.message)
        });
      }
    } else {
      // Log validation failure
      errorLogger.error('validation', 'Message validation failed', {
        taskId: message.task_id,
        messageType: message.type,
        messageId: message.id,
        errors: errors.map(e => `${e.field}: ${e.message}`),
        warnings: warnings.map(w => w.message),
        rawMessage: message
      });
    }


    return {
      isValid,
      errors,
      warnings,
      sanitizedMessage,
      corruptionDetected
    };
  }

  /**
   * Sanitizes content to remove potentially harmful scripts
   * 
   * Removes dangerous HTML/JavaScript while preserving markdown syntax.
   * This prevents XSS attacks and other security vulnerabilities.
   * 
   * Removes:
   * - <script> tags and their content
   * - Inline event handlers (onclick, onerror, etc.)
   * - javascript: protocol in links
   * - data: URIs (except data:image)
   * - <iframe>, <object>, and <embed> tags
   * 
   * @param content - The content to sanitize
   * @returns Sanitized content safe for rendering
   */
  sanitizeContent(content: string): string {
    if (!content) return content;

    let sanitized = content;

    // Remove script tags and their content
    sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

    // Remove inline event handlers (onclick, onerror, etc.)
    sanitized = sanitized.replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '');
    sanitized = sanitized.replace(/\s*on\w+\s*=\s*[^\s>]*/gi, '');

    // Remove javascript: protocol in links
    sanitized = sanitized.replace(/javascript:/gi, '');

    // Remove data: URIs that could contain scripts (but allow data:image)
    sanitized = sanitized.replace(/data:(?!image)[^,]*,/gi, '');

    // Remove iframe tags
    sanitized = sanitized.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');

    // Remove object and embed tags
    sanitized = sanitized.replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '');
    sanitized = sanitized.replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, '');

    return sanitized;
  }

  /**
   * Detects common data corruption patterns in content
   * 
   * Checks for various corruption indicators including:
   * - Excessive escape sequences (\\\\\\)
   * - Malformed JSON escape sequences
   * - Broken table syntax (pipes without proper structure)
   * - Unclosed code blocks (odd number of ```)
   * - Excessive repeated characters (potential corruption)
   * 
   * @param content - The content to check for corruption
   * @returns true if corruption is detected, false otherwise
   */
  detectCorruption(content: string): boolean {
    if (!content) return false;

    // Check for excessive escape sequences (e.g., \\\\\\)
    if (/\\{4,}/.test(content)) {
      return true;
    }

    // Check for malformed JSON escape sequences in markdown
    if (/\\[^\\nrt"'bfuv/]/.test(content)) {
      return true;
    }

    // Check for broken table syntax (pipes without proper structure)
    const lines = content.split('\n');
    for (const line of lines) {
      // If line has pipes but doesn't look like a valid table row
      if (line.includes('|')) {
        const trimmed = line.trim();
        // Check if it's a table separator line (e.g., |---|---|)
        const isSeparator = /^\|[\s\-:]+\|[\s\-:|]*$/.test(trimmed);
        // Check if it's a table row (starts and ends with |)
        const isTableRow = /^\|.*\|$/.test(trimmed);

        if (!isSeparator && !isTableRow && trimmed.startsWith('|')) {
          return true;
        }
      }
    }

    // Check for unclosed code blocks
    const codeBlockMatches = content.match(/```/g);
    if (codeBlockMatches && codeBlockMatches.length % 2 !== 0) {
      return true;
    }

    // Check for excessive repeated characters (potential corruption)
    if (/(.)\1{20,}/.test(content)) {
      return true;
    }

    return false;
  }

  /**
   * Attempts to repair corrupted content
   * 
   * Applies automatic fixes for common corruption patterns:
   * - Reduces excessive escape sequences to single backslash
   * - Adds missing closing pipes to table rows
   * - Closes unclosed code blocks
   * - Limits excessive character repetition
   * 
   * Note: This is a best-effort repair. Complex corruption may not be fixable.
   * 
   * @param content - The corrupted content to repair
   * @returns Repaired content, or original if repair is not possible
   */
  repairContent(content: string): string {
    if (!content) return content;

    let repaired = content;

    // Fix excessive escape sequences
    repaired = repaired.replace(/\\{3,}/g, '\\');

    // Fix broken table rows (add closing pipe if missing)
    const lines = repaired.split('\n');
    const repairedLines = lines.map(line => {
      if (line.includes('|') && line.trim().startsWith('|') && !line.trim().endsWith('|')) {
        return line + '|';
      }
      return line;
    });
    repaired = repairedLines.join('\n');

    // Fix unclosed code blocks (add closing ``` if missing)
    const codeBlockMatches = repaired.match(/```/g);
    if (codeBlockMatches && codeBlockMatches.length % 2 !== 0) {
      repaired += '\n```';
    }

    // Remove excessive repeated characters (keep max 10 repetitions)
    repaired = repaired.replace(/(.)\1{20,}/g, (_match, char) => char.repeat(10));

    return repaired;
  }
}

// Export singleton instance
export const messageValidator = new MessageValidator();
