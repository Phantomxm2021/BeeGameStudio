import { describe, expect, it } from 'vitest';

import { selectDailyLandingBackgroundVideo } from './landingBackgroundVideos';

describe('selectDailyLandingBackgroundVideo', () => {
    it('selects one background per local calendar day and cycles through the list', () => {
        const videos = ['bg-a.mp4', 'bg-b.mp4', 'bg-c.mp4'];

        expect(selectDailyLandingBackgroundVideo(videos, new Date(2026, 0, 1))).toBe('bg-a.mp4');
        expect(selectDailyLandingBackgroundVideo(videos, new Date(2026, 0, 2))).toBe('bg-b.mp4');
        expect(selectDailyLandingBackgroundVideo(videos, new Date(2026, 0, 3))).toBe('bg-c.mp4');
        expect(selectDailyLandingBackgroundVideo(videos, new Date(2026, 0, 4))).toBe('bg-a.mp4');
    });

    it('falls back to the first video when the list is empty', () => {
        expect(selectDailyLandingBackgroundVideo([], new Date(2026, 0, 1))).toBe('');
    });
});
