import { describe, expect, it } from 'vitest';

import { getReviewBindingSummary, getReviewWorkspaceRef, isPinnedReviewBinding } from './SidebarUtils';

describe('Sidebar review binding helpers', () => {
    it('treats checkpoint-bound review payloads as pinned baseline', () => {
        const review = {
            binding: {
                checkpoint_id: 'chk_gdd',
                workspace_ref: '/tmp/workspace/specs/GDD.md',
            },
        };

        expect(isPinnedReviewBinding(review)).toBe(true);
        expect(getReviewWorkspaceRef(review)).toBe('/tmp/workspace/specs/GDD.md');
        expect(getReviewBindingSummary(review)).toBe('Baseline: checkpoint chk_gdd');
    });

    it('falls back to compact artifact metadata when no checkpoint is present', () => {
        const review = {
            binding: {
                artifact_version: 3,
                workspace_path: '/tmp/workspace/specs/GDD.md',
            },
        };

        expect(isPinnedReviewBinding(review)).toBe(false);
        expect(getReviewWorkspaceRef(review)).toBe('/tmp/workspace/specs/GDD.md');
        expect(getReviewBindingSummary(review)).toBe('Baseline: artifact v3');
    });
});
