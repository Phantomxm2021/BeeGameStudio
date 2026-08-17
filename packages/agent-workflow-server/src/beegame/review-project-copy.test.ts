import { createHash } from 'node:crypto'
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
import { createReviewProjectCopy } from './review-project-copy'

const roots: string[] = []

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'beegame-review-copy-'))
  roots.push(value)
  return value
}

async function sourceWorkspace(rootPath: string): Promise<string> {
  const source = join(rootPath, 'source')
  for (const [index, path] of CANONICAL_FOUNDATION_DOCUMENTS.entries()) {
    const absolute = join(source, path)
    await mkdir(dirname(absolute), { recursive: true })
    await writeFile(absolute, `# document ${index}\n\nbody-${index}\n`, 'utf8')
  }
  return source
}

async function digests(workspacePath: string): Promise<Record<string, string>> {
  return Object.fromEntries(
    await Promise.all(
      CANONICAL_FOUNDATION_DOCUMENTS.map(async path => [
        path,
        createHash('sha256')
          .update(await readFile(join(workspacePath, path)))
          .digest('hex'),
      ]),
    ),
  )
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true })))
})

describe('createReviewProjectCopy', () => {
  test('copies exactly the eight canonical documents and creates a current foundation review run', async () => {
    const rootPath = await root()
    const source = await sourceWorkspace(rootPath)
    const destination = join(rootPath, 'review-copy')
    const before = await digests(source)

    const result = await createReviewProjectCopy({
      sourceWorkspacePath: source,
      destinationWorkspacePath: destination,
      ownerId: 'owner-1',
      projectId: 'copy-1',
      confirmedBriefContext: 'A confirmed game brief.',
    })

    expect(result.workspacePath).toBe(destination)
    expect(result.run).toMatchObject({
      projectId: 'copy-1',
      ownerId: 'owner-1',
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'FOUNDATION_REVIEW',
      status: 'running',
      foundationDraftState: {
        completedPaths: [...CANONICAL_FOUNDATION_DOCUMENTS],
      },
      foundationReviewState: {
        attempt: 1,
        status: 'pending',
      },
    })
    expect(await digests(destination)).toEqual(before)
    expect(await digests(source)).toEqual(before)
    expect((await readdir(join(destination, 'docs'))).sort()).toEqual(
      [
        'ASSET_PLAN.md',
        'ART_DIRECTION.md',
        'AUDIO_DESIGN.md',
        'BALANCE_DESIGN.md',
        'GDD.md',
        'LEVEL_SCENE_DESIGN.md',
        'TECHNICAL_DESIGN.md',
        'UI_UX_SPEC.md',
      ].sort(),
    )
    expect(await lstat(join(destination, '.beegame/workflow/run.json'))).toBeDefined()
  })

  test('rejects a missing canonical document and removes its temporary sibling', async () => {
    const rootPath = await root()
    const source = await sourceWorkspace(rootPath)
    await rm(join(source, CANONICAL_FOUNDATION_DOCUMENTS[3]))
    const destination = join(rootPath, 'review-copy')

    await expect(
      createReviewProjectCopy({
        sourceWorkspacePath: source,
        destinationWorkspacePath: destination,
        ownerId: 'owner-1',
        projectId: 'copy-1',
        confirmedBriefContext: 'A confirmed game brief.',
      }),
    ).rejects.toThrow('canonical source document')
    expect(await readdir(rootPath)).toEqual(['source'])
  })

  test('rejects symlinked source documents', async () => {
    const rootPath = await root()
    const source = await sourceWorkspace(rootPath)
    const target = join(source, 'real-gdd.md')
    await writeFile(target, '# real\n', 'utf8')
    await rm(join(source, 'docs/GDD.md'))
    await symlink(target, join(source, 'docs/GDD.md'))

    await expect(
      createReviewProjectCopy({
        sourceWorkspacePath: source,
        destinationWorkspacePath: join(rootPath, 'review-copy'),
        ownerId: 'owner-1',
        projectId: 'copy-1',
        confirmedBriefContext: 'A confirmed game brief.',
      }),
    ).rejects.toThrow('regular file')
  })

  test('rejects blank briefs and existing destinations without changing either workspace', async () => {
    const rootPath = await root()
    const source = await sourceWorkspace(rootPath)
    const destination = join(rootPath, 'review-copy')
    await mkdir(destination)

    await expect(
      createReviewProjectCopy({
        sourceWorkspacePath: source,
        destinationWorkspacePath: destination,
        ownerId: 'owner-1',
        projectId: 'copy-1',
        confirmedBriefContext: '   ',
      }),
    ).rejects.toThrow('confirmed brief context is required')
    await expect(
      createReviewProjectCopy({
        sourceWorkspacePath: source,
        destinationWorkspacePath: destination,
        ownerId: 'owner-1',
        projectId: 'copy-1',
        confirmedBriefContext: 'A confirmed game brief.',
      }),
    ).rejects.toThrow('destination already exists')
    expect(await readdir(destination)).toEqual([])
  })
})
