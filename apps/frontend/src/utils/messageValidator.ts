/**
 * Message Validator
 * 
 * Validates the transport shape of incoming WebSocket messages before storing.
 * 
 * This module is a critical part of the error handling pipeline, ensuring that
 * all messages received from the WebSocket connection are properly validated
 * before being stored in the chat store. Message content remains byte-for-byte
 * unchanged; rendering safety belongs to the renderer, not the transport.
 * 
 * Key Features:
 * - Schema validation for all message types
 * - Comprehensive error logging for debugging
 * 
 * Requirements: 1.3, 6.1, 6.2, 6.3, 6.4
 */

import type { ProjectEventMessage, ProjectEventMessageType } from '../types/message';
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
 * Contains the validation status, any errors/warnings found, and the original
 * message when its transport shape is valid.
 */
export interface ValidationResult {
  /** Whether the message passed validation */
  isValid: boolean;
  /** Array of validation errors (blocks processing) */
  errors: ValidationError[];
  /** Array of validation warnings (allows processing) */
  warnings: ValidationError[];
  /** Original message (only if isValid is true) */
  sanitizedMessage?: ProjectEventMessage;
}

/**
 * MessageValidator class
 * 
 * Provides structural validation for WebSocket messages.
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
export class MessageValidator {
  /** List of valid message types accepted by the system */
  private readonly VALID_MESSAGE_TYPES: ProjectEventMessageType[] = [
    'token',
    'agent_message',
    'thought',
    'status',
    'tool_start',
    'tool_end',
    'usage',
    'human_gate',
    'artifact_created',
    'context_update',
    'error',
    'error_paused',
    'p2p_route',
    'project_renamed'
  ];

  private readonly VALID_STATUS_VALUES = ['queued', 'running', 'resuming', 'paused', 'idle', 'finished', 'failed', 'stopped'] as const;

  /**
   * Validates a WebSocket message structure without interpreting its content.
   * 
   * Performs comprehensive validation including:
   * - Type checking for all fields
   * - Required field validation
   * @param message - The WebSocket message to validate (can be any type)
   * @returns ValidationResult with validation status, errors, warnings, and original message
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  validateMessage(message: any): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];
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
        warnings
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
    const typesRequiringTaskId: ProjectEventMessageType[] = ['token', 'agent_message', 'thought', 'status', 'tool_start', 'tool_end', 'error_paused'];
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

    // Preserve native content exactly. React/Markdown rendering owns output
    // safety; transport code must never rewrite Claude Code events.
    const isValid = errors.length === 0;
    const sanitizedMessage = isValid ? message as ProjectEventMessage : undefined;

    if (isValid) {
      if (warnings.length > 0) {
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
      sanitizedMessage
    };
  }
}

// Export singleton instance
export const messageValidator = new MessageValidator();
