import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { getGameDocumentContract } from './game-document-contracts'
import { buildFoundationSectionIndex } from './foundation-section-index'
import {
  completeTestSubmission,
  renderTestCompleteGameDocument,
} from '../../__tests__/complete-game-document-fixture'
import * as revisionStage from './foundation-revision-stage'
import {
  createFoundationRevisionStage,
  foundationRevisionStagePath,
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
import type {
  AuditIssue,
  FoundationDocumentAuditIssue,
} from './foundation-issue-registry'
import type { FoundationDocumentPath, FoundationRevisionRound } from './types'

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

test('rejects invalid dynamic rounds before constructing packet paths', () => {
  for (const round of [0, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => foundationRevisionPacketPath(revision, round as never, 'revision-task-1')).toThrow(/round/i)
  }
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
  const issue: AuditIssue = {
    id: 'AUD-1',
    severity: 'HIGH' as const,
    type: 'semantic' as const,
    source,
    target,
    expected: 'expected',
    actual: 'actual',
    remediation: { kind: 'patch', scope: 'section', documentPath, sectionIds: ['rules_systems'] },
  }
  const authority = await buildFoundationRevisionAuthority({
    workspacePath: workspace,
    revision,
    taskId: 'revision-task-1',
    round: 1,
    batch: { scope: 'section', documentPath, sectionIds: ['rules_systems'], issueIds: ['AUD-1'] },
    issues: [issue],
    sourceAuthorityDigest: 'c'.repeat(64),
    sourceIssueRegistryDigest: 'd'.repeat(64),
    sourceDerivedDigests: { sectionIndex: 'e'.repeat(64), factStore: 'f'.repeat(64), manifest: '0'.repeat(64) },
    sourceDocumentDigests: [{ path: documentPath, digest: '1'.repeat(64) }],
    normalizedFacts: [{ source, payload: 'duplicate fact prose'.repeat(1000) }],
  })

  expect(authority.packet.sections).toHaveLength(3)
  expect(authority.packet.normalizedFacts).toHaveLength(1)
  expect(authority.packet.factConstraints).toEqual(expect.arrayContaining([
    expect.objectContaining({
      key: 'game.resources',
      owner: { documentPath, sectionId: 'rules_systems' },
      valueType: 'string[]',
      extractionInstruction: expect.any(String),
      sourceOfTruthDirection: expect.any(String),
    }),
  ]))
  const packetIssues = authority.packet.issues as Array<Record<string, unknown>>
  expect(packetIssues).toEqual([expect.objectContaining({ id: 'AUD-1', actual: 'actual' })])
  expect(packetIssues[0]).not.toHaveProperty('problem')
  expect(packetIssues[0]).not.toHaveProperty('evidenceRefs')
})

test('includes complete cross-document source and target sections without widening write scope', async () => {
  const workspace = await workspaceWithCanonicalDocuments([
    documentPath,
    'docs/LEVEL_SCENE_DESIGN.md',
  ])
  const documents = Object.fromEntries(
    await Promise.all(
      [documentPath, 'docs/LEVEL_SCENE_DESIGN.md'].map(async path => [
        path,
        await readFile(join(workspace, path), 'utf8'),
      ]),
    ),
  )
  const source = buildFoundationSectionIndex({ documents }).find(
    section => section.documentPath === documentPath && section.sectionId === 'core_loop',
  )!
  const target = buildFoundationSectionIndex({ documents }).find(
    section => section.documentPath === 'docs/LEVEL_SCENE_DESIGN.md' && section.sectionId === 'pacing_beats',
  )!
  const issue: AuditIssue = {
    id: 'AUD-cross-document',
    severity: 'HIGH',
    type: 'semantic',
    source,
    target,
    expected: 'expected cross-document consistency',
    actual: 'actual cross-document mismatch',
    remediation: { kind: 'patch', scope: 'section', documentPath, sectionIds: ['rules_systems'] },
  }

  const authority = await buildFoundationRevisionAuthority({
    workspacePath: workspace,
    revision,
    taskId: 'revision-task-cross-document',
    round: 1,
    batch: { scope: 'section', documentPath, sectionIds: ['rules_systems'], issueIds: [issue.id] },
    issues: [issue],
    sourceAuthorityDigest: 'c'.repeat(64),
    sourceIssueRegistryDigest: 'd'.repeat(64),
    sourceDerivedDigests: { sectionIndex: 'e'.repeat(64), factStore: 'f'.repeat(64), manifest: '0'.repeat(64) },
    sourceDocumentDigests: [
      { path: documentPath, digest: '1'.repeat(64) },
      { path: 'docs/LEVEL_SCENE_DESIGN.md', digest: '2'.repeat(64) },
    ],
    normalizedFacts: [],
  })

  const sections = authority.packet.sections as Array<Record<string, unknown>>
  expect(sections).toHaveLength(3)
  expect(sections).toEqual(expect.arrayContaining([
    expect.objectContaining({
      documentPath: source.documentPath,
      sectionId: source.sectionId,
      text: expect.stringContaining('original core_loop'),
    }),
    expect.objectContaining({
      documentPath: target.documentPath,
      sectionId: target.sectionId,
      text: expect.stringContaining('original pacing_beats'),
    }),
  ]))
  expect(authority.packet.documentPath).toBe(documentPath)
  expect(authority.packet.sectionIds).toEqual(['rules_systems'])
  expect(authority.stagedPath).toBe(
    foundationRevisionStagePath(revision, documentPath),
  )
})

test('accepts a legal complex revision packet above the old 24KiB business cap', async () => {
  const workspace = await workspaceWithCanonicalDocument()
  const canonicalPath = join(workspace, documentPath)
  const original = await readFile(canonicalPath, 'utf8')
  await writeFile(canonicalPath, original.replace('original vision', 'complex revision context '.repeat(1500)))
  const sections = buildFoundationSectionIndex({ documents: { [documentPath]: await readFile(canonicalPath, 'utf8') } })
  const source = sections.find(section => section.sectionId === 'vision')!
  const target = sections.find(section => section.sectionId === 'progression')!
  const issue: AuditIssue = {
    id: 'AUD-large-revision-packet',
    severity: 'HIGH' as const,
    type: 'semantic' as const,
    source,
    target,
    expected: 'expected',
    actual: 'detailed admitted issue context '.repeat(1500),
    remediation: { kind: 'patch', scope: 'section', documentPath, sectionIds: ['rules_systems'] },
  }

  const authority = await buildFoundationRevisionAuthority({
    workspacePath: workspace,
    revision,
    taskId: 'revision-task-large-packet',
    round: 1,
    batch: { scope: 'section', documentPath, sectionIds: ['rules_systems'], issueIds: [issue.id] },
    issues: [issue],
    sourceAuthorityDigest: 'c'.repeat(64),
    sourceIssueRegistryDigest: 'd'.repeat(64),
    sourceDerivedDigests: { sectionIndex: 'e'.repeat(64), factStore: 'f'.repeat(64), manifest: '0'.repeat(64) },
    sourceDocumentDigests: [{ path: documentPath, digest: '1'.repeat(64) }],
    normalizedFacts: [],
  })

  expect(Buffer.byteLength(JSON.stringify(authority.packet), 'utf8')).toBeGreaterThan(24 * 1024)
  expect(authority.packet.documentPath).toBe(documentPath)
  expect(authority.packet.issueIds).toEqual([issue.id])
  expect(authority.packet.sectionIds).toEqual(['rules_systems'])
  expect(authority.packet.issues).toEqual([issue])
  expect(authority.packet.sections).toEqual(expect.arrayContaining([
    expect.objectContaining({ sectionId: 'vision', documentPath }),
    expect.objectContaining({ sectionId: 'rules_systems', documentPath }),
  ]))
  expect(authority.packetDigest).toBe(foundationRevisionPacketDigest(authority.packet))
})

test('persists semantic result artifacts immutably and binds issue, packet, result digest, and path', async () => {
  const workspace = await workspaceWithCanonicalDocument()
  const api = revisionStage as unknown as {
    writeFoundationRevisionSemanticResult?: (input: {
      workspacePath: string
      revision: string
      round: FoundationRevisionRound
      taskId: string
      issueId: string
      packetDigest: string
      result: Record<string, unknown>
      resultDigest: string
    }) => Promise<string>
    loadFoundationRevisionSemanticResult?: (input: {
      workspacePath: string
      revision: string
      round: FoundationRevisionRound
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
  const result = { taskId: 'revision-recheck-1', issueId: 'AUD-semantic-1', packetDigest, status: 'PASS' as const }
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
  await expect(api.writeFoundationRevisionSemanticResult({ ...input, result: { ...result, status: 'FAIL' }, resultDigest: 'b'.repeat(64) })).rejects.toThrow(/shape|different|conflict|digest/i)
})

test('persists service-admitted structured failure diagnostics with dependency digests', async () => {
  const workspace = await workspaceWithCanonicalDocument()
  const section = { documentPath, sectionId: 'vision', heading: 'Vision', startLine: 3, endLine: 5, digest: 'a'.repeat(64) }
  const packetDigest = 'a'.repeat(64)
  const result = {
    taskId: 'revision-recheck-1', issueId: 'AUD-semantic-1', packetDigest, status: 'FAIL' as const,
    diagnostic: {
      unmetExpected: 'coherent', observedActual: 'contradictory',
      evidence: [section], dependencySections: [section],
      failureReasonCode: 'actual_persists' as const, scopeAssessment: 'repairable_in_scope' as const,
    },
  }
  const resultDigest = digestFoundationSemanticRecheckResult(result as never)
  const input = { workspacePath: workspace, revision, round: 1 as const, taskId: result.taskId, issueId: result.issueId, packetDigest, result, resultDigest }
  const resultPath = await revisionStage.writeFoundationRevisionSemanticResult(input as never)
  await expect(revisionStage.loadFoundationRevisionSemanticResult({ ...input, resultPath })).resolves.toEqual(result)
  await expect(revisionStage.writeFoundationRevisionSemanticResult({ ...input, result: { ...result, diagnostic: { ...result.diagnostic, unmetExpected: 'tampered' } }, resultDigest } as never)).rejects.toThrow(/digest|different|conflict/i)
})

function canonicalDocument(): string {
  return canonicalDocumentFor(documentPath)
}

function canonicalDocumentFor(path: FoundationDocumentPath): string {
  const contract = getGameDocumentContract(path)
  const title = path === documentPath ? 'GDD' : path
  const sections = contract.sections.map(section => `<!-- beegame-section:${section.sectionId} -->\n## ${section.title}\n\n${section.sectionId === 'progression' ? '' : `original ${section.sectionId}`}\n`).join('\n')
  const materials = contract.productionMaterials.map(material => `<!-- beegame-material:${material.materialId} -->\n### ${material.title}\n\nmaterial ${material.materialId}\n`).join('\n')
  return `# ${title}\n\n<!-- beegame-executive-summary -->\n## Executive Summary\n\nsummary authority\n\n${sections}<!-- beegame-production-materials -->\n## Production Materials\n\n${materials}<!-- beegame-audit-appendix -->\n## Audit Appendix\n\naudit metadata\n`
}

async function workspaceWithCanonicalDocument() {
  const workspace = await mkdtemp(join(tmpdir(), 'beegame-revision-stage-'))
  workspaces.push(workspace)
  await mkdirFor(join(workspace, 'docs'))
  await writeFile(join(workspace, documentPath), canonicalDocument())
  return workspace
}

async function workspaceWithCompleteCanonicalDocument() {
  const workspace = await mkdtemp(join(tmpdir(), 'beegame-revision-stage-'))
  workspaces.push(workspace)
  await mkdirFor(join(workspace, 'docs'))
  await writeFile(join(workspace, documentPath), completeCanonicalDocument())
  return workspace
}

async function workspaceWithCompleteDocument() {
  const workspace = await mkdtemp(join(tmpdir(), 'beegame-revision-stage-'))
  workspaces.push(workspace)
  await mkdirFor(join(workspace, 'docs'))
  await writeFile(join(workspace, documentPath), completeDocument())
  return workspace
}

function completeCanonicalDocument(): string {
  const contract = getGameDocumentContract(documentPath)
  const lines = [
    '# GDD',
    '',
    '<!-- beegame-executive-summary -->',
    '## Executive Summary',
    '',
    'summary authority',
    '',
    ...contract.sections.flatMap(section => [
      `<!-- beegame-section:${section.sectionId} -->`,
      `## ${section.title}`,
      '',
      `original ${section.sectionId}`,
      '',
    ]),
    '<!-- beegame-production-materials -->',
    '## Production Materials',
    '',
    ...contract.productionMaterials.flatMap(material => [
      `<!-- beegame-material:${material.materialId} -->`,
      `### ${material.title}`,
      '',
      `material ${material.materialId}`,
      '',
    ]),
    '<!-- beegame-audit-appendix -->',
    '## Audit Appendix',
    '',
    'audit metadata',
  ]
  return lines.join('\n')
}

function completeDocument(path: FoundationDocumentPath = documentPath): string {
  return renderTestCompleteGameDocument(path, completeTestSubmission(path))
}

async function workspaceWithCanonicalDocuments(paths: readonly FoundationDocumentPath[]) {
  const workspace = await mkdtemp(join(tmpdir(), 'beegame-revision-stage-'))
  workspaces.push(workspace)
  await mkdirFor(join(workspace, 'docs'))
  await Promise.all(paths.map(path => writeFile(join(workspace, path), canonicalDocumentFor(path))))
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
    scope: 'section' as const,
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

function documentFormatIssue(
  id: string,
  digest: string,
): FoundationDocumentAuditIssue {
  return {
    id,
    severity: 'BLOCKER',
    type: 'contract',
    source: { scope: 'document', documentPath, digest },
    expected: 'canonical complete document',
    actual: 'document format is invalid',
    remediation: { kind: 'patch', scope: 'document', documentPath },
    reasonCode: 'DOCUMENT_FORMAT_INVALID',
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

test('derives a document-scope replacement only for an admitted format issue', async () => {
  const workspace = await workspaceWithCompleteDocument()
  const complete = completeDocument()
  const malformed = complete.replace(
    '<!-- beegame-section:vision -->',
    '<!-- malformed-section-marker -->',
  )
  await writeFile(join(workspace, documentPath), malformed)
  const stage = await createFoundationRevisionStage({
    workspacePath: workspace,
    revision,
    documentPath,
  })
  await writeFile(join(workspace, stage.stagedPath), complete)
  const issue = documentFormatIssue('AUD-DOCUMENT-FORMAT', stage.baseDocumentDigest)
  const batch = {
    scope: 'document' as const,
    documentPath,
    sectionIds: [] as [],
    issueIds: [issue.id],
  }
  const receiptWithoutTerminal = {
    scope: 'document' as const,
    taskId: 'document-revision-task',
    round: 1 as const,
    documentPath,
    issueIds: [issue.id],
    baseDocumentDigest: stage.baseDocumentDigest,
    stagedDocumentDigest: stageDigest(complete),
    changedSectionIds: [] as [],
    stagedPath: stage.stagedPath,
  } satisfies Omit<RevisionTaskReceipt, 'terminalDigest'>
  const receipt = {
    ...receiptWithoutTerminal,
    terminalDigest: revisionTaskReceiptTerminalDigest(receiptWithoutTerminal),
  }

  const authority = await buildFoundationRevisionAuthority({
    workspacePath: workspace,
    revision,
    taskId: receipt.taskId,
    round: receipt.round,
    batch,
    issues: [issue],
    sourceAuthorityDigest: 'a'.repeat(64),
    sourceIssueRegistryDigest: 'b'.repeat(64),
    sourceDerivedDigests: {
      sectionIndex: 'c'.repeat(64),
      factStore: 'd'.repeat(64),
      manifest: 'e'.repeat(64),
    },
    sourceDocumentDigests: [{ path: documentPath, digest: stage.baseDocumentDigest }],
    normalizedFacts: [{ source: { documentPath, sectionId: 'vision' }, payload: 'ignored' }],
  })
  expect(authority.scope).toBe('document')
  expect(authority.packet.scope).toBe('document')
  expect(authority.packet.sections).toEqual([])
  expect(authority.packet.normalizedFacts).toEqual([])
  expect(authority.packet.factConstraints).toEqual([])
  expect(authority.packet.documentContract).toBeDefined()
  const serializedRepairContract = JSON.stringify(authority.packet.documentContract)
  for (const section of getGameDocumentContract(documentPath).sections) {
    expect(serializedRepairContract).toContain(`<!-- beegame-section:${section.sectionId} -->`)
    expect(serializedRepairContract).toContain(`## ${section.title}`)
  }
  for (const material of getGameDocumentContract(documentPath).productionMaterials) {
    expect(serializedRepairContract).toContain(`<!-- beegame-material:${material.materialId} -->`)
    expect(serializedRepairContract).toContain(`### ${material.title}`)
    expect(serializedRepairContract).toContain(material.format)
  }
  expect(authority.packet.document).toEqual({
    documentPath,
    digest: stage.baseDocumentDigest,
    text: malformed,
  })

  const operations = await deriveFoundationPatchOperations({
    workspacePath: workspace,
    revision,
    taskId: receipt.taskId,
    batch,
    issues: [issue],
    receipt,
  })
  expect(operations).toEqual([{
    scope: 'document',
    kind: 'REPLACE',
    documentPath,
    issueIds: [issue.id],
    beforeDigest: stage.baseDocumentDigest,
    afterDigest: stageDigest(complete),
  }])
})

test('rejects document-scope empty or non-canonical staged bytes', async () => {
  const workspace = await workspaceWithCompleteDocument()
  const complete = completeDocument()
  const malformed = complete.replace(
    '<!-- beegame-section:vision -->',
    '<!-- malformed-section-marker -->',
  )
  await writeFile(join(workspace, documentPath), malformed)
  const stage = await createFoundationRevisionStage({
    workspacePath: workspace,
    revision,
    documentPath,
  })
  const issue = documentFormatIssue('AUD-DOCUMENT-FORMAT', stage.baseDocumentDigest)
  const batch = {
    scope: 'document' as const,
    documentPath,
    sectionIds: [] as [],
    issueIds: [issue.id],
  }

  const makeReceipt = (staged: string): RevisionTaskReceipt => {
    const core = {
      scope: 'document' as const,
      taskId: 'document-revision-invalid-task',
      round: 1 as const,
      documentPath,
      issueIds: [issue.id],
      baseDocumentDigest: stage.baseDocumentDigest,
      stagedDocumentDigest: stageDigest(staged),
      changedSectionIds: [] as [],
      stagedPath: stage.stagedPath,
    } satisfies Omit<RevisionTaskReceipt, 'terminalDigest'>
    return {
      ...core,
      terminalDigest: revisionTaskReceiptTerminalDigest(core),
    }
  }

  await writeFile(join(workspace, stage.stagedPath), '')
  await expect(deriveFoundationPatchOperations({
    workspacePath: workspace,
    revision,
    batch,
    issues: [issue],
    receipt: makeReceipt(''),
  })).rejects.toThrow(/non-empty/i)

  const malformedStaged = malformed.replace('## Executive Summary', '## Wrong Summary')
  await writeFile(join(workspace, stage.stagedPath), malformedStaged)
  await expect(deriveFoundationPatchOperations({
    workspacePath: workspace,
    revision,
    batch,
    issues: [issue],
    receipt: makeReceipt(malformedStaged),
  })).rejects.toThrow(/complete|marker|structure/i)
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
      scope: 'section',
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

test('derives admitted summary and material blocks while rejecting unlisted derived or authoritative changes', async () => {
  const workspace = await workspaceWithCompleteCanonicalDocument()
  const stage = await createFoundationRevisionStage({ workspacePath: workspace, revision, documentPath })
  const original = await readFile(join(workspace, stage.stagedPath), 'utf8')
  const materials = getGameDocumentContract(documentPath).productionMaterials
  const materialId = materials[0]!.materialId
  const unlistedMaterialId = materials[1]!.materialId
  const changed = original
    .replace('summary authority', 'changed summary authority')
    .replace(`material ${materialId}`, `changed material ${materialId}`)
  await writeFile(join(workspace, stage.stagedPath), changed)
  const admittedSectionIds = ['executive_summary', `material.${materialId}`]
  const admittedIssueIds = ['AUD-SUMMARY', 'AUD-MATERIAL']
  const makeInput = (document: string, receipt: RevisionTaskReceipt) => ({
    workspacePath: workspace,
    revision,
    batch: { scope: 'section' as const, documentPath, sectionIds: admittedSectionIds, issueIds: admittedIssueIds },
    issues: [
      admittedIssue('AUD-SUMMARY', 'executive_summary'),
      admittedIssue('AUD-MATERIAL', `material.${materialId}`),
    ],
    receipt,
  })
  const operations = await deriveFoundationPatchOperations(makeInput(changed, receiptFor({
    issueIds: admittedIssueIds,
    baseDocumentDigest: stage.baseDocumentDigest,
    stagedDocumentDigest: stageDigest(changed),
    stagedPath: stage.stagedPath,
    changedSectionIds: admittedSectionIds,
  })))
  expect(operations.map(sectionOperationId)).toEqual(admittedSectionIds)

  const unlistedDerived = changed.replace(
    `material ${unlistedMaterialId}`,
    `changed unlisted material ${unlistedMaterialId}`,
  )
  await writeFile(join(workspace, stage.stagedPath), unlistedDerived)
  await expect(deriveFoundationPatchOperations(makeInput(unlistedDerived, receiptFor({
    issueIds: admittedIssueIds,
    baseDocumentDigest: stage.baseDocumentDigest,
    stagedDocumentDigest: stageDigest(unlistedDerived),
    stagedPath: stage.stagedPath,
    changedSectionIds: admittedSectionIds,
  })))).rejects.toThrow(/unauthorized|outside/i)

  const authoritativeDrift = changed.replace('original vision', 'changed authoritative vision')
  await writeFile(join(workspace, stage.stagedPath), authoritativeDrift)
  await expect(deriveFoundationPatchOperations(makeInput(authoritativeDrift, receiptFor({
    issueIds: admittedIssueIds,
    baseDocumentDigest: stage.baseDocumentDigest,
    stagedDocumentDigest: stageDigest(authoritativeDrift),
    stagedPath: stage.stagedPath,
    changedSectionIds: admittedSectionIds,
  })))).rejects.toThrow(/unauthorized|outside/i)
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
      batch: { scope: 'section', documentPath, sectionIds: ['vision'], issueIds: ['AUD-1'] },
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
        scope: 'section',
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
      batch: { scope: 'section', documentPath, sectionIds: ['vision'], issueIds: ['AUD-1'] },
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
        scope: 'section',
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
      batch: { scope: 'section', documentPath, sectionIds: ['vision'], issueIds: ['AUD-1'] },
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
      batch: { scope: 'section', documentPath, sectionIds: ['vision'], issueIds: ['AUD-1'] },
      issues: [admittedIssue('AUD-1', 'vision')],
      receipt: broken,
    }),
  ).rejects.toThrow(/section|marker|contract/i)
})

function admittedIssue(id: string, remediationSectionId: string): AuditIssue {
  return {
    id,
    severity: 'HIGH',
    type: 'rule',
    source: {
      documentPath,
      sectionId: remediationSectionId,
      heading: remediationSectionId,
      startLine: 1,
      endLine: 1,
      digest: 'a'.repeat(64),
    },
    expected: 'expected',
    actual: 'actual',
    remediation: { kind: 'patch', scope: 'section', documentPath, sectionIds: [remediationSectionId] },
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
      scope: 'section',
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
      scope: 'section',
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
      sectionId: sectionOperationId(operation),
      issueIds: operation.issueIds,
    })),
  ).toEqual(
    operations.map(operation => ({
      sectionId: sectionOperationId(operation),
      issueIds: operation.issueIds,
    })),
  )
})

test('treats remediation sectionIds as authority when only one authorized section changes', async () => {
  const workspace = await workspaceWithCanonicalDocument()
  const stage = await createFoundationRevisionStage({
    workspacePath: workspace,
    revision,
    documentPath,
  })
  const staged = (await readFile(join(workspace, stage.stagedPath), 'utf8'))
    .replace('original vision', 'revised vision')
  await writeFile(join(workspace, stage.stagedPath), staged)
  const issue = admittedIssue('AUD-MULTI', 'vision')
  issue.remediation = {
    kind: 'patch',
    scope: 'section',
    documentPath,
    sectionIds: ['vision', 'core_loop'],
  }
  const operations = await deriveFoundationPatchOperations({
    workspacePath: workspace,
    revision,
    batch: {
      scope: 'section',
      documentPath,
      sectionIds: ['vision', 'core_loop'],
      issueIds: [issue.id],
    },
    issues: [issue],
    receipt: receiptFor({
      issueIds: [issue.id],
      changedSectionIds: ['vision'],
      baseDocumentDigest: stage.baseDocumentDigest,
      stagedDocumentDigest: stageDigest(staged),
      stagedPath: stage.stagedPath,
    }),
  })
  expect(operations).toEqual([
    expect.objectContaining({ sectionId: 'vision', issueIds: [issue.id] }),
  ])
})

test('rejects section revisions with no progress or with changed sections lacking issue coverage', async () => {
  const workspace = await workspaceWithCanonicalDocument()
  const stage = await createFoundationRevisionStage({ workspacePath: workspace, revision, documentPath })
  const original = await readFile(join(workspace, stage.stagedPath), 'utf8')
  const issue = admittedIssue('AUD-VISION', 'vision')
  const baseInput = {
    workspacePath: workspace,
    revision,
    batch: {
      scope: 'section' as const,
      documentPath,
      sectionIds: ['vision', 'core_loop'],
      issueIds: [issue.id],
    },
    issues: [issue],
  }

  await expect(deriveFoundationPatchOperations({
    ...baseInput,
    receipt: receiptFor({
      issueIds: [issue.id],
      changedSectionIds: ['vision'],
      baseDocumentDigest: stage.baseDocumentDigest,
      stagedDocumentDigest: stage.baseDocumentDigest,
      stagedPath: stage.stagedPath,
    }),
  })).rejects.toThrow(/no section progress/i)

  const unrelatedChange = original.replace('original core_loop', 'revised core loop')
  await writeFile(join(workspace, stage.stagedPath), unrelatedChange)
  await expect(deriveFoundationPatchOperations({
    ...baseInput,
    receipt: receiptFor({
      issueIds: [issue.id],
      changedSectionIds: ['core_loop'],
      baseDocumentDigest: stage.baseDocumentDigest,
      stagedDocumentDigest: stageDigest(unrelatedChange),
      stagedPath: stage.stagedPath,
    }),
  })).rejects.toThrow(/without an admitted issue|coverage/i)
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
        scope: 'section',
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
      batch: { scope: 'section', documentPath, sectionIds: ['vision'], issueIds: ['AUD-OTHER'] },
      issues: [admittedIssue('AUD-OTHER', 'core_loop')],
      receipt: unrelatedReceipt,
    }),
  ).rejects.toThrow(/target|changed|issue/i)
})

test('rejects a changed authorized section outside the admitted issue remediation', async () => {
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
        scope: 'section',
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

function sectionOperationId(operation: import('./foundation-revision-stage').PatchOperation): string {
  if (operation.scope !== 'section') throw new Error('expected a section operation')
  return operation.sectionId
}
