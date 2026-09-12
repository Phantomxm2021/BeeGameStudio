import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { authorDigest } from './contract'
import { createAuthorAcceptanceJournal, type AuthorAcceptanceJournalBinding } from './acceptance-journal'
import { createAuthorPersistence } from './persistence'
import { foundationAuthoringSources } from './domain/foundation-authoring-contract'
import { type AuthoredDocumentReceipt } from './domain/authored-document-receipt'
import { type DispatchRecord, type FoundationDocumentPath } from './domain/types'

const path: FoundationDocumentPath = 'docs/GDD.md'
const brief = 'Acceptance journal brief'
const briefDigest = createHash('sha256').update(brief).digest('hex')

async function fixture(runId = '550e8400-e29b-41d4-a716-446655440000') {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'foundation-author-acceptance-')))
  const binding: AuthorAcceptanceJournalBinding = {
    runId, ownerId: 'owner', projectId: 'project', inputDigest: 'a'.repeat(64),
    confirmedBriefDigest: briefDigest, workspacePath,
  }
  const dispatchId = 'dispatch-1'
  const request = {
    runId, dispatchId, ownerId: 'owner', projectId: 'project', workspacePath,
    workerType: 'document-author' as const, phase: 'DOCUMENT_DRAFTING' as const,
    taskId: path, revision: 'revision-1', allowedPaths: [path],
    contract: {
      confirmedBriefDigest: briefDigest, confirmedBriefContext: brief,
      documentSet: 'foundation' as const, authoringMode: 'initial' as const,
      foundationDocumentPath: path,
      availableUpstreamPaths: foundationAuthoringSources(path).map(source => source.path),
    },
  }
  const record: DispatchRecord = {
    dispatchId, workerType: 'document-author', phase: 'DOCUMENT_DRAFTING', taskId: path,
    revision: 'revision-1', status: 'running', request,
    startedAt: '2026-09-05T00:00:00.000Z',
  }
  const receipt: AuthoredDocumentReceipt = {
    schemaVersion: 5, dispatchId, targetPath: path, finalDigest: 'b'.repeat(64),
    byteLength: 12, documentId: 'GDD', version: '1.0.0',
    updatedAt: '2026-09-05T00:00:00.000Z', status: 'committed',
  }
  return { workspacePath, binding, record, receipt }
}

describe('immutable author acceptance journal', () => {
  test('legacy Audio proofs retain their exact old upstream set; v2 cannot reuse that narrower contract', async () => {
    const f = await fixture()
    try {
      const audio = 'docs/AUDIO_DESIGN.md' as const
      f.record.taskId = audio
      f.record.request!.taskId = audio
      f.record.request!.allowedPaths = [audio]
      Object.assign(f.record.request!.contract, { foundationDocumentPath: audio, authoringMode: 'parallel-draft',
        availableUpstreamPaths: ['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md', 'docs/UI_UX_SPEC.md'] })
      f.receipt.targetPath = audio; f.receipt.documentId = 'AUDIO_DESIGN'
      const journal = createAuthorAcceptanceJournal(createAuthorPersistence({ rootPath: join(f.workspacePath, 'journal') }), f.binding)
      await journal.accept(f.record, f.receipt)
      await journal.validate(audio, f.record.dispatchId, f.receipt)
      f.record.request!.contract.authorBodyVersion = 'foundation-author-body.v2'
      await expect(journal.accept(f.record, f.receipt)).rejects.toThrow('upstream source set')
    } finally { await rm(f.workspacePath, { recursive: true, force: true }) }
  })
  test('accepts and validates an exact committed dispatch proof, including replay', async () => {
    const fixtureValue = await fixture()
    try {
      const store = createAuthorPersistence({ rootPath: join(fixtureValue.workspacePath, 'journal') })
      const journal = createAuthorAcceptanceJournal(store, fixtureValue.binding)
      await journal.accept(fixtureValue.record, fixtureValue.receipt)
      await journal.accept(structuredClone(fixtureValue.record), structuredClone(fixtureValue.receipt))
      await journal.validate(path, fixtureValue.record.dispatchId, fixtureValue.receipt)
    } finally { await rm(fixtureValue.workspacePath, { recursive: true, force: true }) }
  })

  test('rejects a same-path conflicting dispatch or receipt and a missing proof', async () => {
    const fixtureValue = await fixture()
    try {
      const store = createAuthorPersistence({ rootPath: join(fixtureValue.workspacePath, 'journal') })
      const journal = createAuthorAcceptanceJournal(store, fixtureValue.binding)
      await journal.accept(fixtureValue.record, fixtureValue.receipt)
      const conflict = structuredClone(fixtureValue.record)
      conflict.request!.revision = 'revision-2'
      await expect(journal.accept(conflict, fixtureValue.receipt)).rejects.toThrow(/record binding/)
      const changedReceipt = { ...fixtureValue.receipt, finalDigest: 'c'.repeat(64) }
      await expect(journal.accept(fixtureValue.record, changedReceipt)).rejects.toThrow(/conflicts/)
      await expect(journal.validate(path, fixtureValue.record.dispatchId, changedReceipt)).rejects.toThrow(/does not match receipt/)
      const missingReceipt = { ...fixtureValue.receipt, dispatchId: 'dispatch-2', targetPath: 'docs/LEVEL_SCENE_DESIGN.md' as const, documentId: 'LEVEL_SCENE_DESIGN' }
      await expect(journal.validate('docs/LEVEL_SCENE_DESIGN.md', 'dispatch-2', missingReceipt)).rejects.toThrow(/missing/)
    } finally { await rm(fixtureValue.workspacePath, { recursive: true, force: true }) }
  })

  test('keeps identical body/receipt data isolated across runs', async () => {
    const first = await fixture()
    const second = await fixture('660e8400-e29b-41d4-a716-446655440000')
    try {
      const root = join(first.workspacePath, 'journal')
      const firstJournal = createAuthorAcceptanceJournal(createAuthorPersistence({ rootPath: root }), first.binding)
      const secondJournal = createAuthorAcceptanceJournal(createAuthorPersistence({ rootPath: root }), second.binding)
      await firstJournal.accept(first.record, first.receipt)
      await expect(secondJournal.validate(path, second.record.dispatchId, second.receipt)).rejects.toThrow(/missing/)
      await secondJournal.accept(second.record, second.receipt)
      await secondJournal.validate(path, second.record.dispatchId, second.receipt)
    } finally {
      await rm(first.workspacePath, { recursive: true, force: true })
      await rm(second.workspacePath, { recursive: true, force: true })
    }
  })

  test('rejects tampered request identity and receipt identity before persistence', async () => {
    const fixtureValue = await fixture()
    try {
      const store = createAuthorPersistence({ rootPath: join(fixtureValue.workspacePath, 'journal') })
      const journal = createAuthorAcceptanceJournal(store, fixtureValue.binding)
      const foreign = structuredClone(fixtureValue.record)
      foreign.request!.ownerId = 'foreign-owner'
      await expect(journal.accept(foreign, fixtureValue.receipt)).rejects.toThrow(/binding/)
      const foreignReceipt = { ...fixtureValue.receipt, dispatchId: 'foreign-dispatch' }
      await expect(journal.accept(fixtureValue.record, foreignReceipt)).rejects.toThrow(/match/)
    } finally { await rm(fixtureValue.workspacePath, { recursive: true, force: true }) }
  })

  test('binds record metadata exactly and rejects invalid mode, status, and deprecated state', async () => {
    const fixtureValue = await fixture()
    try {
      const store = createAuthorPersistence({ rootPath: join(fixtureValue.workspacePath, 'journal') })
      const journal = createAuthorAcceptanceJournal(store, fixtureValue.binding)
      const mismatched = structuredClone(fixtureValue.record)
      mismatched.phase = 'DOCUMENT_DRAFTING' as const
      mismatched.revision = 'different-revision'
      await expect(journal.accept(mismatched, fixtureValue.receipt)).rejects.toThrow(/record binding/)
      const invalidStatus = structuredClone(fixtureValue.record)
      invalidStatus.status = 'failed'
      await expect(journal.accept(invalidStatus, fixtureValue.receipt)).rejects.toThrow(/record binding/)
      const parallelGdd = structuredClone(fixtureValue.record)
      ;(parallelGdd.request!.contract as Record<string, unknown>).authoringMode = 'parallel-draft'
      await expect(journal.accept(parallelGdd, fixtureValue.receipt)).rejects.toThrow(/parallel dispatch path/)
      const deprecated = structuredClone(fixtureValue.record)
      ;(deprecated.request!.contract as Record<string, unknown>).priorFailureReason = 'old failure'
      await expect(journal.accept(deprecated, fixtureValue.receipt)).rejects.toThrow(/deprecated/)
    } finally { await rm(fixtureValue.workspacePath, { recursive: true, force: true }) }
  })

  test('rejects an entry whose persisted path is changed under the canonical key', async () => {
    const fixtureValue = await fixture()
    try {
      const store = createAuthorPersistence({ rootPath: join(fixtureValue.workspacePath, 'journal') })
      const journal = createAuthorAcceptanceJournal(store, fixtureValue.binding)
      await journal.accept(fixtureValue.record, fixtureValue.receipt)
      const key = authorDigest(['author-accepted', fixtureValue.binding.runId, path])
      const stored = await store.load<Record<string, unknown>>(key)
      await store.save(key, { ...stored, path: 'docs/LEVEL_SCENE_DESIGN.md' })
      await expect(journal.validate(path, fixtureValue.record.dispatchId, fixtureValue.receipt)).rejects.toThrow(/does not match receipt/)
    } finally { await rm(fixtureValue.workspacePath, { recursive: true, force: true }) }
  })
})
