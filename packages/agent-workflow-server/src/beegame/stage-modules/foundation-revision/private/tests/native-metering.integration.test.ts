import { expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { createRevisionNativeAssignment } from '../native-assignment'
import { buildRevisionNativeEnvironment } from '../native-environment'
import { executeRevisionNativeProcess } from '../native-process'
import { captureRevisionUsageEvent, getLatestRevisionRuntimeUsage, type RevisionUsageEvent } from '../native-usage'
import { revisionDigest } from '../json-digest'
import { buildReviewerPublishedResult } from '../../../foundation-reviewer/private/review-publication'
import { initialReviewerFactState } from '../../../foundation-reviewer/private/fact-state'
import { reviewFixtureDocuments } from '../../../foundation-reviewer/private/test-fixtures/review-fixture'

async function assignmentFixture() {
  const documents = reviewFixtureDocuments()
  documents[0]!.content = '# incomplete\r\n'
  const sourceResult = buildReviewerPublishedResult({ documents, state: initialReviewerFactState(documents),
    identity: { ownerId: 'owner', projectId: 'project', requestId: 'review' },
    subject: { kind: 'initial', sourceResultId: 'author', sourceDocumentRevision: 'a'.repeat(64), confirmedBriefDigest: 'b'.repeat(64) } })
  const request = { kind: 'initial', ownerId: 'owner', projectId: 'project', requestId: 'repair', sourceResult,
    sourceBinding: { ownerId: 'owner', projectId: 'project', resultId: sourceResult.resultId, resultDigest: revisionDigest(sourceResult) } }
  return createRevisionNativeAssignment({ request, attemptId: randomUUID(), documentPath: 'docs/GDD.md' })
}

test('owned assignment, environment, native protocol and late metering compose without a model call', async () => {
  const assignment = await assignmentFixture()
  const usageEvents: RevisionUsageEvent[] = []
  try {
    const result = await executeRevisionNativeProcess({
      configuration: { command: [process.execPath, resolve(import.meta.dir, 'native-metering-fixture.ts')],
        env: buildRevisionNativeEnvironment({}, assignment.bridgeEnvironment) },
      cwd: assignment.cwd, scope: assignment.scope, prompt: assignment.prompt,
      onMessage(message: Record<string, unknown>) {
        const usage = captureRevisionUsageEvent(message)
        if (usage) usageEvents.push(usage)
        // The native parser must never consume a callback-mutated object.
        message.result = '# Wrong observer replacement'
      },
    })
    expect(result.markdown).toBe('# Repaired fixture')
    expect(result.completion.scope).toBe('direct-child')
    expect(result.completion.stdoutDrained).toBe(true)
    expect(result.completion.pid).toBeGreaterThan(0)
    expect(usageEvents).toHaveLength(3)
    expect(getLatestRevisionRuntimeUsage(usageEvents).total_tokens).toBe(18)
    expect(JSON.stringify(usageEvents)).not.toContain('incomplete')
    expect(JSON.stringify(usageEvents)).not.toContain('Repaired')
  } finally { await assignment.dispose() }
}, 10_000)

test('an observer failure cannot succeed, but buffered late usage is still drained', async () => {
  const assignment = await assignmentFixture()
  const usageEvents: RevisionUsageEvent[] = []
  let rejected = false
  try {
    const result = executeRevisionNativeProcess({
      configuration: { command: [process.execPath, resolve(import.meta.dir, 'native-metering-fixture.ts')],
        env: buildRevisionNativeEnvironment({}, assignment.bridgeEnvironment) },
      cwd: assignment.cwd, scope: assignment.scope, prompt: assignment.prompt,
      onMessage(message: Record<string, unknown>) {
        const usage = captureRevisionUsageEvent(message)
        if (!usage) return
        usageEvents.push(usage)
        if (!rejected) { rejected = true; throw new Error('private persistence fixture failure') }
      },
    })
    await expect(result).rejects.toMatchObject({ code: 'revision_native_observer_failed', completion: { scope: 'direct-child', stdoutDrained: true } })
    expect(usageEvents).toHaveLength(3)
    expect(getLatestRevisionRuntimeUsage(usageEvents).total_tokens).toBe(18)
  } finally { await assignment.dispose() }
}, 10_000)
