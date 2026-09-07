import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startDocumentStage, completeFoundationDocumentDraft } from '../foundation-authoring-stage'
import { recordFoundationDispatch } from '../foundation-authoring-batch'
import { buildFoundationAuthorAuthorityBlock } from '../foundation-authoring-input'
import { commitAuthoredFoundationDocument } from '../authored-document-receipt'
import { getGameDocumentContract } from '../game-document-contracts'
import { CANONICAL_FOUNDATION_DOCUMENTS, type DispatchRecord, type FoundationAuthoringContext, type WorkerDispatchRequest } from '../types'
import { authoringRun } from '../../test-fixtures/authoring-context'
import { FROZEN_DOCUMENTS } from '../../test-fixtures/frozen-documents'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function workspace() {
  const path = await mkdtemp(join(tmpdir(), 'author-domain-completion-'))
  roots.push(path)
  return path
}
async function requestsFor(run: FoundationAuthoringContext, workspacePath: string) {
  const requests: WorkerDispatchRequest[] = []
  await startDocumentStage({ run, workspacePath, dispatcher: { async dispatch(value) { requests.push(value) } } })
  return requests
}
async function complete(run: FoundationAuthoringContext, request: WorkerDispatchRequest, workspacePath: string, body: string, index: number) {
  const path = request.contract.foundationDocumentPath!
  const dispatchId = 'completion-' + index
  request = { ...request, dispatchId }
  const dispatch: DispatchRecord = { dispatchId, workerType: 'document-author', phase: 'DOCUMENT_DRAFTING', taskId: path,
    revision: run.revision.document, status: 'running', request, startedAt: '2026-09-05T00:00:00.000Z' }
  if (run.foundationDraftState.documents)
    run = { ...run, foundationDraftState: recordFoundationDispatch(run.foundationDraftState, path, 'drafting', dispatch) }
  await buildFoundationAuthorAuthorityBlock(request)
  await commitAuthoredFoundationDocument({ workspacePath, dispatchId, targetPath: path, authoredBody: body, updatedAt: '2026-09-05T00:00:00.000Z' })
  return completeFoundationDocumentDraft({ run: { ...run, activeDispatch: { ...dispatch, status: 'completed' } }, workspacePath,
    terminal: { workerType: 'document-author', status: 'completed', writtenPaths: [path], resolvedFindingIds: [] } })
}

test('projects confirmed authority and accepts every complete discipline through the private Author domain', async () => {
  const path = await workspace()
  let run = authoringRun()
  let count = 0
  while (run.phase === 'DOCUMENT_DRAFTING') {
    const requests = await requestsFor(run, path)
    expect(requests.length).toBeGreaterThan(0)
    for (const request of requests) {
      const document = request.contract.foundationDocumentPath!
      expect(request.contract.confirmedBriefContext).toBe(run.confirmedBriefContext)
      expect(request.contract.completeDocumentContract).toEqual(getGameDocumentContract(document))
      run = await complete(run, request, path, FROZEN_DOCUMENTS[document], count++)
      expect(run.blockedReason).toBeUndefined()
    }
  }
  expect(count).toBe(8)
  expect(run.phase).toBe('DOCUMENT_REVIEW')
  expect(run.foundationDraftState.completedPaths).toEqual([...CANONICAL_FOUNDATION_DOCUMENTS])
  for (const document of CANONICAL_FOUNDATION_DOCUMENTS) {
    const text = await readFile(join(path, document), 'utf8')
    for (const section of getGameDocumentContract(document).sections)
      expect(text).toContain('<!-- beegame-section:' + section.sectionId + ' -->')
  }
})

test('non-empty malformed Markdown remains accepted for later review rather than being silently rewritten', async () => {
  const path = await workspace()
  const run = authoringRun()
  const request = (await requestsFor(run, path))[0]!
  const body = '# Incomplete GDD\n\nIntentionally lacks discipline format markers.\n'
  const result = await complete(run, request, path, body, 0)
  expect(result.blockedReason).toBeUndefined()
  expect(result.foundationDraftState.completedPaths).toContain('docs/GDD.md')
  expect((await readFile(join(path, 'docs/GDD.md'), 'utf8')).endsWith(body)).toBe(true)
})
