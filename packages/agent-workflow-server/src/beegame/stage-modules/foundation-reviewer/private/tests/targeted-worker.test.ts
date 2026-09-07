import { expect, test } from 'bun:test'
import { mkdtemp, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { firstCandidateFixture } from '../test-fixtures/candidate-fixture'
import { createReviewerTargetedFactWorker, createReviewerTargetedSemanticWorker } from '../targeted-worker'
import { validateReviewerTargetedFacts } from '../targeted-preparation'
import { executeReviewWorker } from '../native-worker'

test('targeted fact output is bounded and binds receipts to candidate evidence', () => {
  const { prepared } = firstCandidateFixture(false)
  const task = createReviewerTargetedFactWorker(prepared, 0)
  const output = task.admit({ status: 'completed', results: [{ key: 'game.mechanics', status: 'present', value: ['move', 'attack', 'dash', 'parry'] }] })
  expect(output.receipts).toHaveLength(1)
  expect(output.facts[0]!.source.digest).not.toBe(prepared.issues[0]!.source.digest)
  expect(validateReviewerTargetedFacts(prepared, output.receipts).semantic).toHaveLength(1)
  expect(() => task.admit({ status: 'completed', results: [{ key: 'game.mechanics', status: 'absent', evidence: {} }] })).toThrow()
  expect(() => createReviewerTargetedFactWorker(prepared, 1)).toThrow('index')
})
test('targeted semantic admission owns expected, scope and issue identity; malformed FAIL cannot pass', () => {
  const { prepared } = firstCandidateFixture()
  const task = createReviewerTargetedSemanticWorker(prepared, [], 0)
  const ref = validateReviewerTargetedFacts(prepared, []).semantic[0]!.packet.sections[0]!.ref
  const payload = { status: 'FAIL', diagnostic: { observedActual: 'feedback is still missing',
    failureReasonCode: 'expected_not_met', evidence: [{ documentPath: ref.documentPath, sectionId: ref.sectionId, digest: ref.digest }] } }
  const result = task.admit(payload)
  expect(result).toMatchObject({ status: 'FAIL', issueId: prepared.issues[0]!.id,
    diagnostic: { unmetExpected: prepared.issues[0]!.expected, scopeAssessment: 'repairable_in_scope' } })
  for (const invalid of [{ status: 'ISSUES' }, { status: 'UNDECIDABLE' }, { status: 'PASS', diagnostic: payload.diagnostic },
    { ...payload, issueId: 'forged' }, { ...payload, diagnostic: { ...payload.diagnostic, scopeAssessment: 'ignore' } },
    { ...payload, diagnostic: { ...payload.diagnostic, evidence: [{ ...payload.diagnostic.evidence[0], digest: 'f'.repeat(64) }] } }])
    expect(() => task.admit(invalid)).toThrow()
})
test('targeted semantic prompt includes exact assigned section digests without task or candidate identity', () => {
  const { prepared } = firstCandidateFixture()
  const task = createReviewerTargetedSemanticWorker(prepared, [], 0)
  const packet = validateReviewerTargetedFacts(prepared, []).semantic[0]!.packet
  const modelPacket = JSON.parse(task.prompt.split('Model packet contract: ')[1]!).packet
  expect(modelPacket.sections.map((section: Record<string, string>) =>
    `${section.documentPath}#${section.sectionId}:${section.digest}`)).toEqual(packet.sections.map(section =>
      `${section.ref.documentPath}#${section.ref.sectionId}:${section.ref.digest}`))
  expect(task.prompt).toContain('Return only PASS or FAIL in the supplied StructuredOutput schema')
  expect(task.prompt).toContain('targeted semantic recheck schema')
  expect(task.prompt).not.toContain('Issue drafts must use only assigned section keys')
  expect(task.prompt).not.toContain('Semantic Issue remediation must be exactly')
  expect(task.prompt).not.toContain('targeted-semantic-0')
  expect(task.prompt).not.toContain('candidate-one')
  expect(task.schema.properties.diagnostic.properties.evidence.items.required).toContain('digest')
})
test('actual offline native process completes targeted FAIL with bound diagnostic without writing project files', async () => {
  const { prepared } = firstCandidateFixture()
  const workspacePath = await mkdtemp(join(tmpdir(), 'reviewer-targeted-worker-'))
  try {
    const task = createReviewerTargetedSemanticWorker(prepared, [], 0)
    const result = await executeReviewWorker({ workspacePath, task,
      configuration: { command: [process.execPath, join(import.meta.dir, '../test-fixtures/native-reviewer.ts'), '--fixture-mode=targeted-fail'], env: {} } })
    expect(result.value.status).toBe('FAIL')
    if (result.value.status !== 'FAIL') return
    expect(result.value.diagnostic.observedActual).toBe('fixture actual persists')
    expect(result.value.diagnostic.evidence.map(ref => `${ref.documentPath}#${ref.sectionId}:${ref.digest}`)).toEqual(
      validateReviewerTargetedFacts(prepared, []).semantic[0]!.packet.sections.map(section =>
        `${section.ref.documentPath}#${section.ref.sectionId}:${section.ref.digest}`))
    expect(result.usage.total_tokens).toBe(10)
    expect(await readdir(workspacePath)).toEqual([])
  } finally { await rm(workspacePath, { recursive: true, force: true }) }
})
test('actual offline native process completes targeted PASS without writing project files', async () => {
  const { prepared } = firstCandidateFixture()
  const workspacePath = await mkdtemp(join(tmpdir(), 'reviewer-targeted-worker-'))
  try {
    const result = await executeReviewWorker({ workspacePath, task: createReviewerTargetedSemanticWorker(prepared, [], 0),
      configuration: { command: [process.execPath, join(import.meta.dir, '../test-fixtures/native-reviewer.ts'), '--fixture-mode=targeted-pass'], env: {} } })
    expect(result.value.status).toBe('PASS')
    expect(result.usage.total_tokens).toBe(10)
    expect(await readdir(workspacePath)).toEqual([])
  } finally { await rm(workspacePath, { recursive: true, force: true }) }
})
