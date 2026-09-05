import { describe, expect, setSystemTime, test, afterEach } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { completeTestSubmission, renderTestCompleteGameDocument } from '../../../../__tests__/complete-game-document-fixture'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../../types'
import {
  deriveFoundationAuditArtifacts,
  loadDeterministicFoundationReview,
  publishFoundationDerivedArtifacts,
} from '../../foundation-audit-artifacts'
import { createFoundationFactStore, digestFactStore } from '../../foundation-fact-store'
import { FOUNDATION_SEMANTIC_AUDIT_MANIFEST } from '../../foundation-semantic-audit'
import {
  prepareFoundationDeterministicReview,
  prepareFoundationSemanticWave,
  type FoundationDerivedAuthorityBinding,
} from './deterministic'
import { buildSemanticPacketFor, requireSectionAuditIssues } from './packets'

const roots: string[] = []

afterEach(async () => {
  setSystemTime()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const workspacePath = await mkdtemp(join(tmpdir(), 'foundation-review-deterministic-isolation-'))
  roots.push(workspacePath)
  for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
    await mkdir(dirname(join(workspacePath, path)), { recursive: true })
    await writeFile(join(workspacePath, path), renderTestCompleteGameDocument(path, completeTestSubmission(path)))
  }
  const revision = 'deterministic-isolation'
  const derivedIndex = await deriveFoundationAuditArtifacts({
    workspacePath,
    revision,
    checkpoints: CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({ path, status: 'committed' as const })),
  })
  const factStore = createFoundationFactStore([])
  const derived = await publishFoundationDerivedArtifacts({
    workspacePath,
    revision,
    documentDigests: derivedIndex.documentDigests,
    sectionIndex: derivedIndex.sectionIndex,
    factStore,
    normalizedFactDigest: digestFactStore(factStore),
    manifest: derivedIndex.manifest as unknown as Record<string, unknown>,
  })
  const derivedBinding: FoundationDerivedAuthorityBinding = {
    manifestPath: '.beegame/audit/foundation/deterministic-isolation/derived/manifest.json',
    manifestDigest: derived.digests.manifest,
    markerPath: '.beegame/audit/foundation/deterministic-isolation/derived/COMMITTED.json',
    markerDigest: derived.digests.marker,
    factStorePath: '.beegame/audit/foundation/deterministic-isolation/derived/fact-store.json',
    factStoreDigest: derived.digests.factStore,
    sectionIndexPath: '.beegame/audit/foundation/deterministic-isolation/derived/section-index.json',
    sectionIndexDigest: derived.digests.sectionIndex,
  }
  return { workspacePath, revision, derivedBinding, derived }
}

describe('Reviewer deterministic preparation isolation', () => {
  test('keeps the baseline contract and produces the same ten-task seed', async () => {
    const baseline = execFileSync(
      'git',
      ['show', '3230c7813:packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts'],
      { cwd: join(import.meta.dir, '../../../../../../..'), encoding: 'utf8' },
    )
    expect(baseline).toContain('const semanticPackets = await Promise.all(FOUNDATION_SEMANTIC_AUDIT_MANIFEST.checks.map(check => buildSemanticPacketFor')
    expect(baseline).toContain('const phaseStartedAt = new Date().toISOString()')
    expect(baseline).toContain('semantic authority did not return exactly ten checks')

    setSystemTime(new Date('2026-09-05T00:00:00.000Z'))
    const value = await fixture()
    const prepared = await prepareFoundationDeterministicReview({
      workspacePath: value.workspacePath,
      revision: value.revision,
      status: 'derived_committed',
      derived: value.derivedBinding,
    })
    const wave = await prepareFoundationSemanticWave(prepared)
    expect(wave.phaseStartedAt).toBe('2026-09-05T00:00:00.000Z')
    expect(wave.packets).toHaveLength(10)
    expect(wave.collection.tasks).toHaveLength(10)
    expect(wave.collection.tasks.map(task => ({
      taskId: task.taskId,
      kind: task.kind,
      revision: task.revision,
      checkId: task.checkId,
      packetDigest: task.packetDigest,
      modelTier: task.modelTier,
      status: task.status,
      attempt: task.attempt,
    }))).toEqual(wave.packets.map((packet, index) => ({
      taskId: `${value.revision}:semantic:${index}:${packet.identity.slice(0, 12)}`,
      kind: 'semantic',
      revision: value.revision,
      checkId: packet.checkId,
      packetDigest: packet.identity,
      modelTier: FOUNDATION_SEMANTIC_AUDIT_MANIFEST.checks[index]!.modelTier,
      status: 'pending',
      attempt: 0,
    })))
  })

  test('returns a directly reusable immutable evidence snapshot and does not commit state', async () => {
    const value = await fixture()
    const before = await readFile(join(value.workspacePath, '.beegame/audit/foundation/deterministic-isolation/derived/COMMITTED.json'), 'utf8')
    const prepared = await prepareFoundationDeterministicReview({
      workspacePath: value.workspacePath,
      revision: value.revision,
      status: 'derived_committed',
      derived: value.derivedBinding,
    })
    prepared.evidence.committed.sectionIndex.push({
      documentPath: 'docs/GDD.md',
      sectionId: 'mutated',
      heading: 'mutated',
      startLine: 1,
      endLine: 1,
      digest: '0'.repeat(64),
    })
    prepared.evidence.review.issues.push(...[])
    const again = await prepareFoundationDeterministicReview({
      workspacePath: value.workspacePath,
      revision: value.revision,
      status: 'derived_committed',
      derived: value.derivedBinding,
    })
    expect(again.evidence.committed.sectionIndex).not.toContainEqual(expect.objectContaining({ sectionId: 'mutated' }))
    expect(await readFile(join(value.workspacePath, '.beegame/audit/foundation/deterministic-isolation/derived/COMMITTED.json'), 'utf8')).toBe(before)
  })

  test('semantic wave accepts only the bound preparation and has no workspace override path', async () => {
    const source = readFileSync(join(import.meta.dir, 'deterministic.ts'), 'utf8')
    expect(source).not.toContain('FoundationSemanticWaveInput')
    expect(source).not.toContain("'preparation' in input")
    const value = await fixture()
    const prepared = await prepareFoundationDeterministicReview({
      workspacePath: value.workspacePath,
      revision: value.revision,
      status: 'derived_committed',
      derived: value.derivedBinding,
    })
    await expect(prepareFoundationSemanticWave({
      workspacePath: value.workspacePath,
      revision: value.revision,
      preparation: prepared,
    } as never)).rejects.toBeDefined()
  })

  test('rejects missing and stale deterministic-ready authority with baseline errors', async () => {
    const value = await fixture()
    const prepared = await prepareFoundationDeterministicReview({
      workspacePath: value.workspacePath,
      revision: value.revision,
      status: 'derived_committed',
      derived: value.derivedBinding,
    })
    await expect(prepareFoundationDeterministicReview({
      workspacePath: value.workspacePath,
      revision: value.revision,
      status: 'deterministic_ready',
      derived: value.derivedBinding,
    })).rejects.toThrow('deterministic-ready state is missing immutable review binding')
    await expect(prepareFoundationDeterministicReview({
      workspacePath: value.workspacePath,
      revision: value.revision,
      status: 'deterministic_ready',
      derived: value.derivedBinding,
      deterministic: { ...prepared.binding, factStoreDigest: '0'.repeat(64) },
    })).rejects.toThrow('deterministic-ready review binding is stale')
    await expect(prepareFoundationDeterministicReview({
      workspacePath: value.workspacePath,
      revision: value.revision,
      status: 'derived_committed',
    })).rejects.toThrow('committed deterministic audit inputs are unavailable')
  })

  test('matches the baseline packet construction against the committed fixture', async () => {
    const value = await fixture()
    const prepared = await prepareFoundationDeterministicReview({
      workspacePath: value.workspacePath,
      revision: value.revision,
      status: 'derived_committed',
      derived: value.derivedBinding,
    })
    const expected = await Promise.all(FOUNDATION_SEMANTIC_AUDIT_MANIFEST.checks.map(check =>
      buildSemanticPacketFor({
        workspacePath: value.workspacePath,
        revision: value.revision,
        checkId: check.checkId,
        sectionIndex: prepared.evidence.committed.sectionIndex,
        factStore: prepared.evidence.committed.factStore,
        deterministicReviewDigest: prepared.evidence.review.reviewDigest,
        deterministicIssuePrefix: requireSectionAuditIssues(prepared.evidence.review.issues),
        documentDigests: prepared.evidence.committed.documentDigests,
      }),
    ))
    const actual = await prepareFoundationSemanticWave(prepared)
    expect(actual.packets).toEqual(expected)
    expect(actual.collection.tasks.map(task => task.packetDigest)).toEqual(expected.map(packet => packet.identity))
    expect(await loadDeterministicFoundationReview({ workspacePath: value.workspacePath, revision: value.revision, reviewDigest: prepared.binding.reviewDigest })).toBeTruthy()
    // The preparation operation's only durable writes are the deterministic
    // review artifact publication; the semantic wave writes no artifacts.
  })
})
