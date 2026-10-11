import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, cp } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const script = resolve(import.meta.dir, '../build.ts')

test('dual-runtime build bundles libraries Bun treats as builtins, without checkout dependency leakage', () => fixture(async root => {
  await mkdir(join(root, 'node_modules/ws'), { recursive: true })
  await writeFile(join(root, 'node_modules/ws/package.json'), JSON.stringify({ name: 'ws', type: 'module', main: 'index.js' }))
  await writeFile(join(root, 'node_modules/ws/index.js'), 'export default "portable-ws-fixture"\n')
  await writeFile(join(root, 'src/entrypoints/cli.tsx'), 'import ws from "ws"; console.log(ws)\n')
  expect((await command(root, [script, '--outdir', 'isolated'])).code).toBe(0)
  const remote = await mkdtemp('/private/tmp/bgs-relocated-build-')
  try {
    await cp(join(root, 'isolated'), remote, { recursive: true })
    const child = Bun.spawn(['node', join(remote, 'cli-node.js')], { cwd: remote, stdout: 'pipe', stderr: 'pipe' })
    expect(await child.exited).toBe(0)
    expect((await new Response(child.stdout).text()).trim()).toBe('portable-ws-fixture')
  } finally { await rm(remote, { recursive: true, force: true }) }
}))

async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp('/private/tmp/bgs-build-safety-')
  try {
    for (const dir of ['src/entrypoints', 'vendor/audio-capture', 'src/utils/vendor/ripgrep', '.beegame/skills/builtinskills', 'dist'])
      await mkdir(join(root, dir), { recursive: true })
    await writeFile(join(root, 'src/entrypoints/cli.tsx'), 'console.log("synthetic-new-build")\n')
    await writeFile(join(root, 'dist/cli.js'), 'console.log("synthetic-old-build")\n')
    await writeFile(join(root, 'dist/cli-bun.js'), '#!/usr/bin/env bun\nimport "./cli.js"\n')
    await writeFile(join(root, 'dist/old-chunk.js'), 'export const value = "old lazy chunk"\n')
    await run(root)
  } finally { await rm(root, { recursive: true, force: true }) }
}

async function command(root: string, args: string[]) {
  const child = Bun.spawn([process.execPath, ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  return { code, stdout, stderr }
}

test.each(['bundle', 'copy', 'startup'] as const)('failed %s leaves the live entry and old chunks intact', kind => fixture(async root => {
  const entry = join(root, 'src/entrypoints/cli.tsx')
  if (kind === 'bundle') await writeFile(entry, 'const = invalid syntax')
  if (kind === 'copy') await rm(join(root, 'vendor/audio-capture'), { recursive: true })
  if (kind === 'startup') await writeFile(entry, 'throw new Error("synthetic startup failure")')
  expect((await command(root, [script])).code).not.toBe(0)
  expect(await readFile(join(root, 'dist/cli.js'), 'utf8')).toContain('synthetic-old-build')
  expect((await command(root, ['dist/cli-bun.js'])).stdout.trim()).toBe('synthetic-old-build')
  expect(await readFile(join(root, 'dist/old-chunk.js'), 'utf8')).toContain('old lazy chunk')
}))

test('successful builds publish launchers while retaining previous generations', () => fixture(async root => {
  const first = await command(root, [script])
  expect(first.code).toBe(0)
  expect((await command(root, ['dist/cli-bun.js'])).stdout.trim()).toBe('synthetic-new-build')
  const generation = (await readdir(join(root, 'dist'))).find(name => name.startsWith('build-'))!
  await writeFile(join(root, 'src/entrypoints/cli.tsx'), 'console.log("synthetic-next-build")\n')
  expect((await command(root, [script])).code).toBe(0)
  expect((await command(root, ['dist/cli-node.js'])).stdout.trim()).toBe('synthetic-next-build')
  expect((await command(root, [join('dist', generation, 'cli.js')])).stdout.trim()).toBe('synthetic-new-build')
  expect(await readFile(join(root, 'dist/old-chunk.js'), 'utf8')).toContain('old lazy chunk')
}))

test('custom output is isolated and a nonempty destination is never overwritten', () => fixture(async root => {
  expect((await command(root, [script, '--outdir', 'isolated'])).code).toBe(0)
  expect(await readFile(join(root, 'dist/cli.js'), 'utf8')).toContain('synthetic-old-build')
  const before = await readFile(join(root, 'isolated/cli.js'), 'utf8')
  const repeated = await command(root, [script, '--outdir', 'isolated'])
  expect(repeated.code).not.toBe(0)
  expect(repeated.stderr).toContain('new or empty directory')
  expect(await readFile(join(root, 'isolated/cli.js'), 'utf8')).toBe(before)
}))

test('a successful version fastpath cannot publish a CLI whose real command tree fails', () => fixture(async root => {
  await writeFile(join(root, 'src/entrypoints/cli.tsx'),
    'if (process.argv.includes("--version")) console.log("fixture-version"); else throw new Error("real command tree failed")\n')
  const built = await command(root, [script])
  expect(built.code).not.toBe(0)
  expect(built.stderr).toContain('real command tree failed')
  expect(await readFile(join(root, 'dist/cli.js'), 'utf8')).toContain('synthetic-old-build')
  expect((await command(root, ['dist/cli-bun.js'])).stdout.trim()).toBe('synthetic-old-build')
}))
