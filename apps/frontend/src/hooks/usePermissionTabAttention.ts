import { useEffect, useRef } from 'react';
import type { PendingUserReviewItem } from '../services/api';

export const countPendingToolPermissions = (
  reviews: PendingUserReviewItem[],
): number => reviews.filter(review => {
  const status = review?.review_status;
  return String(status?.lane_id || '') === 'permission'
    && Boolean(status?.requires_user_action);
}).length;

export const formatPermissionTabTitle = (
  baseTitle: string,
  pendingCount: number,
  label: string,
): string => {
  if (pendingCount <= 0) return baseTitle;
  return `(${pendingCount}) ${label} · ${baseTitle}`;
};

/**
 * Keeps native tool approvals visible even when the user switches browser
 * tabs. This is presentation only: it does not resolve, retry, or otherwise
 * alter Claude Code's permission request.
 */
export function usePermissionTabAttention(
  pendingCount: number,
  label: string,
): void {
  const baseTitleRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    if (baseTitleRef.current === null) baseTitleRef.current = document.title;

    const baseTitle = baseTitleRef.current;
    const attentionTitle = formatPermissionTabTitle(baseTitle, pendingCount, label);
    document.title = attentionTitle;

    return () => {
      if (document.title === attentionTitle) document.title = baseTitle;
    };
  }, [label, pendingCount]);
}
