import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../../../foundation-documents'
import { foundationPublicDigest } from '../../../foundation-public-result'
import type { FoundationIrInput } from '../input'
import { foundationReadyReceiptFromInput } from './core/source-input'
import type { GameIrCompilationIdentity } from './core/protocol'
import { compileGameIr } from './compiler'

const sha = (value: string): string => createHash('sha256').update(value).digest('hex')
function fixture(): FoundationIrInput {
  const content = '# Fixture\n\nCaptured source.\n', digest = sha(content)
  const documents = CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({ path, content, digest,
    byteLength: Buffer.byteLength(content), sections: [{ ordinal: 0, kind: 'heading' as const,
      headingLevel: 1, headingText: 'Fixture', startByte: 0, endByte: Buffer.byteLength(content), digest }] }))
  const documentSetDigest = foundationPublicDigest(documents.map(document => [document.path, document.digest]))
  return { protocolVersion: 1, ownerId: 'owner', projectId: 'project', foundationResultId: sha('result'),
    foundationResultDigest: sha('result-digest'), publishedDocumentRevision: documentSetDigest, documentSetDigest,
    confirmedBriefDigest: sha('brief'), confirmedRequirementsDigest: sha('brief'), documents,
    sourceIndexDigest: foundationPublicDigest(documents.map(document => ({ path: document.path, digest: document.digest,
      byteLength: document.byteLength, sections: document.sections }))) }
}
function identity(source: FoundationIrInput): GameIrCompilationIdentity {
  const receipt = foundationReadyReceiptFromInput(source)
  return { runId: 'run', taskId: 'task', publicationId: 'publication', confirmedBriefDigest: receipt.confirmedBriefDigest,
    foundationRevision: receipt.foundationRevision, foundationReadyReceiptDigest: receipt.receiptDigest }
}

test('runs one direct CLI generation and preserves its validation error', async () => {
  const source = fixture(), id = identity(source), workspacePath = await mkdtemp(join('/private/tmp', 'direct-ir-'))
  let calls = 0
  try {
    const execute = async () => { calls += 1; return 'not-json' }
    const result = await compileGameIr({ workspacePath, identity: id, foundationInput: source, execute })
    expect(result.status).toBe('needs_action'); expect(calls).toBe(1)
    expect(result.status === 'needs_action' ? result.diagnostic.reason : '').toContain('Unexpected identifier')
    const repeated = await compileGameIr({ workspacePath, identity: id, foundationInput: source, execute })
    expect(repeated.status).toBe('needs_action'); expect(calls).toBe(1)
    expect(repeated.status === 'needs_action' ? repeated.diagnostic.reason : '').toContain('Unexpected identifier')
  } finally { await rm(workspacePath, { recursive: true, force: true }) }
})

test('checks cancellation before starting the CLI compile', async () => {
  const source = fixture(), id = identity(source), workspacePath = await mkdtemp(join('/private/tmp', 'direct-ir-stop-'))
  const controller = new AbortController(); controller.abort(); let calls = 0
  try {
    await expect(compileGameIr({ workspacePath, identity: id, foundationInput: source, signal: controller.signal,
      execute: async () => { calls += 1; return '{}' } })).rejects.toMatchObject({ name: 'AbortError' })
    expect(calls).toBe(0)
  } finally { await rm(workspacePath, { recursive: true, force: true }) }
})
