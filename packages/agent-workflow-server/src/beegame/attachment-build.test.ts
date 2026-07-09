import { expect, test } from 'bun:test'

import { parseAttachmentBuildAnalysis } from './attachment-build'

test('parses a structured attachment build analysis', () => {
  const result = parseAttachmentBuildAnalysis({
    analysisId: 'analysis_1',
    sourceType: 'gdd',
    completeness: 'complete',
    confirmedFacts: [{ field: 'coreLoop', value: 'Solve puzzles', source: 'game-design.md' }],
    inferredDesign: [],
    missingFields: [],
    conflicts: [],
    gddDraft: '# Game Design',
  })

  expect(result.sourceType).toBe('gdd')
  expect(result.confirmedFacts[0]?.field).toBe('coreLoop')
})

test('rejects unknown enums and confidence levels', () => {
  expect(() => parseAttachmentBuildAnalysis({
    analysisId: 'analysis_2',
    sourceType: 'unknown',
    completeness: 'complete',
    confirmedFacts: [],
    inferredDesign: [{ field: 'camera', value: 'Top-down', confidence: 'certain', source: 'image.png' }],
    missingFields: [],
    conflicts: [],
    gddDraft: '# Draft',
  })).toThrow('Invalid attachment build analysis')
})
