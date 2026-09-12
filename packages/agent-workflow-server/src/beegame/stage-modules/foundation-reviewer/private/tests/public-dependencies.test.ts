import { expect, test } from 'bun:test'
import { readFile, realpath } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

test('public Reviewer bundles the whole lifecycle without another stage, old runtime or infrastructure implementation', async () => {
  const root = await realpath(resolve(import.meta.dir, '../..'))
  const zodRoot = await realpath(dirname(fileURLToPath(import.meta.resolve('zod/package.json'))))
  const diffRoot = await realpath(dirname(fileURLToPath(import.meta.resolve('diff/package.json'))))
  const fileRunner = await realpath(fileURLToPath(import.meta.resolve('@bee-game-studio/agent-workflow/native-file-agent')))
  const taskAccess = await realpath(fileURLToPath(import.meta.resolve('@bee-game-studio/agent-workflow/native-task-access')))
  const loaded = new Set<string>()
  const allowedNode = new Set(['node:crypto', 'node:fs', 'node:fs/promises', 'node:path', 'node:os', 'node:child_process', 'node:string_decoder'])
  const built = await Bun.build({ entrypoints: [resolve(root, 'public.ts')], target: 'bun',
    plugins: [{ name: 'audit-public-reviewer', setup(build) {
      build.onResolve({ filter: /.*/ }, args => {
        if (args.path === '@bee-game-studio/agent-workflow/native-file-agent') return { path: fileRunner }
        if (args.path.startsWith('node:')) {
          if (!allowedNode.has(args.path)) throw new Error(`Unexpected Reviewer builtin ${args.path}`)
          return { path: args.path, external: true }
        }
        if (!['zod/v4', 'diff'].includes(args.path) && !args.path.startsWith('.') && !args.path.startsWith('/'))
          throw new Error(`Unexpected Reviewer package ${args.path}`)
      })
      build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async args => {
        const path = await realpath(args.path)
        if ((!path.startsWith(root + sep) && !path.startsWith(zodRoot + sep) && !path.startsWith(diffRoot + sep) && ![fileRunner, taskAccess].includes(path)) || path.includes(`${sep}tests${sep}`))
          throw new Error(`Reviewer lifecycle dependency escaped ${path}`)
        loaded.add(path)
        return { contents: await readFile(path, 'utf8'), loader: path.endsWith('.ts') ? 'ts' : 'js' }
      })
    } }],
  })
  expect(built.logs.filter(log => log.level === 'error')).toEqual([])
  expect(built.success).toBe(true)
  // The native file lifecycle must not retain historical validators or executors.
  for (const file of ['single-agent-native-worker.ts', 'single-agent-task.ts', 'single-agent-tool-task.ts',
    'single-agent-native-tools.ts', 'single-agent-trace.ts', 'single-agent-trace-protocol.ts',
    'single-agent-prompt.ts', 'gdd-led-review-task.ts', 'independent-audit-task.ts'])
    expect(loaded.has(resolve(root, 'private', file))).toBe(false)
  for (const file of ['archived-review-policy.ts', 'archived-review-validation.ts', 'single-agent-tools.ts', 'single-agent-report.ts', 'recoverable-review-journal.ts', 'independent-audit-validation.ts'])
    expect(loaded.has(resolve(root, 'private', file))).toBe(false)
  for (const file of ['single-agent-lifecycle.ts', 'native-files.ts', 'single-agent-journal.ts', 'single-agent-publication.ts'])
    expect(loaded.has(resolve(root, 'private', file))).toBe(true)
})
