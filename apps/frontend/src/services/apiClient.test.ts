import { describe, expect, it } from 'vitest';

import { API_BASE_URL } from './apiClient';

describe('apiClient defaults', () => {
  it('uses same-origin requests by default', () => {
    expect(API_BASE_URL).toBe('');
  });
});
