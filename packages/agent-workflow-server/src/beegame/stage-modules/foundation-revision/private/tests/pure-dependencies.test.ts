import { expect, test } from 'bun:test'
import { readFile, realpath } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

async function assertPrivateBundle(entrypoints: string[], allowedNode: readonly string[], allowFileRunner = false) {
  const root = await realpath(resolve(import.meta.dir, '..'))
  const fileRunner = await realpath(fileURLToPath(import.meta.resolve('@bee-game-studio/agent-workflow/native-file-agent')))
  const taskAccess = await realpath(fileURLToPath(import.meta.resolve('@bee-game-studio/agent-workflow/native-task-access')))
  const zodRoot = await realpath(dirname(fileURLToPath(import.meta.resolve('zod/package.json'))))
  const loaded = new Set<string>()
  const built = await Bun.build({
    entrypoints: entrypoints.map(file => resolve(root, file)),
    target: 'bun',
    plugins: [{ name: 'audit-revision-pure-dependencies', setup(build) {
      build.onResolve({ filter: /.*/ }, args => {
        if (allowFileRunner && args.path === '@bee-game-studio/agent-workflow/native-file-agent') return { path: fileRunner }
        if (args.path.startsWith('node:')) {
          if (!allowedNode.includes(args.path)) throw new Error(`Revision bundle cannot access ${args.path}`)
          return { path: args.path, external: true }
        }
        if (args.path !== 'zod/v4' && !args.path.startsWith('.') && !args.path.startsWith('/'))
          throw new Error(`Unexpected pure Revision package: ${args.path}`)
        return undefined
      })
      build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async args => {
        const file = await realpath(args.path)
        if ((!file.startsWith(root + sep) && !file.startsWith(zodRoot + sep) && !(allowFileRunner && [fileRunner, taskAccess].includes(file))) || file.includes(`${sep}tests${sep}`))
          throw new Error(`Revision implementation escaped its private root: ${file}`)
        loaded.add(file)
        // Supply the inspected file directly so the bundler does not perform
        // a separate default-loader read after this asynchronous boundary check.
        const loader = /\.tsx$/.test(file) ? 'tsx' : /\.jsx$/.test(file) ? 'jsx' : /\.[cm]?ts$/.test(file) ? 'ts' : 'js'
        return { contents: await readFile(file, 'utf8'), loader }
      })
    } }],
  })
  expect(built.logs.filter(log => log.level === 'error')).toEqual([])
  expect(built.success).toBe(true)
  expect(loaded.size).toBeGreaterThanOrEqual(entrypoints.length)
  expect(built.outputs.length).toBe(entrypoints.length)
}

test('Revision preparation bundles using only its own implementation, zod and crypto', async () => {
  await assertPrivateBundle(['document-snapshot.ts', 'json-digest.ts', 'single-review-source.ts', 'revision-snapshot.ts',
    'candidate-result.ts', 'candidate-construction.ts', 'request-preparation.ts', 'native-usage.ts',
    'request-execution-state.ts', 'usage-billing.ts', 'lifecycle-contract.ts'], ['node:crypto'])
}, 20_000)

test('Revision candidate publication has no other stage, old runtime, process or network dependency', async () => {
  await assertPrivateBundle(['candidate-publication.ts', 'request-store.ts', 'native-environment.ts', 'attempt-store.ts', 'completed-candidate.ts', 'usage-outbox.ts', 'execution-lease.ts'], ['node:crypto', 'node:fs', 'node:fs/promises', 'node:path', 'node:os'])
}, 20_000)

test('Revision native process owns its execution without importing the old runner or other stages', async () => {
  await assertPrivateBundle(['native-process.ts'], ['node:crypto', 'node:child_process', 'node:path', 'node:fs/promises'], true)
}, 20_000)

test('Revision owned attempt composes only private execution and storage components', async () => {
  await assertPrivateBundle(['owned-attempt.ts'], ['node:crypto', 'node:child_process', 'node:path', 'node:fs', 'node:fs/promises', 'node:os'], true)
}, 20_000)
