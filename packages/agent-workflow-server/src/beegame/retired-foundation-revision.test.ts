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
    expect(loaded.has(resolve(import.meta.dir, path))).toBe(true)
})

test('Revision impact analysis has no delivery-workflow compatibility copy', () => {
  const retiredPath = resolve(import.meta.dir, 'delivery-workflow/foundation-impact-analysis.ts')
  const reviewerPath = resolve(import.meta.dir, 'stage-modules/foundation-reviewer/private/domain/foundation-impact-analysis.ts')
  expect(existsSync(retiredPath)).toBe(false)
  expect(existsSync(reviewerPath)).toBe(true)
  expect(readFileSync(reviewerPath, 'utf8')).toContain('export function analyzeFoundationImpact')
  for (const path of ['controller.ts', 'dispatch.ts', 'recovery.ts', 'run-store.ts', 'transition.ts']) {
    const source = readFileSync(resolve(import.meta.dir, 'delivery-workflow', path), 'utf8')
    expect(source).not.toContain('foundation-impact-analysis')
  }
})
