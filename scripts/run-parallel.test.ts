import { expect, test } from 'bun:test'
import { resolve } from 'node:path'

test('parallel install wrapper propagates a child failure', async () => {
  const child = Bun.spawn(['node', resolve(import.meta.dir, 'run-parallel.mjs'), '/nonexistent-bgs-fixture.cjs'], { stdout: 'pipe', stderr: 'pipe' })
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
  expect(code).not.toBe(0)
  expect(stderr).toContain('MODULE_NOT_FOUND')
})

test('parallel install wrapper accepts an empty task set', () => {
  expect(Bun.spawnSync(['node', resolve(import.meta.dir, 'run-parallel.mjs')]).exitCode).toBe(0)
})
