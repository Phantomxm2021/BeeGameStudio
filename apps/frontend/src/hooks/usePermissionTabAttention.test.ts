import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { PendingUserReviewItem } from '../services/api';
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
        review_status: {
          lane_id: 'permission',
          requires_user_action: true,
        },
      },
      {
        gate_id: 'document-review',
        review_status: {
          lane_id: 'internal_board_review',
          requires_user_action: true,
        },
      },
      {
        gate_id: 'resolved-permission',
        review_status: {
          lane_id: 'permission',
          requires_user_action: false,
        },
      },
    ] as PendingUserReviewItem[])).toBe(1);
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
