import { describe, expect, it } from 'vitest';
import { filterPathsForDisplay } from './chatPathDisplay';

describe('filterPathsForDisplay', () => {
    it('hides absolute paths across platforms and project-relative paths', () => {
        expect(filterPathsForDisplay('Read /Users/alice/Game/src/Player.ts and C:\\Users\\alice\\Game\\src\\World.json'))
            .toBe('Read Player.ts and World.json');
        expect(filterPathsForDisplay('Updated ./docs/GDD.md and src/scene/forest.json'))
            .toBe('Updated GDD.md and forest.json');
        expect(filterPathsForDisplay('Open file:///private/tmp/agent/output.json'))
            .toBe('Open output.json');
    });

    it('keeps only the final name of a directory path and hides internal workflow directories', () => {
        expect(filterPathsForDisplay('Working in /Users/alice/work/game/docs/')).toBe('Working in docs');
        expect(filterPathsForDisplay('Read .beegame/workflow/run-1/workspace/docs/GDD.md and review-context/run-1/review.json'))
            .toBe('Read GDD.md and review.json');
    });

    it('does not rewrite URLs or ordinary slash-separated prose', () => {
        expect(filterPathsForDisplay('See https://example.com/docs and natural/intentional/alive.'))
            .toBe('See https://example.com/docs and natural/intentional/alive.');
        expect(filterPathsForDisplay('Request /api/projects/current')).toBe('Request /api/projects/current');
    });
});
