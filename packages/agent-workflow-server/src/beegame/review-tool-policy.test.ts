import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { reviewToolPolicy, designReviewReference } from './review-tool-policy'
import { writeDesignDocumentsFixture, designHandoffFixture } from './fixtures/layout-fixture'
import type { NativeProjectTurnInput } from '@bee-game-studio/agent-workflow/native-direction-authors'
import type { DashboardPermissionDecision, DashboardPermissionRequest } from './session-manager'

async function fixture(run: (root: string, turn: NativeProjectTurnInput) => Promise<void>, step: 'inspect' | 'revise' | 'verify' = 'inspect') {
  const root = await realpath(await mkdtemp('/private/tmp/bgs-review-policy-test-'))
  await writeDesignDocumentsFixture(root); await mkdir(join(root, '.beegame/tmp'), { recursive: true })
  const turn: NativeProjectTurnInput = { reviewDocuments: ['GDD.md'], reviewStep: step, reviewWorkspace: root,
    reviewResultPath: join(root, '.beegame/tmp/receipt.txt'), reviewRevision: 'a'.repeat(64), reviewWritableDocuments: ['GDD.md'],
    reviewReceiptContext: { step, findings: [], sourceHeadings: { 'GDD.md': ['Design'] } } }
  try { await run(root, turn) } finally { await rm(root, { recursive: true, force: true }) }
}
const request = (toolName: string, input: Record<string, unknown>): DashboardPermissionRequest => ({ toolName, toolUseID: 'fixture-tool', input, message: 'Fixture' })
const receipt = (step: string) => 'complete\n' + JSON.stringify({ step, findings: [], resolved: [] })
const allow = async (): Promise<DashboardPermissionDecision> => ({ behavior: 'allow', source: 'policy' })
const finding = { id: 'choose', severity: 'blocker' as const, action: 'decide' as const, owner: 'user' as const,
  documents: ['GDD.md' as const], sources: [{ document: 'GDD.md' as const, section: 'Design' }],
  impact: 'Two conflicting approved directions.', closeWhen: 'Choose a direction.', neededBefore: 'resources' as const }
const questions = [{ header: 'choose', question: 'Which direction?', options: [{ label: 'A', description: 'A' }, { label: 'B', description: 'B' }], multiSelect: false }]

test.each(['inspect', 'revise', 'verify'] as const)('%s retains exact write scope and literal checker commands through BGS stdio policy', step => fixture(async (root, turn) => {
  const policy = reviewToolPolicy(turn, allow)
  expect((await policy(request('Write', { file_path: turn.reviewResultPath, content: receipt(step) })))?.behavior).toBe('allow')
  expect((await policy(request('Write', { file_path: join(root, 'docs/GDD.md'), content: '# Design' })))?.behavior).toBe(step === 'revise' ? 'allow' : 'deny')
  expect((await policy(request('Edit', { file_path: join(root, 'docs/ART_DIRECTION.md') })))?.behavior).toBe('deny')
  expect((await policy(request('Agent', {})))?.behavior).toBe('deny')
  expect((await policy(request('Bash', { command: 'bun .beegame/delivery/check-content.mjs --help' })))?.behavior).toBe('allow')
  expect((await policy(request('Bash', { command: 'bun .beegame/delivery/check-content.mjs --help | echo done' })))?.behavior).toBe('deny')
  expect(await policy(request('Read', { file_path: join(root, 'docs/GDD.md') }))).toBeUndefined()
}, step))

test('receipt field mistakes and invalid saved indexes get exact feedback, not a new review or claimed PASS', () => fixture(async (root, turn) => {
  turn.reviewDocuments = ['TECHNICAL_DESIGN.md']; turn.reviewWritableDocuments = ['TECHNICAL_DESIGN.md']
  turn.reviewReceiptContext!.sourceHeadings = { 'TECHNICAL_DESIGN.md': ['Design'] }
  const index = designHandoffFixture('TECHNICAL_DESIGN.md'); delete index.implementationItems
  await writeFile(join(root, '.beegame/design-handoffs/TECHNICAL_DESIGN.json'), JSON.stringify(index))
  const policy = reviewToolPolicy(turn, allow)
  expect((await policy(request('Write', { file_path: turn.reviewResultPath, content: receipt('revise') })))?.message).toContain('implementationItems')
  expect((await policy(request('Write', { file_path: turn.reviewResultPath + '-mistyped', content: receipt('revise') })))?.message).toContain('Expected Write.file_path')
  expect((await policy(request('Write', { file_path: turn.reviewResultPath, content: 'done' })))?.message).toContain('First line')
}, 'revise'))

test('authorized names do not grant write access through an external or inside-workspace symlink', () => fixture(async (root, turn) => {
  await symlink('/etc/hosts', join(root, 'docs/GDD.md.alias'))
  turn.reviewWritableFiles = ['docs/GDD.md.alias']
  const policy = reviewToolPolicy(turn, allow)
  expect((await policy(request('Edit', { file_path: join(root, 'docs/GDD.md.alias') })))?.behavior).toBe('deny')
  await symlink(join(root, 'docs/GDD.md'), turn.reviewResultPath!)
  expect((await policy(request('Write', { file_path: turn.reviewResultPath, content: receipt('revise') })))?.behavior).toBe('deny')
}, 'revise'))

test.each(['automatic', 'empty', 'changed', 'declined'] as const)('Question %s cannot authorize design changes or completion', mode => fixture(async (root, turn) => {
  turn.reviewReceiptContext!.findings = [finding]
  const policy = reviewToolPolicy(turn, async req => {
    if (mode === 'declined') return { behavior: 'deny', source: 'user' }
    return { behavior: 'allow', source: mode === 'automatic' ? 'policy' : 'user',
      updatedInput: { ...req.input, ...(mode === 'changed' ? { questions: [] } : {}), answers: mode === 'empty' ? {} : { 'Which direction?': 'A' } } }
  })
  expect((await policy(request('AskUserQuestion', { questions })))?.behavior).toBe('deny')
  expect((await policy(request('Edit', { file_path: join(root, 'docs/GDD.md') })))?.message).toContain('required user answers')
}, 'revise'))

test('new decision proposals stay in BGS; only standard Question metadata and actual human answers return to native', () => fixture(async (root, turn) => {
  await writeFile(turn.reviewResultPath! + '.decision-findings.json', JSON.stringify([finding]))
  let retained: unknown
  const policy = reviewToolPolicy(turn, async req => {
    expect((req.input.metadata as any).designFindings).toEqual([finding])
    return { behavior: 'allow', source: 'user', updatedInput: { ...req.input, answers: { 'Which direction?': 'A' } } }
  }, undefined, async state => { retained = JSON.parse(JSON.stringify(state)) })
  const decision = await policy(request('AskUserQuestion', { questions }))
  expect(decision?.behavior).toBe('allow')
  expect(decision?.updatedInput?.metadata).toEqual({ source: 'bgs-design-review:' + turn.reviewRevision })
  expect((retained as any).decisions).toEqual(['choose'])
  expect((await policy(request('Edit', { file_path: join(root, 'docs/GDD.md') })))?.behavior).toBe('allow')
  expect((await policy(request('Write', { file_path: turn.reviewResultPath, content: receipt('revise') })))?.message).toContain('preserve review findings')
  const restarted = reviewToolPolicy(turn, allow, retained as any)
  expect((await restarted(request('AskUserQuestion', { questions })))?.message).toContain('already has a retained')
}, 'revise'))

test('selected Review methods are the exact Skill source sections and missing sections fail closed', async () => {
  const root = new URL('../../../../.beegame/skills/builtinskills/game-design-check/', import.meta.url).pathname
  expect(await designReviewReference(root, ['GDD.md'])).toContain('## GDD.md')
  await expect(designReviewReference(root, ['DOES_NOT_EXIST.md'])).rejects.toThrow('unavailable')
})

test('a pending newly discovered Question survives interruption and is still enriched for the human broker', () => fixture(async (_root, turn) => {
  await writeFile(turn.reviewResultPath! + '.decision-findings.json', JSON.stringify([finding]))
  let saved: any
  const first = reviewToolPolicy(turn, async () => ({ behavior: 'deny', source: 'user' }), undefined,
    async state => { saved = JSON.parse(JSON.stringify(state)) })
  expect((await first(request('AskUserQuestion', { questions })))?.behavior).toBe('deny')
  const restarted = reviewToolPolicy(turn, async req => {
    expect((req.input.metadata as any).designFindings).toEqual([finding])
    return { behavior: 'allow', source: 'user', updatedInput: { ...req.input, answers: { 'Which direction?': 'B' } } }
  }, saved)
  expect((await restarted(request('AskUserQuestion', { questions })))?.behavior).toBe('allow')
}, 'revise'))

