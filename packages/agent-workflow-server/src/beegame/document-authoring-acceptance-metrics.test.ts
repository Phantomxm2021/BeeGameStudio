import { describe, expect, test } from 'bun:test'
import {
  EIGHT_DOCUMENT_AUTHORING_RAW_TOKEN_CEILING,
  GDD_AUTHORING_RAW_TOKEN_CEILING,
  summarizeDocumentAuthoringAcceptance,
} from './document-authoring-acceptance-metrics'

function evidence(path = 'docs/GDD.md', totalTokens = 570_000) {
  return {
    path,
    dispatchId: `dispatch:${path}`,
    usage: {
      input_tokens: 40_000,
      cache_read_tokens: Math.max(0, totalTokens - 70_000),
      cache_creation_tokens: 0,
      completion_tokens: 30_000,
      total_tokens: totalTokens,
    },
    modelStops: 7,
    toolCalls: { Write: 1, Edit: 5 },
    elapsedMs: 480_000,
    bytes: 60_000,
    lines: 800,
    accepted: true,
  }
}

describe('document authoring acceptance metrics', () => {
  test('reports a GDD budget verdict without producing runtime actions', () => {
    const report = summarizeDocumentAuthoringAcceptance({
      documents: [evidence()],
    })

    expect(GDD_AUTHORING_RAW_TOKEN_CEILING).toBe(600_000)
    expect(report.documents[0]?.withinBudget).toBe(true)
    expect(report.total.rawTokens).toBe(570_000)
    expect(report.withinAuthoringBudget).toBe(true)
    expect(report).not.toHaveProperty('action')
    expect(report).not.toHaveProperty('terminate')
  })

  test('fails release verdicts for excess, duplicate, or contaminated evidence', () => {
    expect(
      summarizeDocumentAuthoringAcceptance({
        documents: [evidence('docs/GDD.md', 600_001)],
      }).withinAuthoringBudget,
    ).toBe(false)
    expect(() =>
      summarizeDocumentAuthoringAcceptance({
        documents: [evidence('docs/UNKNOWN.md')],
      }),
    ).toThrow(/canonical/i)
    expect(() =>
      summarizeDocumentAuthoringAcceptance({
        documents: [evidence(), evidence()],
      }),
    ).toThrow(/duplicate/i)
  })

  test('requires exactly eight documents and applies the combined ceiling', () => {
    const paths = [
      'docs/GDD.md',
      'docs/LEVEL_SCENE_DESIGN.md',
      'docs/BALANCE_DESIGN.md',
      'docs/TECHNICAL_DESIGN.md',
      'docs/ART_DIRECTION.md',
      'docs/UI_UX_SPEC.md',
      'docs/AUDIO_DESIGN.md',
      'docs/ASSET_PLAN.md',
    ]
    const perDocumentTokens = [
      600_000,
      500_000,
      500_000,
      550_000,
      450_000,
      450_000,
      400_000,
      450_000,
    ]
    const report = summarizeDocumentAuthoringAcceptance({
      documents: paths.map((path, index) => ({
        ...evidence(path, perDocumentTokens[index]),
        dispatchId: `dispatch-${index}`,
      })),
    })

    expect(EIGHT_DOCUMENT_AUTHORING_RAW_TOKEN_CEILING).toBe(4_000_000)
    expect(report.completeDocumentSet).toBe(true)
    expect(report.total.rawTokens).toBe(3_900_000)
    expect(report.withinAuthoringBudget).toBe(true)
    expect(
      summarizeDocumentAuthoringAcceptance({
        documents: paths.slice(0, 7).map((path, index) => ({
          ...evidence(path, perDocumentTokens[index]),
          dispatchId: `partial-${index}`,
        })),
      }).completeDocumentSet,
    ).toBe(false)
  })

  test('rejects a second authoring dispatch for the same document', () => {
    expect(() =>
      summarizeDocumentAuthoringAcceptance({
        documents: [
          { ...evidence('docs/GDD.md', 200_000), phase: 'stream' as const },
          {
            ...evidence('docs/GDD.md', 60_000),
            dispatchId: 'gdd-second-pass',
            phase: 'final' as const,
          },
        ],
      }),
    ).toThrow(/duplicate document/i)
  })
})
