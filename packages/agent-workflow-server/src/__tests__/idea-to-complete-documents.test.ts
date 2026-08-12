import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestDeliveryRun } from './delivery-workflow-test-helpers'
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
import {
  prepareCompleteGameDocumentArtifacts,
  renderCompleteGameDocument,
} from '../beegame/complete-game-document'
import { commitAuthoredFoundationDocument } from '../beegame/authored-document-receipt'

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
      acceptanceCriteria: ['The document is complete, inspectable, and implementation-ready.'],
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
      workspaces.splice(0).map(path =>
        rm(path, { recursive: true, force: true }),
      ),
    )
  })

  test('projects confirmed product authority and commits every complete discipline document', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'idea-documents-'))
    workspaces.push(workspacePath)
    const confirmedBriefContext = JSON.stringify({
      kind: 'confirmed_build_brief',
      productAuthority: {
        intent: 'A complete game product ready for multidisciplinary production.',
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

    for (const [documentIndex, path] of CANONICAL_FOUNDATION_DOCUMENTS.entries()) {
      let request: WorkerDispatchRequest | undefined
      await startDocumentStage({
        run,
        workspacePath,
        dispatcher: {
          async dispatch(value) {
            request = value
            return value
          },
        },
      })
      expect(request?.contract.confirmedBriefContext).toBe(
        confirmedBriefContext,
      )
      const documentContract = getGameDocumentContract(path)
      expect(request?.contract.completeDocumentContract).toEqual(
        documentContract,
      )

      const dispatchId = `complete-document-${documentIndex}`
      const submission = completeSubmission(path)
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      await writeFile(
        join(workspacePath, path),
        renderCompleteGameDocument(path, submission),
      )
      for (const artifact of prepareCompleteGameDocumentArtifacts(path, submission)) {
        await mkdir(join(workspacePath, artifact.path, '..'), {
          recursive: true,
        })
        await writeFile(join(workspacePath, artifact.path), artifact.content)
      }
      await commitAuthoredFoundationDocument({
        workspacePath,
        dispatchId,
        targetPath: path,
      })

      const now = new Date().toISOString()
      run = await completeDocumentDraft({
        run: {
          ...run,
          activeDispatch: {
            dispatchId,
            workerType: 'document-author',
            phase: run.phase,
            revision: run.revision.document,
            status: 'completed',
            request,
            startedAt: now,
            finishedAt: now,
          },
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
    }

    expect(run.phase).toBe('DOCUMENT_REVIEW')
    expect(run.foundationDraftState.completedPaths).toEqual(
      [...CANONICAL_FOUNDATION_DOCUMENTS],
    )
    for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
      const content = await readFile(join(workspacePath, path), 'utf8')
      for (const section of getGameDocumentContract(path).sections)
        expect(content).toContain(
          `<!-- beegame-section:${section.sectionId} -->`,
        )
    }
  })

  test('does not advance past an invalid complete foundation document', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'invalid-idea-document-'))
    workspaces.push(workspacePath)
    const path = CANONICAL_FOUNDATION_DOCUMENTS[0]
    const contract = getGameDocumentContract(path)
    const submission = completeSubmission(path)
    const renderedLines = renderCompleteGameDocument(path, submission).split('\n')
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
