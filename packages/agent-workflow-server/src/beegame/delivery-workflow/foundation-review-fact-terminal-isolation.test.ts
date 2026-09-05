import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
  type WorkflowUsage,
} from './types'
import {
  deriveFoundationAuditArtifacts,
  loadFoundationAuditArtifacts,
  writeFoundationFactReceipt,
} from './foundation-audit-artifacts'
import {
  buildFoundationFactPackets,
  extractNormalizedFoundationFacts,
  mergeFoundationFactResults,
  validateFoundationFactResults,
} from './foundation-fact-extraction'
import { foundationRuntimeTasks } from './foundation-audit-state'
import { digestFoundationFactTerminal } from './foundation-fact-runtime'
import { prepareFoundationFactTerminal, type FoundationReviewFactTerminalInput, type FoundationReviewFactTerminalSnapshot } from './stages/foundation-review/fact-terminal'
import { foundationFactDefinition } from './foundation-fact-definitions'
import { completeTestSubmission, renderTestCompleteGameDocument } from '../../__tests__/complete-game-document-fixture'

const revision = 'fact-terminal-isolation'
const usage: WorkflowUsage = { input_tokens: 2, cache_read_tokens: 1, cache_creation_tokens: 0, completion_tokens: 3, total_tokens: 6 }

type Fixture = { path: string; input: FoundationReviewFactTerminalInput; result: FoundationReviewFactTerminalInput['result'] }

async function tree(root: string): Promise<Record<string, string>> {
  const output: Record<string, string> = {}
  async function visit(prefix: string): Promise<void> {
    for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
      const path = join(prefix, entry.name)
      if (entry.isDirectory()) await visit(path)
      else output[path] = await readFile(join(root, path), 'utf8')
    }
  }
  await visit('')
  return output
}

async function fixture(options: { complete?: boolean } = {}): Promise<Fixture> {
  const path = await mkdtemp(join(tmpdir(), 'review-fact-terminal-'))
  for (const document of CANONICAL_FOUNDATION_DOCUMENTS) {
    await mkdir(dirname(join(path, document)), { recursive: true })
    await writeFile(join(path, document), renderTestCompleteGameDocument(document, completeTestSubmission(document)))
  }
  const artifacts = await deriveFoundationAuditArtifacts({
    workspacePath: path,
    revision,
    checkpoints: CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({ path, status: 'committed' as const })),
  })
  const documents = new Map<FoundationDocumentPath, string>(await Promise.all(CANONICAL_FOUNDATION_DOCUMENTS.map(async document => [document, await readFile(join(path, document), 'utf8')] as const)))
  const extraction = extractNormalizedFoundationFacts({ documents, sectionIndex: artifacts.sectionIndex })
  const packets = buildFoundationFactPackets({ revision, documents, sectionIndex: artifacts.sectionIndex, unresolvedKeys: extraction.unresolvedKeys })
  const packet = packets.find(candidate => candidate.keys.includes('art.style_constraints'))!
  const key = packet.keys[0]!
  const definition = foundationFactDefinition(key)!
  const section = packet.sections.find(candidate => candidate.documentPath === definition.owner.documentPath && candidate.sectionId === definition.owner.sectionId)!
  const line = documents.get(section.documentPath)!.split('\n')[section.startLine - 1]!
  const result: FoundationReviewFactTerminalInput['result'] = {
    workerType: 'foundation-fact-extractor',
    status: 'completed',
    runId: 'run',
    dispatchId: 'dispatch-fact',
    taskId: 'task-fact',
    revision,
    packetDigest: packet.packetDigest,
    results: packet.keys.map(candidate => candidate === key
      ? { key: candidate, status: 'present' as const, value: ['worker'], evidence: { documentPath: section.documentPath, sectionId: section.sectionId, startLine: section.startLine, endLine: section.startLine, digest: createHash('sha256').update(line).digest('hex') } }
      : { key: candidate, status: 'absent' as const }),
  }
  const task = {
    taskId: 'task-fact', kind: 'document-facts' as const, revision, packetDigest: packet.packetDigest,
    factKeyCount: packet.keys.length, modelTier: 'fast' as const, status: 'running' as const, attempt: 1,
    dispatch: { dispatchId: 'dispatch-fact', workerType: 'foundation-fact-extractor' as const, phase: 'DOCUMENT_REVIEW' as const, taskId: 'task-fact', revision, status: 'running' as const, startedAt: '2026-09-05T00:00:00.000Z' },
  }
  const second = options.complete ? [] : [{ ...task, taskId: 'task-pending', packetDigest: 'b'.repeat(64), status: 'pending' as const, dispatch: undefined }]
  const snapshot: FoundationReviewFactTerminalSnapshot = {
    revision, artifactRevision: revision, phase: 'DOCUMENT_REVIEW', status: 'extracting_facts', phaseStartedAt: '2026-09-05T00:00:00.000Z',
    documentDigests: Object.fromEntries(artifacts.documentDigests.map(item => [item.path, item.digest])) as Record<FoundationDocumentPath, string>,
    sectionIndexDigest: artifacts.manifest.sectionIndexDigest,
    sectionIndexPath: relative(path, artifacts.paths.sectionIndex).replaceAll('\\', '/'),
    manifestPath: relative(path, artifacts.paths.manifest).replaceAll('\\', '/'),
    aggregateUsage: usage,
    tasks: [task, ...second],
  }
  return {
    path,
    result,
    input: { workspacePath: path, snapshot, targetTaskId: 'task-fact', record: { dispatchId: 'dispatch-fact', workerType: 'foundation-fact-extractor', phase: 'DOCUMENT_REVIEW', taskId: 'task-fact', revision, status: 'completed', startedAt: '2026-09-05T00:00:00.000Z', finishedAt: '2026-09-05T00:00:01.000Z', usage }, result, packet },
  }
}

/** Compile the exact terminal-admission business slice from the trusted baseline. */
function baselineBusiness(): (input: FoundationReviewFactTerminalInput) => Promise<unknown> {
  const root = join(import.meta.dir, '../../../../../')
  const source = execFileSync('git', ['show', 'a35320472:packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts'], { cwd: root, encoding: 'utf8' })
  const start = source.indexOf('        const lockedState = locked.foundationAuditState!', source.indexOf('    if (foundationFactTask && result.workerType === \'foundation-fact-extractor\')'))
  const end = source.indexOf('        const collectionAfterReceipt', start)
  const business = source.slice(start, end)
  const dependencies = { loadFoundationAuditArtifacts, CANONICAL_FOUNDATION_DOCUMENTS, readFile, join, validateFoundationFactResults, foundationRuntimeTasks, admitFoundationFactTerminal: requireRuntime('admitFoundationFactTerminal'), writeFoundationFactReceipt: requireRuntime('writeFoundationFactReceipt'), projectTaskTerminalEvidence: requireRuntime('projectTaskTerminalEvidence'), foundationFactTasksComplete: requireRuntime('foundationFactTasksComplete'), digestFoundationFactTerminal }
  const generated = new Bun.Transpiler({ loader: 'ts' }).transformSync(`async function baseline(input) {
    const locked = { foundationAuditState: input.snapshot, revision: { document: input.snapshot.artifactRevision } };
    const lockedTask = input.snapshot.tasks.find(task => task.taskId === input.targetTaskId);
    const record = input.record;
    const result = input.result;
    const request = { contract: { packet: input.packet } };
${business}
    return { auditState, admission };
      }
  }`)
  return new Function(...Object.keys(dependencies), `${generated};return baseline`)(...Object.values(dependencies))
}

import { admitFoundationFactTerminal, foundationFactTasksComplete } from './foundation-fact-runtime'
import { projectTaskTerminalEvidence } from './task-terminal-evidence'
import { writeFoundationFactReceipt as writeReceipt } from './foundation-audit-artifacts'
function requireRuntime(name: string): unknown {
  if (name === 'admitFoundationFactTerminal') return admitFoundationFactTerminal
  if (name === 'writeFoundationFactReceipt') return writeReceipt
  if (name === 'projectTaskTerminalEvidence') return projectTaskTerminalEvidence
  if (name === 'foundationFactTasksComplete') return foundationFactTasksComplete
  throw new Error(`unexpected baseline dependency: ${name}`)
}

describe('Reviewer fact terminal isolation', () => {
  test('matches baseline validation, admission, receipt publication and full completion', async () => {
    const before = await fixture({ complete: true })
    const after = await fixture({ complete: true })
    try {
      const expected = await baselineBusiness()({ ...before.input, packet: before.input.packet })
      const actual = await prepareFoundationFactTerminal(after.input)
      expect(actual.kind).toBe('facts-staged')
      const expectedState = (expected as { auditState: { aggregateUsage: WorkflowUsage | undefined; tasks: unknown[] } }).auditState
      expect({ status: actual.statePatch?.status, aggregateUsage: actual.statePatch?.aggregateUsage, tasks: JSON.parse(JSON.stringify(actual.statePatch?.tasks)) }).toEqual({ status: 'facts_staged', aggregateUsage: expectedState.aggregateUsage, tasks: JSON.parse(JSON.stringify(expectedState.tasks)) })
      expect((expected as { admission: { terminalDigest: string } }).admission.terminalDigest).toBe(actual.terminalDigest)
      expect(await tree(after.path)).toEqual(await tree(before.path))
    } finally {
      await rm(before.path, { recursive: true, force: true })
      await rm(after.path, { recursive: true, force: true })
    }
  })

  test('returns an ordinary admitted patch while another fact task remains pending', async () => {
    const before = await fixture()
    const after = await fixture()
    try {
      const expected = await baselineBusiness()(before.input)
      const actual = await prepareFoundationFactTerminal(after.input)
      expect(actual.kind).toBe('admitted')
      expect(actual.statePatch?.status).toBe('extracting_facts')
      expect(actual.runStatus).toBe('running')
      expect(actual.terminalDigest).toBe((expected as { admission: { terminalDigest: string } }).admission.terminalDigest)
      expect(actual.statePatch?.tasks.find(task => task.taskId === 'task-fact')?.receiptPath).toBeTruthy()
    } finally {
      await rm(before.path, { recursive: true, force: true })
      await rm(after.path, { recursive: true, force: true })
    }
  })

  test('replays the same completed terminal and rejects a conflicting replay', async () => {
    const workspace = await fixture({ complete: true })
    try {
      const digest = digestFoundationFactTerminal(workspace.result)
      const replay = { ...structuredClone(workspace.input), snapshot: { ...workspace.input.snapshot, status: 'facts_staged' as const, tasks: workspace.input.snapshot.tasks.map(task => ({ ...task, status: 'completed' as const, terminalDigest: digest })) } }
      const result = await prepareFoundationFactTerminal(replay)
      expect(result).toMatchObject({ kind: 'replayed', idempotent: true, accepted: true, continueFacts: true, terminalDigest: digest })
      const conflict = { ...replay, result: { ...replay.result, dispatchId: 'dispatch-fact', results: [] } }
      await expect(prepareFoundationFactTerminal(conflict)).rejects.toThrow('conflicting foundation fact terminal replay')
    } finally { await rm(workspace.path, { recursive: true, force: true }) }
  })

  test('preserves invalid-result naming and rejects tampered packet/result evidence', async () => {
    const workspace = await fixture()
    try {
      const invalid = { ...workspace.input, result: { ...workspace.input.result, results: [] } }
      await expect(prepareFoundationFactTerminal(invalid)).rejects.toMatchObject({ name: 'FoundationFactInvalidResultError', message: expect.stringContaining('account for every assigned key') })
      const tampered = { ...workspace.input, packet: { ...(workspace.input.packet as Record<string, unknown>), keys: [] } }
      await expect(prepareFoundationFactTerminal(tampered)).rejects.toMatchObject({ name: 'FoundationFactInvalidResultError', message: expect.stringContaining('key count') })
    } finally { await rm(workspace.path, { recursive: true, force: true }) }
  })

  test('captures all input projections before asynchronous reads', async () => {
    const workspace = await fixture()
    try {
      const input = workspace.input
      const pending = prepareFoundationFactTerminal(input)
      Object.assign(input, { workspacePath: '/definitely-not-the-fixture' })
      Object.assign(input.snapshot, { documentDigests: {} })
      Object.assign(input.record, { finishedAt: undefined })
      const result = await pending
      expect(result.kind).toBe('admitted')
    } finally { await rm(workspace.path, { recursive: true, force: true }) }
  })
})
