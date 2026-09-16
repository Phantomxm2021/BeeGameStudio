import { describe, expect, it } from 'vitest';
import { shortenAbsolutePathsForDisplay } from './chatPathDisplay';

describe('shortenAbsolutePathsForDisplay', () => {
    it('keeps only the final name from Unix and Windows absolute paths', () => {
        expect(shortenAbsolutePathsForDisplay(
            'Read /Users/dev/work/game/docs/GDD.md then C:\\Users\\dev\\game\\src\\scene.tsx',
        )).toBe('Read GDD.md then scene.tsx');
    });

    it('shortens absolute directories with a trailing slash', () => {
        expect(shortenAbsolutePathsForDisplay('Working in /Users/dev/work/game/docs/'))
            .toBe('Working in docs');
    });

    it('preserves URLs and relative paths', () => {
        const value = 'Open https://example.com/assets/image.png and docs/GDD.md';
        expect(shortenAbsolutePathsForDisplay(value)).toBe(value);
    });

    it('preserves user-facing root-relative routes', () => {
        const value = 'Request /api/projects/current';
        expect(shortenAbsolutePathsForDisplay(value)).toBe(value);
    });

    it('hides internal workflow storage paths while keeping their file names', () => {
        expect(shortenAbsolutePathsForDisplay(
            'Read .beegame/workflow/foundation-authoring/run-1/workspace/docs/GDD.md and review-context/run-1/review.json',
        )).toBe('Read GDD.md and review.json');
    });
});
