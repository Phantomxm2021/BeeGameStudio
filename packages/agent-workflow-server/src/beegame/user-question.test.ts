import { expect, test } from 'bun:test'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { answeredQuestionInput } from './user-question'
import { BeeGameSessionManager, type DashboardPermissionDecision } from './session-manager'
import { AUTHOR_BATCHES } from './project-author'
import { writeDesignDocumentsFixture } from './fixtures/layout-fixture'
import { beginProjectDelivery, advanceProjectDeliveryAfterTurn, readProjectDelivery } from './project-delivery'
import { prepareLegacyDesignReviewFixture } from './fixtures/layout-fixture'
import type { DesignFinding } from '@bee-game-studio/agent-workflow/design-review-result'

const input = { questions: [
  { question: 'Style?', header: 'Style', options: [{ label: 'Pixel' }, { label: 'Vector' }] },
  { question: 'Features?', multiSelect: true, options: [{ label: 'Jump' }, { label: 'Run' }] },
], metadata: { source: 'test' } }
const answers = { 'Style?': 'Custom style', 'Features?': 'Jump, Run' }

test('returns answers with untouched native questions and metadata', () => {
  expect(answeredQuestionInput('AskUserQuestion', input, answers)).toEqual({ ...input, answers })
  expect('answers' in input).toBe(false)
})

test('does not accept partial, empty, unknown, malformed answers or answers for another tool', () => {
  for (const value of [undefined, [], {}, { 'Style?': 'Pixel' }, { ...answers, 'Style?': ' ' },
    { ...answers, extra: 'unexpected' }, { ...answers, 'Style?': 1 }]) {
    expect(() => answeredQuestionInput('AskUserQuestion', input, value)).toThrow()
  }
  expect(() => answeredQuestionInput('Bash', { command: 'echo test' }, answers)).toThrow()
})

test('keeps invalid submissions pending and delivers valid answers once', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bgs-question-'))
    let received: DashboardPermissionDecision | undefined
    const manager = new BeeGameSessionManager({ start: async () => ({ stop() {}, async submit(turn) {
      received = await turn.requestPermission({ toolUseID: 'question', toolName: 'AskUserQuestion', input, message: 'Answer?' })
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'Answered' })
    } }) }, root)
    try {
      const session = manager.start({ workspacePath: root, userId: 'owner', projectId: 'project' })
      await manager.sendWithDisplay(session.id, 'Offline question fixture')
      for (let i = 0; i < 200 && !manager.pendingPermissionsForProject('owner', 'project', root).length; i++) await Bun.sleep(5)
      expect(manager.pendingPermissionsForProject('owner', 'project', root)).toHaveLength(1)
      expect(() => manager.resolvePermission(session.id, 'question', { behavior: 'allow', answers: {} })).toThrow()
      expect(manager.pendingPermissionsForProject('owner', 'project', root)).toHaveLength(1)
      manager.resolvePermission(session.id, 'question', { behavior: 'allow', scope: 'once', answers })
      for (let i = 0; i < 200 && !received; i++) await Bun.sleep(5)
      expect(received).toMatchObject({ behavior: 'allow', scope: 'once', updatedInput: { ...input, answers }, updatedPermissions: [] })
      expect(manager.pendingPermissionsForProject('owner', 'project', root)).toHaveLength(0)
      expect(() => manager.resolvePermission(session.id, 'question', { behavior: 'allow', answers })).toThrow('Permission request not found')
    } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('declining a question does not require answers or strand the agent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-question-decline-'))
  let received: DashboardPermissionDecision | undefined
  const manager = new BeeGameSessionManager({ start: async () => ({ stop() {}, async submit(turn) {
    received = await turn.requestPermission({ toolUseID: 'question', toolName: 'AskUserQuestion', input, message: 'Answer?' })
  } }) }, root)
  try {
    const session = manager.start({ workspacePath: root, userId: 'owner', projectId: 'project' })
    await manager.sendWithDisplay(session.id, 'Offline decline fixture')
    for (let i = 0; i < 200 && !manager.pendingPermissionsForProject('owner', 'project', root).length; i++) await Bun.sleep(5)
    manager.resolvePermission(session.id, 'question', { behavior: 'deny' })
    for (let i = 0; i < 200 && !received; i++) await Bun.sleep(5)
    expect(received).toMatchObject({ behavior: 'deny' })
    expect(manager.pendingPermissionsForProject('owner', 'project', root)).toHaveLength(0)
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test.each([false, true])('design Question broker persists only an answer to the current saved version; drift=%s', async drift => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-design-question-broker-'))
  let received: DashboardPermissionDecision | undefined
  const finding: DesignFinding = { id: 'F1', severity: 'blocker', action: 'decide', owner: 'user', documents: ['GDD.md'],
    sources: [{ document: 'GDD.md', section: 'Design' }], impact: 'Changes a confirmed requirement', closeWhen: 'User chooses and saved design is verified', neededBefore: 'resources' }
  await beginProjectDelivery(root, root, 'Synthetic confirmed brief')
  for (const [batch, documents] of AUTHOR_BATCHES.entries()) {
    await writeDesignDocumentsFixture(root, documents)
    await advanceProjectDeliveryAfterTurn(root, root, batch === 0 ? { phase: 'author', status: 'complete', summary: '' } : undefined, batch || undefined)
  }
  await prepareLegacyDesignReviewFixture(root, root)
  await advanceProjectDeliveryAfterTurn(root, root, { phase: 'review', status: 'complete', summary: '', review: { step: 'inspect', findings: [finding], resolved: [] } })
  const state = (await readProjectDelivery(root, root))!
  const review = state.designReview!
  const question = { questions: [{ question: 'Keep the confirmed feature?', header: 'F1', options: [{ label: 'Keep', description: 'Preserves requirements' }, { label: 'Remove', description: 'Reduces scope' }] }],
    metadata: { source: 'bgs-design-review:' + review.revision } }
  const manager = new BeeGameSessionManager({ start: async () => ({ stop() {}, async submit(turn) {
    received = await turn.requestPermission({ toolUseID: 'design-q', toolName: 'AskUserQuestion', input: question, message: 'Design decision' })
    await turn.onMessage({ type: 'result', subtype: 'success', result: 'Question returned' })
  } }) }, root)
  try {
    const session = manager.start({ workspacePath: root, userId: 'owner', projectId: 'project' })
    await manager.sendWithDisplay(session.id, 'Offline Revision', { prepareTurn: async () => ({ projectTurn: {
      restartContext: true, reviewDocuments: ['GDD.md'], reviewStep: 'revise', reviewWorkspace: root,
      reviewResultPath: join(root, '.beegame/tmp/receipt.txt'), reviewWritableDocuments: ['GDD.md'],
      reviewRevision: review.revision, reviewReceiptContext: { step: 'revise', findings: [finding], sourceHeadings: { 'GDD.md': ['Design'] } },
    } }) })
    for (let i = 0; i < 200 && !manager.pendingPermissionsForProject('owner', 'project', root).length; i++) await Bun.sleep(5)
    expect(manager.pendingPermissionsForProject('owner', 'project', root)[0]?.input).toEqual(question)
    expect((await readProjectDelivery(root, root))?.designReview?.userDecisions).toBeUndefined()
    if (drift) {
      const path = join(root, 'docs/GDD.md')
      await writeFile(path, (await readFile(path, 'utf8')) + '\nExternal source change while waiting\n')
    }
    manager.resolvePermission(session.id, 'design-q', { behavior: 'allow', answers: { 'Keep the confirmed feature?': 'Keep' } })
    for (let i = 0; i < 200 && !received; i++) await Bun.sleep(5)
    expect(received?.behavior).toBe(drift ? 'deny' : 'allow')
    const saved = await readProjectDelivery(root, root)
    expect(saved?.designReview?.userDecisions).toEqual(drift ? undefined : [{ id: 'F1', toolUseID: 'design-q', revision: review.revision, question: 'Keep the confirmed feature?', answer: 'Keep' }])
    expect(saved?.designReview?.step).toBe('revise')
    expect(saved?.designBaseline).toBeUndefined()
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})
