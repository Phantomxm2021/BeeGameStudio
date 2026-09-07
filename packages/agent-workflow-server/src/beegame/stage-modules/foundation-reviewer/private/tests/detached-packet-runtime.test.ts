import { expect, test } from 'bun:test'
import { mkdtemp, realpath, writeFile, rm, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'

test('private fact/source/confirmation packets execute outside the repository with a closed bundle', async () => {
  const moduleRoot = resolve(import.meta.dir, '..')
  const loaded = new Set<string>()
  const build = await Bun.build({
    entrypoints: [join(moduleRoot, 'test-fixtures/detached-reviewer.ts'), join(moduleRoot, 'test-fixtures/native-reviewer.ts')],
    target: 'bun',
    plugins: [{ name: 'reviewer-private-boundary', setup(builder) {
      builder.onLoad({ filter: /.*/ }, async args => {
        loaded.add(args.path)
        if (!args.path.startsWith(moduleRoot + sep) && !args.path.includes('/node_modules/zod/'))
          throw new Error('Unexpected transitive Reviewer packet dependency: ' + args.path)
        // Serve the inspected bytes directly, without a separate default-loader
        // read against the long-running suite's compiler filesystem cache.
        return { contents: await readFile(args.path, 'utf8'), loader: args.path.endsWith('.ts') ? 'ts' : 'js' }
      })
    } }],
  })
  expect(build.success).toBe(true)
  expect(build.logs).toEqual([])
  expect(loaded.has(join(moduleRoot, 'native-worker.ts'))).toBe(true)
  expect(loaded.has(join(moduleRoot, 'worker-schemas.ts'))).toBe(true)
  expect(loaded.has(join(moduleRoot, 'fact-journal.ts'))).toBe(true)
  const isolated = await realpath(await mkdtemp(join(tmpdir(), 'reviewer-detached-')))
  let child: ReturnType<typeof Bun.spawn> | undefined
  try {
    for (const output of build.outputs) {
      const name = output.path.endsWith('/detached-reviewer.js') ? 'detached-reviewer.js' : 'native-reviewer.js'
      await writeFile(join(isolated, name), await output.text())
    }
    const spawned = Bun.spawn([process.execPath, join(isolated, 'detached-reviewer.js'), join(isolated, 'native-reviewer.js')], {
      cwd: isolated, env: { PATH: '/usr/bin:/bin', TMPDIR: tmpdir() }, stdout: 'pipe', stderr: 'pipe',
    })
    child = spawned
    const [stdout, stderr, exit] = await Promise.all([new Response(spawned.stdout).text(), new Response(spawned.stderr).text(), spawned.exited])
    expect(stderr).toBe('')
    expect(exit).toBe(0)
    const result = JSON.parse(stdout)
    expect(result.fact.value.receipts.length).toBeGreaterThan(0)
    expect(result.source.value.outcome).toBe('PASS')
    expect(result.confirmation.value.outcome).toBe('PASS')
    expect(result.source.value.packetIdentity).toBe(result.confirmation.value.packetIdentity)
    expect([result.fact.usage.total_tokens, result.source.usage.total_tokens, result.confirmation.usage.total_tokens]).toEqual([10, 10, 10])
    expect(result.journal).toEqual({ taskStatus: 'completed', usage: 10 })
    expect((await readdir(isolated)).sort()).toEqual(['.beegame', 'detached-reviewer.js', 'native-reviewer.js'])
  } finally {
    child?.kill()
    if (child) await child.exited
    await rm(isolated, { recursive: true, force: true })
  }
}, 15_000)
