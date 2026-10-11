import { expect, test } from 'bun:test'
import ts from 'typescript'
import plugin from './vite-plugin-feature-flags'
import { getBuildFeatures } from './defines'

test('all build entrypoints interpret feature flag values, including disabling defaults', () => {
  const features = getBuildFeatures({ FEATURE_NEW: '1', FEATURE_OFF: '0', FEATURE_EMPTY: '', FEATURE_GOAL: 'false' })
  expect(features).toContain('NEW')
  for (const name of ['OFF', 'EMPTY', 'GOAL']) expect(features).not.toContain(name)
  expect(() => getBuildFeatures({ FEATURE_TEST: 'invalid' })).toThrow('Invalid FEATURE_TEST')
})

async function transform(code: string): Promise<string> {
  const hook = plugin().transform as (code: string, id: string) => { code: string } | null
  return (await hook(code, '/fixture.ts'))?.code ?? code
}

test('transforms feature calls without rewriting string literals, comments or object methods', async () => {
  const output = await transform(`import { feature } from 'bun:bundle';
    const text = "feature('GOAL')"; // feature('GOAL')
    const enabled = feature('GOAL'); const unrelated = object.feature('GOAL');`)
  expect(output).toContain(`"feature('GOAL')"`)
  expect(output).toContain(`// feature('GOAL')`)
  expect(output).toContain('const enabled = true')
  expect(output).toContain("object.feature('GOAL')")
})

test('downlevels using declarations with real disposal, not a const rewrite', async () => {
  const output = await transform(`function run() { using _ = { [Symbol.dispose]() { globalThis.disposed = true; } }; }
    run();`)
  const runnable = ts.transpileModule(output, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText
  const context: { disposed?: boolean } = {}
  new Function('globalThis', runnable)(context)
  expect(context.disposed).toBe(true)
})

test('respects parameter, block, catch and hoisted bindings shadowing an imported feature', async () => {
  const output = await transform(`import { feature as check } from 'bun:bundle';
    globalThis.topLevel = check('GOAL');
    function run(check) { return check('GOAL'); }
    globalThis.parameter = run(() => 123);
    { const check = () => 456; globalThis.block = check('GOAL'); }
    try { throw () => 789; } catch (check) { globalThis.caught = check('GOAL'); }
    function hoisted() { return check('GOAL'); function check() { return 42; } }
    globalThis.hoisted = hoisted();`)
  const context: Record<string, unknown> = {}
  new Function('globalThis', output.replace(/^import[^\n]*\n/gm, ''))(context)
  expect(context).toEqual({ topLevel: true, parameter: 123, block: 456, caught: 789, hoisted: 42 })
})
