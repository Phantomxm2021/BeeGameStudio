import { expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { createRevisionNativeAssignment } from '../native-assignment'
import { revisionDigest } from '../json-digest'
import { buildReviewerPublishedResult } from '../../../foundation-reviewer/private/review-publication'
import { initialReviewerFactState } from '../../../foundation-reviewer/private/fact-state'
import { completedReviewFixture, reviewFixtureDocuments } from '../../../foundation-reviewer/private/test-fixtures/review-fixture'
import { createNativeFoundationRevisionReadTool } from '../../../../native-foundation-revision-read-tool'

function fixture() {
  const documents = reviewFixtureDocuments()
  documents[0]!.content = '# incomplete\r\n'
  const sourceResult = buildReviewerPublishedResult({ documents, state: initialReviewerFactState(documents),
    identity: { ownerId: 'owner', projectId: 'project', requestId: 'review' },
    subject: { kind: 'initial', sourceResultId: 'author', sourceDocumentRevision: 'a'.repeat(64), confirmedBriefDigest: 'b'.repeat(64) } })
  return { kind: 'initial', ownerId: 'owner', projectId: 'project', requestId: 'repair', sourceResult,
    sourceBinding: { ownerId: 'owner', projectId: 'project', resultId: sourceResult.resultId, resultDigest: revisionDigest(sourceResult) } }
}

test('native document assignment captures bytes into a private read root outside the empty cwd', async () => {
  const request = fixture()
  const attemptId = randomUUID()
  const pending = createRevisionNativeAssignment({ request, attemptId, documentPath: 'docs/GDD.md' })
  request.sourceResult.documents[0]!.content = 'caller mutation'
  const assignment = await pending
  try {
    expect(await readdir(assignment.cwd)).toEqual([])
    expect(assignment.scope).toBe('document')
    expect(assignment.bridgeEnvironment.BEEGAME_WORKSPACE_PATH).not.toBe(assignment.cwd)
    const path = assignment.bridgeEnvironment.BEEGAME_REVISION_STAGED_PATH!
    expect(await readFile(path, 'utf8')).toBe('# incomplete\r\n')
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    const contract = JSON.parse(assignment.bridgeEnvironment.BEEGAME_REVISION_CONTRACT!)
    expect(contract.taskId).toBe(attemptId)
    expect(contract.stagedPath).toBe('assigned.md')
    expect(assignment.prompt).not.toContain('# incomplete')
    const tool = createNativeFoundationRevisionReadTool({ buildTool: definition => definition,
      workspacePath: assignment.bridgeEnvironment.BEEGAME_WORKSPACE_PATH!, expectedStagedPath: contract.stagedPath,
    }) as { call(value: unknown): Promise<unknown> }
    await expect(tool.call({ path: 'other' })).rejects.toThrow()
    expect(await tool.call({})).toEqual({ data: { markdown: '# incomplete\r\n' } })
    await expect(tool.call({})).rejects.toThrow('already read')
  } finally { await assignment.dispose() }
  await assignment.dispose()
  await expect(stat(assignment.cwd)).rejects.toThrow()
})

test('assignment cannot choose retained/non-dispatch documents or caller-provided filesystem roots', async () => {
  const input = { request: fixture(), attemptId: randomUUID(), documentPath: 'docs/GDD.md' }
  await expect(createRevisionNativeAssignment({ ...input, root: '/tmp' })).rejects.toThrow()
  await expect(createRevisionNativeAssignment({ ...input, documentPath: 'docs/TECHNICAL_DESIGN.md' })).rejects.toThrow('no dispatch authority')
  await expect(createRevisionNativeAssignment({ ...input, attemptId: '../escape' })).rejects.toThrow()
})

test('section assignments supply no full-document read bridge', async () => {
  const review = completedReviewFixture({ normalizedFacts: true, output: taskId => taskId === 'semantic-4'
    ? { status: 'completed', outcome: 'ISSUES', issues: [{ problem: 'feedback conflict', expected: 'readable feedback', actual: 'missing feedback',
      sourceSectionKey: 'GDD#player_actions', supportingSectionKeys: [], remediation: { kind: 'patch', sectionKeys: ['UI#input'] } }] }
    : { status: 'completed', outcome: 'PASS' } })
  const sourceResult = buildReviewerPublishedResult({ documents: review.documents, state: review.state,
    identity: { ownerId: 'owner', projectId: 'project', requestId: 'review' },
    subject: { kind: 'initial', sourceResultId: 'author', sourceDocumentRevision: 'a'.repeat(64), confirmedBriefDigest: 'b'.repeat(64) } })
  const request = { kind: 'initial', ownerId: 'owner', projectId: 'project', requestId: 'repair', sourceResult,
    sourceBinding: { ownerId: 'owner', projectId: 'project', resultId: sourceResult.resultId, resultDigest: revisionDigest(sourceResult) } }
  const assignment = await createRevisionNativeAssignment({ request, attemptId: randomUUID(), documentPath: 'docs/UI_UX_SPEC.md' })
  try {
    expect(assignment.scope).toBe('section')
    expect(assignment.bridgeEnvironment).toEqual({ BEEGAME_WORKFLOW_WORKER_TYPE: 'foundation-document-reviser' })
    expect(await readdir(assignment.cwd)).toEqual([])
    expect(assignment.prompt).toContain('Do not read the staged document; the service preserves every unassigned byte.')
  } finally { await assignment.dispose() }
})
