import { expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const retired = [
  'foundation-revision-markdown-stream.ts',
  ...['stage', 'publication', 'batches', 'round-policy', 'task-contracts']
    .map(name => `delivery-workflow/foundation-revision-${name}.ts`),
  'delivery-workflow/foundation-patch-validation.ts',
]

test('retired Revision execution stays absent from the production tree and app bundle', async () => {
  for (const path of retired) expect(existsSync(resolve(import.meta.dir, path))).toBe(false)
  const loaded = new Set<string>()
  const built = await Bun.build({
    entrypoints: [resolve(import.meta.dir, '../app.ts')], target: 'bun', packages: 'external',
    plugins: [{ name: 'revision-retirement-boundary', setup(build) {
      build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, args => { loaded.add(args.path) })
    } }],
  })
  expect(built.logs.filter(log => log.level === 'error')).toEqual([])
  expect(built.success).toBe(true)
  for (const path of retired) expect(loaded.has(resolve(import.meta.dir, path))).toBe(false)
  expect([...loaded].filter(path => /(?:\/tests\/|\/test-fixtures\/|\.test\.[cm]?[jt]sx?$)/.test(path))).toEqual([])
  for (const path of ['foundation-revision-host.ts', 'stage-modules/foundation-revision/public.ts',
    'stage-modules/foundation-revision/private/lifecycle.ts', 'stage-modules/foundation-revision/private/native-process.ts'])
    expect(loaded.has(resolve(import.meta.dir, path))).toBe(false)
})

test('production orchestration has no standalone Revision dependency', () => {
  const sources = [
    resolve(import.meta.dir, '../app.ts'),
    resolve(import.meta.dir, 'delivery-workflow/controller.ts'),
    resolve(import.meta.dir, 'delivery-workflow/foundation-review-link.ts'),
    resolve(import.meta.dir, 'delivery-workflow/foundation-public-handoff.ts'),
  ].map(path => readFileSync(path, 'utf8'))
  for (const source of sources) {
    expect(source).not.toContain('createFoundationRevision')
    expect(source).not.toContain('foundation-revision-host')
    expect(source).not.toContain('stage-modules/foundation-revision')
  }
})
