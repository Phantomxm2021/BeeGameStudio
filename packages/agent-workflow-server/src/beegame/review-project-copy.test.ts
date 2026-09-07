import { createHash, randomUUID } from 'node:crypto'
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './delivery-workflow/types'
import type { DeliveryRun } from './delivery-workflow/types'
import { foundationReviewerInputDigest } from './stage-modules/foundation-reviewer/public'
import { deliveryRunSchema } from './delivery-workflow/schema'
import { createReviewProjectCopy } from './review-project-copy'

const roots: string[] = []
const digest = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex')

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'beegame-review-copy-'))
  roots.push(value)
  return value
}

async function sourceFixture(rootPath: string): Promise<{
  source: string
  sourceRun: Pick<
    DeliveryRun,
    | 'ownerId'
    | 'projectId'
    | 'confirmedBriefDigest'
    | 'confirmedBriefContext'
    | 'authorStage'
  >
  exports: Buffer[]
  result: NonNullable<NonNullable<DeliveryRun['authorStage']>['result']>
}> {
  const source = join(rootPath, 'source')
  const ownerId = 'owner-1'
  const projectId = 'source-project'
  const confirmedBriefContext = 'A confirmed game brief.'
  const confirmedBriefDigest = digest(confirmedBriefContext)
  const resultId = digest('author-result')
  const authorInputDigest = digest('author-input')
  const exports = CANONICAL_FOUNDATION_DOCUMENTS.map((path, index) =>
    Buffer.from(`# frozen ${index}\n\nexport-body-${index}\n`, 'utf8'),
  )
  const documents = CANONICAL_FOUNDATION_DOCUMENTS.map((path, index) => ({
    path,
    digest: digest(exports[index]!),
    byteLength: exports[index]!.byteLength,
    artifactPath: `exports/${path}`,
  }))
  for (const [index, document] of documents.entries()) {
    const absolute = join(source, document.artifactPath)
    await mkdir(dirname(absolute), { recursive: true })
    await writeFile(absolute, exports[index]!)
    const canonical = join(source, CANONICAL_FOUNDATION_DOCUMENTS[index]!)
    await mkdir(dirname(canonical), { recursive: true })
    await writeFile(canonical, `# mutable canonical ${index}\n`, 'utf8')
  }
  await mkdir(join(source, '.beegame/workflow'), { recursive: true })
  await writeFile(join(source, '.beegame/workflow/old-run.json'), 'old-run', 'utf8')

  const result = {
    protocolVersion: 1 as const,
    producer: 'foundation-authoring' as const,
    kind: 'foundation_documents' as const,
    resultId,
    inputDigest: authorInputDigest,
    ownerId,
    projectId,
    confirmedBriefDigest,
    documents,
    documentRevision: digest('document-revision'),
    workspaceRevision: digest('workspace-revision'),
    receiptSetDigest: digest('receipt-set'),
  }
  return {
    source,
    sourceRun: {
      ownerId,
      projectId,
      confirmedBriefDigest,
      confirmedBriefContext,
      authorStage: {
        protocolVersion: 1,
        requestId: 'author-request',
        inputDigest: authorInputDigest,
        status: 'completed',
        handle: {
          protocolVersion: 1,
          producer: 'foundation-authoring',
          id: randomUUID(),
        },
        control: {
          sequence: 0,
          action: 'run' as const,
          requestId: 'author-request',
        },
        result,
      },
    },
    exports,
    result,
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('createReviewProjectCopy', () => {
  test('copies frozen public exports, creates a fresh reviewer request, and ignores mutable canonical docs', async () => {
    const rootPath = await root()
    const fixture = await sourceFixture(rootPath)
    const destination = join(rootPath, 'review-copy')
    const oldRunBefore = await readFile(join(fixture.source, '.beegame/workflow/old-run.json'))

    const result = await createReviewProjectCopy({
      sourceWorkspacePath: fixture.source,
      destinationWorkspacePath: destination,
      ownerId: 'owner-1',
      projectId: 'review-project',
      confirmedBriefContext: 'A confirmed game brief.',
      sourceRun: fixture.sourceRun,
    })

    expect(result.workspacePath).toBe(destination)
    expect(result.run).toMatchObject({
      projectId: 'review-project',
      ownerId: 'owner-1',
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'FOUNDATION_REVIEW',
      status: 'running',
      foundationDraftState: { completedPaths: [] },
    })
    expect(result.run.authorStage).toBeUndefined()
    const link = result.run.foundationReviewStage!
    expect(link.importedAuthorResult).toEqual(fixture.result)
    expect(link.authorResultId).toBe(fixture.result.resultId)
    expect(link.sequence).toBe(0)
    expect(link.control).toEqual({ sequence: 0, appliedSequence: 0, action: 'run' })
    expect(link.invocation.request.requestId).toBe(`foundation:${result.run.runId}:0`)
    expect(link.invocation.request.projectId).toBe('review-project')
    if (link.invocation.stage === 'reviewer')
      expect(link.invocation.request.inputDigest).toBe(
        foundationReviewerInputDigest({
          ownerId: 'owner-1',
          projectId: 'review-project',
          input: link.invocation.request.input,
        }),
      )
    expect('kind' in link.invocation.request.input).toBe(false)
    if ('subject' in link.invocation.request.input) {
      expect(link.invocation.request.input.subject).toMatchObject({
        kind: 'initial',
        sourceResultId: fixture.result.resultId,
      })
    }
    for (const [index, path] of CANONICAL_FOUNDATION_DOCUMENTS.entries()) {
      expect(await readFile(join(destination, path), 'utf8')).toBe(
        fixture.exports[index]!.toString('utf8'),
      )
      expect(
        await readFile(
          join(destination, fixture.result.documents[index]!.artifactPath),
          'utf8',
        ),
      ).toBe(fixture.exports[index]!.toString('utf8'))
    }
    expect(await readFile(join(fixture.source, '.beegame/workflow/old-run.json'))).toEqual(oldRunBefore)
    await expect(lstat(join(destination, '.beegame/workflow/old-run.json'))).rejects.toThrow()
    expect(deliveryRunSchema.safeParse(result.run).success).toBe(true)
  })

  test('persisted imported provenance rejects mixed legacy author state and source/request tampering', async () => {
    const rootPath = await root()
    const fixture = await sourceFixture(rootPath)
    const result = await createReviewProjectCopy({
      sourceWorkspacePath: fixture.source,
      destinationWorkspacePath: join(rootPath, 'review-copy'),
      ownerId: 'owner-1',
      projectId: 'review-project',
      confirmedBriefContext: 'A confirmed game brief.',
      sourceRun: fixture.sourceRun,
    })

    const mixed = structuredClone(result.run)
    mixed.authorStage = structuredClone(fixture.sourceRun.authorStage)
    expect(deliveryRunSchema.safeParse(mixed).success).toBe(false)

    for (const mutate of [
      (run: DeliveryRun) => {
        run.foundationReviewStage!.importedAuthorResult!.ownerId = 'other-owner'
      },
      (run: DeliveryRun) => {
        run.foundationReviewStage!.importedAuthorResult!.projectId = run.projectId
      },
      (run: DeliveryRun) => {
        run.foundationReviewStage!.importedAuthorResult!.confirmedBriefDigest = digest('other-brief')
      },
    ]) {
      const tampered = structuredClone(result.run)
      mutate(tampered)
      expect(deliveryRunSchema.safeParse(tampered).success).toBe(false)
    }

    const changedRequest = structuredClone(result.run)
    const requestInput = changedRequest.foundationReviewStage!.invocation.request.input
    if ('documents' in requestInput) {
      requestInput.documents[0]!.content = `${requestInput.documents[0]!.content}tampered`
      changedRequest.foundationReviewStage!.invocation.request.inputDigest =
        foundationReviewerInputDigest({
          ownerId: 'owner-1',
          projectId: 'review-project',
          input: requestInput,
        })
    }
    expect(deliveryRunSchema.safeParse(changedRequest).success).toBe(false)
    expect(result.run.foundationDraftState.completedPaths).toEqual([])
  })

  test('rejects tampered, symlinked, cross-owner, and mismatched-brief sources before publishing', async () => {
    const rootPath = await root()
    const fixture = await sourceFixture(rootPath)
    const target = join(rootPath, 'review-copy')
    const firstArtifact = fixture.result.documents[0]!.artifactPath

    await writeFile(join(fixture.source, firstArtifact), 'tampered', 'utf8')
    await expect(
      createReviewProjectCopy({
        sourceWorkspacePath: fixture.source,
        destinationWorkspacePath: target,
        ownerId: 'owner-1',
        projectId: 'review-project',
        confirmedBriefContext: 'A confirmed game brief.',
        sourceRun: fixture.sourceRun,
      }),
    ).rejects.toThrow()
    expect(await readdir(rootPath)).toContain('source')
    expect(await readdir(rootPath)).not.toContain('review-copy')

    const symlinkFixture = await sourceFixture(rootPath)
    const symlinkArtifact = join(symlinkFixture.source, symlinkFixture.result.documents[0]!.artifactPath)
    await rm(symlinkArtifact)
    await symlink(join(symlinkFixture.source, 'outside.md'), symlinkArtifact)
    await writeFile(join(symlinkFixture.source, 'outside.md'), 'outside', 'utf8')
    await expect(
      createReviewProjectCopy({
        sourceWorkspacePath: symlinkFixture.source,
        destinationWorkspacePath: join(rootPath, 'symlink-copy'),
        ownerId: 'owner-1',
        projectId: 'review-project',
        confirmedBriefContext: 'A confirmed game brief.',
        sourceRun: symlinkFixture.sourceRun,
      }),
    ).rejects.toThrow()

    await expect(
      createReviewProjectCopy({
        sourceWorkspacePath: fixture.source,
        destinationWorkspacePath: join(rootPath, 'owner-copy'),
        ownerId: 'other-owner',
        projectId: 'review-project',
        confirmedBriefContext: 'A confirmed game brief.',
        sourceRun: fixture.sourceRun,
      }),
    ).rejects.toThrow('owner')
    await expect(
      createReviewProjectCopy({
        sourceWorkspacePath: fixture.source,
        destinationWorkspacePath: join(rootPath, 'brief-copy'),
        ownerId: 'owner-1',
        projectId: 'review-project',
        confirmedBriefContext: 'Different brief.',
        sourceRun: fixture.sourceRun,
      }),
    ).rejects.toThrow('brief')
  })

  test('rejects an existing destination and a source project reuse', async () => {
    const rootPath = await root()
    const fixture = await sourceFixture(rootPath)
    const destination = join(rootPath, 'review-copy')
    await mkdir(destination)
    await expect(
      createReviewProjectCopy({
        sourceWorkspacePath: fixture.source,
        destinationWorkspacePath: destination,
        ownerId: 'owner-1',
        projectId: 'review-project',
        confirmedBriefContext: 'A confirmed game brief.',
        sourceRun: fixture.sourceRun,
      }),
    ).rejects.toThrow('already exists')
    await expect(
      createReviewProjectCopy({
        sourceWorkspacePath: fixture.source,
        destinationWorkspacePath: join(rootPath, 'same-project'),
        ownerId: 'owner-1',
        projectId: 'source-project',
        confirmedBriefContext: 'A confirmed game brief.',
        sourceRun: fixture.sourceRun,
      }),
    ).rejects.toThrow('differ')
  })
})
