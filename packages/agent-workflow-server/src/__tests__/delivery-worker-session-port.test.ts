import { describe, expect, test } from 'bun:test'
import { createBeeGameDeliveryWorkerPort } from '../beegame/delivery-worker-session-port'
import type { BeeGameSessionManager } from '../beegame/session-manager'
import type { WorkerDispatchRequest } from '../beegame/delivery-workflow/types'

describe('delivery worker session credentials', () => {
  test('resolves the current auth token for every worker start and submit', async () => {
    const starts: Array<{ authToken?: string }> = []
    const updates: Array<{ sessionId: string; authToken?: string }> = []
    const displays: Array<{ authToken?: string }> = []
    const sessions = {
      start(input: { authToken?: string }) {
        starts.push(input)
        return { id: `session-${starts.length}` }
      },
      updateAuthToken(sessionId: string, authToken?: string) {
        updates.push({ sessionId, authToken })
      },
      async sendWithDisplay(
        _sessionId: string,
        _prompt: string,
        display: { authToken?: string },
      ) {
        displays.push(display)
      },
    } as unknown as BeeGameSessionManager
    let authToken = 'author-token'
    const port = createBeeGameDeliveryWorkerPort({
      sessions,
      userId: 'user-1',
      getAuthToken: () => authToken,
    })
    const request: WorkerDispatchRequest = {
      dispatchId: 'dispatch-1',
      runId: 'run-1',
      ownerId: 'user-1',
      projectId: 'project-1',
      workspacePath: '/tmp/project-1',
      workerType: 'document-reviewer',
      phase: 'DOCUMENT_REVIEW',
      revision: 'revision-1',
      contract: {},
    }

    await port.start(request)
    authToken = 'reviewer-token'
    await port.submit('dispatch-1', 'Review the documents')

    expect(starts.map(start => start.authToken)).toEqual(['author-token'])
    expect(updates).toEqual([
      { sessionId: 'session-1', authToken: 'reviewer-token' },
    ])
    expect(displays.map(display => display.authToken)).toEqual([
      'reviewer-token',
    ])
  })
})
