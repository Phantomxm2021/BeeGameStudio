import { describe, expect, test } from 'bun:test'
import { getDefaultConsoleCommandForTesting } from '../console/session-manager'

describe('console session manager', () => {
  test('uses the current Bun executable for the default Claude Code command', () => {
    const command = getDefaultConsoleCommandForTesting()

    expect(command[0]).toBe(process.execPath)
    expect(command[1]).toBe('run')
    expect(command[2]).toEndWith('src/entrypoints/cli.tsx')
    expect(command[3]).toBe('-p')
  })
})
