import { describe, expect, test } from 'bun:test'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, realpath, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { authorDigest, type AuthorHandle, type AuthorStartInput } from './contract'
import { parseAuthorCheckpoint, type AuthorCheckpoint, type Registration } from './checkpoint'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './domain/types'
import { foundationAuthoringSources } from './domain/foundation-authoring-contract'
import { createAuthorPersistence } from './persistence'
import { createAuthorAcceptanceJournal } from './acceptance-journal'

const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const handle: AuthorHandle = { protocolVersion: 1, producer: 'foundation-authoring', id: '550e8400-e29b-41d4-a716-446655440000' }
const brief = 'Checkpoint test brief'
const start: AuthorStartInput = {
  protocolVersion: 1, requestId: 'start-1', ownerId: 'owner', projectId: 'project',
  input: { confirmedBrief: brief, confirmedBriefDigest: digest(brief) },
  inputDigest: authorDigest({ ownerId: 'owner', projectId: 'project', input: { confirmedBrief: brief, confirmedBriefDigest: digest(brief) } }),
}

async function rootFixture(): Promise<{ workspace: string; registration: Registration }> {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), 'foundation-author-checkpoint-')))
  return { workspace, registration: { handle, start, createdAt: '2026-09-05T00:00:00.000Z', workspacePath: workspace } }
}

function baseCheckpoint(registration: Registration): AuthorCheckpoint {
  return {
    registration,
    context: {
      runId: handle.id, ownerId: 'owner', projectId: 'project', confirmedBriefDigest: digest(brief), confirmedBriefContext: brief,
      phase: 'DOCUMENT_DRAFTING', documentStep: 'FOUNDATION_DRAFTING', status: 'running', foundationDraftState: { completedPaths: [] },
      revision: { document: 'd'.repeat(64), workspace: 'w'.repeat(64) }, updatedAt: '2026-09-05T00:00:00.000Z',
    },
    appliedSequence: 0, acceptedDispatches: {}, sessions: {}, usage: {},
  }
}

function completedCheckpoint(registration: Registration, workspace: string): AuthorCheckpoint {
  const body = '# stable body\n'
  const acceptedDispatches: Record<string, string> = {}
  const receipts = CANONICAL_FOUNDATION_DOCUMENTS.map((path, index) => {
    const dispatchId = `${String(index + 1).padStart(2, '0')}-${'a'.repeat(8)}`
    acceptedDispatches[path] = dispatchId
    return {
      schemaVersion: 5 as const, dispatchId, targetPath: path, finalDigest: digest(body), byteLength: Buffer.byteLength(body),
      documentId: path.slice(5, -3), version: '1.0.0' as const, updatedAt: '2026-09-05T00:00:00.000Z', status: 'committed' as const,
    }
  })
  const receiptSetDigest = authorDigest(receipts)
  const resultId = authorDigest({ producer: 'foundation-authoring', inputDigest: start.inputDigest, receiptSetDigest })
  const documents = CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({
    path, digest: digest(body), byteLength: Buffer.byteLength(body), artifactPath: `.beegame/workflow/foundation-authoring/artifacts/${resultId}/${path}`,
  }))
  const context = {
    ...baseCheckpoint(registration).context,
    phase: 'DOCUMENT_REVIEW' as const, documentStep: 'FOUNDATION_REVIEW' as const, status: 'completed' as const,
    foundationDraftState: {
      completedPaths: [...CANONICAL_FOUNDATION_DOCUMENTS],
      documents: CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({ path, status: 'committed' as const })),
    },
  }
  return {
    registration, context, appliedSequence: 0, acceptedDispatches, sessions: {}, usage: {},
    result: { protocolVersion: 1, producer: 'foundation-authoring', kind: 'foundation_documents', resultId, inputDigest: start.inputDigest,
      ownerId: 'owner', projectId: 'project', confirmedBriefDigest: start.input.confirmedBriefDigest, documents,
      documentRevision: 'e'.repeat(64), workspaceRevision: 'f'.repeat(64), receiptSetDigest },
  }
}

async function writeCompletedProof(workspace: string, checkpoint: AuthorCheckpoint): Promise<void> {
  const body = '# stable body\n'
  for (const [path, dispatchId] of Object.entries(checkpoint.acceptedDispatches)) {
    const receiptPath = join(workspace, '.beegame/workflow/foundation-authoring/receipts', `${dispatchId}.json`)
    await mkdir(join(workspace, '.beegame/workflow/foundation-authoring/receipts'), { recursive: true })
    await writeFile(receiptPath, JSON.stringify({ schemaVersion: 5, dispatchId, targetPath: path, finalDigest: digest(body), byteLength: Buffer.byteLength(body), documentId: path.slice(5, -3), version: '1.0.0', updatedAt: '2026-09-05T00:00:00.000Z', status: 'committed' }))
    const artifact = checkpoint.result!.documents.find(value => value.path === path)!.artifactPath
    await mkdir(join(workspace, artifact, '..'), { recursive: true })
    await writeFile(join(workspace, artifact), body)
  }
}

async function acceptanceJournalFor(checkpoint: AuthorCheckpoint): Promise<ReturnType<typeof createAuthorAcceptanceJournal>> {
  const { registration, context } = checkpoint
  const store = createAuthorPersistence({ rootPath: join(registration.workspacePath, '.acceptance-journal') })
  const journal = createAuthorAcceptanceJournal(store, {
    runId: context.runId, ownerId: context.ownerId, projectId: context.projectId,
    inputDigest: registration.start.inputDigest, confirmedBriefDigest: context.confirmedBriefDigest,
    workspacePath: registration.workspacePath,
  })
  for (const path of Object.keys(checkpoint.acceptedDispatches) as Array<typeof CANONICAL_FOUNDATION_DOCUMENTS[number]>) {
    const dispatchId = checkpoint.acceptedDispatches[path]
    const request = {
      runId: context.runId, dispatchId, ownerId: context.ownerId, projectId: context.projectId,
      workspacePath: registration.workspacePath, workerType: 'document-author' as const,
      phase: 'DOCUMENT_DRAFTING' as const, taskId: path, revision: context.revision.document,
      allowedPaths: [path], contract: {
        confirmedBriefDigest: context.confirmedBriefDigest, confirmedBriefContext: context.confirmedBriefContext,
        documentSet: 'foundation' as const,
        authoringMode: path === CANONICAL_FOUNDATION_DOCUMENTS[0] ? 'initial' as const : 'parallel-draft' as const,
        foundationDocumentPath: path,
        availableUpstreamPaths: foundationAuthoringSources(path).map(source => source.path),
      },
    }
    const receipt = JSON.parse(await readFile(join(registration.workspacePath, '.beegame/workflow/foundation-authoring/receipts', `${dispatchId}.json`), 'utf8'))
    await journal.accept({ dispatchId, workerType: 'document-author', phase: 'DOCUMENT_DRAFTING', taskId: path,
      revision: context.revision.document, status: 'running', request, startedAt: '2026-09-05T00:00:00.000Z' }, receipt)
  }
  return journal
}

describe('strict author checkpoint parser', () => {
  test('reads a legacy running Audio dispatch without granting the same upstream exception to v2', async () => {
    const f = await rootFixture()
    try {
      const checkpoint = baseCheckpoint(f.registration)
      const audio = 'docs/AUDIO_DESIGN.md' as const
      const dispatchId = 'legacy-audio'
      checkpoint.context.foundationDraftState.documents = CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({ path, status: 'pending' }))
      const document = checkpoint.context.foundationDraftState.documents.find(document => document.path === audio)!
      document.status = 'drafting'
      document.dispatch = { dispatchId, workerType: 'document-author', phase: 'DOCUMENT_DRAFTING', taskId: audio,
        revision: checkpoint.context.revision.document, status: 'running', startedAt: '2026-09-05T00:00:00.000Z',
        request: { runId: handle.id, dispatchId, ownerId: 'owner', projectId: 'project', workspacePath: f.workspace,
          workerType: 'document-author', phase: 'DOCUMENT_DRAFTING', taskId: audio, revision: checkpoint.context.revision.document,
          allowedPaths: [audio], contract: { confirmedBriefDigest: digest(brief), confirmedBriefContext: brief, documentSet: 'foundation',
            authoringMode: 'parallel-draft', foundationDocumentPath: audio,
            availableUpstreamPaths: ['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md', 'docs/UI_UX_SPEC.md'] } } }
      await expect(parseAuthorCheckpoint(checkpoint, { handle, workspacePath: f.workspace })).resolves.toEqual(checkpoint)
      document.dispatch.request!.contract.authorBodyVersion = 'foundation-author-body.v2'
      await expect(parseAuthorCheckpoint(checkpoint, { handle, workspacePath: f.workspace })).rejects.toThrow('upstream source set')
    } finally { await rm(f.workspace, { recursive: true, force: true }) }
  })
  test('preserves out-of-order parallel commits beyond the canonical completed prefix', async () => {
    const fixture = await rootFixture()
    try {
      const checkpoint = completedCheckpoint(fixture.registration, fixture.workspace)
      await writeCompletedProof(fixture.workspace, checkpoint)
      await expect(parseAuthorCheckpoint(checkpoint, { handle, workspacePath: fixture.workspace })).rejects.toThrow(/acceptance proof/)
      const acceptanceJournal = await acceptanceJournalFor(checkpoint)
      await mkdir(join(fixture.workspace, 'docs'), { recursive: true })
      for (const path of CANONICAL_FOUNDATION_DOCUMENTS) await writeFile(join(fixture.workspace, path), '# stable body\n')
      checkpoint.result = undefined
      checkpoint.context.phase = 'DOCUMENT_DRAFTING'
      checkpoint.context.documentStep = 'FOUNDATION_DRAFTING'
      checkpoint.context.status = 'running'
      checkpoint.context.foundationDraftState.documents![2]!.status = 'pending'
      checkpoint.context.foundationDraftState.completedPaths = [...CANONICAL_FOUNDATION_DOCUMENTS.slice(0, 2)]
      delete checkpoint.acceptedDispatches['docs/BALANCE_DESIGN.md']
      await expect(parseAuthorCheckpoint(checkpoint, { handle, workspacePath: fixture.workspace, acceptanceJournal })).resolves.toEqual(expect.any(Object))
    } finally { await rm(fixture.workspace, { recursive: true, force: true }) }
  })
  test('accepts a minimal unfinished checkpoint', async () => {
    const fixture = await rootFixture()
    try { await expect(parseAuthorCheckpoint(baseCheckpoint(fixture.registration), { handle, workspacePath: fixture.workspace })).resolves.toEqual(expect.any(Object)) }
    finally { await rm(fixture.workspace, { recursive: true, force: true }) }
  })

  test('rejects tampered handle, producer, extra workflow fields, and foreign dispatch', async () => {
    const fixture = await rootFixture()
    try {
      const checkpoint = baseCheckpoint(fixture.registration)
      await expect(parseAuthorCheckpoint({ ...checkpoint, unexpected: true }, { handle, workspacePath: fixture.workspace })).rejects.toThrow()
      await expect(parseAuthorCheckpoint({ ...checkpoint, registration: { ...checkpoint.registration, handle: { ...handle, producer: 'other' } } }, { handle, workspacePath: fixture.workspace })).rejects.toThrow(/handle/)
      const foreign = structuredClone(checkpoint)
      foreign.context.activeDispatch = { dispatchId: 'foreign-1', workerType: 'document-author', phase: 'DOCUMENT_DRAFTING', taskId: 'docs/GDD.md', revision: 'x', status: 'running', startedAt: '2026-09-05T00:00:00.000Z', request: { runId: 'other-run', ownerId: 'owner', projectId: 'project', workspacePath: fixture.workspace, workerType: 'document-author', phase: 'DOCUMENT_DRAFTING', taskId: 'docs/GDD.md', revision: 'x', allowedPaths: ['docs/GDD.md'], contract: { confirmedBriefDigest: start.input.confirmedBriefDigest, confirmedBriefContext: brief, documentSet: 'foundation', authoringMode: 'initial', foundationDocumentPath: 'docs/GDD.md' } } }
      await expect(parseAuthorCheckpoint(foreign, { handle, workspacePath: fixture.workspace })).rejects.toThrow(/identity/)
    } finally { await rm(fixture.workspace, { recursive: true, force: true }) }
  })

  test('requires committed proof and validates result identity and immutable artifact bytes', async () => {
    const fixture = await rootFixture()
    try {
      const checkpoint = completedCheckpoint(fixture.registration, fixture.workspace)
      await writeCompletedProof(fixture.workspace, checkpoint)
      const acceptanceJournal = await acceptanceJournalFor(checkpoint)
      await expect(parseAuthorCheckpoint({ ...checkpoint, acceptedDispatches: {} }, { handle, workspacePath: fixture.workspace, acceptanceJournal })).rejects.toThrow(/proof/)
      await expect(parseAuthorCheckpoint(checkpoint, { handle, workspacePath: fixture.workspace, acceptanceJournal })).resolves.toEqual(expect.any(Object))
      const badResult = structuredClone(checkpoint); badResult.result!.ownerId = 'other'
      await expect(parseAuthorCheckpoint(badResult, { handle, workspacePath: fixture.workspace })).rejects.toThrow(/identity/)
      const badArtifact = structuredClone(checkpoint)
      await writeFile(join(fixture.workspace, badArtifact.result!.documents[0]!.artifactPath), 'tampered')
      await expect(parseAuthorCheckpoint(badArtifact, { handle, workspacePath: fixture.workspace, acceptanceJournal })).rejects.toThrow(/artifact proof/)
    } finally { await rm(fixture.workspace, { recursive: true, force: true }) }
  })

  test('allows canonical documents to change after completed immutable artifacts', async () => {
    const fixture = await rootFixture()
    try {
      const checkpoint = completedCheckpoint(fixture.registration, fixture.workspace)
      await writeCompletedProof(fixture.workspace, checkpoint)
      const acceptanceJournal = await acceptanceJournalFor(checkpoint)
      await mkdir(join(fixture.workspace, 'docs'), { recursive: true })
      await writeFile(join(fixture.workspace, 'docs/GDD.md'), 'a later revision')
      await expect(parseAuthorCheckpoint(checkpoint, { handle, workspacePath: fixture.workspace, acceptanceJournal })).resolves.toEqual(expect.any(Object))
    } finally { await rm(fixture.workspace, { recursive: true, force: true }) }
  })

  test('rejects prepared receipts without mutating them during checkpoint parsing', async () => {
    const fixture = await rootFixture()
    try {
      const checkpoint = completedCheckpoint(fixture.registration, fixture.workspace)
      await writeCompletedProof(fixture.workspace, checkpoint)
      const acceptanceJournal = await acceptanceJournalFor(checkpoint)
      checkpoint.result = undefined
      checkpoint.context.status = 'needs_action'
      const receiptPath = join(fixture.workspace, '.beegame/workflow/foundation-authoring/receipts', `${checkpoint.acceptedDispatches['docs/GDD.md']}.json`)
      const prepared = JSON.parse(await readFile(receiptPath, 'utf8'))
      prepared.status = 'package_prepared'
      await writeFile(receiptPath, JSON.stringify(prepared))
      const before = await readFile(receiptPath)
      await expect(parseAuthorCheckpoint(checkpoint, { handle, workspacePath: fixture.workspace, acceptanceJournal })).rejects.toThrow(/receipt\/body proof/)
      expect(await readFile(receiptPath)).toEqual(before)
    } finally { await rm(fixture.workspace, { recursive: true, force: true }) }
  })
})
