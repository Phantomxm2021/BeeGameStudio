import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { completeDocumentDraft } from '../beegame/delivery-workflow/document-stage'
import { createInitialDeliveryRun } from '../beegame/delivery-workflow/run-store'
import { transitionDeliveryRun } from '../beegame/delivery-workflow/transition'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../beegame/delivery-workflow/types'

describe('delivery workflow document ordering', () => {
  let workspace = ''

  afterEach(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true })
  })

  test('moves six complete foundation documents to foundation review without requiring later artifacts', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-foundation-order-'))
    for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
      await mkdir(join(workspace, path, '..'), { recursive: true })
      await writeFile(join(workspace, path), `# ${path}\n`)
    }
    const run = transitionDeliveryRun(
      createInitialDeliveryRun({
        projectId: 'project-1',
        ownerId: 'owner-1',
        confirmedBriefDigest: 'brief-1',
      }),
      { type: 'documents_ready' },
    )

    const completed = await completeDocumentDraft({
      run,
      workspacePath: workspace,
      terminal: {
        workerType: 'document-author',
        status: 'completed',
        revision: 'uncomputed',
        writtenPaths: [...CANONICAL_FOUNDATION_DOCUMENTS],
      },
      documentSet: 'foundation',
    })

    expect(completed).toMatchObject({
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'FOUNDATION_REVIEW',
      status: 'running',
      blockedReason: undefined,
    })
  })

  test('requires resource preparation followed by comprehensive review before task planning', () => {
    const resourceRevision = 'resource-revision-1'
    const resourcePrepared = transitionDeliveryRun(
      {
        ...createInitialDeliveryRun({
          projectId: 'project-1',
          ownerId: 'owner-1',
          confirmedBriefDigest: 'brief-1',
          documentRevision: 'document-revision-1',
          workspaceRevision: 'workspace-revision-1',
        }),
        phase: 'RESOURCE_PREPARATION',
      },
      {
        type: 'resource_preparation_ready',
        resourceRevision,
        evidence: {
          path: '.beegame/workflow/evidence/resource.json',
          kind: 'resource_preparation',
          revision: resourceRevision,
          status: 'passed',
          observedAt: new Date().toISOString(),
        },
      },
    )

    expect(resourcePrepared).toMatchObject({
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'CHECKLIST_REVIEW',
      revision: { resource: resourceRevision },
    })

    const comprehensivelyReviewed = transitionDeliveryRun(resourcePrepared, {
      type: 'document_review_ready',
      evidence: {
        path: '.beegame/workflow/evidence/comprehensive-review.json',
        kind: 'document_review',
        revision: resourceRevision,
        status: 'ready',
        observedAt: new Date().toISOString(),
      },
    })

    expect(comprehensivelyReviewed).toMatchObject({
      phase: 'ATOMIC_TASK_PLANNING',
      documentStep: undefined,
      evidence: {
        resourcePreparation: { status: 'passed' },
        documentReview: { status: 'ready', revision: resourceRevision },
      },
    })
  })

  test('moves an approved checklist to resource preparation before comprehensive review', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-checklist-order-'))
    for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
      await mkdir(join(workspace, path, '..'), { recursive: true })
      await writeFile(join(workspace, path), `# ${path}\n`)
    }
    const checklistPath = 'docs/acceptance/gameplay-checklist.md'
    await mkdir(join(workspace, 'docs', 'acceptance'), { recursive: true })
    await writeFile(
      join(workspace, checklistPath),
      '# Acceptance\n- [ ] PATH-001 source: docs/GDD.md implement: Launch the game expected: playable state evidence: runtime\n',
    )
    const run = {
      ...createInitialDeliveryRun({
        projectId: 'project-1',
        ownerId: 'owner-1',
        confirmedBriefDigest: 'brief-1',
      }),
      phase: 'DOCUMENT_REVIEW' as const,
      documentStep: 'CHECKLIST_DRAFTING' as const,
    }

    const completed = await completeDocumentDraft({
      run,
      workspacePath: workspace,
      terminal: {
        workerType: 'document-author',
        status: 'completed',
        revision: run.revision.document,
        writtenPaths: [checklistPath],
      },
      documentSet: 'checklist',
    })

    expect(completed).toMatchObject({
      phase: 'RESOURCE_PREPARATION',
      status: 'running',
      blockedReason: undefined,
    })
    expect(completed.documentStep).toBeUndefined()
  })
})
