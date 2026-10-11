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
    {
      from: 'CLAUDE_CONFIG_DIR',
      to: 'BEEGAME_CONFIG_DIR',
    },
  ],
  fileSubstitutions: {},
  rootExceptions: {},
  generatedPaths: [],
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
    expect(value.literalSubstitutions).toContainEqual({
      from: 'CLAUDE_CONFIG_DIR',
      to: 'BEEGAME_CONFIG_DIR',
    })
  })

  test('CI audits the exact pinned upstream commit', async () => {
    const workflow = await Bun.file(
      resolve(import.meta.dir, '../../.github/workflows/core-alignment.yml'),
    ).text()

    expect(workflow).toContain(
      '3bb6b5746238c418138eb96d57765d79012edd96',
    )
    expect(workflow).toContain('bun run core:audit')
  })

  test('product substitutions target existing files and rename only locally maintained package namespaces', async () => {
    const root = resolve(import.meta.dir, '../..')
    const manifest = await loadAlignmentManifest(resolve(root, 'config/upstream-core-alignment.json'))
    for (const path of Object.keys(manifest.fileSubstitutions)) {
      expect(await Bun.file(resolve(root, path)).exists()).toBe(true)
    }
    for (const [from, to] of [
      ['@anthropic/ink', '@bee-game-studio/ink'],
      ['@anthropic/remote-control-server', '@bee-game-studio/remote-control-server'],
    ]) {
      expect(manifest.literalSubstitutions).toContainEqual({ from, to })
    }
    expect(manifest.fileSubstitutions).not.toHaveProperty('src/cli/updateCCB.ts')
  })
})

describe('upstream core audit', () => {
  test.each(['upstream', 'local'] as const)('rejects symlink ancestors of explicitly synchronized files (%s)', async side => {
    const root = await mkdtemp('/private/tmp/bgs-alignment-parent-')
    try {
      const upstreamRoot = join(root, 'upstream')
      const localRoot = join(root, 'local')
      await mkdir(upstreamRoot)
      await mkdir(localRoot)
      await writeFixture(join(root, 'outside'), 'check.ts', 'outside evidence')
      const linked = side === 'local' ? localRoot : upstreamRoot
      const ordinary = side === 'local' ? upstreamRoot : localRoot
      await symlink(join(root, 'outside'), join(linked, 'scripts'))
      await writeFixture(ordinary, 'scripts/check.ts', 'ordinary source')
      const input = { manifest: { ...fixtureManifest, synchronizedDirectories: [], synchronizedFiles: ['scripts/check.ts'] },
        upstreamRoot, localRoot, verifyCommit: false }
      await expect(auditCoreAlignment(input)).rejects.toThrow('symbolic links are not allowed')
      await expect(syncCoreAlignment(input)).rejects.toThrow('symbolic links are not allowed')
      expect(await readFile(join(root, 'outside/check.ts'), 'utf8')).toBe('outside evidence')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('sync preserves declared compatibility files and entry hooks without hiding audit differences', async () => {
    const root = await mkdtemp(join(tmpdir(), 'core-alignment-runtime-'))
    const upstreamRoot = join(root, 'upstream')
    const localRoot = join(root, 'local')
    const manifest = await loadAlignmentManifest(
      resolve(import.meta.dir, '../../config/upstream-core-alignment.json'),
    )
    expect(manifest.rootExceptions['src/utils/runtimeEnvironment.ts']).toBeDefined()
    expect(manifest.rootExceptions['src/entrypoints/cli.tsx']).toBeDefined()
    const helper = await Bun.file(resolve(import.meta.dir, '../../src/utils/runtimeEnvironment.ts')).text()
    const entry = "import {normalizeRuntimeEnvironment} from '../utils/runtimeEnvironment'\nexport const environment = normalizeRuntimeEnvironment({CLAUDE_CODE_SIMPLE:'1'})\n"
    try {
      await writeFixture(upstreamRoot, 'src/entrypoints/cli.tsx', 'export const upstream = true\n')
      await writeFixture(upstreamRoot, 'src/normal.ts', 'export const updated = true\n')
      await writeFixture(localRoot, 'src/entrypoints/cli.tsx', entry)
      await writeFixture(localRoot, 'src/utils/runtimeEnvironment.ts', helper)
      await writeFixture(localRoot, 'src/normal.ts', 'old\n')
      await writeFixture(localRoot, 'src/unapproved.ts', 'unexpected\n')
      const input = {
        manifest: { ...fixtureManifest, rootExceptions: manifest.rootExceptions },
        upstreamRoot, localRoot, verifyCommit: false,
      }
      await syncCoreAlignment(input)
      expect(await Bun.file(join(localRoot, 'src/entrypoints/cli.tsx')).text()).toBe(entry)
      expect(await Bun.file(join(localRoot, 'src/utils/runtimeEnvironment.ts')).text()).toBe(helper)
      expect(await Bun.file(join(localRoot, 'src/normal.ts')).text()).toBe('export const updated = true\n')
      expect(await Bun.file(join(localRoot, 'src/unapproved.ts')).exists()).toBe(false)
      expect((await import(join(localRoot, 'src/entrypoints/cli.tsx'))).environment).toEqual({ BGS_SIMPLE: '1' })
      expect((await auditCoreAlignment(input)).differences).toEqual([
        { kind: 'modified', path: 'src/entrypoints/cli.tsx' },
        { kind: 'local-only', path: 'src/utils/runtimeEnvironment.ts' },
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('applies only declared branding substitutions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'core-alignment-branding-'))
    const upstreamRoot = join(root, 'upstream')
    const localRoot = join(root, 'local')
    const url = 'https://remote-control.example.test/'
    await writeFixture(
      upstreamRoot,
      'src/runtime.ts',
      `import '@claude-code-best/builtin-tools'\nexport const configDir = process.env.CLAUDE_CONFIG_DIR\nexport const url = '${url}'\n`,
    )
    await writeFixture(
      localRoot,
      'src/runtime.ts',
      `import '@bee-game-studio/builtin-tools'\nexport const configDir = process.env.BEEGAME_CONFIG_DIR\nexport const url = '${url}'\n`,
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
      "import '@claude-code-best/builtin-tools'\nexport const configDir = process.env.CLAUDE_CONFIG_DIR\n",
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
      "import '@bee-game-studio/builtin-tools'\nexport const configDir = process.env.BEEGAME_CONFIG_DIR\n",
    )
    expect(
      new Uint8Array(await readFile(join(localRoot, 'src/runtime.bin'))),
    ).toEqual(new Uint8Array([0xff, 0x00, 0x81]))
    expect(await Bun.file(join(localRoot, 'src/local-only.ts')).exists()).toBe(
      false,
    )
    await rm(root, { recursive: true, force: true })
  })

  test('applies branding substitutions to valid UTF-8 source containing NUL', async () => {
    const root = await mkdtemp(join(tmpdir(), 'core-alignment-utf8-nul-'))
    const upstreamRoot = join(root, 'upstream')
    const localRoot = join(root, 'local')
    const upstreamSource =
      "process.env.CLAUDE_CONFIG_DIR\nconst control = '\0'\n"
    await writeFixture(upstreamRoot, 'src/runtime.ts', upstreamSource)
    await mkdir(localRoot, { recursive: true })

    await syncCoreAlignment({
      manifest: fixtureManifest,
      upstreamRoot,
      localRoot,
      verifyCommit: false,
    })

    expect(await Bun.file(join(localRoot, 'src/runtime.ts')).text()).toBe(
      "process.env.BEEGAME_CONFIG_DIR\nconst control = '\0'\n",
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

  test('ignores dependency installation links inside source packages', async () => {
    const root = await mkdtemp(join(tmpdir(), 'core-alignment-dependencies-'))
    const upstreamRoot = join(root, 'upstream')
    const localRoot = join(root, 'local')
    await writeFixture(upstreamRoot, 'src/runtime.ts', 'export {}\n')
    await writeFixture(localRoot, 'src/runtime.ts', 'export {}\n')
    await mkdir(join(root, 'dependencies'), { recursive: true })
    await symlink(
      join(root, 'dependencies'),
      join(upstreamRoot, 'src/node_modules'),
    )
    await symlink(
      join(root, 'dependencies'),
      join(localRoot, 'src/node_modules'),
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

  test('ignores only exact manifest-declared generated files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'core-alignment-generated-'))
    const upstreamRoot = join(root, 'upstream')
    const localRoot = join(root, 'local')
    await writeFixture(upstreamRoot, 'src/runtime.ts', 'export {}\n')
    await writeFixture(localRoot, 'src/runtime.ts', 'export {}\n')
    await writeFixture(localRoot, 'src/vendor/rg', new Uint8Array([1, 2, 3]))
    await writeFixture(localRoot, 'src/vendor/unapproved', 'unexpected\n')

    expect(
      (
        await auditCoreAlignment({
          manifest: {
            ...fixtureManifest,
            generatedPaths: ['src/vendor/rg'],
          },
          upstreamRoot,
          localRoot,
          verifyCommit: false,
        })
      ).differences,
    ).toEqual([{ kind: 'local-only', path: 'src/vendor/unapproved' }])
    await rm(root, { recursive: true, force: true })
  })
})
