import { describe, it, expect } from 'vitest';
import { artifactProcessor } from './artifactProcessor';

describe('ArtifactProcessor', () => {
    it('should strip standard HTML comments', () => {
        const input = 'Hello <!-- secret --> World';
        const expected = 'Hello  World';
        expect(artifactProcessor.stripMarkers(input)).toBe(expected);
    });

    it('should strip multiline HTML comments', () => {
        const input = 'Start\n<!-- \n multiline \n comment \n-->\nEnd';
        const expected = 'Start\n\nEnd';
        expect(artifactProcessor.stripMarkers(input)).toBe(expected);
    });

    it('should strip multiple comments', () => {
        const input = '<!-- one -->Part 1<!-- two -->Part 2<!-- three -->';
        const expected = 'Part 1Part 2';
        expect(artifactProcessor.stripMarkers(input)).toBe(expected);
    });

    it('should return empty string for null or undefined', () => {
        expect(artifactProcessor.stripMarkers(null)).toBe('');
        expect(artifactProcessor.stripMarkers(undefined)).toBe('');
    });

    it('should not affect non-comment content', () => {
        const input = '# Title\n\nSome content with *markdown* and `code`.';
        expect(artifactProcessor.stripMarkers(input)).toBe(input);
    });

    it('should trim the result', () => {
        const input = '   Content with markers <!-- marker -->   ';
        const expected = 'Content with markers';
        expect(artifactProcessor.stripMarkers(input)).toBe(expected);
    });

    it('prefers explicit render hints over content heuristics', () => {
        expect(
            artifactProcessor.shouldRenderAsArtifactCard({
                content: 'short content',
                renderHint: 'artifact_card',
                messageType: 'normal',
                isDocument: false,
            })
        ).toBe(true);
    });

    it('uses a Markdown heading without guessing document type from language', () => {
        expect(artifactProcessor.extractMetadata('# ゲーム仕様\n\n説明です')).toMatchObject({
            title: 'ゲーム仕様', summary: '説明です',
        });
        expect(artifactProcessor.shouldRenderAsArtifactCard({ content: 'GDD '.repeat(100) })).toBe(false);
    });
});
