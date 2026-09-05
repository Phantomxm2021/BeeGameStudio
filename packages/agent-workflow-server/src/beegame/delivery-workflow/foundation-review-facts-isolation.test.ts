import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp } from 'node:fs/promises'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
} from './types'
import {
  deriveFoundationAuditArtifacts,
  loadFoundationAuditArtifacts,
  loadFoundationFactReceipt,
  publishFoundationDerivedArtifacts,
  writeFoundationFactReceipt,
} from './foundation-audit-artifacts'
import {
  extractNormalizedFoundationFacts,
  buildFoundationFactPackets,
  mergeFoundationFactResults,
} from './foundation-fact-extraction'
import { createFoundationFactStore, digestFactStore } from './foundation-fact-store'
import { foundationFactDefinition } from './foundation-fact-definitions'
import { foundationRuntimeTasks } from './foundation-audit-state'
import { prepareFoundationReviewFacts, type FoundationReviewFactsInput, type FoundationReviewFactsSnapshot } from './stages/foundation-review/facts'
import {
  completeTestSubmission,
  renderTestCompleteGameDocument,
} from '../../__tests__/complete-game-document-fixture'

const revision = 'facts-isolation'
const usage = {
  input_tokens: 1,
  cache_read_tokens: 0,
  cache_creation_tokens: 0,
  completion_tokens: 1,
  total_tokens: 2,
}

async function copyTree(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  async function visit(prefix: string): Promise<void> {
    for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
      const path = join(prefix, entry.name)
      if (entry.isDirectory()) await visit(path)
      else result[path] = await readFile(join(root, path), 'utf8')
    }
  }
  await visit('')
  return result
}

async function makeWorkspace(): Promise<{ path: string; snapshot: FoundationReviewFactsSnapshot }> {
  const path = await mkdtemp(join(tmpdir(), 'review-facts-equivalence-'))
  for (const document of CANONICAL_FOUNDATION_DOCUMENTS) {
    await mkdir(dirname(join(path, document)), { recursive: true })
    await writeFile(
      join(path, document),
      renderTestCompleteGameDocument(document, completeTestSubmission(document)),
    )
  }
  const artifacts = await deriveFoundationAuditArtifacts({
    workspacePath: path,
    revision,
    checkpoints: CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({
      path,
      status: 'committed' as const,
    })),
  })
  const documents = new Map<FoundationDocumentPath, string>(
    await Promise.all(
      CANONICAL_FOUNDATION_DOCUMENTS.map(async document => [
        document,
        await readFile(join(path, document), 'utf8'),
      ] as const),
    ),
  )
  const extraction = extractNormalizedFoundationFacts({
    documents,
    sectionIndex: artifacts.sectionIndex,
  })
  const packets = buildFoundationFactPackets({
    revision,
    documents,
    sectionIndex: artifacts.sectionIndex,
    unresolvedKeys: extraction.unresolvedKeys,
  })
  const tasks: FoundationReviewFactsSnapshot['tasks'][number][] = []
  for (const [index, packet] of packets.entries()) {
    const taskId = `${revision}:fact:${index}:${packet.packetDigest.slice(0, 12)}`
    const terminalDigest = 'a'.repeat(64)
    const workerKey = packet.keys[0]
    const workerSection = workerKey
      ? artifacts.sectionIndex.find(section => {
          const owner = foundationFactDefinition(workerKey)?.owner
          return owner?.documentPath === section.documentPath && owner.sectionId === section.sectionId
        })
      : undefined
    const workerDocument = workerSection && documents.get(workerSection.documentPath)
    const workerEvidence = workerSection && workerDocument
      ? {
          documentPath: workerSection.documentPath,
          sectionId: workerSection.sectionId,
          startLine: workerSection.startLine,
          endLine: workerSection.startLine,
          digest: createHash('sha256').update(workerDocument.split('\n')[workerSection.startLine - 1] ?? '').digest('hex'),
        }
      : undefined
    const definition = workerKey ? foundationFactDefinition(workerKey) : undefined
    const workerValue = definition?.valueType === 'number'
      ? 1
      : definition?.valueType === 'boolean'
        ? true
        : definition?.valueType === 'number[]'
          ? [1]
          : definition?.valueType === 'string'
            ? definition.valueSpec.enum?.[0] ?? 'worker'
            : ['worker']
    const workerFact = workerKey && workerSection && workerEvidence && definition
      ? {
          key: workerKey,
          value: workerValue,
          source: workerSection,
          evidence: workerEvidence,
        }
      : undefined
    const receipt = {
      taskId,
      revision,
      packetDigest: packet.packetDigest,
      terminalDigest,
      normalizedFactDigest: digestFactStore(workerFact ? [workerFact] : createFoundationFactStore([])),
      receipts: packet.keys.map(key =>
        workerFact && key === workerFact.key
          ? { key, status: 'present' as const, value: workerFact.value, evidence: workerFact.evidence }
          : { key, status: 'absent' as const },
      ),
      facts: workerFact ? [workerFact] : [],
      usage,
      durationMs: 0,
    }
    const written = await writeFoundationFactReceipt({
      workspacePath: path,
      revision,
      receipt,
    })
    tasks.push({
      taskId,
      kind: 'document-facts',
      revision,
      packetDigest: packet.packetDigest,
      terminalDigest,
      receiptPath: written.path,
      receiptDigest: written.digest,
    })
  }
  return {
    path,
    snapshot: {
      revision,
      status: 'facts_staged',
      documentDigests: Object.fromEntries(
        artifacts.documentDigests.map(item => [item.path, item.digest]),
      ) as Record<FoundationDocumentPath, string>,
      sectionIndexDigest: artifacts.manifest.sectionIndexDigest,
      sectionIndexPath: relative(path, artifacts.paths.sectionIndex).replaceAll('\\', '/'),
      manifestPath: relative(path, artifacts.paths.manifest).replaceAll('\\', '/'),
      tasks,
    },
  }
}

/** Compile the business slice directly from the trusted baseline controller. */
function baselineFacts(): (input: FoundationReviewFactsInput) => Promise<unknown> {
  const root = join(import.meta.dir, '../../../../../')
  const source = execFileSync(
    'git',
    ['show', '3230c7813:packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts'],
    { cwd: root, encoding: 'utf8' },
  )
  const functionSource = source.slice(
    source.indexOf('  async function finalizeFoundationFacts('),
    source.indexOf('\n  async function completeDeterministicFoundationAudit(', source.indexOf('  async function finalizeFoundationFacts(')),
  )
  const body = functionSource
    .slice(functionSource.indexOf('{') + 1)
    .replace(/\n  }\s*$/, '')
  const business = body.slice(body.indexOf('\n    const artifacts'), body.indexOf('\n    const lease'))
  const dependencies = {
    CANONICAL_FOUNDATION_DOCUMENTS,
    readFile,
    join,
    loadFoundationAuditArtifacts,
    extractNormalizedFoundationFacts,
    loadFoundationFactReceipt,
    foundationRuntimeTasks,
    mergeFoundationFactResults,
    digestFactStore,
    publishFoundationDerivedArtifacts,
  }
  const generated = new Bun.Transpiler({ loader: 'ts' }).transformSync(
    `async function baseline(input) {
      const run = { foundationAuditState: input.snapshot };
      const state = run.foundationAuditState;
${business}
      return { published, factStore, normalizedFactDigest };
    }`,
  )
  return new Function(
    ...Object.keys(dependencies),
    `${generated};return baseline`,
  )(...Object.values(dependencies))
}

describe('Reviewer fact finalization isolation', () => {
  test('matches the trusted baseline business result and published artifacts', async () => {
    const before = await makeWorkspace()
    const after = await makeWorkspace()
    try {
      const beforeSnapshot = structuredClone(before.snapshot)
      const afterSnapshot = structuredClone(after.snapshot)
      const baseline = baselineFacts()
      const expected = await baseline({ workspacePath: before.path, snapshot: before.snapshot })
      const actual = await prepareFoundationReviewFacts({ workspacePath: after.path, snapshot: after.snapshot })
      expect(actual.revision).toBe(revision)
      expect(actual.normalizedFactDigest).toBe((expected as { normalizedFactDigest: string }).normalizedFactDigest)
      expect(actual.derived).toMatchObject({
        manifestDigest: (expected as { published: { digests: { manifest: string } } }).published.digests.manifest,
        factStoreDigest: (expected as { published: { digests: { factStore: string } } }).published.digests.factStore,
      })
      expect(actual.factStore.find(fact => fact.key === 'art.style_constraints')?.value).toEqual(['worker'])
      expect(await copyTree(after.path)).toEqual(await copyTree(before.path))
      expect(before.snapshot).toEqual(beforeSnapshot)
      expect(after.snapshot).toEqual(afterSnapshot)
    } finally {
      await rm(before.path, { recursive: true, force: true })
      await rm(after.path, { recursive: true, force: true })
    }
  })

  test('preserves baseline receipt-binding failures', async () => {
    const workspace = await makeWorkspace()
    try {
      const invalid = {
        ...structuredClone(workspace.snapshot),
        tasks: workspace.snapshot.tasks.map((task, index) =>
          index === 0 ? { ...task, receiptDigest: undefined } : { ...task },
        ),
      }
      const baseline = baselineFacts()
      await expect(baseline({ workspacePath: workspace.path, snapshot: invalid })).rejects.toThrow(
        'foundation fact task receipt binding is incomplete',
      )
      await expect(prepareFoundationReviewFacts({ workspacePath: workspace.path, snapshot: invalid })).rejects.toThrow(
        'foundation fact task receipt binding is incomplete',
      )
    } finally {
      await rm(workspace.path, { recursive: true, force: true })
    }
  })

  test('rejects tampered worker receipt bytes with the baseline error', async () => {
    const before = await makeWorkspace()
    const after = await makeWorkspace()
    try {
      for (const workspace of [before, after]) {
        const receiptPath = workspace.snapshot.tasks[0]!.receiptPath!
        const absolute = join(workspace.path, receiptPath)
        await writeFile(absolute, `${await readFile(absolute, 'utf8')}tampered`)
      }
      const baseline = baselineFacts()
      await expect(baseline({ workspacePath: before.path, snapshot: before.snapshot })).rejects.toThrow(
        'foundation fact receipt digest mismatch',
      )
      await expect(prepareFoundationReviewFacts({ workspacePath: after.path, snapshot: after.snapshot })).rejects.toThrow(
        'foundation fact receipt digest mismatch',
      )
    } finally {
      await rm(before.path, { recursive: true, force: true })
      await rm(after.path, { recursive: true, force: true })
    }
  })

  test('captures workspace and nested snapshot values before asynchronous I/O', async () => {
    const workspace = await makeWorkspace()
    try {
      const input: FoundationReviewFactsInput = {
        workspacePath: workspace.path,
        snapshot: workspace.snapshot,
      }
      const pending = prepareFoundationReviewFacts(input)
      Object.assign(input, { workspacePath: '/definitely-not-the-fixture' })
      Object.assign(input.snapshot, { documentDigests: {} })
      Object.assign(input.snapshot.tasks[0], { receiptDigest: undefined })
      const result = await pending
      expect(result.revision).toBe(revision)
      expect(await readFile(join(workspace.path, result.derived.manifestPath), 'utf8')).toContain('derived_committed')
    } finally {
      await rm(workspace.path, { recursive: true, force: true })
    }
  })

  test('does not expose mutable snapshot references or controller lifecycle APIs', () => {
    const source = readFileSync(join(import.meta.dir, 'stages/foundation-review/facts.ts'), 'utf8')
    for (const forbidden of ['DeliveryRun', 'mutationLock', 'store.commit', 'foundation-revision-', 'controller'])
      expect(source).not.toContain(forbidden)
  })
})
