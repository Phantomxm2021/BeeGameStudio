import { afterEach, describe, expect, test } from 'bun:test'
import { isAbsolute, resolve } from 'node:path'
import { getDebugLogPath } from '../debug.js'

const originalDebugLogsDir = process.env.CLAUDE_CODE_DEBUG_LOGS_DIR

afterEach(() => {
  if (originalDebugLogsDir === undefined) {
    delete process.env.CLAUDE_CODE_DEBUG_LOGS_DIR
  } else {
    process.env.CLAUDE_CODE_DEBUG_LOGS_DIR = originalDebugLogsDir
  }
})

describe('debug log path runner', () => {
  test('resolves a configured relative log directory before writes occur', () => {
    process.env.CLAUDE_CODE_DEBUG_LOGS_DIR = 'debug-output'

    const debugLogPath = getDebugLogPath()

    expect(isAbsolute(debugLogPath)).toBe(true)
    expect(debugLogPath).toStartWith(resolve('debug-output'))
  })
})
