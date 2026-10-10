import { expect, test } from 'bun:test'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '../../..')

function checkBootstrap(
  raw: string[],
  expected: string[],
  bundled = false,
): void {
  // Bootstrap arguments are frozen at import time; isolate each launch mode.
  const child = Bun.spawnSync(
    [
      process.execPath,
      '-e',
      `
    import { strict as assert } from 'node:assert';
    process.execArgv.splice(0, process.execArgv.length, ...${JSON.stringify(raw)});
    if (${bundled}) Bun.embeddedFiles = [new Blob(['fixture'])];
    const { getBootstrapArgs } = await import(${JSON.stringify(resolve(root, 'src/utils/cliLaunch.ts'))});
    assert.deepEqual(getBootstrapArgs(), ${JSON.stringify(expected)});
  `,
    ],
    { cwd: root, stdout: 'pipe', stderr: 'pipe', timeout: 5000 },
  )
  if (child.exitCode !== 0) throw new Error(child.stderr.toString())
  expect(child.exitCode).toBe(0)
}

test('script CLI preserves adjacent boolean and value-bearing runtime flags', () => {
  const raw = [
    '--no-warnings',
    '--conditions',
    'production',
    '--loader',
    '/a path/loader.mjs',
  ]
  checkBootstrap(raw, raw)
})

test('script CLI preserves defines, feature flags, and equals-form flags', () => {
  const raw = [
    '-d',
    'MACRO.VERSION:"fixture"',
    '--feature',
    'fixture',
    '--conditions=production',
  ]
  checkBootstrap(raw, raw)
})

test('compiled CLI removes leaked application arguments but keeps known runtime flags', () => {
  checkBootstrap(
    [
      '--resume',
      'session',
      '--model',
      'model',
      '--feature',
      'fixture',
      '-d',
      'MACRO.VERSION:"fixture"',
    ],
    ['--feature', 'fixture', '-d', 'MACRO.VERSION:"fixture"'],
    true,
  )
})
