import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { PendingToolPermissionItem } from '../services/api';
import {
  countPendingToolPermissions,
  formatPermissionTabTitle,
  usePermissionTabAttention,
} from './usePermissionTabAttention';

describe('usePermissionTabAttention', () => {
  const originalTitle = document.title;

  afterEach(() => {
    document.title = originalTitle;
  });

  it('formats a localized pending-permission title', () => {
    expect(formatPermissionTabTitle('BeeGame', 2, '需要批准'))
      .toBe('(2) 需要批准 · BeeGame');
  });

  it('counts only unresolved native tool permission reviews', () => {
    expect(countPendingToolPermissions([
      {
        gate_id: 'permission-1',
        type: 'BEEGAME_PERMISSION',
      },
      {
        gate_id: '',
        type: 'BEEGAME_PERMISSION',
      },
    ] as PendingToolPermissionItem[])).toBe(1);
  });

  it('shows pending permission count and restores the original title', () => {
    document.title = 'BeeGame';
    const { rerender, unmount } = renderHook(
      ({ count }) => usePermissionTabAttention(count, 'Approval required'),
      { initialProps: { count: 1 } },
    );

    expect(document.title).toBe('(1) Approval required · BeeGame');
    rerender({ count: 3 });
    expect(document.title).toBe('(3) Approval required · BeeGame');
    rerender({ count: 0 });
    expect(document.title).toBe('BeeGame');
    unmount();
    expect(document.title).toBe('BeeGame');
  });
});
