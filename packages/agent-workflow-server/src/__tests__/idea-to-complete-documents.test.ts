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
import { renderCompleteGameDocument } from '../beegame/complete-game-document'

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
      const submission = {
        title: documentContract.discipline,
        sections: documentContract.sections.map((section, sectionIndex) => ({
          sectionId: section.sectionId,
          title: section.title,
          body: `Complete authority ${documentIndex + 1}.${sectionIndex + 1}.`,
          decisions: [
            {
              decisionId: `${section.sectionId}.decision`,
              statement: `Production decision ${sectionIndex + 1}.`,
              rationale: `Decision rationale ${sectionIndex + 1}.`,
            },
          ],
          productionDetails: [
            {
              detailId: `${section.sectionId}.detail`,
              statement: `Production detail ${sectionIndex + 1}.`,
              owner: documentContract.discipline,
              acceptanceCriteria: [
                `Observable acceptance ${sectionIndex + 1}.`,
              ],
            },
          ],
          upstreamReferences: documentContract.allowedUpstreamPaths.map(
            upstreamPath => ({
              path: upstreamPath,
              authorityId: `${section.sectionId}.upstream`,
            }),
          ),
          risks: [],
          openDecisions: [],
        })),
      }
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
          renderCompleteGameDocument(path, submission),
        ].join('\n'),
      )

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
    const submission = {
      title: contract.discipline,
      sections: contract.sections.map(section => ({
        sectionId: section.sectionId,
        title: section.title,
        body: `Complete authority for ${section.sectionId}.`,
        decisions: [
          {
            decisionId: `${section.sectionId}.decision`,
            statement: `Production decision for ${section.sectionId}.`,
            rationale: `Decision rationale for ${section.sectionId}.`,
          },
        ],
        productionDetails: [
          {
            detailId: `${section.sectionId}.detail`,
            statement: `Production detail for ${section.sectionId}.`,
            owner: contract.discipline,
            acceptanceCriteria: [
              `Observable acceptance for ${section.sectionId}.`,
            ],
          },
        ],
        upstreamReferences: [],
        risks: [],
        openDecisions: [],
      })),
    }
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
