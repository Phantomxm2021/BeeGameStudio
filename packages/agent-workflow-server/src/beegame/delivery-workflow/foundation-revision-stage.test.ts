import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { getGameDocumentContract } from './game-document-contracts'
import * as revisionStage from './foundation-revision-stage'
import {
  createFoundationRevisionStage,
  buildFoundationRevisionAuthority,
  deriveFoundationPatchOperations,
  foundationRevisionPacketDigest,
  foundationRevisionPacketPath,
  loadFoundationRevisionPacket,
  revisionTaskReceiptTerminalDigest,
  writeFoundationRevisionPacket,
  type RevisionTaskReceipt,
} from './foundation-revision-stage'
import { digestFoundationSemanticRecheckResult } from './foundation-patch-validation'
import type { AuditIssue } from './foundation-issue-registry'

const workspaces: string[] = []
afterEach(async () =>
  Promise.all(
    workspaces
      .splice(0)
      .map(path => rm(path, { recursive: true, force: true })),
  ),
)

const documentPath = 'docs/GDD.md' as const
const revision = 'revision-test'

test('atomically persists and digest-validates the sole packet artifact', async () => {
  const workspace = await workspaceWithCanonicalDocument()
  const packet = { schema: 'beegame-foundation-revision-packet-v1', revision, round: 1, taskId: 'revision-task-1', documentPath, issueIds: ['AUD-1'] }
  const packetPath = foundationRevisionPacketPath(revision, 1, 'revision-task-1')
  const packetDigest = foundationRevisionPacketDigest(packet)
  await writeFoundationRevisionPacket({ workspacePath: workspace, revision, round: 1, taskId: 'revision-task-1', documentPath, packet, packetDigest })
  await expect(loadFoundationRevisionPacket({ workspacePath: workspace, revision, round: 1, taskId: 'revision-task-1', documentPath, packetDigest })).resolves.toEqual(packet)
  await writeFile(join(workspace, packetPath), JSON.stringify({ ...packet, issueIds: ['AUD-2'] }))
  await expect(loadFoundationRevisionPacket({ workspacePath: workspace, revision, round: 1, taskId: 'revision-task-1', documentPath, packetDigest })).rejects.toThrow(/digest|stale/i)
})

test('does not overwrite a packet and keeps packet paths isolated by round', async () => {
  const workspace = await workspaceWithCanonicalDocument()
  const identity = { revision, round: 1 as const, taskId: 'revision-task-1', documentPath }
  const first = { schema: 'packet', ...identity, issueIds: ['AUD-1'] }
  const firstDigest = foundationRevisionPacketDigest(first)
  await expect(writeFoundationRevisionPacket({ workspacePath: workspace, ...identity, packet: first, packetDigest: firstDigest })).resolves.toContain('/round-1/')
  await expect(writeFoundationRevisionPacket({ workspacePath: workspace, ...identity, packet: first, packetDigest: firstDigest })).resolves.toBe(foundationRevisionPacketPath(revision, 1, identity.taskId))
  const different = { ...first, issueIds: ['AUD-2'] }
  await expect(writeFoundationRevisionPacket({ workspacePath: workspace, ...identity, packet: different, packetDigest: foundationRevisionPacketDigest(different) })).rejects.toThrow(/different digest|already exists/i)
  const roundTwo = { ...first, round: 2 as const }
  const roundTwoPath = await writeFoundationRevisionPacket({ workspacePath: workspace, revision, round: 2, taskId: identity.taskId, documentPath, packet: roundTwo, packetDigest: foundationRevisionPacketDigest(roundTwo) })
  expect(roundTwoPath).not.toBe(foundationRevisionPacketPath(revision, 1, identity.taskId))
})

test('builds a revision packet without duplicate issue evidence', async () => {
  const workspace = await workspaceWithCanonicalDocument()
  const source = {
    documentPath,
    sectionId: 'vision',
    heading: 'Vision',
    startLine: 3,
    endLine: 5,
    digest: 'a'.repeat(64),
  }
  const target = {
    documentPath,
    sectionId: 'progression',
    heading: 'Progression, Rewards and Economy Boundary',
    startLine: 9,
    endLine: 11,
    digest: 'b'.repeat(64),
  }
  const issue = {
    id: 'AUD-1',
    severity: 'HIGH' as const,
    type: 'semantic' as const,
    source,
    target,
    expected: 'expected',
    actual: 'actual',
    fixDocument: documentPath,
    fixSectionId: 'rules_systems',
  }
  const authority = await buildFoundationRevisionAuthority({
    workspacePath: workspace,
    revision,
    taskId: 'revision-task-1',
    round: 1,
    batch: { documentPath, sectionIds: ['rules_systems'], issueIds: ['AUD-1'] },
    issues: [issue],
    sourceAuthorityDigest: 'c'.repeat(64),
    sourceIssueRegistryDigest: 'd'.repeat(64),
    sourceDerivedDigests: { sectionIndex: 'e'.repeat(64), factStore: 'f'.repeat(64), manifest: '0'.repeat(64) },
    sourceDocumentDigests: [{ path: documentPath, digest: '1'.repeat(64) }],
    normalizedFacts: [{ source, payload: 'duplicate fact prose'.repeat(1000) }],
  })

  expect(authority.packet.sections).toHaveLength(3)
  expect(authority.packet.normalizedFacts).toHaveLength(1)
  const packetIssues = authority.packet.issues as Array<Record<string, unknown>>
  expect(packetIssues).toEqual([expect.objectContaining({ id: 'AUD-1', actual: 'actual' })])
  expect(packetIssues[0]).not.toHaveProperty('problem')
  expect(packetIssues[0]).not.toHaveProperty('evidenceRefs')
})

test('persists semantic result artifacts immutably and binds issue, packet, result digest, and path', async () => {
  const workspace = await workspaceWithCanonicalDocument()
  const api = revisionStage as unknown as {
    writeFoundationRevisionSemanticResult?: (input: {
      workspacePath: string
      revision: string
      round: 1 | 2 | 3
      taskId: string
      issueId: string
      packetDigest: string
      result: Record<string, unknown>
      resultDigest: string
    }) => Promise<string>
    loadFoundationRevisionSemanticResult?: (input: {
      workspacePath: string
      revision: string
      round: 1 | 2 | 3
      taskId: string
      issueId: string
      packetDigest: string
      resultDigest: string
      resultPath: string
    }) => Promise<Record<string, unknown>>
  }
  expect(typeof api.writeFoundationRevisionSemanticResult).toBe('function')
  expect(typeof api.loadFoundationRevisionSemanticResult).toBe('function')
  if (!api.writeFoundationRevisionSemanticResult || !api.loadFoundationRevisionSemanticResult) return
  const packetDigest = 'a'.repeat(64)
  const result = { issueId: 'AUD-semantic-1', packetDigest, status: 'PASS' }
  const resultDigest = digestFoundationSemanticRecheckResult(result as never)
  const input = { workspacePath: workspace, revision, round: 1 as const, taskId: 'revision-recheck-1', issueId: result.issueId, packetDigest, result, resultDigest }
  const resultPath = await api.writeFoundationRevisionSemanticResult(input)
  expect(resultPath).toContain(`/round-${input.round}/tasks/${input.taskId}/`)
  await expect(api.loadFoundationRevisionSemanticResult({ ...input, resultPath })).resolves.toEqual(result)
  await expect(api.writeFoundationRevisionSemanticResult(input)).resolves.toBe(resultPath)
  for (const mismatch of [
    { issueId: 'AUD-other' },
    { packetDigest: 'b'.repeat(64) },
    { resultDigest: 'c'.repeat(64) },
    { resultPath: resultPath.replace(input.taskId, 'other-task') },
  ]) {
    await expect(api.loadFoundationRevisionSemanticResult({ ...input, resultPath, ...mismatch })).rejects.toThrow(/identity|digest|path|stale/i)
  }
  const originalBytes = await readFile(join(workspace, resultPath))
  await writeFile(join(workspace, resultPath), `${originalBytes}tampered`)
  await expect(api.loadFoundationRevisionSemanticResult({ ...input, resultPath })).rejects.toThrow(/digest|stale|tamper/i)
  await expect(api.writeFoundationRevisionSemanticResult({ ...input, result: { ...result, status: 'FAIL' }, resultDigest: 'b'.repeat(64) })).rejects.toThrow(/different|conflict|digest/i)
})

function canonicalDocument(): string {
  const contract = getGameDocumentContract(documentPath)
  return `# GDD\n\n${contract.sections.map(section => `<!-- beegame-section:${section.sectionId} -->\n## ${section.title}\n\n${section.sectionId === 'progression' ? '' : `original ${section.sectionId}`}\n`).join('\n')}`
}

async function workspaceWithCanonicalDocument() {
  const workspace = await mkdtemp(join(tmpdir(), 'beegame-revision-stage-'))
  workspaces.push(workspace)
  await mkdirFor(join(workspace, 'docs'))
  await writeFile(join(workspace, documentPath), canonicalDocument())
  return workspace
}

async function mkdirFor(path: string) {
  const { mkdir } = await import('node:fs/promises')
  await mkdir(path, { recursive: true })
}

function receiptFor(
  input: Partial<RevisionTaskReceipt> &
    Pick<
      RevisionTaskReceipt,
      'baseDocumentDigest' | 'stagedDocumentDigest' | 'stagedPath'
    >,
): RevisionTaskReceipt {
  const receiptWithoutTerminal = {
    taskId: input.taskId ?? 'revision-task-1',
    round: input.round ?? 1,
    documentPath,
    issueIds: input.issueIds ?? ['AUD-1'],
    baseDocumentDigest: input.baseDocumentDigest,
    stagedDocumentDigest: input.stagedDocumentDigest,
    changedSectionIds: input.changedSectionIds ?? ['vision'],
    stagedPath: input.stagedPath,
  } satisfies Omit<RevisionTaskReceipt, 'terminalDigest'>
  return {
    ...receiptWithoutTerminal,
    terminalDigest: revisionTaskReceiptTerminalDigest(receiptWithoutTerminal),
  }
}

test('creates an isolated project-local staged copy and leaves canonical bytes unchanged', async () => {
  const workspace = await workspaceWithCanonicalDocument()
  const canonical = await readFile(join(workspace, documentPath), 'utf8')
  const stage = await createFoundationRevisionStage({
    workspacePath: workspace,
    revision,
    documentPath,
  })

  expect(stage.stagedPath).toBe(
    `.beegame/audit/foundation/${revision}/revision/${documentPath}`,
  )
  expect(await readFile(join(workspace, stage.stagedPath), 'utf8')).toBe(
    canonical,
  )
  expect(await readFile(join(workspace, documentPath), 'utf8')).toBe(canonical)
  expect(stage.baseDocumentDigest).toMatch(/^[a-f0-9]{64}$/)
  expect(stage.stagedDocumentDigest).toBe(stage.baseDocumentDigest)
})

test('rejects a stale existing stage instead of reusing an orphaned copy', async () => {
  const workspace = await workspaceWithCanonicalDocument()
  const stage = await createFoundationRevisionStage({ workspacePath: workspace, revision, documentPath })
  await writeFile(join(workspace, stage.stagedPath), `${await readFile(join(workspace, stage.stagedPath), 'utf8')}\nstale`)
  await expect(createFoundationRevisionStage({ workspacePath: workspace, revision, documentPath, expectedBaseDocumentDigest: stage.baseDocumentDigest })).rejects.toThrow(/base|match|stale/i)
})

test('derives INSERT, REPLACE and DELETE section operations without content fields', async () => {
  const workspace = await workspaceWithCanonicalDocument()
  const stage = await createFoundationRevisionStage({
    workspacePath: workspace,
    revision,
    documentPath,
  })
  let staged = await readFile(join(workspace, stage.stagedPath), 'utf8')
  staged = staged.replace('original vision', 'changed vision')
  staged = staged.replace('original core_loop', '')
  staged = staged.replace(
    '## Progression, Rewards and Economy Boundary\n\n\n',
    '## Progression, Rewards and Economy Boundary\n\ninserted progression\n',
  )
  await writeFile(join(workspace, stage.stagedPath), staged)
  const stagedDocumentDigest = stageDigest(staged)
  const base = receiptFor({
    issueIds: ['AUD-1', 'AUD-DELETE', 'AUD-INSERT'],
    baseDocumentDigest: stage.baseDocumentDigest,
    stagedDocumentDigest,
    stagedPath: stage.stagedPath,
    changedSectionIds: ['vision', 'core_loop', 'progression'],
  })

  const operations = await deriveFoundationPatchOperations({
    workspacePath: workspace,
    revision,
    batch: {
      documentPath,
      sectionIds: ['vision', 'core_loop', 'progression'],
      issueIds: ['AUD-1', 'AUD-DELETE', 'AUD-INSERT'],
    },
    issues: [
      admittedIssue('AUD-1', 'vision'),
      admittedIssue('AUD-DELETE', 'core_loop'),
      admittedIssue('AUD-INSERT', 'progression'),
    ],
    receipt: base,
  })
  expect(operations.map(operation => operation.kind)).toEqual([
    'REPLACE',
    'DELETE',
    'INSERT',
  ])
  expect(operations.every(operation => !('content' in operation))).toBe(true)
  expect(operations.flatMap(operation => operation.issueIds)).toEqual([
    'AUD-1',
    'AUD-DELETE',
    'AUD-INSERT',
  ])
})

test('rejects stale base, traversal paths, user-directory staging and unauthorized sections', async () => {
  const workspace = await workspaceWithCanonicalDocument()
  const stage = await createFoundationRevisionStage({
    workspacePath: workspace,
    revision,
    documentPath,
  })
  const staged = await readFile(join(workspace, stage.stagedPath), 'utf8')
  const valid = receiptFor({
    baseDocumentDigest: stage.baseDocumentDigest,
    stagedDocumentDigest: stage.stagedDocumentDigest,
    stagedPath: stage.stagedPath,
  })

  await writeFile(join(workspace, documentPath), `${staged} drift`)
  await expect(
    deriveFoundationPatchOperations({
      workspacePath: workspace,
      revision,
      batch: { documentPath, sectionIds: ['vision'], issueIds: ['AUD-1'] },
      issues: [admittedIssue('AUD-1', 'vision')],
      receipt: valid,
    }),
  ).rejects.toThrow(/stale|base|digest/i)
  await writeFile(join(workspace, documentPath), staged)

  await expect(
    deriveFoundationPatchOperations({
      workspacePath: workspace,
      revision,
      batch: {
        documentPath,
        sectionIds: ['rules_systems'],
        issueIds: ['AUD-1'],
      },
      issues: [admittedIssue('AUD-1', 'rules_systems')],
      receipt: valid,
    }),
  ).rejects.toThrow(/section|changed/i)
  const { terminalDigest: _terminalDigest, ...traversalWithoutTerminal } = {
    ...valid,
    stagedPath: '../outside.md',
  }
  const traversal = {
    ...traversalWithoutTerminal,
    terminalDigest: revisionTaskReceiptTerminalDigest(traversalWithoutTerminal),
  }
  await expect(
    deriveFoundationPatchOperations({
      workspacePath: workspace,
      revision,
      batch: { documentPath, sectionIds: ['vision'], issueIds: ['AUD-1'] },
      issues: [admittedIssue('AUD-1', 'vision')],
      receipt: traversal,
    }),
  ).rejects.toThrow(/path|staged/i)
})

test('rejects extra keys, duplicate IDs, marker destruction and whole-document drift', async () => {
  const workspace = await workspaceWithCanonicalDocument()
  const stage = await createFoundationRevisionStage({
    workspacePath: workspace,
    revision,
    documentPath,
  })
  const valid = receiptFor({
    baseDocumentDigest: stage.baseDocumentDigest,
    stagedDocumentDigest: stage.stagedDocumentDigest,
    stagedPath: stage.stagedPath,
  })
  await expect(
    deriveFoundationPatchOperations({
      workspacePath: workspace,
      revision,
      batch: {
        documentPath,
        sectionIds: ['vision'],
        issueIds: ['AUD-1', 'AUD-1'],
      },
      issues: [admittedIssue('AUD-1', 'vision')],
      receipt: valid,
    }),
  ).rejects.toThrow(/duplicate|issue/i)
  await expect(
    deriveFoundationPatchOperations({
      workspacePath: workspace,
      revision,
      batch: { documentPath, sectionIds: ['vision'], issueIds: ['AUD-1'] },
      issues: [admittedIssue('AUD-1', 'vision')],
      receipt: { ...valid, extra: true } as never,
    }),
  ).rejects.toThrow(/shape|key|receipt/i)
  await writeFile(
    join(workspace, stage.stagedPath),
    (await readFile(join(workspace, stage.stagedPath), 'utf8')).replace(
      '<!-- beegame-section:vision -->',
      '<!-- broken -->',
    ),
  )
  const broken = receiptFor({
    baseDocumentDigest: stage.baseDocumentDigest,
    stagedDocumentDigest: stageDigest(
      await readFile(join(workspace, stage.stagedPath), 'utf8'),
    ),
    stagedPath: stage.stagedPath,
  })
  await expect(
    deriveFoundationPatchOperations({
      workspacePath: workspace,
      revision,
      batch: { documentPath, sectionIds: ['vision'], issueIds: ['AUD-1'] },
      issues: [admittedIssue('AUD-1', 'vision')],
      receipt: broken,
    }),
  ).rejects.toThrow(/section|marker|contract/i)
})

function admittedIssue(id: string, fixSectionId: string): AuditIssue {
  return {
    id,
    severity: 'HIGH',
    type: 'rule',
    source: {
      documentPath,
      sectionId: fixSectionId,
      heading: fixSectionId,
      startLine: 1,
      endLine: 1,
      digest: 'a'.repeat(64),
    },
    expected: 'expected',
    actual: 'actual',
    fixDocument: documentPath,
    fixSectionId,
  }
}

async function deriveWithIssues(input: Record<string, unknown>) {
  return deriveFoundationPatchOperations(input as never)
}

test('binds distinct section operations to admitted fix targets regardless issue array order', async () => {
  const workspace = await workspaceWithCanonicalDocument()
  const stage = await createFoundationRevisionStage({
    workspacePath: workspace,
    revision,
    documentPath,
  })
  const staged = (await readFile(join(workspace, stage.stagedPath), 'utf8'))
    .replace('original vision', 'revised vision')
    .replace('original core_loop', 'revised core loop')
  await writeFile(join(workspace, stage.stagedPath), staged)
  const receipt = receiptFor({
    issueIds: ['AUD-CORE', 'AUD-VISION'],
    changedSectionIds: ['vision', 'core_loop'],
    baseDocumentDigest: stage.baseDocumentDigest,
    stagedDocumentDigest: stageDigest(staged),
    stagedPath: stage.stagedPath,
  })
  const operations = await deriveWithIssues({
    workspacePath: workspace,
    revision,
    batch: {
      documentPath,
      sectionIds: ['vision', 'core_loop'],
      issueIds: ['AUD-CORE', 'AUD-VISION'],
    },
    issues: [
      admittedIssue('AUD-VISION', 'vision'),
      admittedIssue('AUD-CORE', 'core_loop'),
    ],
    receipt,
  })
  expect(operations).toEqual([
    expect.objectContaining({ sectionId: 'vision', issueIds: ['AUD-VISION'] }),
    expect.objectContaining({ sectionId: 'core_loop', issueIds: ['AUD-CORE'] }),
  ])
  const swapped = await deriveWithIssues({
    workspacePath: workspace,
    revision,
    batch: {
      documentPath,
      sectionIds: ['vision', 'core_loop'],
      issueIds: ['AUD-VISION', 'AUD-CORE'],
    },
    issues: [
      admittedIssue('AUD-CORE', 'core_loop'),
      admittedIssue('AUD-VISION', 'vision'),
    ],
    receipt: receiptFor({
      issueIds: ['AUD-VISION', 'AUD-CORE'],
      changedSectionIds: ['vision', 'core_loop'],
      baseDocumentDigest: stage.baseDocumentDigest,
      stagedDocumentDigest: stageDigest(staged),
      stagedPath: stage.stagedPath,
    }),
  })
  expect(
    swapped.map(operation => ({
      sectionId: operation.sectionId,
      issueIds: operation.issueIds,
    })),
  ).toEqual(
    operations.map(operation => ({
      sectionId: operation.sectionId,
      issueIds: operation.issueIds,
    })),
  )
})

test('keeps issues targeting one section together and rejects changed sections without authority', async () => {
  const workspace = await workspaceWithCanonicalDocument()
  const stage = await createFoundationRevisionStage({
    workspacePath: workspace,
    revision,
    documentPath,
  })
  const staged = (
    await readFile(join(workspace, stage.stagedPath), 'utf8')
  ).replace('original vision', 'revised vision')
  await writeFile(join(workspace, stage.stagedPath), staged)
  const receipt = receiptFor({
    issueIds: ['AUD-2', 'AUD-1'],
    baseDocumentDigest: stage.baseDocumentDigest,
    stagedDocumentDigest: stageDigest(staged),
    stagedPath: stage.stagedPath,
  })
  await expect(
    deriveWithIssues({
      workspacePath: workspace,
      revision,
      batch: {
        documentPath,
        sectionIds: ['vision'],
        issueIds: ['AUD-2', 'AUD-1'],
      },
      issues: [
        admittedIssue('AUD-2', 'vision'),
        admittedIssue('AUD-1', 'vision'),
      ],
      receipt,
    }),
  ).resolves.toEqual([
    expect.objectContaining({
      sectionId: 'vision',
      issueIds: ['AUD-1', 'AUD-2'],
    }),
  ])

  const unrelatedReceipt = receiptFor({
    issueIds: ['AUD-OTHER'],
    changedSectionIds: ['vision'],
    baseDocumentDigest: stage.baseDocumentDigest,
    stagedDocumentDigest: stageDigest(staged),
    stagedPath: stage.stagedPath,
  })
  await expect(
    deriveWithIssues({
      workspacePath: workspace,
      revision,
      batch: { documentPath, sectionIds: ['vision'], issueIds: ['AUD-OTHER'] },
      issues: [admittedIssue('AUD-OTHER', 'core_loop')],
      receipt: unrelatedReceipt,
    }),
  ).rejects.toThrow(/target|changed|issue/i)
})

test('rejects an authorized issue target that was not changed and any changed section with no issue', async () => {
  const workspace = await workspaceWithCanonicalDocument()
  const stage = await createFoundationRevisionStage({
    workspacePath: workspace,
    revision,
    documentPath,
  })
  const staged = (
    await readFile(join(workspace, stage.stagedPath), 'utf8')
  ).replace('original vision', 'revised vision')
  await writeFile(join(workspace, stage.stagedPath), staged)
  const receipt = receiptFor({
    issueIds: ['AUD-CORE'],
    changedSectionIds: ['vision'],
    baseDocumentDigest: stage.baseDocumentDigest,
    stagedDocumentDigest: stageDigest(staged),
    stagedPath: stage.stagedPath,
  })
  await expect(
    deriveWithIssues({
      workspacePath: workspace,
      revision,
      batch: {
        documentPath,
        sectionIds: ['vision', 'core_loop'],
        issueIds: ['AUD-CORE'],
      },
      issues: [admittedIssue('AUD-CORE', 'core_loop')],
      receipt,
    }),
  ).rejects.toThrow(/target|changed|issue/i)
})

function stageDigest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
