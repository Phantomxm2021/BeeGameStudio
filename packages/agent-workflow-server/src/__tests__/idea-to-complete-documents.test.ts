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
import {
  canonicalFoundationAuthorityProjectionBytes,
  foundationProjectionRelativePath,
  projectFoundationAuthority,
} from '../beegame/foundation-authority-projection'

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

async function writeCommittedProjection(
  workspacePath: string,
  dispatchId: string,
  targetPath: (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number],
): Promise<void> {
  const contract = getGameDocumentContract(targetPath)
  const documents = new Map(await Promise.all(
    foundationAuthoringSources(targetPath).map(async source => [
      source.path,
      await readFile(join(workspacePath, source.path), 'utf8'),
    ] as const),
  ))
  const projection = projectFoundationAuthority({
    targetPath,
    availableUpstreamPaths: foundationAuthoringSources(targetPath).map(source => source.path),
    documents,
  })
  await mkdir(join(workspacePath, '.beegame/workflow/document-projections'), {
    recursive: true,
  })
  await writeFile(
    join(workspacePath, foundationProjectionRelativePath(dispatchId)),
    canonicalFoundationAuthorityProjectionBytes(projection),
  )
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
        await writeCommittedProjection(
          workspacePath,
          item.dispatch.dispatchId,
          item.path,
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

  test('commits non-empty malformed Markdown and defers format review beyond authoring', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'invalid-idea-document-'),
    )
    workspaces.push(workspacePath)
    const path = CANONICAL_FOUNDATION_DOCUMENTS[0]
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

    const baseRun: DeliveryRun = {
        ...createTestDeliveryRun({
          projectId: 'project-invalid-document',
          ownerId: 'owner-invalid-document',
          confirmedBriefContext: '{"kind":"confirmed_build_brief"}',
          foundationDraftComplete: false,
        }),
        phase: 'DOCUMENT_DRAFTING',
        documentStep: 'FOUNDATION_DRAFTING',
      }
    const requests: WorkerDispatchRequest[] = []
    await startDocumentStage({
      run: baseRun,
      workspacePath,
      dispatcher: { async dispatch(request) { requests.push(request); return request } },
    })
    const request = requests.find(candidate => candidate.taskId === path)!
    const dispatch = {
      dispatchId: 'malformed-markdown-author',
      workerType: 'document-author' as const,
      phase: baseRun.phase,
      taskId: path,
      revision: baseRun.revision.document,
      status: 'completed' as const,
      request,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    }
    await writeCommittedProjection(workspacePath, dispatch.dispatchId, path)
    await commitAuthoredFoundationDocument({ workspacePath, dispatchId: dispatch.dispatchId, targetPath: path })
    const run = await completeDocumentDraft({
      run: {
        ...baseRun,
        activeDispatch: dispatch,
        foundationDraftState: baseRun.foundationDraftState.documents
          ? recordFoundationDispatch(baseRun.foundationDraftState, path, 'drafting', dispatch)
          : baseRun.foundationDraftState,
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

    expect(run.blockedReason).toBeUndefined()
    expect(run.foundationDraftState.completedPaths).toContain(path)
  })
})
import { foundationAuthoringSources } from '../beegame/delivery-workflow/foundation-authoring-contract'
