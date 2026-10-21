import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const beegameRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'beegame',
)

describe('single native runtime boundary', () => {
  test('has no embedded workflow engine lane', () => {
    for (const retiredFile of [
      'query-engine-process-runner.ts',
      'query-engine-worker.ts',
      'query-engine-worker-protocol.ts',
      'query-engine-process-input.ts',
      'query-engine-runner.ts',
    ]) {
      expect(existsSync(resolve(beegameRoot, retiredFile))).toBe(false)
    }
  })

  test('session manager imports only the native process runner', () => {
    const source = readFileSync(resolve(beegameRoot, 'session-manager.ts'), 'utf8')
    expect(source).toContain("from '../bgs/runner'")
    expect(source).not.toContain('query-engine')
  })
})
