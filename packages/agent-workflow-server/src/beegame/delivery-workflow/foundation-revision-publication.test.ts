import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getGameDocumentContract } from './game-document-contracts'
import { computeDocumentRevision } from './revision'
import {
  createFoundationRevisionStage,
  deriveFoundationPatchOperations,
  foundationPatchOperationsDigest,
  revisionTaskReceiptTerminalDigest,
  type PatchOperation,
  type RevisionTaskReceipt,
} from './foundation-revision-stage'
import type { FoundationSemanticRecheckResult, PatchValidation } from './foundation-patch-validation'
import type { RevisionBatch } from './foundation-revision-batches'
import type { AuditIssue } from './foundation-issue-registry'
import type { FoundationDocumentPath } from './types'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './types'
import {
  foundationRevisionCommittedPath,
  foundationRevisionJournalPath,
  foundationRevisionPreparedPath,
  loadCommittedFoundationRevisionAuthority,
  publishFoundationRevision,
  recoverFoundationRevision,
  type FoundationPublicationSemanticRecheckResult,
} from './foundation-revision-publication'

const workspaces: string[] = []
afterEach(async () => Promise.all(workspaces.splice(0).map(path => rm(path, { recursive: true, force: true }))))

const revision = 'publication-test'
const confirmedBriefDigest = 'b'.repeat(64)
const documentPath = 'docs/GDD.md' as const

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function canonicalDocument(path: FoundationDocumentPath = documentPath): string {
  const contract = getGameDocumentContract(path)
  const sections = contract.sections.map(section => `<!-- beegame-section:${section.sectionId} -->\n## ${section.title}\n\noriginal ${section.sectionId}\n`).join('\n')
  const materials = contract.productionMaterials.map(material => `<!-- beegame-material:${material.materialId} -->\n### ${material.title}\n\nmaterial ${material.materialId}\n`).join('\n')
  const body = `# ${path}\n\n<!-- beegame-executive-summary -->\n## Executive Summary\n\nsummary authority\n\n${sections}<!-- beegame-production-materials -->\n## Production Materials\n\n${materials}<!-- beegame-audit-appendix -->\n## Audit Appendix\n\naudit metadata`
  return `---\ndocument_id: GDD\nversion: 1.0.0\nupdated_at: 2026-08-13T01:00:00.000+08:00\n---\n${body}`
}

async function fixture(paths: readonly FoundationDocumentPath[] = [documentPath]) {
  const workspace = await mkdtemp(join(tmpdir(), 'beegame-publication-'))
  workspaces.push(workspace)
  await mkdir(join(workspace, 'docs'), { recursive: true })
  for (const path of CANONICAL_FOUNDATION_DOCUMENTS) await writeFile(join(workspace, path), canonicalDocument(path))
  const stages: Array<{ receipt: RevisionTaskReceipt; operations: PatchOperation[]; batch: RevisionBatch }> = []
  for (const path of paths) {
    const stage = await createFoundationRevisionStage({ workspacePath: workspace, revision, documentPath: path })
    const original = await readFile(join(workspace, stage.stagedPath), 'utf8')
    const staged = original
      .replace(`original ${getGameDocumentContract(path).sections[0]!.sectionId}`, 'revised authority')
      .replace('version: 1.0.0', 'version: 1.0.1')
      .replace('updated_at: 2026-08-13T01:00:00.000+08:00', 'updated_at: 2026-08-12T17:00:00.001Z')
    await writeFile(join(workspace, stage.stagedPath), staged)
    const baseDigest = stage.baseDocumentDigest
    const stagedDigest = sha256(staged)
    const issueId = `AUD-${paths.indexOf(path) + 1}`
    const receiptWithoutTerminal = {
      taskId: `task-${paths.indexOf(path) + 1}`,
      round: 1 as const,
      documentPath: path,
      issueIds: [issueId],
      baseDocumentDigest: baseDigest,
      stagedDocumentDigest: stagedDigest,
      changedSectionIds: [getGameDocumentContract(path).sections[0]!.sectionId],
      stagedPath: stage.stagedPath,
    }
    const receipt = { ...receiptWithoutTerminal, terminalDigest: revisionTaskReceiptTerminalDigest(receiptWithoutTerminal) }
    const operations = await deriveFoundationPatchOperations({
      workspacePath: workspace,
      revision,
      batch: { documentPath: path, sectionIds: receipt.changedSectionIds, issueIds: receipt.issueIds },
      issues: [revisionIssue(issueId, path, receipt.changedSectionIds[0]!)],
      receipt,
    })
    stages.push({ receipt, operations, batch: { documentPath: path, sectionIds: receipt.changedSectionIds, issueIds: receipt.issueIds } })
  }
  return { workspace, stages }
}

function validation(path: FoundationDocumentPath, receipt: RevisionTaskReceipt, operations: PatchOperation[], issueId: string, status: 'PASS' | 'FAIL' = 'PASS'): PatchValidation {
  return {
    validatorTaskId: `validator-${issueId}`,
    round: 1,
    issueId,
    documentPath: path,
    baseDocumentDigest: receipt.baseDocumentDigest,
    postPatchDocumentDigest: receipt.stagedDocumentDigest,
    patchDigest: foundationPatchOperationsDigest(operations),
    changedSectionIds: [...receipt.changedSectionIds],
    status,
    checkedFactKeys: [],
    checkedContractIds: [],
  }
}

function semanticResult(issueId: string, status: 'PASS' | 'FAIL' = 'PASS'): FoundationSemanticRecheckResult {
  return status === 'PASS'
    ? { taskId: `task-${issueId}`, issueId, packetDigest: sha256(`packet:${issueId}`), status }
    : { taskId: `task-${issueId}`, issueId, packetDigest: sha256(`packet:${issueId}`), status, diagnostic: { unmetExpected: 'expected', observedActual: 'actual', evidence: [], dependencySections: [], failureReasonCode: 'expected_not_met', scopeAssessment: 'repairable_in_scope' } }
}

function revisionIssue(id: string, path: FoundationDocumentPath, sectionId: string): AuditIssue {
  return {
    id,
    severity: 'HIGH',
    type: 'rule',
    source: { documentPath: path, sectionId, heading: sectionId, startLine: 1, endLine: 2, digest: sha256(`source:${id}`) },
    expected: 'expected',
    actual: 'actual',
    remediation: { kind: 'patch', documentPath: path, sectionIds: [sectionId] },
  }
}

function resultingIssue(id: string, severity: AuditIssue['severity'] = 'HIGH'): AuditIssue {
  return {
    id,
    severity,
    type: 'rule',
    source: { documentPath, sectionId: 'core_loop', heading: 'Core Loop', startLine: 1, endLine: 2, digest: sha256(`source:${id}`) },
    expected: 'expected',
    actual: 'actual',
    remediation: { kind: 'patch', documentPath, sectionIds: ['core_loop'] },
  }
}

function publishInput(fixtureValue: Awaited<ReturnType<typeof fixture>>, options: { validations?: PatchValidation[]; semantic?: FoundationPublicationSemanticRecheckResult[]; resultingIssues?: AuditIssue[] } = {}) {
  const validations = options.validations ?? fixtureValue.stages.map(stage => validation(stage.receipt.documentPath, stage.receipt, stage.operations, stage.receipt.issueIds[0]!))
  return {
    workspacePath: fixtureValue.workspace,
    revision,
    confirmedBriefDigest,
    round: 1 as const,
    batches: fixtureValue.stages.map(stage => stage.batch),
    receipts: fixtureValue.stages.map(stage => stage.receipt),
    revisionDeclarations: fixtureValue.stages.map(stage => ({ status: 'APPLIED' as const, changedSectionIds: [...stage.receipt.changedSectionIds] })),
    patchOperations: fixtureValue.stages.flatMap(stage => stage.operations),
    patchValidations: validations,
    semanticRecheckResults: options.semantic ?? [],
    resultingIssues: options.resultingIssues ?? [],
  }
}

describe('foundation revision publication', () => {
  test('writes PREPARED before atomically rolling forward every staged document', async () => {
    const value = await fixture()
    const result = await publishFoundationRevision(publishInput(value))
    expect(result.status).toBe('committed')
    expect(result.resultingRevision).toMatch(/^[a-f0-9]{64}$/)
    expect(result.resultingRevision).toBe(await computeDocumentRevision(value.workspace, confirmedBriefDigest))
    expect(await readFile(join(value.workspace, documentPath), 'utf8')).toContain('revised authority')
    expect(await readFile(join(value.workspace, foundationRevisionPreparedPath(revision)), 'utf8')).toContain('"status": "prepared"')
    expect(await readFile(join(value.workspace, foundationRevisionCommittedPath(revision)), 'utf8')).toContain('"status": "committed"')
    const committed = JSON.parse(await readFile(join(value.workspace, foundationRevisionCommittedPath(revision)), 'utf8'))
    expect(Object.keys(committed.documentDigests).sort()).toEqual([...CANONICAL_FOUNDATION_DOCUMENTS].sort())
  })

  test('publishes one admitted issue whose patch spans multiple sections', async () => {
    const value = await fixture()
    const stage = value.stages[0]!
    const contract = getGameDocumentContract(documentPath)
    const firstSectionId = contract.sections[0]!.sectionId
    const secondSectionId = contract.sections[1]!.sectionId
    const stagedPath = join(value.workspace, stage.receipt.stagedPath)
    const staged = (await readFile(stagedPath, 'utf8'))
      .replace(`original ${secondSectionId}`, `revised ${secondSectionId}`)
    await writeFile(stagedPath, staged)
    const { terminalDigest: _oldTerminalDigest, ...baseReceipt } = stage.receipt
    const receiptWithoutTerminal = {
      ...baseReceipt,
      stagedDocumentDigest: sha256(staged),
      changedSectionIds: [firstSectionId, secondSectionId],
    }
    const receipt = {
      ...receiptWithoutTerminal,
      terminalDigest: revisionTaskReceiptTerminalDigest(receiptWithoutTerminal),
    }
    const issue = revisionIssue(stage.receipt.issueIds[0]!, documentPath, firstSectionId)
    issue.remediation = {
      kind: 'patch',
      documentPath,
      sectionIds: [firstSectionId, secondSectionId],
    }
    const operations = await deriveFoundationPatchOperations({
      workspacePath: value.workspace,
      revision,
      batch: {
        documentPath,
        sectionIds: receipt.changedSectionIds,
        issueIds: receipt.issueIds,
      },
      issues: [issue],
      receipt,
    })

    await expect(publishFoundationRevision({
      workspacePath: value.workspace,
      revision,
      confirmedBriefDigest,
      round: 1,
      batches: [{
        documentPath,
        sectionIds: receipt.changedSectionIds,
        issueIds: receipt.issueIds,
      }],
      receipts: [receipt],
      revisionDeclarations: [{ status: 'APPLIED', changedSectionIds: receipt.changedSectionIds }],
      patchOperations: operations,
      patchValidations: [validation(documentPath, receipt, operations, receipt.issueIds[0]!)],
      semanticRecheckResults: [],
      resultingIssues: [],
    })).resolves.toMatchObject({ status: 'committed' })
  })

  test('publishes the final service-owned metadata bytes and digest', async () => {
    const value = await fixture([documentPath])
    const result = await publishFoundationRevision(publishInput(value))
    const canonical = await readFile(join(value.workspace, documentPath), 'utf8')
    expect(canonical).toContain('version: 1.0.1')
    expect(canonical).toContain('updated_at: 2026-08-12T17:00:00.001Z')
    expect(result.documentDigests[documentPath]).toBe(sha256(canonical))
    const prepared = JSON.parse(await readFile(join(value.workspace, foundationRevisionPreparedPath(revision)), 'utf8')) as { documents: Array<{ documentPath: string; stagedDocumentDigest: string }> }
    expect(prepared.documents.find(document => document.documentPath === documentPath)?.stagedDocumentDigest).toBe(sha256(canonical))
  })

  test('rejects forged service-owned metadata at the publication boundary', async () => {
    const value = await fixture([documentPath])
    const stage = value.stages[0]!
    const forged = (await readFile(join(value.workspace, stage.receipt.stagedPath), 'utf8'))
      .replace('updated_at: 2026-08-12T17:00:00.001Z', 'updated_at: 2099-01-01T00:00:00.000Z')
    await writeFile(join(value.workspace, stage.receipt.stagedPath), forged)
    const { terminalDigest: _terminalDigest, ...receiptCore } = stage.receipt
    const receiptWithoutTerminal = {
      ...receiptCore,
      stagedDocumentDigest: sha256(forged),
    }
    const receipt = {
      ...receiptWithoutTerminal,
      terminalDigest: revisionTaskReceiptTerminalDigest(receiptWithoutTerminal),
    }
    const operations = await deriveFoundationPatchOperations({
      workspacePath: value.workspace,
      revision,
      batch: stage.batch,
      issues: [revisionIssue('AUD-1', documentPath, stage.receipt.changedSectionIds[0]!)],
      receipt,
    })
    const input = publishInput(value, {
      validations: [validation(documentPath, receipt, operations, 'AUD-1')],
    })
    input.receipts = [receipt]
    input.revisionDeclarations = [{ status: 'APPLIED', changedSectionIds: [...receipt.changedSectionIds] }]
    input.patchOperations = operations
    await expect(publishFoundationRevision(input)).rejects.toThrow(/metadata/i)
  })

  test('persists an empty resulting issue registry through publication and recovery', async () => {
    const value = await fixture()
    const result = await publishFoundationRevision(publishInput(value))
    expect(result.resultingIssues).toEqual([])
    expect(Object.isFrozen(result.resultingIssues)).toBe(true)
    expect(result.resultingIssueRegistryDigest).toMatch(/^[a-f0-9]{64}$/)
    const prepared = JSON.parse(await readFile(join(value.workspace, foundationRevisionPreparedPath(revision)), 'utf8'))
    expect(prepared.resultingIssues).toEqual([])
    expect(prepared.resultingIssueRegistryDigest).toBe(result.resultingIssueRegistryDigest)
    const recovered = await recoverFoundationRevision({ workspacePath: value.workspace, revision })
    expect(recovered.resultingIssues).toEqual([])
    expect(recovered.resultingIssueRegistryDigest).toBe(result.resultingIssueRegistryDigest)
  })

  test('round-trips canonical resulting issues and reconstructs them from COMMITTED after recovery', async () => {
    const value = await fixture()
    const resultingIssues = [resultingIssue('NEXT-Z'), resultingIssue('NEXT-A', 'MEDIUM')]
    const result = await publishFoundationRevision(publishInput(value, { resultingIssues }))
    expect(result.resultingIssues.map(issue => issue.id)).toEqual(['NEXT-A', 'NEXT-Z'])
    expect(Object.isFrozen(result.resultingIssues)).toBe(true)
    expect(Object.isFrozen(result.resultingIssues[0])).toBe(true)
    const committed = JSON.parse(await readFile(join(value.workspace, foundationRevisionCommittedPath(revision)), 'utf8'))
    expect(committed.resultingIssueRegistryDigest).toBe(result.resultingIssueRegistryDigest)
    const recovered = await recoverFoundationRevision({ workspacePath: value.workspace, revision })
    expect(recovered.resultingIssues).toEqual(result.resultingIssues)
    expect(recovered.resultingIssueRegistryDigest).toBe(result.resultingIssueRegistryDigest)
    expect(Object.isFrozen(recovered.resultingIssues)).toBe(true)
  })

  test('loads a historical committed authority without comparing current canonical bytes', async () => {
    const value = await fixture()
    const resultingIssues = [resultingIssue('ROUND-2-HIGH')]
    const published = await publishFoundationRevision(publishInput(value, { resultingIssues }))
    await writeFile(join(value.workspace, documentPath), `${await readFile(join(value.workspace, documentPath), 'utf8')}\nhigher-round revision\n`)

    const historical = await loadCommittedFoundationRevisionAuthority({ workspacePath: value.workspace, revision })
    expect(historical.baseRevision).toBe(revision)
    expect(historical.resultingRevision).toBe(published.resultingRevision)
    expect(historical.resultingIssues).toEqual(resultingIssues)
    expect(historical.resultingIssueRegistryDigest).toBe(published.resultingIssueRegistryDigest)
  })

  test('rejects a tampered committed historical authority', async () => {
    const value = await fixture()
    await publishFoundationRevision(publishInput(value, { resultingIssues: [resultingIssue('ROUND-2-HIGH')] }))
    const committedPath = join(value.workspace, foundationRevisionCommittedPath(revision))
    const committed = JSON.parse(await readFile(committedPath, 'utf8')) as Record<string, unknown>
    committed.resultingIssueRegistryDigest = '0'.repeat(64)
    await writeFile(committedPath, JSON.stringify(committed))
    await expect(loadCommittedFoundationRevisionAuthority({ workspacePath: value.workspace, revision })).rejects.toThrow(/COMMITTED|authority|digest/i)
  })

  test('binds the resulting revision to unchanged canonical documents as well', async () => {
    const baseline = await fixture()
    const baselineResult = await publishFoundationRevision(publishInput(baseline))
    const changed = await fixture()
    const unrelatedPath = 'docs/ART_DIRECTION.md' as const
    const unrelated = await readFile(join(changed.workspace, unrelatedPath), 'utf8')
    await writeFile(join(changed.workspace, unrelatedPath), `${unrelated}\nunchanged-owner revision input`) 
    const changedResult = await publishFoundationRevision(publishInput(changed))
    expect(changedResult.resultingRevision).not.toBe(baselineResult.resultingRevision)
    expect(changedResult.documentDigests[unrelatedPath]).toBe(sha256(`${unrelated}\nunchanged-owner revision input`))
  })

  test('rejects stale canonical bytes and missing validation before PREPARED', async () => {
    const stale = await fixture()
    await writeFile(join(stale.workspace, documentPath), `${canonicalDocument()}\nstale`) 
    await expect(publishFoundationRevision(publishInput(stale))).rejects.toThrow(/stale|base|canonical/i)

    const missing = await fixture()
    await expect(publishFoundationRevision(publishInput(missing, { validations: [] }))).rejects.toThrow(/validation|coverage/i)

  })

  test('requires a semantic recheck result for uncovered semantic issue authority', async () => {
    const value = await fixture()
    const stage = value.stages[0]!
    await expect(publishFoundationRevision(publishInput(value, { validations: [] }))).rejects.toThrow(/coverage|validation/i)
    await expect(publishFoundationRevision(publishInput(value, { validations: [], semantic: [semanticResult(stage.receipt.issueIds[0]!)] }))).resolves.toMatchObject({ status: 'committed' })
  })

  test('does not create PREPARED or publish canonical bytes when PatchValidation fails', async () => {
    const value = await fixture()
    const before = await readFile(join(value.workspace, documentPath), 'utf8')
    const stage = value.stages[0]!
    const failed = validation(stage.receipt.documentPath, stage.receipt, stage.operations, stage.receipt.issueIds[0]!, 'FAIL')

    await expect(publishFoundationRevision(publishInput(value, {
      validations: [failed],
      resultingIssues: [resultingIssue('AUD-1')],
    }))).rejects.toThrow(/cannot publish|FAIL|validation/i)

    expect(await readFile(join(value.workspace, documentPath), 'utf8')).toBe(before)
    await expect(readFile(join(value.workspace, foundationRevisionPreparedPath(revision)), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('publication schema rejects UNDECIDABLE targeted semantic rechecks before PREPARED', async () => {
    const value = await fixture()
    const before = await readFile(join(value.workspace, documentPath), 'utf8')
    const stage = value.stages[0]!

    await expect(publishFoundationRevision(publishInput(value, {
      validations: [],
      semantic: [{ ...semanticResult(stage.receipt.issueIds[0]!), status: 'UNDECIDABLE' } as unknown as FoundationPublicationSemanticRecheckResult],
      resultingIssues: [resultingIssue('AUD-1')],
    }))).rejects.toThrow(/semantic recheck status is invalid/i)

    expect(await readFile(join(value.workspace, documentPath), 'utf8')).toBe(before)
    await expect(readFile(join(value.workspace, foundationRevisionPreparedPath(revision)), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('requires one APPLIED declaration for every active document receipt', async () => {
    const value = await fixture()
    await expect(publishFoundationRevision({
      ...publishInput(value),
      revisionDeclarations: [],
    })).rejects.toThrow(/declaration|coverage|APPLIED/i)
    await expect(readFile(join(value.workspace, foundationRevisionPreparedPath(revision)), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('rejects an APPLIED declaration whose receipt disagrees with the active batch', async () => {
    const value = await fixture()
    const stage = value.stages[0]!
    await expect(publishFoundationRevision({
      ...publishInput(value),
      revisionDeclarations: [{ status: 'APPLIED', changedSectionIds: ['rules_systems'] }],
    })).rejects.toThrow(/declaration|receipt|batch|section/i)
    await expect(readFile(join(value.workspace, foundationRevisionPreparedPath(revision)), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('rejects a stale receipt before PREPARED', async () => {
    const receipt = await fixture()
    const receiptStage = receipt.stages[0]!
    const staleReceipt = { ...receiptStage.receipt, stagedDocumentDigest: sha256('stale-stage') }
    await expect(publishFoundationRevision({ ...publishInput(receipt), receipts: [staleReceipt] })).rejects.toThrow(/receipt|stale|digest|canonical/i)
  })

  test('rejects a stale patch operation before PREPARED', async () => {
    const operation = await fixture()
    const staleOperation = { ...operation.stages[0]!.operations[0]!, ...(operation.stages[0]!.operations[0]!.kind === 'DELETE' ? { beforeDigest: sha256('stale-operation') } : { afterDigest: sha256('stale-operation') }) }
    await expect(publishFoundationRevision({ ...publishInput(operation), patchOperations: [staleOperation] })).rejects.toThrow(/operation|authority|digest|canonical/i)
  })

  test('recovers after a crash following one path and is idempotent thereafter', async () => {
    const value = await fixture([documentPath])
    const secondPath = 'docs/TECHNICAL_DESIGN.md' as const
    await mkdir(join(value.workspace, 'docs'), { recursive: true })
    await writeFile(join(value.workspace, secondPath), canonicalDocument(secondPath))
    const secondStage = await createFoundationRevisionStage({ workspacePath: value.workspace, revision, documentPath: secondPath })
    const secondOriginal = await readFile(join(value.workspace, secondStage.stagedPath), 'utf8')
    const secondStaged = secondOriginal
      .replace(`original ${getGameDocumentContract(secondPath).sections[0]!.sectionId}`, 'revised technical authority')
      .replace('version: 1.0.0', 'version: 1.0.1')
      .replace('updated_at: 2026-08-13T01:00:00.000+08:00', 'updated_at: 2026-08-12T17:00:00.001Z')
    await writeFile(join(value.workspace, secondStage.stagedPath), secondStaged)
    const secondIssue = 'AUD-2'
    const secondReceiptWithoutTerminal = {
      taskId: 'task-2', round: 1 as const, documentPath: secondPath, issueIds: [secondIssue],
      baseDocumentDigest: secondStage.baseDocumentDigest, stagedDocumentDigest: sha256(secondStaged),
      changedSectionIds: [getGameDocumentContract(secondPath).sections[0]!.sectionId], stagedPath: secondStage.stagedPath,
    }
    const secondReceipt = { ...secondReceiptWithoutTerminal, terminalDigest: revisionTaskReceiptTerminalDigest(secondReceiptWithoutTerminal) }
    const secondOperations = await deriveFoundationPatchOperations({ workspacePath: value.workspace, revision, batch: { documentPath: secondPath, sectionIds: secondReceipt.changedSectionIds, issueIds: [secondIssue] }, issues: [revisionIssue(secondIssue, secondPath, secondReceipt.changedSectionIds[0]!)], receipt: secondReceipt })
    const first = value
    const input = {
      workspacePath: value.workspace, revision, round: 1 as const,
      confirmedBriefDigest,
      batches: [first.stages[0]!.batch, { documentPath: secondPath, sectionIds: secondReceipt.changedSectionIds, issueIds: [secondIssue] }],
      receipts: [first.stages[0]!.receipt, secondReceipt],
      revisionDeclarations: [
        { status: 'APPLIED' as const, changedSectionIds: [...first.stages[0]!.receipt.changedSectionIds] },
        { status: 'APPLIED' as const, changedSectionIds: [...secondReceipt.changedSectionIds] },
      ],
      patchOperations: [...first.stages[0]!.operations, ...secondOperations],
      patchValidations: [validation(documentPath, first.stages[0]!.receipt, first.stages[0]!.operations, 'AUD-1'), validation(secondPath, secondReceipt, secondOperations, secondIssue)],
      semanticRecheckResults: [],
      resultingIssues: [],
    }
    let published = 0
    await expect(publishFoundationRevision({ ...input, onPathPublished: () => { published += 1; if (published === 1) throw new Error('simulated crash') } })).rejects.toThrow('simulated crash')
    const recovered = await recoverFoundationRevision({ workspacePath: value.workspace, revision, onPathPublished: () => { published += 1 } })
    expect(recovered).toMatchObject({ status: 'committed', resultingRevision: expect.any(String), patchOperations: input.patchOperations })
    const replayed = await recoverFoundationRevision({ workspacePath: value.workspace, revision })
    expect(replayed).toMatchObject({ status: 'committed', resultingRevision: recovered.resultingRevision, patchOperations: input.patchOperations })
    expect(published).toBe(2)
    expect(JSON.parse(await readFile(join(value.workspace, foundationRevisionJournalPath(revision)), 'utf8')).entries.every((entry: { status: string }) => entry.status === 'published')).toBe(true)
  })

  test('rejects a tampered journal and a second publication authority', async () => {
    const value = await fixture()
    const input = publishInput(value)
    await publishFoundationRevision(input)
    const journalPath = join(value.workspace, foundationRevisionJournalPath(revision))
    const journal = JSON.parse(await readFile(journalPath, 'utf8'))
    journal.authorityDigest = '0'.repeat(64)
    await writeFile(journalPath, JSON.stringify(journal))
    await expect(recoverFoundationRevision({ workspacePath: value.workspace, revision })).rejects.toThrow(/journal|authority/i)

    const fresh = await fixture()
    const altered = publishInput(fresh)
    altered.patchOperations[0] = { ...altered.patchOperations[0]!, issueIds: ['OTHER'] }
    await expect(publishFoundationRevision(altered)).rejects.toThrow(/authority|coverage|issue/i)
  })

  test('rejects failed authority before resulting Registry validation', async () => {
    const failed = await fixture()
    const failedStage = failed.stages[0]!
    const failedValidation = validation(failedStage.receipt.documentPath, failedStage.receipt, failedStage.operations, failedStage.receipt.issueIds[0]!, 'FAIL')
    await expect(publishFoundationRevision(publishInput(failed, { validations: [failedValidation], resultingIssues: [resultingIssue('AUD-1')] }))).rejects.toThrow(/cannot publish|FAIL/i)

    const pass = await fixture()
    await expect(publishFoundationRevision(publishInput(pass, { resultingIssues: [resultingIssue('AUD-1')] }))).rejects.toThrow(/overlap|PASS|issue/i)

    const missing = await fixture()
    await expect(publishFoundationRevision(publishInput(missing, { validations: [validation(missing.stages[0]!.receipt.documentPath, missing.stages[0]!.receipt, missing.stages[0]!.operations, 'AUD-1', 'FAIL')] }))).rejects.toThrow(/missing resulting|FAIL|issue/i)

    const duplicate = await fixture()
    await expect(publishFoundationRevision(publishInput(duplicate, { resultingIssues: [resultingIssue('NEXT'), resultingIssue('NEXT')] }))).rejects.toThrow(/duplicate|issue/i)

    const unsupported = await fixture()
    await expect(publishFoundationRevision(publishInput(unsupported, { resultingIssues: [{ ...resultingIssue('NEXT'), severity: 'UNKNOWN' } as unknown as AuditIssue] }))).rejects.toThrow(/severity|issue/i)
  })

  test('rejects tampering with resulting issues in PREPARED authority', async () => {
    const value = await fixture()
    await publishFoundationRevision(publishInput(value, { resultingIssues: [resultingIssue('NEXT')] }))
    const preparedPath = join(value.workspace, foundationRevisionPreparedPath(revision))
    const prepared = JSON.parse(await readFile(preparedPath, 'utf8'))
    prepared.resultingIssues[0].id = 'TAMPERED'
    await writeFile(preparedPath, JSON.stringify(prepared))
    await expect(recoverFoundationRevision({ workspacePath: value.workspace, revision })).rejects.toThrow(/authority|digest/i)
  })
})
