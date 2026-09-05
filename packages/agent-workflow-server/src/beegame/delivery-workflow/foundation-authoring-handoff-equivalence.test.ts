import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import {
  authorHandoffCheckpoints,
} from './foundation-authoring-state'
import { canStartFoundationAudit as currentCanStartFoundationAudit } from './foundation-audit-boundary'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type DeliveryRun,
  type FoundationDocumentCheckpoint,
  type FoundationDraftState,
} from './types'

const root = resolve(import.meta.dir, '../../../../..')
const baseline = 'dffad4194'
const directory = 'packages/agent-workflow-server/src/beegame/delivery-workflow/'

function baselineSource(file: string): string {
  return execFileSync(
    'git',
    ['show', `${baseline}:${directory}${file}`],
    { cwd: root, encoding: 'utf8' },
  )
}

function loadBaselineCanStartFoundationAudit(): (run: DeliveryRun) => boolean {
  const source = new Bun.Transpiler({ loader: 'ts' })
    .transformSync(baselineSource('foundation-audit-boundary.ts'))
    .replace(/import[\s\S]*?from ['"][^'"]+['"];?\n/g, '')
    .replace(/export /g, '')
  return new Function(
    'CANONICAL_FOUNDATION_DOCUMENTS',
    `${source};return canStartFoundationAudit`,
  )(CANONICAL_FOUNDATION_DOCUMENTS) as (run: DeliveryRun) => boolean
}

function runWithState(foundationDraftState: FoundationDraftState): DeliveryRun {
  return { foundationDraftState } as DeliveryRun
}

function completedState(
  completedPaths: readonly (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number][],
): FoundationDraftState {
  return { completedPaths: [...completedPaths] }
}

function checkpoint(
  path: (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number],
  status: FoundationDocumentCheckpoint['status'],
): FoundationDocumentCheckpoint {
  return {
    path,
    status,
    dispatch: {
      dispatchId: `dispatch-${path}`,
      workerType: 'document-author',
      phase: 'DOCUMENT_DRAFTING',
      taskId: path,
      revision: 'revision',
      status: 'running',
      startedAt: '2026-09-05T00:00:00.000Z',
    },
    upstreamDigests: { brief: 'digest' },
    failureReason: status === 'needs_action' ? 'fixture failure' : undefined,
  }
}

function checkpointState(
  entries: readonly FoundationDocumentCheckpoint[],
): FoundationDraftState {
  return {
    completedPaths: entries
      .filter(entry => entry.status === 'committed')
      .map(entry => entry.path),
    documents: entries.map(entry => ({ ...entry })),
  }
}

describe('Stage 2 author handoff equivalence', () => {
  test('canStartFoundationAudit matches the approved baseline for legacy paths', () => {
    const baselineCanStart = loadBaselineCanStartFoundationAudit()
    const states: FoundationDraftState[] = []

    for (let length = 0; length <= CANONICAL_FOUNDATION_DOCUMENTS.length; length++)
      states.push(completedState(CANONICAL_FOUNDATION_DOCUMENTS.slice(0, length)))

    states.push(
      completedState([
        ...CANONICAL_FOUNDATION_DOCUMENTS.slice(0, 4),
        CANONICAL_FOUNDATION_DOCUMENTS[7],
      ]),
      completedState([...CANONICAL_FOUNDATION_DOCUMENTS].reverse()),
      completedState([
        CANONICAL_FOUNDATION_DOCUMENTS[0],
        CANONICAL_FOUNDATION_DOCUMENTS[2],
        CANONICAL_FOUNDATION_DOCUMENTS[1],
        ...CANONICAL_FOUNDATION_DOCUMENTS.slice(3),
      ]),
    )

    for (const state of states) {
      const run = runWithState(state)
      expect(currentCanStartFoundationAudit(run)).toBe(
        baselineCanStart(run),
      )
    }
  })

  test('canStartFoundationAudit matches the baseline for missing, partial, reordered and mixed checkpoints', () => {
    const baselineCanStart = loadBaselineCanStartFoundationAudit()
    const allCommitted = CANONICAL_FOUNDATION_DOCUMENTS.map(path =>
      checkpoint(path, 'committed'),
    )
    const states: FoundationDraftState[] = [
      checkpointState([]),
      checkpointState(allCommitted.slice(0, 1)),
      checkpointState(allCommitted.slice(0, 7)),
      checkpointState(allCommitted),
      checkpointState([...allCommitted].reverse()),
      checkpointState([
        ...allCommitted.slice(0, 3),
        ...allCommitted.slice(4),
      ]),
      checkpointState(
        allCommitted.map((entry, index) =>
          index === 1 ? { ...entry, status: 'drafting' } : entry,
        ),
      ),
      checkpointState(
        allCommitted.map((entry, index) =>
          index === 6 ? { ...entry, status: 'needs_action' } : entry,
        ),
      ),
      checkpointState(
        allCommitted.map((entry, index) =>
          index === 4 ? { ...entry, status: 'pending' } : entry,
        ),
      ),
      {
        completedPaths: [...CANONICAL_FOUNDATION_DOCUMENTS],
        documents: [],
      },
    ]

    for (const state of states) {
      const run = runWithState(state)
      expect(currentCanStartFoundationAudit(run)).toBe(
        baselineCanStart(run),
      )
    }
  })

  test('authorHandoffCheckpoints exposes only path/status and does not share checkpoint objects', () => {
    const source: FoundationDraftState = checkpointState(
      CANONICAL_FOUNDATION_DOCUMENTS.map((path, index) =>
        checkpoint(path, index === 0 ? 'committed' : 'pending'),
      ),
    )
    const handoff = authorHandoffCheckpoints(source)

    expect(handoff).toHaveLength(CANONICAL_FOUNDATION_DOCUMENTS.length)
    expect(handoff).toEqual(
      source.documents!.map(({ path, status }) => ({ path, status })),
    )
    for (const [index, value] of handoff.entries()) {
      expect(Object.keys(value).sort()).toEqual(['path', 'status'])
      expect(value).not.toBe(source.documents![index])
    }

    handoff[0]!.status = 'pending'
    expect(source.documents![0]!.status).toBe('committed')

    const legacySource = completedState([CANONICAL_FOUNDATION_DOCUMENTS[0]])
    const legacyHandoff = authorHandoffCheckpoints(legacySource)
    expect(legacyHandoff).toEqual(
      CANONICAL_FOUNDATION_DOCUMENTS.map((path, index) => ({
        path,
        status: index === 0 ? 'committed' : 'pending',
      })),
    )
    expect(legacyHandoff[0]).not.toBe(legacySource)
    expect(Object.keys(legacyHandoff[0]!).sort()).toEqual(['path', 'status'])
  })

})
