import { describe, expect, test } from 'bun:test'
import { createBeeGameDeliveryWorkerPort } from './delivery-worker-session-port'

describe('delivery worker complete document boundary', () => {
  test('submits the dispatch-built revision projection instead of rebuilding from the start request', async () => {
    const prompts: string[] = []
    const sessions = {
      start: () => ({ id: 'revision-session' }),
      updateAuthToken: () => undefined,
      sendWithDisplay: async (_sessionId: string, prompt: string) => {
        prompts.push(prompt)
      },
    }
    const port = createBeeGameDeliveryWorkerPort({
      sessions: sessions as never,
      userId: 'user',
    })
    await port.start({
      dispatchId: 'revision-dispatch',
      runId: 'run',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'foundation-document-reviser',
      phase: 'DOCUMENT_REVIEW',
      revision: 'revision',
      allowedPaths: ['docs/GDD.md'],
      contract: {
        workerType: 'foundation-document-reviser',
        stagedPath: 'docs/GDD.md',
      },
    })
    await port.submit('revision-dispatch', 'DISPATCH_BUILT_REVISION_PROJECTION')
    expect(prompts).toEqual(['DISPATCH_BUILT_REVISION_PROJECTION'])
  })
})
