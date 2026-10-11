import { describe, expect, test } from 'bun:test'

const { interpretCommandResult } = await import('../commandSemantics')

describe('interpretCommandResult', () => {
  test.each(['cd /missing && rg pattern .', 'false && diff a b'])(
    'does not borrow an unexecuted command exit meaning: %s',
    command => {
      expect(interpretCommandResult(command, 1, '', '')).toEqual({
        isError: true,
        message: 'Command failed with exit code 1',
      })
      expect(interpretCommandResult(command, 0, '', '').isError).toBe(false)
    },
  )
  test.each(['false || rg pattern .', 'rg "a && b" file'])(
    'keeps non-AND search semantics: %s',
    command => {
      expect(interpretCommandResult(command, 1, '', '')).toEqual({
        isError: false,
        message: 'No matches found',
      })
    },
  )
  // ─── Default semantics ────────────────────────────────────────────
  test('exit 0 is not an error for unknown commands', () => {
    const result = interpretCommandResult('echo hello', 0, 'hello', '')
    expect(result.isError).toBe(false)
  })

  test('non-zero exit is an error for unknown commands', () => {
    const result = interpretCommandResult('echo hello', 1, '', 'fail')
    expect(result.isError).toBe(true)
    expect(result.message).toContain('exit code 1')
  })

  // ─── grep semantics ──────────────────────────────────────────────
  test('grep exit 0 is not an error', () => {
    const result = interpretCommandResult('grep pattern file', 0, 'match', '')
    expect(result.isError).toBe(false)
  })

  test('grep exit 1 means no matches (not error)', () => {
    const result = interpretCommandResult('grep pattern file', 1, '', '')
    expect(result.isError).toBe(false)
    expect(result.message).toBe('No matches found')
  })

  test('grep exit 2 is an error', () => {
    const result = interpretCommandResult('grep pattern file', 2, '', 'err')
    expect(result.isError).toBe(true)
  })

  // ─── diff semantics ──────────────────────────────────────────────
  test('diff exit 1 means files differ (not error)', () => {
    const result = interpretCommandResult('diff a.txt b.txt', 1, 'diff', '')
    expect(result.isError).toBe(false)
    expect(result.message).toBe('Files differ')
  })

  test('diff exit 2 is an error', () => {
    const result = interpretCommandResult('diff a.txt b.txt', 2, '', 'err')
    expect(result.isError).toBe(true)
  })

  // ─── test/[ semantics ────────────────────────────────────────────
  test('test exit 1 means condition false (not error)', () => {
    const result = interpretCommandResult('test -f nofile', 1, '', '')
    expect(result.isError).toBe(false)
    expect(result.message).toBe('Condition is false')
  })

  // ─── piped commands ──────────────────────────────────────────────
  test('uses last command in pipe for semantics', () => {
    // "cat file | grep pattern" → last command is "grep pattern"
    const result = interpretCommandResult('cat file | grep pattern', 1, '', '')
    expect(result.isError).toBe(false)
    expect(result.message).toBe('No matches found')
  })

  // ─── rg (ripgrep) semantics ──────────────────────────────────────
  test('rg exit 1 means no matches (not error)', () => {
    const result = interpretCommandResult('rg pattern', 1, '', '')
    expect(result.isError).toBe(false)
    expect(result.message).toBe('No matches found')
  })

  // ─── find semantics ──────────────────────────────────────────────
  test('find exit 1 is partial success', () => {
    const result = interpretCommandResult("find . -name '*.ts'", 1, '', '')
    expect(result.isError).toBe(false)
    expect(result.message).toBe('Some directories were inaccessible')
  })
})
