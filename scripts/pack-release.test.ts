import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stageReleaseMetadata } from './pack-release'

test('release staging contains declared notices and scripts but not workspace state, previous builds or source', async () => {
  const root = await mkdtemp('/private/tmp/bgs-release-test-')
  try {
    const source = join(root, 'source')
    const stage = join(root, 'stage')
    await mkdir(join(source, 'dist/build-old'), { recursive: true })
    await mkdir(stage)
    await writeFile(join(source, 'dist/build-old/cli.js'), 'do not ship')
    await writeFile(join(source, 'NOTICE.md'), 'retain original authors')
    await writeFile(join(source, 'README.md'), 'BGS source')
    await writeFile(join(source, 'package.json'), JSON.stringify({ name: 'bee-game-studio',
      workspaces: ['packages/*'], devDependencies: { 'private-dev': 'workspace:*' },
      files: ['dist', 'NOTICE.md'], scripts: { prepublishOnly: 'do not ship', prepare: 'do not ship', postinstall: 'retained command' },
      dependencies: { sharp: '^0.34.5' } }))
    await stageReleaseMetadata(source, stage)
    const pkg = JSON.parse(await readFile(join(stage, 'package.json'), 'utf8'))
    expect(pkg.workspaces).toBeUndefined()
    expect(pkg.devDependencies).toBeUndefined()
    expect(pkg.scripts).toEqual({ postinstall: 'retained command' })
    expect(pkg.dependencies.sharp).toBe('^0.34.5')
    expect(await Bun.file(join(stage, 'NOTICE.md')).text()).toBe('retain original authors')
    expect(await Bun.file(join(stage, 'dist/build-old/cli.js')).exists()).toBe(false)
  } finally { await rm(root, { recursive: true, force: true }) }
})
