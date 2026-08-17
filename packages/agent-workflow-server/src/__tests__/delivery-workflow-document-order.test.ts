import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createTestDeliveryRun } from './delivery-workflow-test-helpers'
import { startDocumentStage } from '../beegame/delivery-workflow/document-stage'
import { createFoundationRemediationStateFromAuthority } from '../beegame/delivery-workflow/foundation-remediation'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type WorkerDispatchRequest,
} from '../beegame/delivery-workflow/types'

const revision = 'a'.repeat(64)

describe('Foundation remediation document order', () => {
  test('dispatches the three exact owner lanes concurrently', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'review-coordinated-repair-'))
    try {
      const affectedPaths = [
        'docs/GDD.md',
        'docs/LEVEL_SCENE_DESIGN.md',
        'docs/BALANCE_DESIGN.md',
        'docs/TECHNICAL_DESIGN.md',
        'docs/ART_DIRECTION.md',
        'docs/UI_UX_SPEC.md',
        'docs/ASSET_PLAN.md',
      ] as const
      const reviewPath = `.beegame/reviews/foundation/${revision}/review.json`
      const reviewBytes = `${JSON.stringify({
        version: 2,
        scope: 'foundation',
        revision,
        verdict: 'NEEDS_REVISION',
        priorConflictStatus: [],
        conflicts: [{
          id: 'B1',
          title: 'Shared production contract is inconsistent',
          problem: 'Owned documents disagree on one required outcome.',
          evidence: [{ path: 'docs/GDD.md', location: 'Core loop', observed: 'The outcome differs.' }],
          requiredOutcome: 'All owners express one implementable outcome.',
          changes: affectedPaths.map(path => ({ path, action: `Align ${path}.` })),
          acceptance: ['All paths encode the same outcome.'],
        }],
      })}\n`
      const reviewDigest = createHash('sha256').update(reviewBytes).digest('hex')
      await mkdir(dirname(join(workspacePath, reviewPath)), { recursive: true })
      await writeFile(join(workspacePath, reviewPath), reviewBytes)
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      await Promise.all(
        CANONICAL_FOUNDATION_DOCUMENTS.map(path =>
          writeFile(join(workspacePath, path), `# ${path}\n`),
        ),
      )
      const run = {
        ...createTestDeliveryRun({
          runId: 'review-foundation',
          projectId: 'project',
          ownerId: 'owner',
          foundationDraftComplete: true,
        }),
        phase: 'DOCUMENT_DRAFTING' as const,
        foundationRemediationState: createFoundationRemediationStateFromAuthority({
          reviewPath,
          reviewDigest,
          sourceRevision: revision,
          affectedPaths: [...affectedPaths],
        }),
      }
      const dispatched: WorkerDispatchRequest[] = []

      await startDocumentStage({
        run,
        workspacePath,
        dispatcher: {
          async dispatch(request) {
            dispatched.push(request)
            return request
          },
        },
      })

      expect(dispatched.map(request => request.taskId)).toEqual([
        'foundation-remediation:core-design',
        'foundation-remediation:technical-assets',
        'foundation-remediation:presentation',
      ])
      expect(dispatched.map(request => request.allowedPaths)).toEqual([
        ['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md', 'docs/BALANCE_DESIGN.md'],
        ['docs/TECHNICAL_DESIGN.md', 'docs/ASSET_PLAN.md'],
        ['docs/ART_DIRECTION.md', 'docs/UI_UX_SPEC.md'],
      ])
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })
})
