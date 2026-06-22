import { describe, expect, it } from 'vitest';
import { formatTaskId, formatMessageContent } from './formatters';

describe('formatters', () => {
  it('formats wp task ids and preserves other ids', () => {
    expect(formatTaskId('wp_1')).toBe('Task_1');
    expect(formatTaskId('wp_123')).toBe('Task_123');
    expect(formatTaskId('task_1')).toBe('task_1');
    expect(formatTaskId(null)).toBe('');
  });

  it('formats wp references inside message content', () => {
    expect(formatMessageContent('Please check wp_1 and wp_2.')).toBe('Please check Task_1 and Task_2.');
    expect(formatMessageContent('The term wp_ is not replaced.')).toBe('The term wp_ is not replaced.');
    expect(formatMessageContent('Task wp_999 is finished.')).toBe('Task Task_999 is finished.');
    expect(formatMessageContent('wp_1, wp_2, wp_3')).toBe('Task_1, Task_2, Task_3');
  });
});
