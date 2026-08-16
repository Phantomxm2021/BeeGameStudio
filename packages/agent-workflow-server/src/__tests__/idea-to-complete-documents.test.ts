import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createTestDeliveryRun,
  withTestDocumentMetadata,
} from './delivery-workflow-test-helpers'
import {
  completeDocumentDraft,
  startDocumentStage,
} from '../beegame/delivery-workflow/document-stage'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  CANONICAL_PROJECT_DOCUMENT_IDS,
  type DeliveryRun,
  type WorkerDispatchRequest,
} from '../beegame/delivery-workflow/types'
import { getGameDocumentContract } from '../beegame/delivery-workflow/game-document-contracts'
import { renderTestCompleteGameDocument } from './complete-game-document-fixture'
import { commitAuthoredFoundationDocument } from '../beegame/authored-document-receipt'
import { recordFoundationDispatch } from '../beegame/delivery-workflow/foundation-authoring-batch'
import { createDocumentReviewRun } from '../beegame/delivery-workflow/document-review-stage'

function completeSubmission(
  path: (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number],
) {
  const contract = getGameDocumentContract(path)
  return {
    title: contract.discipline,
    executiveSummary: `Complete ${contract.discipline} authority and production outcome.`,
    sections: contract.sections.map((section, index) => ({
      sectionId: section.sectionId,
      title: section.title,
      body: `Complete authority and production requirements ${index + 1}.`,
    })),
    productionMaterials: contract.productionMaterials.map(material =>
      material.format === 'evidence_register'
        ? {
            materialId: material.materialId,
            title: material.title,
            format: material.format,
            entries: [
              {
                evidenceId: `${material.materialId}.pending`,
                category: 'search_direction' as const,
                displayName: 'Pending reference direction',
                purpose: 'Record a production need before source selection.',
                state: 'source_not_selected' as const,
                evidenceRefs: [],
              },
            ],
          }
        : {
            materialId: material.materialId,
            title: material.title,
            format: material.format,
            body:
              material.format === 'markdown_table'
                ? '| Field | Value |\n| --- | --- |\n| Owner | Authority |'
                : material.format === 'mermaid'
                  ? '```mermaid\ngraph TD\n  A --> B\n```'
                  : '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>',
          },
    ),
    auditAppendix: {
      acceptanceCriteria: [
        'The document is complete, inspectable, and implementation-ready.',
      ],
      upstreamReferences: [],
      risks: [],
      openDecisions: [],
    },
  }
}

describe('idea to complete game documents', () => {
  const workspaces: string[] = []

  afterEach(async () => {
    await Promise.all(
      workspaces
        .splice(0)
        .map(path => rm(path, { recursive: true, force: true })),
    )
  })

  test('normalizes service-owned metadata after report-driven remediation', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'remediated-document-'))
    workspaces.push(workspacePath)
    const path = CANONICAL_FOUNDATION_DOCUMENTS[0]
    const dispatchId = 'remediated-gdd-author'
    await mkdir(join(workspacePath, 'docs'), { recursive: true })
    await commitAuthoredFoundationDocument({
      workspacePath,
      dispatchId: 'initial-gdd-author',
      targetPath: path,
      authoredBody: renderTestCompleteGameDocument(path, completeSubmission(path)),
      updatedAt: '2026-08-15T00:00:00.000Z',
    })
    const targetPath = join(workspacePath, path)
    const remediatedBody = (await readFile(targetPath, 'utf8'))
      .replace('version: 1.0.0', 'version: 1.1.0')
      .replace(
        'updated_at: 2026-08-15T00:00:00.000Z',
        'updated_at: 2026-08-16T00:00:00.000Z',
      )
    await writeFile(targetPath, remediatedBody)

    const review = {
      ...createDocumentReviewRun({
        scope: 'foundation',
        revision: 'a'.repeat(64),
      }),
      status: 'completed' as const,
      finalReportPath: `.beegame/reviews/foundation/${'a'.repeat(64)}/review.json`,
      finalReportDigest: 'b'.repeat(64),
      verdict: 'NEEDS_REVISION' as const,
      affectedPaths: [path],
      remediatedPaths: [],
    }
    const base = createTestDeliveryRun({
      projectId: 'project-remediated-document',
      ownerId: 'owner-remediated-document',
      confirmedBriefDigest: 'c'.repeat(64),
      foundationDraftComplete: true,
    })
    const request: WorkerDispatchRequest = {
      dispatchId,
      runId: base.runId,
      ownerId: base.ownerId,
      projectId: base.projectId,
      workspacePath,
      workerType: 'document-author',
      phase: 'DOCUMENT_DRAFTING',
      taskId: path,
      revision: base.revision.document,
      allowedPaths: [path],
      contract: {
        documentSet: 'foundation',
        authoringMode: 'remediation',
        foundationDocumentPath: path,
        previousDocumentMetadata: {
          [path]: {
            version: '1.0.0',
            updatedAt: '2026-08-15T00:00:00.000Z',
          },
        },
      },
    }
    const terminal = {
      workerType: 'document-author' as const,
      status: 'completed' as const,
      writtenPaths: [path],
      resolvedFindingIds: [],
    }
    const runWithCompletedDispatch: DeliveryRun = {
        ...base,
        phase: 'DOCUMENT_DRAFTING',
        documentStep: 'FOUNDATION_DRAFTING',
        documentReviewState: {
          activeRun: review,
          approvals: {},
          attempts: { foundation: 1, checklist: 0, complete: 0 },
        },
        activeDispatch: {
          dispatchId,
          workerType: 'document-author',
          phase: 'DOCUMENT_DRAFTING',
          taskId: path,
          revision: base.revision.document,
          status: 'completed',
          request,
          terminalResult: terminal,
          startedAt: '2026-08-16T00:00:00.000Z',
          finishedAt: '2026-08-16T00:01:00.000Z',
        },
      }
    const rejected = await completeDocumentDraft({
      run: runWithCompletedDispatch,
      workspacePath,
      terminal,
      audit: () => ({ valid: false, issues: ['synthetic local validation failure'] }),
    })

    expect(rejected.activeDispatch).toMatchObject({
      dispatchId,
      status: 'completed',
      terminalResult: terminal,
    })

    const completed = await completeDocumentDraft({
      run: { ...rejected, status: 'running' },
      workspacePath,
      terminal,
      audit: () => ({ valid: true, issues: [] }),
    })

    expect(completed.blockedReason).toBeUndefined()
    expect(await readFile(targetPath, 'utf8')).toContain('version: 1.0.1')
  })

  test('projects confirmed product authority and commits every complete discipline document', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'idea-documents-'))
    workspaces.push(workspacePath)
    const confirmedBriefContext = JSON.stringify({
      kind: 'confirmed_build_brief',
      productAuthority: {
        intent:
          'A complete game product ready for multidisciplinary production.',
        constraints: ['Remain platform-neutral until a target is approved.'],
      },
    })
    let run: DeliveryRun = {
      ...createTestDeliveryRun({
        projectId: 'project-complete-documents',
        ownerId: 'owner-complete-documents',
        confirmedBriefContext,
        foundationDraftComplete: false,
      }),
      phase: 'DOCUMENT_DRAFTING',
      documentStep: 'FOUNDATION_DRAFTING',
    }

    let documentIndex = 0
    while (run.phase === 'DOCUMENT_DRAFTING') {
      const requests: WorkerDispatchRequest[] = []
      await startDocumentStage({
        run,
        workspacePath,
        dispatcher: {
          async dispatch(value) {
            requests.push(value)
            return value
          },
        },
      })
      expect(requests.length).toBeGreaterThan(0)
      const dispatches = requests.map(request => {
        const path =
          request.taskId as (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number]
        const now = new Date().toISOString()
        return {
          path,
          request,
          dispatch: {
            dispatchId: `complete-document-${documentIndex++}`,
            workerType: 'document-author' as const,
            phase: run.phase,
            taskId: path,
            revision: run.revision.document,
            status: 'running' as const,
            request,
            startedAt: now,
          },
        }
      })
      if (run.foundationDraftState.documents)
        for (const item of dispatches)
          run = {
            ...run,
            foundationDraftState: recordFoundationDispatch(
              run.foundationDraftState,
              item.path,
              'drafting',
              item.dispatch,
            ),
          }

      for (const item of dispatches) {
        expect(item.request.contract.confirmedBriefContext).toBe(
          confirmedBriefContext,
        )
        expect(item.request.contract.completeDocumentContract).toEqual(
          getGameDocumentContract(item.path),
        )
        await mkdir(join(workspacePath, 'docs'), { recursive: true })
        await writeFile(
          join(workspacePath, item.path),
          withTestDocumentMetadata(
            item.path,
            renderTestCompleteGameDocument(
              item.path,
              completeSubmission(item.path),
            ),
          ),
        )
        await commitAuthoredFoundationDocument({
          workspacePath,
          dispatchId: item.dispatch.dispatchId,
          targetPath: item.path,
        })
        const finishedAt = new Date().toISOString()
        run = await completeDocumentDraft({
          run: {
            ...run,
            activeDispatch: {
              ...item.dispatch,
              status: 'completed',
              finishedAt,
            },
          },
          workspacePath,
          terminal: {
            workerType: 'document-author',
            status: 'completed',
            writtenPaths: [item.path],
            resolvedFindingIds: [],
          },
          documentSet: 'foundation',
        })
        expect(run.blockedReason).toBeUndefined()
      }
    }

    expect(run.phase).toBe('DOCUMENT_REVIEW')
    expect(run.foundationDraftState.completedPaths).toEqual([
      ...CANONICAL_FOUNDATION_DOCUMENTS,
    ])
    for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
      const content = await readFile(join(workspacePath, path), 'utf8')
      for (const section of getGameDocumentContract(path).sections)
        expect(content).toContain(
          `<!-- beegame-section:${section.sectionId} -->`,
        )
    }
  })

  test('does not advance past an invalid complete foundation document', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'invalid-idea-document-'),
    )
    workspaces.push(workspacePath)
    const path = CANONICAL_FOUNDATION_DOCUMENTS[0]
    const contract = getGameDocumentContract(path)
    const submission = completeSubmission(path)
    const renderedLines = renderTestCompleteGameDocument(
      path,
      submission,
    ).split('\n')
    renderedLines.shift()
    await mkdir(join(workspacePath, 'docs'), { recursive: true })
    await writeFile(
      join(workspacePath, path),
      [
        '---',
        `document_id: ${CANONICAL_PROJECT_DOCUMENT_IDS[path]}`,
        'version: 1.0.0',
        'updated_at: 2026-08-11T00:00:00.000Z',
        '---',
        '',
        ...renderedLines,
      ].join('\n'),
    )

    const run = await completeDocumentDraft({
      run: {
        ...createTestDeliveryRun({
          projectId: 'project-invalid-document',
          ownerId: 'owner-invalid-document',
          confirmedBriefContext: '{"kind":"confirmed_build_brief"}',
          foundationDraftComplete: false,
        }),
        phase: 'DOCUMENT_DRAFTING',
        documentStep: 'FOUNDATION_DRAFTING',
      },
      workspacePath,
      terminal: {
        workerType: 'document-author',
        status: 'completed',
        writtenPaths: [path],
        resolvedFindingIds: [],
      },
      documentSet: 'foundation',
    })

    expect(run.blockedReason).toContain(
      'complete game document requires one document title',
    )
    expect(run.foundationDraftState.completedPaths).toEqual([])
  })
})
