/**
 * Unit tests for MessageValidator
 * 
 * Tests validation, sanitization, corruption detection, and repair functionality
 * Requirements: 1.3, 6.1, 6.2, 6.3, 6.4
 */

import { describe, it, expect } from 'vitest';
import { MessageValidator } from './messageValidator';
import type { WebSocketMessage } from '../types/message';

describe('MessageValidator', () => {
  const validator = new MessageValidator();

  describe('validateMessage', () => {
    it('should accept valid token message', () => {
      const message: WebSocketMessage = {
        type: 'token',
        task_id: '123',
        content: 'Hello world',
        sender: 'agent'
      };

      const result = validator.validateMessage(message);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.sanitizedMessage).toBeDefined();
    });

    it('should reject message with missing type', () => {
      const message = {
        task_id: '123',
        content: 'Hello'
      };

      const result = validator.validateMessage(message);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ field: 'type' })
      );
    });

    it('should allow message with missing task_id but add a warning', () => {
      const message = {
        type: 'token',
        content: 'Hello'
      };

      const result = validator.validateMessage(message);

      expect(result.isValid).toBe(true);
      expect(result.warnings).toContainEqual(
        expect.objectContaining({ field: 'task_id', severity: 'warning' })
      );
    });

    it('should reject message with invalid type', () => {
      const message = {
        type: 'invalid_type',
        task_id: '123',
        content: 'Hello'
      };

      const result = validator.validateMessage(message);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ 
          field: 'type',
          message: expect.stringContaining('Invalid message type')
        })
      );
    });

    it('should reject message with non-string content', () => {
      const message = {
        type: 'token',
        task_id: '123',
        content: 123
      };

      const result = validator.validateMessage(message);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ field: 'content' })
      );
    });

    it('should reject message with non-string task_id', () => {
      const message = {
        type: 'token',
        task_id: 123,
        content: 'Hello'
      };

      const result = validator.validateMessage(message);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ field: 'task_id' })
      );
    });

    it('should validate usage message with token counts', () => {
      const message: WebSocketMessage = {
        type: 'usage',
        task_id: '123',
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30
        }
      };

      const result = validator.validateMessage(message);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate runtime artifact and context update messages', () => {
      const artifactMessage: WebSocketMessage = {
        type: 'artifact_created',
        task_id: 'pipe_123',
        project_id: 'proj_123',
        artifact_id: 'art_123',
        artifact_type: 'gdd',
        name: 'GDD.md',
      };
      const contextMessage: WebSocketMessage = {
        type: 'context_update',
        task_id: 'pipe_123',
        project_id: 'proj_123',
        context: {
          bundle_id: 'ctx_123',
          phase: 'gdd',
          status: 'ready',
          blackboard_record_count: 1,
          memory_hits: 2,
          rag_sources: ['docs/SystemDesign/05.md'],
          selected_skills: ['gdd_contract'],
        },
      };

      expect(validator.validateMessage(artifactMessage).isValid).toBe(true);
      expect(validator.validateMessage(contextMessage).isValid).toBe(true);
    });

    it('should reject usage message with invalid token counts', () => {
      const message = {
        type: 'usage',
        task_id: '123',
        usage: {
          prompt_tokens: '10',
          completion_tokens: 20,
          total_tokens: 30
        }
      };

      const result = validator.validateMessage(message);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ field: 'usage.prompt_tokens' })
      );
    });

    it('should detect corruption in content', () => {
      const message = {
        type: 'token',
        task_id: '123',
        content: 'Hello \\\\\\\\world'
      };

      const result = validator.validateMessage(message);

      expect(result.isValid).toBe(true);
      expect(result.corruptionDetected).toBe(true);
      expect(result.warnings).toContainEqual(
        expect.objectContaining({ 
          field: 'content',
          severity: 'warning'
        })
      );
    });
  });

  describe('sanitizeContent', () => {
    it('should remove script tags', () => {
      const content = '<script>alert("xss")</script>Hello world';
      const sanitized = validator.sanitizeContent(content);

      expect(sanitized).not.toContain('<script>');
      expect(sanitized).toContain('Hello world');
    });

    it('should remove inline event handlers', () => {
      const content = '<div onclick="alert(1)">Click me</div>';
      const sanitized = validator.sanitizeContent(content);

      expect(sanitized).not.toContain('onclick');
      expect(sanitized).toContain('Click me');
    });

    it('should remove javascript: protocol', () => {
      const content = '<a href="javascript:alert(1)">Link</a>';
      const sanitized = validator.sanitizeContent(content);

      expect(sanitized).not.toContain('javascript:');
      expect(sanitized).toContain('Link');
    });

    it('should remove iframe tags', () => {
      const content = '<iframe src="evil.com"></iframe>Safe content';
      const sanitized = validator.sanitizeContent(content);

      expect(sanitized).not.toContain('<iframe');
      expect(sanitized).toContain('Safe content');
    });

    it('should preserve markdown syntax', () => {
      const content = '# Header\n\n**bold** and *italic*\n\n```js\ncode\n```';
      const sanitized = validator.sanitizeContent(content);

      expect(sanitized).toBe(content);
    });

    it('should preserve data:image URIs', () => {
      const content = '![image](data:image/png;base64,abc123)';
      const sanitized = validator.sanitizeContent(content);

      expect(sanitized).toContain('data:image');
    });

    it('should remove non-image data URIs', () => {
      const content = '<a href="data:text/html,<script>alert(1)</script>">Link</a>';
      const sanitized = validator.sanitizeContent(content);

      expect(sanitized).not.toContain('data:text');
    });
  });

  describe('detectCorruption', () => {
    it('should detect excessive escape sequences', () => {
      const content = 'Hello \\\\\\\\world';
      expect(validator.detectCorruption(content)).toBe(true);
    });

    it('should detect broken table syntax', () => {
      const content = '| Col1 | Col2\n|------|------|\n| A | B |';
      expect(validator.detectCorruption(content)).toBe(true);
    });

    it('should detect unclosed code blocks', () => {
      const content = '```js\nconst x = 1;\n';
      expect(validator.detectCorruption(content)).toBe(true);
    });

    it('should detect excessive repeated characters', () => {
      const content = 'Hello aaaaaaaaaaaaaaaaaaaaaaaaa world';
      expect(validator.detectCorruption(content)).toBe(true);
    });

    it('should not detect corruption in valid markdown', () => {
      const content = '# Header\n\n| Col1 | Col2 |\n|------|------|\n| A | B |\n\n```js\ncode\n```';
      expect(validator.detectCorruption(content)).toBe(false);
    });

    it('should not detect corruption in valid table', () => {
      const content = '| Name | Age |\n|------|-----|\n| John | 30 |';
      expect(validator.detectCorruption(content)).toBe(false);
    });

    it('should handle empty content', () => {
      expect(validator.detectCorruption('')).toBe(false);
    });
  });

  describe('repairContent', () => {
    it('should fix excessive escape sequences', () => {
      const content = 'Hello \\\\\\\\world';
      const repaired = validator.repairContent(content);

      expect(repaired).toBe('Hello \\world');
    });

    it('should fix broken table rows', () => {
      const content = '| Col1 | Col2\n|------|------|\n| A | B |';
      const repaired = validator.repairContent(content);

      // Should add closing pipe to first row
      expect(repaired).toBe('| Col1 | Col2|\n|------|------|\n| A | B |');
    });

    it('should fix unclosed code blocks', () => {
      const content = '```js\nconst x = 1;\n';
      const repaired = validator.repairContent(content);

      // Should add closing ``` with newline
      expect(repaired).toBe('```js\nconst x = 1;\n\n```');
    });

    it('should fix excessive repeated characters', () => {
      const content = 'Hello aaaaaaaaaaaaaaaaaaaaaaaaa world';
      const repaired = validator.repairContent(content);

      expect(repaired).toBe('Hello aaaaaaaaaa world');
    });

    it('should not modify valid content', () => {
      const content = '# Header\n\n| Col1 | Col2 |\n|------|------|\n| A | B |';
      const repaired = validator.repairContent(content);

      expect(repaired).toBe(content);
    });

    it('should handle empty content', () => {
      expect(validator.repairContent('')).toBe('');
    });
  });
});
