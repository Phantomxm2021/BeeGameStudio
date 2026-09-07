import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'bun:test'
import {
  publishProjectArtifacts,
  readCurrentProjectArtifact,
  readCurrentProjectArtifacts,
  readProjectArtifactPublicationToken,
  readCanonicalProjectArtifactConsistently,
} from './project-artifact-store'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function workspace(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'beegame-artifacts-'))
  temporaryDirectories.push(path)
  return path
}

function document(path: string, content: string) {
  const bytes = Buffer.from(content, 'utf8')
  return {
    path,
    content,
    digest: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.byteLength,
  }
}

describe('application-owned project artifact snapshots', () => {
  it('does not impose a smaller ten-MiB ceiling than the application result envelopes', async () => {
    const root = await workspace()
    const content = 'x'.repeat(11 * 1024 * 1024)
    await publishProjectArtifacts({ workspacePath: root, ownerId: 'owner', projectId: 'project',
      publicationId: 'large-valid', documents: [document('large.md', content)] })
    expect((await readCurrentProjectArtifact(root, 'large.md'))?.length).toBe(content.length)
  })

  it('captures a complete multi-artifact version across a later publication', async () => {
    const root = await workspace()
    const publish = (publicationId: string, value: string) => publishProjectArtifacts({ workspacePath: root,
      ownerId: 'owner', projectId: 'project', publicationId,
      documents: [document('a.txt', value), document('b.txt', value)] })
    await publish('first', 'one')
    const captured = await readCurrentProjectArtifacts(root)
    await Promise.all([publish('second', 'two'), publish('third', 'three')])
    expect(captured!.map(document => document.content)).toEqual(['one', 'one'])
    const current = await readCurrentProjectArtifacts(root)
    expect(new Set(current!.map(document => document.content)).size).toBe(1)
    expect(['two', 'three']).toContain(current![0]!.content)
  })

  it('changes the publication token across a real read and fails closed on pending work', async () => {
    const root = await workspace()
    await publishProjectArtifacts({
      workspacePath: root,
      ownerId: 'owner',
      projectId: 'project',
      publicationId: 'first',
      documents: [document('a.txt', 'one')],
    })
    const before = await readProjectArtifactPublicationToken(root)
    expect(before).toEqual(expect.any(String))

    const bytesReadBeforePublication = await readFile(join(root, 'a.txt'), 'utf8')
    await publishProjectArtifacts({
      workspacePath: root,
      ownerId: 'owner',
      projectId: 'project',
      publicationId: 'second',
      documents: [document('a.txt', 'two')],
    })
    const after = await readProjectArtifactPublicationToken(root)
    expect(after).toEqual(expect.any(String))
    expect(after).not.toBe(before)
    expect(bytesReadBeforePublication).toBe('one')

    await expect(readCanonicalProjectArtifactConsistently(root, async () => {
      const bytes = await readFile(join(root, 'a.txt'), 'utf8')
      await publishProjectArtifacts({ workspacePath: root, ownerId: 'owner', projectId: 'project',
        publicationId: 'third', documents: [document('a.txt', 'three')] })
      return bytes
    })).rejects.toThrow(/changed during canonical read/i)

    const pendingPath = join(root, '.beegame', 'artifacts', 'pending', 'race.json')
    await writeFile(pendingPath, '{}', 'utf8')
    await expect(readProjectArtifactPublicationToken(root)).rejects.toThrow(/pending transaction/i)
  })

  it('does not take over an unexplained publication lock or change current bytes', async () => {
    const root = await workspace()
    const input = { workspacePath: root, ownerId: 'owner', projectId: 'project',
      publicationId: 'first', documents: [document('a.txt', 'one')] }
    await publishProjectArtifacts(input)
    await mkdir(join(root, '.beegame/artifacts/.publish.lock'))
    await expect(publishProjectArtifacts({ ...input, publicationId: 'second', documents: [document('a.txt', 'two')] }))
      .rejects.toThrow('already in progress')
    expect(await readCurrentProjectArtifact(root, 'a.txt')).toBe('one')
  })

  it('rejects a different project identity even with a new publication id', async () => {
    const root = await workspace()
    const input = { workspacePath: root, ownerId: 'owner', projectId: 'project',
      publicationId: 'first', documents: [document('a.txt', 'one')] }
    await publishProjectArtifacts(input)
    await expect(publishProjectArtifacts({ ...input, projectId: 'other', publicationId: 'second' }))
      .rejects.toThrow('different owner or project')
  })

  it('requires the expected owner and project when reading a current snapshot', async () => {
    const root = await workspace()
    await publishProjectArtifacts({ workspacePath: root, ownerId: 'owner', projectId: 'project',
      publicationId: 'first', documents: [document('a.txt', 'one')] })
    await expect(readCurrentProjectArtifact(root, 'a.txt', {
      ownerId: 'other-owner', projectId: 'project',
    })).rejects.toThrow('expected owner or project')
    await expect(readCurrentProjectArtifacts(root, {
      ownerId: 'owner', projectId: 'other-project',
    })).rejects.toThrow('expected owner or project')
    await expect(readCurrentProjectArtifact(root, 'a.txt', {
      ownerId: 'owner', projectId: 'project',
    })).resolves.toBe('one')
  })

  it('publishes exact UTF-8 bytes to project files and preserves unrelated files', async () => {
    const root = await workspace()
    const source = join(root, 'canonical.txt')
    await writeFile(source, 'canonical')
    await publishProjectArtifacts({
      workspacePath: root,
      ownerId: 'owner-1',
      projectId: 'project-1',
      publicationId: 'publication-1',
      documents: [document('src/世界.txt', 'hello\n世界\n')],
    })

    expect(await readCurrentProjectArtifact(root, 'src/世界.txt')).toBe('hello\n世界\n')
    expect(await readFile(join(root, 'src/世界.txt'), 'utf8')).toBe('hello\n世界\n')
    expect(await readFile(source, 'utf8')).toBe('canonical')
    expect(await readCurrentProjectArtifact(root, 'missing.txt')).toBeUndefined()
  })

  it('is idempotent for the same publication and rejects a reused id with new content', async () => {
    const root = await workspace()
    const input = {
      workspacePath: root,
      ownerId: 'owner-1',
      projectId: 'project-1',
      publicationId: 'publication-1',
      documents: [document('a.txt', 'one')],
    }
    await publishProjectArtifacts(input)
    await publishProjectArtifacts(input)
    await expect(publishProjectArtifacts({
      ...input,
      documents: [document('a.txt', 'two')],
    })).rejects.toThrow(/already bound/i)
  })

  it('repairs a same-ID snapshot-only current only with explicit missing baselines', async () => {
    const root = await workspace()
    const input = {
      workspacePath: root,
      ownerId: 'owner-1', projectId: 'project-1', publicationId: 'publication-migrate',
      documents: [document('docs/GDD.md', 'old')],
    }
    await publishProjectArtifacts(input)
    await unlink(join(root, 'docs/GDD.md'))
    await expect(publishProjectArtifacts(input)).rejects.toThrow(/explicit workspace baselines/i)
    await publishProjectArtifacts({
      ...input,
      expectedWorkspaceDigests: [{ path: 'docs/GDD.md', digest: null }],
    })
    expect(await readFile(join(root, 'docs/GDD.md'), 'utf8')).toBe('old')
  })

  it('rejects a same-ID user edit without silently healing it', async () => {
    const root = await workspace()
    const input = {
      workspacePath: root,
      ownerId: 'owner-1', projectId: 'project-1', publicationId: 'publication-drift',
      documents: [document('docs/GDD.md', 'accepted')],
    }
    await publishProjectArtifacts(input)
    await writeFile(join(root, 'docs/GDD.md'), 'user edit')
    await expect(publishProjectArtifacts(input)).rejects.toThrow(/explicit workspace baselines/i)
    expect(await readFile(join(root, 'docs/GDD.md'), 'utf8')).toBe('user edit')
  })

  it('materializes a legacy snapshot over its explicit old file baseline and replays without a new epoch', async () => {
    const root = await workspace()
    const input = { workspacePath: root, ownerId: 'owner-1', projectId: 'project-1',
      publicationId: 'legacy-approved', documents: [document('docs/UI_UX_SPEC.md', 'version: 1.0.2')] }
    await publishProjectArtifacts(input)
    await writeFile(join(root, 'docs/UI_UX_SPEC.md'), 'version: 1.0.0')
    await unlink(join(root, '.beegame/artifacts/materialization.json'))
    expect(await readProjectArtifactPublicationToken(root)).toBeUndefined()
    await expect(publishProjectArtifacts(input)).rejects.toThrow(/explicit workspace baselines/i)
    const approved = { ...input, expectedWorkspaceDigests: [{ path: 'docs/UI_UX_SPEC.md',
      digest: createHash('sha256').update('version: 1.0.0').digest('hex') }] }
    const pointer = await readFile(join(root, '.beegame/artifacts/current.json'), 'utf8')
    await publishProjectArtifacts(approved)
    expect(await readFile(join(root, 'docs/UI_UX_SPEC.md'), 'utf8')).toBe('version: 1.0.2')
    expect(await readFile(join(root, '.beegame/artifacts/current.json'), 'utf8')).toBe(pointer)
    const epoch = await readProjectArtifactPublicationToken(root)
    await publishProjectArtifacts(approved)
    expect(await readProjectArtifactPublicationToken(root)).toBe(epoch)
  })

  it('preflights all destinations before changing any file', async () => {
    const root = await workspace()
    await mkdir(join(root, 'docs'), { recursive: true })
    await writeFile(join(root, 'docs/a.md'), 'old-a')
    await writeFile(join(root, 'docs/b.md'), 'user-b')
    await expect(publishProjectArtifacts({
      workspacePath: root,
      ownerId: 'owner-1', projectId: 'project-1', publicationId: 'publication-preflight',
      expectedWorkspaceDigests: [
        { path: 'docs/a.md', digest: createHash('sha256').update('old-a').digest('hex') },
        { path: 'docs/b.md', digest: createHash('sha256').update('old-b').digest('hex') },
      ],
      documents: [document('docs/a.md', 'new-a'), document('docs/b.md', 'new-b')],
    })).rejects.toThrow(/baseline conflict/i)
    expect(await readFile(join(root, 'docs/a.md'), 'utf8')).toBe('old-a')
    expect(await readFile(join(root, 'docs/b.md'), 'utf8')).toBe('user-b')
  })

  it('replays a synthetic partial transaction after its commit step is unblocked', async () => {
    const root = await workspace()
    await mkdir(join(root, 'docs'), { recursive: true })
    await writeFile(join(root, 'docs/a.md'), 'old-a')
    await writeFile(join(root, 'docs/b.md'), 'old-b')
    await mkdir(join(root, '.beegame/artifacts/snapshots'), { recursive: true })
    await mkdir(join(root, '.beegame/artifacts/publications'), { recursive: true })
    await mkdir(join(root, '.beegame/artifacts/pending'), { recursive: true })
    await mkdir(join(root, '.beegame/artifacts/materialization.json'))
    const old = (content: string) => createHash('sha256').update(content).digest('hex')
    const input = {
      workspacePath: root,
      ownerId: 'owner-1', projectId: 'project-1', publicationId: 'publication-replay',
      expectedWorkspaceDigests: [
        { path: 'docs/a.md', digest: old('old-a') },
        { path: 'docs/b.md', digest: old('old-b') },
      ],
      documents: [document('docs/a.md', 'new-a'), document('docs/b.md', 'new-b')],
    }
    await expect(publishProjectArtifacts(input)).rejects.toThrow()
    await expect(readProjectArtifactPublicationToken(root)).rejects.toThrow(/pending transaction/i)
    await expect(publishProjectArtifacts({ ...input, publicationId: 'other-publication' })).rejects.toThrow(/pending transaction/i)
    await writeFile(join(root, 'docs/a.md'), 'old-a')
    await rm(join(root, '.beegame/artifacts/materialization.json'), { recursive: true, force: true })
    await publishProjectArtifacts(input)
    expect(await readFile(join(root, 'docs/a.md'), 'utf8')).toBe('new-a')
    expect(await readFile(join(root, 'docs/b.md'), 'utf8')).toBe('new-b')
    expect(await readProjectArtifactPublicationToken(root)).toEqual(expect.any(String))
  })

  it('supports a stale-write compare-and-swap guard', async () => {
    const root = await workspace()
    await publishProjectArtifacts({
      workspacePath: root,
      ownerId: 'owner-1', projectId: 'project-1', publicationId: 'publication-1',
      documents: [document('a.txt', 'one')],
    })
    await expect(publishProjectArtifacts({
      workspacePath: root,
      ownerId: 'owner-1', projectId: 'project-1', publicationId: 'publication-2',
      expectedPublicationId: 'stale-publication',
      documents: [document('a.txt', 'two')],
    })).rejects.toThrow(/compare-and-swap/i)
    expect(await readCurrentProjectArtifact(root, 'a.txt')).toBe('one')
  })

  it('keeps publication ids immutable across later current-pointer switches', async () => {
    const root = await workspace()
    await publishProjectArtifacts({
      workspacePath: root,
      ownerId: 'owner-1', projectId: 'project-1', publicationId: 'publication-1',
      documents: [document('a.txt', 'one')],
    })
    await publishProjectArtifacts({
      workspacePath: root,
      ownerId: 'owner-1', projectId: 'project-1', publicationId: 'publication-2',
      documents: [document('a.txt', 'two')],
    })
    await publishProjectArtifacts({
      workspacePath: root,
      ownerId: 'owner-1', projectId: 'project-1', publicationId: 'publication-1',
      documents: [document('a.txt', 'one')],
    })
    expect(await readCurrentProjectArtifact(root, 'a.txt')).toBe('two')
    await expect(publishProjectArtifacts({
      workspacePath: root,
      ownerId: 'owner-1', projectId: 'project-1', publicationId: 'publication-1',
      documents: [document('a.txt', 'changed')],
    })).rejects.toThrow(/already bound/i)
    expect(await readCurrentProjectArtifact(root, 'a.txt')).toBe('two')
  })

  it('does not mistake an uncommitted orphan snapshot for a committed publication', async () => {
    const root = await workspace()
    await publishProjectArtifacts({
      workspacePath: root,
      ownerId: 'owner-1', projectId: 'project-1', publicationId: 'publication-orphan',
      documents: [document('a.txt', 'one')],
    })
    await unlink(join(root, '.beegame', 'artifacts', 'current.json'))
    expect(await readCurrentProjectArtifact(root, 'a.txt')).toBeUndefined()
    await publishProjectArtifacts({
      workspacePath: root,
      ownerId: 'owner-1', projectId: 'project-1', publicationId: 'publication-orphan',
      documents: [document('a.txt', 'one')],
    })
    expect(await readCurrentProjectArtifact(root, 'a.txt')).toBe('one')
  })

  it('rejects invalid content metadata and unsafe paths', async () => {
    const root = await workspace()
    const valid = document('a.txt', 'one')
    await expect(publishProjectArtifacts({
      workspacePath: root,
      ownerId: 'owner-1', projectId: 'project-1', publicationId: 'publication-1',
      documents: [{ ...valid, digest: '0'.repeat(64) }],
    })).rejects.toThrow(/digest does not match/i)
    await expect(publishProjectArtifacts({
      workspacePath: root,
      ownerId: 'owner-1', projectId: 'project-1', publicationId: 'publication-1',
      documents: [document('../escape.txt', 'one')],
    })).rejects.toThrow(/unsafe artifact path/i)
    await expect(readCurrentProjectArtifact(root, 'a/../a.txt')).rejects.toThrow(/unsafe artifact path/i)
    await expect(publishProjectArtifacts({
      workspacePath: root,
      ownerId: 'owner-1', projectId: 'project-1', publicationId: 'publication-reserved',
      documents: [document('.beegame/artifacts/current.json', 'one')],
    })).rejects.toThrow(/reserved by the application/i)
  })

  it('fails closed when current or snapshot metadata is tampered with', async () => {
    const root = await workspace()
    await publishProjectArtifacts({
      workspacePath: root,
      ownerId: 'owner-1', projectId: 'project-1', publicationId: 'publication-1',
      documents: [document('a.txt', 'one')],
    })
    const artifactsPath = join(root, '.beegame', 'artifacts')
    const currentPath = join(artifactsPath, 'current.json')
    const current = JSON.parse(await readFile(currentPath, 'utf8')) as { snapshotDigest: string }
    await writeFile(currentPath, JSON.stringify({ ...current, snapshotDigest: '0'.repeat(64) }))
    await expect(readCurrentProjectArtifact(root, 'a.txt')).rejects.toThrow(/current pointer/i)

    const clean = await workspace()
    await publishProjectArtifacts({
      workspacePath: clean,
      ownerId: 'owner-1', projectId: 'project-1', publicationId: 'publication-2',
      documents: [document('a.txt', 'two')],
    })
    const cleanArtifactsPath = join(clean, '.beegame', 'artifacts')
    const repairedCurrent = JSON.parse(await readFile(join(cleanArtifactsPath, 'current.json'), 'utf8')) as { snapshotDigest: string }
    const snapshotPath = join(cleanArtifactsPath, 'snapshots', `${repairedCurrent.snapshotDigest}.json`)
    await writeFile(snapshotPath, `${await readFile(snapshotPath, 'utf8')} `)
    await expect(readCurrentProjectArtifact(clean, 'a.txt')).rejects.toThrow(/metadata|snapshot/i)
  })

  it('rejects symlinked store parents and current pointers', async () => {
    const root = await workspace()
    const outside = await workspace()
    await symlink(outside, join(root, '.beegame'))
    await expect(publishProjectArtifacts({
      workspacePath: root,
      ownerId: 'owner-1', projectId: 'project-1', publicationId: 'publication-1',
      documents: [document('a.txt', 'one')],
    })).rejects.toThrow(/symlink/i)

    const clean = await workspace()
    await publishProjectArtifacts({
      workspacePath: clean,
      ownerId: 'owner-1', projectId: 'project-1', publicationId: 'publication-1',
      documents: [document('a.txt', 'one')],
    })
    const current = join(clean, '.beegame', 'artifacts', 'current.json')
    const target = join(clean, 'elsewhere.json')
    await writeFile(target, await readFile(current))
    await unlink(current)
    await symlink(target, current)
    await expect(readCurrentProjectArtifact(clean, 'a.txt')).rejects.toThrow(/symlink/i)
  })
})
