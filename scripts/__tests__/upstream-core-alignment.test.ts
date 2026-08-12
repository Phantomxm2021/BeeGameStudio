import { describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import {
  auditCoreAlignment,
  loadAlignmentManifest,
  syncCoreAlignment,
  type AlignmentManifest,
} from '../upstream-core-alignment'

const fixtureManifest: AlignmentManifest = {
  version: 1,
  upstreamRepository: 'https://github.com/example/upstream.git',
  upstreamCommit: 'a'.repeat(40),
  synchronizedDirectories: ['src'],
  synchronizedFiles: [],
  literalSubstitutions: [
    {
      from: '@claude-code-best/builtin-tools',
      to: '@bee-game-studio/builtin-tools',
    },
  ],
  fileSubstitutions: {},
  rootExceptions: {},
}

async function writeFixture(root: string, path: string, value: string | Uint8Array) {
  const absolute = join(root, path)
  await mkdir(dirname(absolute), { recursive: true })
  await Bun.write(absolute, value)
}

describe('upstream core manifest', () => {
  test('pins upstream and excludes product trees', async () => {
    const value = await loadAlignmentManifest(
      resolve(import.meta.dir, '../../config/upstream-core-alignment.json'),
    )

    expect(value.upstreamCommit).toBe(
      '3bb6b5746238c418138eb96d57765d79012edd96',
    )
    expect(value.synchronizedDirectories).toContain('src')
    expect(value.synchronizedDirectories).toContain(
      'packages/workflow-engine',
    )
    expect(value.synchronizedDirectories).not.toContain(
      'packages/agent-workflow-server',
    )
    expect(value.literalSubstitutions).toContainEqual({
      from: '@claude-code-best/builtin-tools',
      to: '@bee-game-studio/builtin-tools',
    })
  })
})

describe('upstream core audit', () => {
  test('applies only declared branding substitutions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'core-alignment-branding-'))
    const upstreamRoot = join(root, 'upstream')
    const localRoot = join(root, 'local')
    const url = 'https://remote-control.claude-code-best.win/'
    await writeFixture(
      upstreamRoot,
      'src/runtime.ts',
      `import '@claude-code-best/builtin-tools'\nexport const url = '${url}'\n`,
    )
    await writeFixture(
      localRoot,
      'src/runtime.ts',
      `import '@bee-game-studio/builtin-tools'\nexport const url = '${url}'\n`,
    )

    expect(
      (
        await auditCoreAlignment({
          manifest: fixtureManifest,
          upstreamRoot,
          localRoot,
          verifyCommit: false,
        })
      ).differences,
    ).toEqual([])
    await rm(root, { recursive: true, force: true })
  })

  test('reports modified, missing, and local-only files in bytewise order', async () => {
    const root = await mkdtemp(join(tmpdir(), 'core-alignment-drift-'))
    const upstreamRoot = join(root, 'upstream')
    const localRoot = join(root, 'local')
    await writeFixture(upstreamRoot, 'src/a.ts', 'upstream-a\n')
    await writeFixture(upstreamRoot, 'src/b.ts', 'upstream-b\n')
    await writeFixture(localRoot, 'src/a.ts', 'changed-a\n')
    await writeFixture(localRoot, 'src/c.ts', 'local-c\n')

    expect(
      (
        await auditCoreAlignment({
          manifest: fixtureManifest,
          upstreamRoot,
          localRoot,
          verifyCommit: false,
        })
      ).differences,
    ).toEqual([
      { kind: 'modified', path: 'src/a.ts' },
      { kind: 'missing', path: 'src/b.ts' },
      { kind: 'local-only', path: 'src/c.ts' },
    ])
    await rm(root, { recursive: true, force: true })
  })

  test('synchronizes exact text and binary content and deletes local-only files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'core-alignment-sync-'))
    const upstreamRoot = join(root, 'upstream')
    const localRoot = join(root, 'local')
    await writeFixture(
      upstreamRoot,
      'src/runtime.ts',
      "import '@claude-code-best/builtin-tools'\n",
    )
    await writeFixture(
      upstreamRoot,
      'src/runtime.bin',
      new Uint8Array([0xff, 0x00, 0x81]),
    )
    await writeFixture(localRoot, 'src/local-only.ts', 'remove\n')

    await syncCoreAlignment({
      manifest: fixtureManifest,
      upstreamRoot,
      localRoot,
      verifyCommit: false,
    })

    expect(await Bun.file(join(localRoot, 'src/runtime.ts')).text()).toBe(
      "import '@bee-game-studio/builtin-tools'\n",
    )
    expect(
      new Uint8Array(await readFile(join(localRoot, 'src/runtime.bin'))),
    ).toEqual(new Uint8Array([0xff, 0x00, 0x81]))
    expect(await Bun.file(join(localRoot, 'src/local-only.ts')).exists()).toBe(
      false,
    )
    await rm(root, { recursive: true, force: true })
  })

  test('rejects manifest traversal and source symlinks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'core-alignment-safety-'))
    const upstreamRoot = join(root, 'upstream')
    const localRoot = join(root, 'local')
    await mkdir(upstreamRoot, { recursive: true })
    await mkdir(localRoot, { recursive: true })
    await expect(
      auditCoreAlignment({
        manifest: {
          ...fixtureManifest,
          synchronizedDirectories: ['../outside'],
        },
        upstreamRoot,
        localRoot,
        verifyCommit: false,
      }),
    ).rejects.toThrow('must be a safe relative path')

    await writeFixture(root, 'outside/secret.ts', 'secret\n')
    await symlink(join(root, 'outside'), join(upstreamRoot, 'src'))
    await expect(
      auditCoreAlignment({
        manifest: fixtureManifest,
        upstreamRoot,
        localRoot,
        verifyCommit: false,
      }),
    ).rejects.toThrow('symbolic links are not allowed')
    await rm(root, { recursive: true, force: true })
  })
})
