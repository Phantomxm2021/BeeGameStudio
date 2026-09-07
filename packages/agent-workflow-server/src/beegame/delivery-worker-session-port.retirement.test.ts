import { expect, test } from 'bun:test'
import { createBeeGameDeliveryWorkerPort } from './delivery-worker-session-port'
import { CANONICAL_FOUNDATION_DOCUMENTS, type WorkerDispatchRequest } from './delivery-workflow/types'

test('old shared transport rejects every foundation author before session, credentials or workspace effects', async () => {
  let effects = 0
  const fail = () => { effects++; throw new Error('No shared session side effects are allowed') }
  const port = createBeeGameDeliveryWorkerPort({ userId: 'owner', sessions: { start: fail } as never, getAuthToken: async () => fail() })
  for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
    for (const authoringMode of [undefined, 'initial', 'parallel-draft']) {
      const request: WorkerDispatchRequest = { runId: 'run', ownerId: 'owner', projectId: 'project', workspacePath: '/must-not-exist',
        workerType: 'document-author', phase: 'DOCUMENT_DRAFTING', revision: 'revision', allowedPaths: [path],
        contract: { documentSet: 'foundation', foundationDocumentPath: path, ...(authoringMode ? { authoringMode } : {}) } }
      await expect(port.start(request)).rejects.toThrow('retired')
    }
  }
  expect(effects).toBe(0)
})
