import { describe, expect, test } from 'bun:test'
import { relative, resolve } from 'node:path'

const PROJECT_ROOT = resolve(__dirname, '..', '..', '..')
const RUNNER_ABS = resolve(__dirname, 'debugPaths.runner.ts')
const RUNNER_REL = './' + relative(PROJECT_ROOT, RUNNER_ABS).replace(/\\/g, '/')

describe('debug log paths', () => {
  test('resolves configured paths in an isolated process', async () => {
    const proc = Bun.spawn([process.execPath, 'test', RUNNER_REL], {
      cwd: PROJECT_ROOT,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const code = await proc.exited
    if (code !== 0) {
      const stderr = await new Response(proc.stderr).text()
      const stdout = await new Response(proc.stdout).text()
      throw new Error(
        `debug path test subprocess failed (exit ${code}):\n${(
          stderr + '\n' + stdout
        ).slice(-5000)}`,
      )
    }

    expect(code).toBe(0)
  })
})
