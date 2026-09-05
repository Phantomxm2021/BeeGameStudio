import { describe, expect, test, setSystemTime } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import * as artifacts from './foundation-audit-artifacts'
import * as extraction from './foundation-fact-extraction'
import * as facts from './foundation-fact-store'
import * as auditState from './foundation-audit-state'
import * as production from './foundation-audit-production-manifest'
import * as semantic from './foundation-semantic-audit'
import * as semanticRuntime from './foundation-semantic-runtime'
import * as reviewPublic from './stages/foundation-review/public'
import * as reviewBoundary from './foundation-review-boundary'
import { CANONICAL_FOUNDATION_DOCUMENTS, type DeliveryRun } from './types'
import { completeTestSubmission, renderTestCompleteGameDocument } from '../../__tests__/complete-game-document-fixture'
import { FOUNDATION_FACT_CATALOG } from './foundation-fact-definitions'
import { getGameDocumentContract } from './game-document-contracts'

const root = resolve(import.meta.dir, '../../../../..')
const controllerPath = 'packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts'
const baseline = execFileSync('git', ['show', '3230c7813:' + controllerPath], { cwd: root, encoding: 'utf8' })
const current = () => readFileSync(join(root, controllerPath), 'utf8')
type Operation = 'finalizeFoundationFacts' | 'completeDeterministicFoundationAudit'
function operationSource(source: string, operation: Operation) {
  const next = operation === 'finalizeFoundationFacts' ? 'completeDeterministicFoundationAudit' : 'finalizeFoundationSemanticReview'
  return source.slice(source.indexOf('  async function ' + operation + '('), source.indexOf('\n  async function ' + next + '('))
}
const digestHelper = baseline.slice(baseline.indexOf('function sameDocumentDigests('), baseline.indexOf('\nfunction markRevisionCommitTransient'))
const dependencies = {
  ...artifacts, ...extraction, ...facts, ...auditState, ...production,
  ...semantic, ...semanticRuntime, ...reviewPublic, ...reviewBoundary,
  CANONICAL_FOUNDATION_DOCUMENTS, readFile, join,
}
const revision = 'review-progression-equivalence'
function completeFixtureDocument(path: (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number]): string {
  let markdown = renderTestCompleteGameDocument(path, completeTestSubmission(path))
  const contract = getGameDocumentContract(path)
  for (const fact of FOUNDATION_FACT_CATALOG.filter(item => item.owner.documentPath === path)) {
    const materialId = fact.owner.sectionId.startsWith('material.') ? fact.owner.sectionId.slice('material.'.length) : undefined
    const heading = materialId ? contract.productionMaterials.find(item => item.materialId === materialId)?.title : contract.sections.find(item => item.sectionId === fact.owner.sectionId)?.title
    const marker = materialId ? `<!-- beegame-material:${materialId} -->` : `<!-- beegame-section:${fact.owner.sectionId} -->`
    const prefix = `${marker}\n${materialId ? '###' : '##'} ${heading}\n\n`
    const value = fact.valueType === 'number' ? fact.valueSpec.min ?? 1 : fact.valueType === 'string' ? fact.valueSpec.enum?.[0] ?? 'fixture' : fact.valueType === 'number[]' ? [1] : ['fixture']
    if (!heading || !markdown.includes(prefix)) throw new Error('fixture fact owner missing: ' + fact.key)
    markdown = markdown.replace(prefix, `${prefix}${fact.key}: ${JSON.stringify(value)}\n\n`)
  }
  return markdown
}
async function fixture(derived: boolean) {
  const workspacePath = await mkdtemp(join(tmpdir(), 'review-progression-'))
  for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
    await mkdir(dirname(join(workspacePath, path)), { recursive: true })
    await writeFile(join(workspacePath, path), completeFixtureDocument(path))
  }
  const staged = await artifacts.deriveFoundationAuditArtifacts({ workspacePath, revision, checkpoints: CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({ path, status: 'committed' as const })) })
  const state = auditState.createFoundationAuditState({ revision, documentDigests: staged.documentDigests, manifest: staged.manifest })
  state.status = 'facts_staged'
  state.tasks = []
  if (derived) {
    const store = facts.createFoundationFactStore([])
    const published = await artifacts.publishFoundationDerivedArtifacts({ workspacePath, revision, documentDigests: staged.documentDigests, sectionIndex: staged.sectionIndex, factStore: store, normalizedFactDigest: facts.digestFactStore(store), manifest: staged.manifest as unknown as Record<string, unknown> })
    const prefix = '.beegame/audit/foundation/' + revision + '/derived/'
    state.status = 'derived_committed'
    state.derived = {
      manifestPath: prefix + 'manifest.json', manifestDigest: published.digests.manifest,
      markerPath: prefix + 'COMMITTED.json', markerDigest: published.digests.marker,
      factStorePath: prefix + 'fact-store.json', factStoreDigest: published.digests.factStore,
      sectionIndexPath: prefix + 'section-index.json', sectionIndexDigest: published.digests.sectionIndex,
    }
  }
  const run = {
    runId: 'run', ownerId: 'owner', projectId: 'project', phase: 'DOCUMENT_REVIEW', documentStep: 'FOUNDATION_REVIEW',
    status: 'running', revision: { document: revision, workspace: 'workspace-revision' },
    foundationAuditState: state, resourceProductionState: { sentinel: ['preserve'] },
  } as unknown as DeliveryRun
  return { workspacePath, run }
}
type Controls = {
  lockedStatus?: string
  failCommitType?: string
  changeSourceAfterDeterministicCommit?: boolean
}
async function capture(source: string, operation: Operation, run: DeliveryRun, workspacePath: string, controls: Controls = {}) {
  let durable = structuredClone(run)
  const events: unknown[] = []
  const firstPath = join(workspacePath, CANONICAL_FOUNDATION_DOCUMENTS[0])
  const originalBytes = await readFile(firstPath, 'utf8')
  const store = {
    mutationLock: async (runId: string) => { events.push({ lock: runId }); return 'lease' },
    load: async () => {
      events.push('load')
      const copy = structuredClone(durable)
      if (controls.lockedStatus) copy.foundationAuditState!.status = controls.lockedStatus as never
      return copy
    },
    commit: async (next: DeliveryRun, event: { type: string }) => {
      events.push({ commit: structuredClone(next), event: structuredClone(event) })
      if (controls.failCommitType === event.type) throw new Error('injected commit failure')
      durable = structuredClone(next)
      if (controls.changeSourceAfterDeterministicCommit && event.type === 'foundation.audit.deterministic_ready')
        await writeFile(firstPath, '# changed after durable deterministic binding')
      return next
    },
    unlock: async () => { events.push('unlock') },
  }
  const args = { ...dependencies, store, input: { workspacePath },
    resumeUnlocked: async (next: DeliveryRun) => { events.push({ resume: structuredClone(next) }) },
    completeDeterministicFoundationAudit: async (next: DeliveryRun) => { events.push({ deterministicContinuation: structuredClone(next) }) },
  }
  const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(digestHelper + '\n' + operationSource(source, operation))
  try {
    const fn = new Function(...Object.keys(args), js + ';return ' + operation)(...Object.values(args))
    await fn(run)
    return { durable, events }
  } catch (error) { return { durable, events, error: (error as Error).message } }
  finally { await writeFile(firstPath, originalBytes) }
}
async function equivalent(operation: Operation, run: DeliveryRun, path: string, controls?: Controls) {
  const untouched = structuredClone(run)
  const expected = await capture(baseline, operation, run, path, controls)
  const actual = await capture(current(), operation, run, path, controls)
  expect(actual).toEqual(expected)
  expect(run).toEqual(untouched)
  return actual
}
async function withFixture(derived: boolean, body: (value: Awaited<ReturnType<typeof fixture>>) => Promise<void>) {
  setSystemTime(new Date('2026-09-05T00:00:00.000Z'))
  const value = await fixture(derived)
  try { await body(value) }
  finally { setSystemTime(); await rm(value.workspacePath, { recursive: true, force: true }) }
}
describe('Reviewer progression commit-boundary equivalence', () => {

  test('progression inputs are whitelisted independent snapshots and reject another phase', () => withFixture(false, async ({ run, workspacePath }) => {
    Object.assign(run.foundationAuditState!, { authority: { secret: 'revision-owned' }, revisionBundles: [{ secret: true }] })
    const frozen = structuredClone(run)
    const input = reviewBoundary.projectFoundationReviewFacts(run, workspacePath)
    expect(input.snapshot).not.toHaveProperty('authority')
    expect(input.snapshot).not.toHaveProperty('revisionBundles')
    ;(input.snapshot.documentDigests as Record<string, string>)[CANONICAL_FOUNDATION_DOCUMENTS[0]] = 'mutated'
    expect(run).toEqual(frozen)
    run.phase = 'FOUNDATION_REVISION'
    expect(() => reviewBoundary.projectFoundationReviewFacts(run, workspacePath)).toThrow('requires staged review facts')
    expect(() => reviewBoundary.projectFoundationDeterministicReview(run, workspacePath)).toThrow('requires committed review facts')
  }))
  test('deterministic preparation and semantic wave capture caller inputs before async reads', () => withFixture(true, async ({ run, workspacePath }) => {
    const prepared = await reviewPublic.prepareFoundationDeterministicReview(reviewBoundary.projectFoundationDeterministicReview(run, workspacePath))
    const input = {
      workspacePath,
      revision,
      status: 'deterministic_ready' as const,
      derived: structuredClone(run.foundationAuditState!.derived),
      deterministic: { ...prepared.binding },
    }
    const pending = reviewPublic.prepareFoundationDeterministicReview(input)
    input.workspacePath = '/not-the-bound-workspace'
    input.revision = 'stale'
    input.deterministic.factStoreDigest = '0'.repeat(64)
    const captured = await pending
    expect(captured.binding).toEqual(prepared.binding)
    const expectedWave = await reviewPublic.prepareFoundationSemanticWave(captured)
    const waveInput = structuredClone(captured)
    const wavePending = reviewPublic.prepareFoundationSemanticWave(waveInput)
    Object.assign(waveInput, { workspacePath: '/not-the-bound-workspace', revision: 'stale' })
    waveInput.evidence.committed.sectionIndex[0]!.digest = '0'.repeat(64)
    waveInput.evidence.review.reviewDigest = '0'.repeat(64)
    expect(await wavePending).toEqual(expectedWave)
  }))
  test('fact finalization preserves one derived commit and downstream continuation', () => withFixture(false, async ({ run, workspacePath }) => {
    const result = await equivalent('finalizeFoundationFacts', run, workspacePath)
    expect(result.error).toBeUndefined()
    expect(result.durable.foundationAuditState?.status).toBe('derived_committed')
    expect(result.events.at(-1)).toHaveProperty('deterministicContinuation')
  }))
  test('fact binding keeps idempotence, stale-status failure and unlock on commit failure', () => withFixture(false, async ({ run, workspacePath }) => {
    expect((await equivalent('finalizeFoundationFacts', run, workspacePath, { lockedStatus: 'derived_committed' })).events).toEqual([{ lock: 'run' }, 'load', 'unlock'])
    expect((await equivalent('finalizeFoundationFacts', run, workspacePath, { lockedStatus: 'semantic_review' })).error).toBe('foundation fact state changed before derived binding')
    const failed = await equivalent('finalizeFoundationFacts', run, workspacePath, { failCommitType: 'foundation.fact.derived_committed' })
    expect(failed.error).toBe('injected commit failure')
    expect(failed.durable.foundationAuditState?.status).toBe('facts_staged')
    expect(failed.events.at(-1)).toBe('unlock')
  }))
  test('deterministic commit precedes semantic seeding and preserves exact run/event payloads', () => withFixture(true, async ({ run, workspacePath }) => {
    const result = await equivalent('completeDeterministicFoundationAudit', run, workspacePath)
    expect(result.error).toBeUndefined()
    const commits = result.events.filter((event: any) => event?.event).map((event: any) => event.event.type)
    expect(commits).toEqual(['foundation.audit.deterministic_ready', 'foundation.audit.semantic_review'])
    expect(result.durable.foundationAuditState?.tasks).toHaveLength(10)
    expect(result.events.at(-1)).toHaveProperty('resume')
  }))
  test('deterministic-ready recovery skips duplicate binding but recreates the same semantic wave', () => withFixture(true, async ({ run, workspacePath }) => {
    const initial = await capture(baseline, 'completeDeterministicFoundationAudit', run, workspacePath)
    const firstCommit = initial.events.find((event: any) => event?.event?.type === 'foundation.audit.deterministic_ready') as { commit: DeliveryRun }
    const result = await equivalent('completeDeterministicFoundationAudit', firstCommit.commit, workspacePath)
    expect(result.error).toBeUndefined()
    expect(result.events.filter((event: any) => event?.event)).toHaveLength(1)
  }))
  test('source drift after deterministic commit leaves recoverable deterministic-ready authority', () => withFixture(true, async ({ run, workspacePath }) => {
    const result = await equivalent('completeDeterministicFoundationAudit', run, workspacePath, { changeSourceAfterDeterministicCommit: true })
    expect(result.error).toContain('semantic audit source changed after commit')
    expect(result.durable.foundationAuditState?.status).toBe('deterministic_ready')
    expect(result.events.filter((event: any) => event?.event)).toHaveLength(1)
  }))
  test('deterministic commit failure releases lock without semantic dispatch or state advance', () => withFixture(true, async ({ run, workspacePath }) => {
    const result = await equivalent('completeDeterministicFoundationAudit', run, workspacePath, { failCommitType: 'foundation.audit.deterministic_ready' })
    expect(result.error).toBe('injected commit failure')
    expect(result.durable.foundationAuditState?.status).toBe('derived_committed')
    expect(result.events.at(-1)).toBe('unlock')
  }))
})
