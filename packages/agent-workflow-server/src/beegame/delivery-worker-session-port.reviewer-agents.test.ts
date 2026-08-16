import { describe, expect, test } from 'bun:test'
import { createBeeGameDeliveryWorkerPort } from './delivery-worker-session-port'

function reviewerRequest(scope: 'foundation' | 'checklist') {
  return {
    dispatchId: `review-${scope}`,
    runId: 'run-review',
    ownerId: 'owner',
    projectId: 'project',
    workspacePath: process.cwd(),
    workerType: 'document-reviewer',
    phase: 'DOCUMENT_REVIEW',
    revision: 'a'.repeat(64),
    contract: {
      reviewScope: scope,
      reviewRole: 'final',
      assignment: {
        scope,
        role: 'final',
        sourcePaths: [],
        stagingOutputPaths: ['.beegame/reviews/staging/review.json'],
        committedOutputPaths: ['.beegame/reviews/review.json'],
        verificationSourcePaths: ['docs/GDD.md'],
      },
      revisionVerification: {
        kind: 'document',
        confirmedBriefDigest: 'b'.repeat(64),
        prerequisiteReports: [],
      },
      partDigests: { document: 'c'.repeat(64) },
      allowedAffectedPaths: ['docs/GDD.md'],
    },
  }
}

describe('Foundation Reviewer native agent boundary', () => {
  test('injects two fixed read-only agents only for the Foundation parent Reviewer', async () => {
    const starts: Array<Record<string, unknown>> = []
    const sessions = {
      start(input: Record<string, unknown>) {
        starts.push(input)
        return {
          id: `session-${starts.length}`,
          status: 'running',
          turnStatus: 'idle',
          createdAt: new Date(),
          updatedAt: new Date(),
          cwd: process.cwd(),
        }
      },
      updateAuthToken: () => undefined,
      events: () => [],
      get: () => undefined,
      stop: () => undefined,
    }
    const port = createBeeGameDeliveryWorkerPort({
      sessions: sessions as never,
      userId: 'user',
    })

    await port.start(reviewerRequest('foundation') as never)
    await port.start(reviewerRequest('checklist') as never)

    const definitions = starts[0]?.workflowAgentDefinitions as Record<
      string,
      { tools: string[] }
    >
    expect(Object.keys(definitions)).toEqual([
      'foundation-contract-specialist',
      'foundation-integration-specialist',
    ])
    expect(Object.values(definitions).map(value => value.tools)).toEqual([
      ['Read', 'Grep', 'Glob'],
      ['Read', 'Grep', 'Glob'],
    ])
    expect(starts[1]?.workflowAgentDefinitions).toBeUndefined()
  })
})
