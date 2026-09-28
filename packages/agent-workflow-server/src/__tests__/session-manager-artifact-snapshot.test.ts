import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BeeGameSessionManager,
  type BeeGameSessionRunner,
} from '../beegame/session-manager'
import { publishProjectArtifacts } from '../beegame/project-artifact-store'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function document(path: string, content: string) {
  const bytes = Buffer.from(content, 'utf8')
  return {
    path,
    content,
    digest: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.byteLength,
  }
}

function readStoredZipEntries(data: Uint8Array): Map<string, string> {
  const entries = new Map<string, string>()
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const decoder = new TextDecoder()
  let offset = 0
  while (offset + 30 <= data.byteLength && view.getUint32(offset, true) === 0x04034b50) {
    const nameLength = view.getUint16(offset + 26, true)
    const extraLength = view.getUint16(offset + 28, true)
    const byteLength = view.getUint32(offset + 18, true)
    const nameStart = offset + 30
    const dataStart = nameStart + nameLength + extraLength
    const name = decoder.decode(data.subarray(nameStart, dataStart - extraLength))
    entries.set(name, decoder.decode(data.subarray(dataStart, dataStart + byteLength)))
    offset = dataStart + byteLength
  }
  return entries
}

describe('active BeeGame session artifact reads', () => {
  test('readArtifact and package always serve canonical bytes, regardless of application snapshots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'beegame-session-artifact-snapshot-'))
    roots.push(root)
    const workspacePath = join(root, 'workspace')
    const path = 'docs/GDD.md'
    const canonical = '# canonical initial\n'
    const published = '# application snapshot must not mask canonical bytes\n'
    await mkdir(join(workspacePath, 'docs'), { recursive: true })
    await writeFile(join(workspacePath, path), canonical, 'utf8')

    const runner: BeeGameSessionRunner = {
      start: async () => ({
        submit: async () => undefined,
        stop: () => undefined,
      }),
    }
    const manager = new BeeGameSessionManager(runner, root)
    const session = manager.start({
      workspacePath,
      projectId: 'project_beegame_active',
      userId: 'owner-1',
    })

    const beforePublish = await manager.readArtifact(session.id, path)
    expect(beforePublish).toEqual({ path, content: canonical })

    await publishProjectArtifacts({
      workspacePath,
      ownerId: 'owner-1',
      projectId: 'project_beegame_active',
      publicationId: 'publication-current',
      documents: [document(path, published)],
    })
    // Publishing materializes the application snapshot once. Subsequent
    // canonical edits must remain authoritative for direct manager callers.
    await writeFile(join(workspacePath, path), canonical, 'utf8')

    expect(await manager.readArtifact(session.id, path)).toEqual({
      path,
      content: canonical,
    })

    const archive = await manager.createProjectPackage(session.id)
    const entries = readStoredZipEntries(archive.data)
    expect(entries.get(path)).toBe(canonical)
    expect([...entries.keys()].some(entry => entry.startsWith('.beegame/artifacts/'))).toBe(false)
    // Corrupting an unused application snapshot must not break canonical reads.
    await writeFile(join(workspacePath, '.beegame', 'artifacts', 'current.json'), '{not-json', 'utf8')
    expect(await manager.readArtifact(session.id, path)).toEqual({
      path,
      content: canonical,
    })
    const repairedArchive = await manager.createProjectPackage(session.id)
    expect(readStoredZipEntries(repairedArchive.data).get(path)).toBe(canonical)
    const foreignManager = new BeeGameSessionManager(runner, root)
    const foreignSession = foreignManager.start({
      workspacePath, projectId: 'other-project', userId: 'owner-1',
    })
    expect(await foreignManager.readArtifact(foreignSession.id, path)).toEqual({
      path,
      content: canonical,
    })
    expect(readStoredZipEntries((await foreignManager.createProjectPackage(foreignSession.id)).data).get(path)).toBe(canonical)
    await mkdir(join(workspacePath, '.beegame', 'artifacts', 'pending'), { recursive: true })
    await writeFile(join(workspacePath, '.beegame', 'artifacts', 'pending', 'race.json'), '{}', 'utf8')
    await expect(manager.readArtifact(session.id, path)).rejects.toThrow(/pending transaction/i)
    await expect(manager.createProjectPackage(session.id)).rejects.toThrow(/pending transaction/i)
    await foreignManager.dispose()
    manager.dispose()
  })
})
