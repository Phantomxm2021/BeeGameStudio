import { describe, expect, it } from 'vitest';

import { normalizeAttachmentBuildAnalysis } from './attachmentBuild';

describe('attachment build analysis', () => {
    it('normalizes a complete GDD analysis without dropping confirmed facts', () => {
        const result = normalizeAttachmentBuildAnalysis({
            analysisId: 'analysis_1',
            sourceType: 'gdd',
            completeness: 'complete',
            confirmedFacts: [{ field: 'coreLoop', value: 'Solve puzzles', source: 'game-design.md' }],
            inferredDesign: [],
            missingFields: [],
            conflicts: [],
            gddDraft: '# Game Design',
        });

        expect(result.sourceType).toBe('gdd');
        expect(result.completeness).toBe('complete');
        expect(result.confirmedFacts[0]?.value).toBe('Solve puzzles');
        expect(result.gddDraft).toBe('# Game Design');
    });

    it('preserves image inferences and their confidence levels', () => {
        const result = normalizeAttachmentBuildAnalysis({
            analysisId: 'analysis_2',
            sourceType: 'image',
            completeness: 'partial',
            confirmedFacts: [],
            inferredDesign: [{
                field: 'camera',
                value: 'Top-down',
                confidence: 'medium',
                source: 'concept.png',
            }],
            missingFields: [{ field: 'winCondition', reason: 'Not visible in image' }],
            conflicts: [],
            gddDraft: '# Draft',
        });

        expect(result.inferredDesign[0]?.confidence).toBe('medium');
        expect(result.missingFields[0]?.field).toBe('winCondition');
    });

    it('rejects unknown analysis enums instead of guessing a flow', () => {
        expect(() => normalizeAttachmentBuildAnalysis({
            analysisId: 'analysis_3',
            sourceType: 'unknown',
            completeness: 'complete',
            confirmedFacts: [],
            inferredDesign: [],
            missingFields: [],
            conflicts: [],
            gddDraft: '',
        })).toThrow('Invalid attachment build analysis');
    });
});
