import { expect, test } from 'bun:test'
import { readFile, realpath } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

test('public Revision bundles the whole lifecycle without another stage, old runtime or infrastructure implementation', async () => {
  const root = await realpath(resolve(import.meta.dir, '../..'))
  const zodRoot = await realpath(dirname(fileURLToPath(import.meta.resolve('zod/package.json'))))
  const fileRunner = await realpath(fileURLToPath(import.meta.resolve('@bee-game-studio/agent-workflow/native-file-agent')))
  const taskAccess = await realpath(fileURLToPath(import.meta.resolve('@bee-game-studio/agent-workflow/native-task-access')))
  const loaded = new Set<string>()
  const allowedNode = new Set(['node:crypto', 'node:fs', 'node:fs/promises', 'node:path', 'node:os', 'node:child_process'])
  const built = await Bun.build({ entrypoints: [resolve(root, 'public.ts')], target: 'bun',
    plugins: [{ name: 'audit-public-revision', setup(build) {
      build.onResolve({ filter: /.*/ }, args => {
        if (args.path === '@bee-game-studio/agent-workflow/native-file-agent') return { path: fileRunner }
        if (args.path.startsWith('node:')) {
          if (!allowedNode.has(args.path)) throw new Error(`Unexpected Revision builtin ${args.path}`)
          return { path: args.path, external: true }
        }
        if (args.path !== 'zod/v4' && !args.path.startsWith('.') && !args.path.startsWith('/'))
          throw new Error(`Unexpected Revision package ${args.path}`)
      })
      build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async args => {
        const path = await realpath(args.path)
        if ((!path.startsWith(root + sep) && !path.startsWith(zodRoot + sep) && ![fileRunner, taskAccess].includes(path)) || path.includes(`${sep}tests${sep}`))
          throw new Error(`Revision lifecycle dependency escaped ${path}`)
        loaded.add(path)
        return { contents: await readFile(path, 'utf8'), loader: path.endsWith('.ts') ? 'ts' : 'js' }
      })
    } }],
  })
  expect(built.logs.filter(log => log.level === 'error')).toEqual([])
  expect(built.success).toBe(true)
  for (const file of ['document-set-output.ts', 'worker-input.ts', 'worker-output.ts', 'single-review-authority.ts',
    'candidate-changes.ts', 'native-assignment.ts', 'planning.ts', 'markdown.ts', 'complete-document.ts'])
    expect(loaded.has(resolve(root, 'private', file))).toBe(false)
  for (const file of ['lifecycle.ts', 'owned-attempt.ts', 'usage-outbox.ts', 'execution-lease.ts', 'completed-candidate.ts'])
    expect(loaded.has(resolve(root, 'private', file))).toBe(true)
})
