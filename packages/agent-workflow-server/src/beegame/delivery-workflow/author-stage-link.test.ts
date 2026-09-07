import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import { createInitialDeliveryRun } from './run-store'
import { parseDeliveryRun } from './schema'
import { CANONICAL_FOUNDATION_DOCUMENTS, type AuthorStageLink, type DeliveryRun } from './types'

const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const brief = 'A confirmed authoring brief.'
const briefDigest = digest(brief)
const inputDigest = '1'.repeat(64)
const documentDigest = '2'.repeat(64)
const handle = {
  protocolVersion: 1 as const,
  producer: 'foundation-authoring' as const,
  id: '550e8400-e29b-41d4-a716-446655440000',
}

function result(overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: 1 as const,
    producer: 'foundation-authoring' as const,
    kind: 'foundation_documents' as const,
    resultId: '3'.repeat(64),
    inputDigest,
    ownerId: 'owner-1',
    projectId: 'project-1',
    confirmedBriefDigest: briefDigest,
    documents: CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({
      path,
      digest: documentDigest,
      byteLength: 12,
      artifactPath: `.beegame/workflow/foundation-authoring/artifacts/result/${path}`,
    })),
    documentRevision: 'document-revision-1',
    workspaceRevision: 'workspace-revision-1',
    receiptSetDigest: '4'.repeat(64),
    ...overrides,
  }
}

function baseRun(overrides: Partial<DeliveryRun> = {}): DeliveryRun {
  return {
    ...createInitialDeliveryRun({
      runId: 'run-1',
      ownerId: 'owner-1',
      projectId: 'project-1',
      confirmedBriefContext: brief,
      confirmedBriefDigest: briefDigest,
    }),
    phase: 'DOCUMENT_REVIEW',
    documentStep: 'FOUNDATION_REVIEW',
    foundationDraftState: { completedPaths: [] },
    ...overrides,
  }
}

function link(overrides: Partial<AuthorStageLink> = {}): AuthorStageLink {
  return {
    protocolVersion: 1,
    requestId: 'author-request-1',
    inputDigest,
    status: 'completed',
    handle,
    result: result(),
    control: { sequence: 1, action: 'run', requestId: 'author-request-1' },
    ...overrides,
  }
}

describe('public author stage link persistence', () => {
  test('accepts completed public author result with legacy draft state empty', () => {
    expect(parseDeliveryRun(baseRun({ authorStage: link() }))).toMatchObject({
      authorStage: { status: 'completed', result: { documents: { length: 8 } } },
    })
  })

  test('rejects extra fields and incomplete public result documents', () => {
    expect(() => parseDeliveryRun(baseRun({ authorStage: { ...link(), unexpected: true } as never }))).toThrow()
    expect(() => parseDeliveryRun(baseRun({ authorStage: link({ result: result({ documents: [] }) }) }))).toThrow()
    expect(() => parseDeliveryRun(baseRun({ authorStage: link({ result: result({ ownerId: 'foreign-owner' }) }) }))).toThrow(/owner/)
  })

  test('rejects missing required handle/result and foreign result bindings', () => {
    expect(() => parseDeliveryRun(baseRun({ authorStage: link({ status: 'running', handle: undefined, result: undefined }) }))).toThrow(/handle/)
    expect(() => parseDeliveryRun(baseRun({ authorStage: link({ result: result({ inputDigest: 'f'.repeat(64) }) }) }))).toThrow(/input digest/)
    expect(() => parseDeliveryRun(baseRun({ authorStage: link({ result: result({ projectId: 'foreign-project' }) }) }))).toThrow(/project/)
    expect(() => parseDeliveryRun(baseRun({ authorStage: link({ result: result({ confirmedBriefDigest: 'f'.repeat(64) }) }) }))).toThrow(/brief/)
  })

  test('rejects dual authority with legacy author dispatch or checkpoints', () => {
    const legacyDispatch = {
      dispatchId: 'dispatch-1', workerType: 'document-author', phase: 'DOCUMENT_DRAFTING',
      revision: 'revision-1', status: 'running', startedAt: '2026-09-05T00:00:00.000Z',
    } as const
    expect(() => parseDeliveryRun(baseRun({ authorStage: link(), activeDispatch: legacyDispatch }))).toThrow(/legacy author dispatch/)
    expect(() => parseDeliveryRun(baseRun({ authorStage: link(), foundationDraftState: { completedPaths: ['docs/GDD.md'] } }))).toThrow(/legacy author checkpoints/)
    expect(() => parseDeliveryRun(baseRun({ authorStage: link(), foundationDraftState: { completedPaths: [], documents: [{ path: 'docs/GDD.md', status: 'pending' }] } }))).toThrow(/legacy author documents/)
  })

  test('allows stop-before-start and failed public control points without a handle', () => {
    expect(parseDeliveryRun(baseRun({ phase: 'DOCUMENT_DRAFTING', documentStep: 'FOUNDATION_DRAFTING', authorStage: link({ status: 'stopped', handle: undefined, result: undefined, control: { sequence: 1, action: 'stop', requestId: 'author-request-1', reason: 'stop-before-start' } }) }))).toMatchObject({ authorStage: { status: 'stopped' } })
    expect(parseDeliveryRun(baseRun({ phase: 'DOCUMENT_DRAFTING', documentStep: 'FOUNDATION_DRAFTING', authorStage: link({ status: 'failed', handle: undefined, result: undefined, control: { sequence: 1, action: 'run', requestId: 'author-request-1' } }) }))).toMatchObject({ authorStage: { status: 'failed' } })
    expect(() => parseDeliveryRun(baseRun({ phase: 'DOCUMENT_DRAFTING', documentStep: 'FOUNDATION_DRAFTING', authorStage: link({ status: 'stopped', handle: undefined, result: undefined, control: { sequence: 1, action: 'run', requestId: 'author-request-1' } }) }))).toThrow(/stop-before-start/)
  })
})
