import { describe, expect, it, vi } from 'vitest';
import { MessageValidator } from './messageValidator';

describe('MessageValidator transport boundary', () => {
  const validator = new MessageValidator();

  it('preserves native message content exactly', () => {
    const message = {
      type: 'agent_message',
      task_id: 'task-1',
      sender: 'agent',
      content: '<script>literal example</script>\n```\nunclosed markdown\n||||',
    };

    const result = validator.validateMessage(message);

    expect(result.isValid).toBe(true);
    expect(result.sanitizedMessage).toEqual(message);
    expect(result.sanitizedMessage?.content).toBe(message.content);
  });

  it('rejects an invalid transport envelope without trying to repair it', () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = validator.validateMessage({
      task_id: 'task-1',
      content: 'native content',
    });

    expect(result.isValid).toBe(false);
    expect(result.sanitizedMessage).toBeUndefined();
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'type' }),
    ]));
    expect(errorLog).toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it('keeps a missing task id as a non-mutating warning', () => {
    const warningLog = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const message = { type: 'token', content: 'partial' };
    const result = validator.validateMessage(message);

    expect(result.isValid).toBe(true);
    expect(result.sanitizedMessage).toEqual(message);
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'task_id' }),
    ]));
    expect(warningLog).toHaveBeenCalled();
    warningLog.mockRestore();
  });
});
