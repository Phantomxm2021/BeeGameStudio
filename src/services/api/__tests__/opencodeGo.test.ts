import { expect, test } from 'bun:test'

test('Go uses both real SDK routes and preserves session identity without changing other providers', () => {
  // Keep credential mocks and cached SDK clients isolated from other tests.
  const fixture = Bun.spawnSync([process.execPath, new URL('./opencodeGo.fixture.ts', import.meta.url).pathname], {
    cwd: process.cwd(), env: process.env, stdout: 'pipe', stderr: 'pipe',
  })
  expect(fixture.exitCode, fixture.stderr.toString()).toBe(0)
  expect(fixture.stdout.toString()).toContain('Go request headers and SDK routes passed')
})
