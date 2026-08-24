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
  publishFoundationRevision,
  recoverFoundationRevision,
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
  return `# ${path}\n\n${contract.sections.map(section => `<!-- beegame-section:${section.sectionId} -->\n## ${section.title}\n\noriginal ${section.sectionId}\n`).join('\n')}`
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
    const staged = original.replace(`original ${getGameDocumentContract(path).sections[0]!.sectionId}`, 'revised authority')
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
      issues: [{ id: issueId, fixDocument: path, fixSectionId: receipt.changedSectionIds[0] }] as never,
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
  return { issueId, packetDigest: sha256(`packet:${issueId}`), status }
}

function resultingIssue(id: string, severity: AuditIssue['severity'] = 'HIGH'): AuditIssue {
  return {
    id,
    severity,
    type: 'rule',
    source: { documentPath, sectionId: 'core_loop', heading: 'Core Loop', startLine: 1, endLine: 2, digest: sha256(`source:${id}`) },
    expected: 'expected',
    actual: 'actual',
    fixDocument: documentPath,
    fixSectionId: 'core_loop',
  }
}

function publishInput(fixtureValue: Awaited<ReturnType<typeof fixture>>, options: { validations?: PatchValidation[]; semantic?: FoundationSemanticRecheckResult[]; resultingIssues?: AuditIssue[] } = {}) {
  const validations = options.validations ?? fixtureValue.stages.map(stage => validation(stage.receipt.documentPath, stage.receipt, stage.operations, stage.receipt.issueIds[0]!))
  return {
    workspacePath: fixtureValue.workspace,
    revision,
    confirmedBriefDigest,
    round: 1 as const,
    batches: fixtureValue.stages.map(stage => stage.batch),
    receipts: fixtureValue.stages.map(stage => stage.receipt),
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

  test('rejects stale canonical bytes and missing or failed validation before PREPARED', async () => {
    const stale = await fixture()
    await writeFile(join(stale.workspace, documentPath), `${canonicalDocument()}\nstale`) 
    await expect(publishFoundationRevision(publishInput(stale))).rejects.toThrow(/stale|base|canonical/i)

    const missing = await fixture()
    await expect(publishFoundationRevision(publishInput(missing, { validations: [] }))).rejects.toThrow(/validation|coverage/i)

    const failed = await fixture()
    const stage = failed.stages[0]!
    await expect(publishFoundationRevision(publishInput(failed, { validations: [validation(stage.receipt.documentPath, stage.receipt, stage.operations, stage.receipt.issueIds[0]!, 'FAIL')] }))).rejects.toThrow(/FAIL|validation/i)
  })

  test('requires a semantic recheck result for uncovered semantic issue authority', async () => {
    const value = await fixture()
    const stage = value.stages[0]!
    await expect(publishFoundationRevision(publishInput(value, { validations: [] }))).rejects.toThrow(/coverage|validation/i)
    await expect(publishFoundationRevision(publishInput(value, { validations: [], semantic: [semanticResult(stage.receipt.issueIds[0]!)] }))).resolves.toMatchObject({ status: 'committed' })
  })

  test('recovers after a crash following one path and is idempotent thereafter', async () => {
    const value = await fixture([documentPath])
    const secondPath = 'docs/TECHNICAL_DESIGN.md' as const
    await mkdir(join(value.workspace, 'docs'), { recursive: true })
    await writeFile(join(value.workspace, secondPath), canonicalDocument(secondPath))
    const secondStage = await createFoundationRevisionStage({ workspacePath: value.workspace, revision, documentPath: secondPath })
    const secondOriginal = await readFile(join(value.workspace, secondStage.stagedPath), 'utf8')
    const secondStaged = secondOriginal.replace(`original ${getGameDocumentContract(secondPath).sections[0]!.sectionId}`, 'revised technical authority')
    await writeFile(join(value.workspace, secondStage.stagedPath), secondStaged)
    const secondIssue = 'AUD-2'
    const secondReceiptWithoutTerminal = {
      taskId: 'task-2', round: 1 as const, documentPath: secondPath, issueIds: [secondIssue],
      baseDocumentDigest: secondStage.baseDocumentDigest, stagedDocumentDigest: sha256(secondStaged),
      changedSectionIds: [getGameDocumentContract(secondPath).sections[0]!.sectionId], stagedPath: secondStage.stagedPath,
    }
    const secondReceipt = { ...secondReceiptWithoutTerminal, terminalDigest: revisionTaskReceiptTerminalDigest(secondReceiptWithoutTerminal) }
    const secondOperations = await deriveFoundationPatchOperations({ workspacePath: value.workspace, revision, batch: { documentPath: secondPath, sectionIds: secondReceipt.changedSectionIds, issueIds: [secondIssue] }, issues: [{ id: secondIssue, fixDocument: secondPath, fixSectionId: secondReceipt.changedSectionIds[0] }] as never, receipt: secondReceipt })
    const first = value
    const input = {
      workspacePath: value.workspace, revision, round: 1 as const,
      confirmedBriefDigest,
      batches: [first.stages[0]!.batch, { documentPath: secondPath, sectionIds: secondReceipt.changedSectionIds, issueIds: [secondIssue] }],
      receipts: [first.stages[0]!.receipt, secondReceipt],
      patchOperations: [...first.stages[0]!.operations, ...secondOperations],
      patchValidations: [validation(documentPath, first.stages[0]!.receipt, first.stages[0]!.operations, 'AUD-1'), validation(secondPath, secondReceipt, secondOperations, secondIssue)],
      semanticRecheckResults: [],
      resultingIssues: [],
    }
    let published = 0
    await expect(publishFoundationRevision({ ...input, onPathPublished: () => { published += 1; if (published === 1) throw new Error('simulated crash') } })).rejects.toThrow('simulated crash')
    await expect(recoverFoundationRevision({ workspacePath: value.workspace, revision })).resolves.toMatchObject({ status: 'committed', resultingRevision: expect.any(String) })
    await expect(recoverFoundationRevision({ workspacePath: value.workspace, revision })).resolves.toMatchObject({ status: 'committed', resultingRevision: expect.any(String) })
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

  test('rejects resulting issue overlap, duplicates, and unsupported severity', async () => {
    const overlap = await fixture()
    await expect(publishFoundationRevision(publishInput(overlap, { resultingIssues: [resultingIssue('AUD-1')] }))).rejects.toThrow(/overlap|resolved|issue/i)

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
