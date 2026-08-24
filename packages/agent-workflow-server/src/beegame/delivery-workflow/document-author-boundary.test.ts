import { describe, expect, test } from 'bun:test'
import { canStartFoundationAudit } from './foundation-audit-boundary'
import type { DeliveryRun, FoundationDocumentCheckpoint } from './types'

const paths = [
  'docs/GDD.md',
  'docs/LEVEL_SCENE_DESIGN.md',
  'docs/BALANCE_DESIGN.md',
  'docs/TECHNICAL_DESIGN.md',
  'docs/ART_DIRECTION.md',
  'docs/UI_UX_SPEC.md',
  'docs/AUDIO_DESIGN.md',
  'docs/ASSET_PLAN.md',
] as const

function runWithStatuses(
  statuses: readonly FoundationDocumentCheckpoint['status'][],
): DeliveryRun {
  return {
    schemaVersion: 27,
    runId: 'run-boundary',
    projectId: 'project-boundary',
    ownerId: 'owner-boundary',
    confirmedBriefDigest: 'a'.repeat(64),
    confirmedBriefContext: 'confirmed brief',
    phase: 'DOCUMENT_DRAFTING',
    status: 'running',
    revision: {
      document: 'b'.repeat(64),
      workspace: 'c'.repeat(64),
    },
    tasks: [],
    evidence: {},
    foundationDraftState: {
      completedPaths: paths.filter(
        (_, index) => statuses[index] === 'committed',
      ),
      documents: paths.map((path, index) => ({
        path,
        status: statuses[index]!,
      })),
    },
    resourceProductionState: { currentTask: 'RESOURCE_PLAN' },
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T00:00:00.000Z',
  }
}

function runWithSevenCommittedDocs(): DeliveryRun {
  return runWithStatuses([
    'committed',
    'committed',
    'committed',
    'committed',
    'committed',
    'committed',
    'committed',
    'pending',
  ])
}

describe('Document Author boundary', () => {
  test('does not enter document review before all eight author receipts commit', () => {
    expect(canStartFoundationAudit(runWithSevenCommittedDocs())).toBe(false)
  })

  test('enters the foundation audit boundary only after all eight author receipts commit', () => {
    expect(
      canStartFoundationAudit(
        runWithStatuses([
          'committed',
          'committed',
          'committed',
          'committed',
          'committed',
          'committed',
          'committed',
          'committed',
        ]),
      ),
    ).toBe(true)
  })
})
