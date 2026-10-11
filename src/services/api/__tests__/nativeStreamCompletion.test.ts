import { expect, test } from 'bun:test'

test('native Messages EOF is validated without replaying already-yielded tools', () => {
  // Module mocks must not replace real API clients in sibling test files.
  const fixture = Bun.spawnSync(
    [
      process.execPath,
      new URL('./nativeStreamCompletion.fixture.ts', import.meta.url).pathname,
    ],
    { cwd: process.cwd(), env: process.env, stdout: 'pipe', stderr: 'pipe' },
  )
  expect(fixture.exitCode, fixture.stderr.toString()).toBe(0)
  const output = JSON.parse(
    fixture.stdout.toString().trim().split('\n').at(-1)!,
  )
  for (const name of [
    'completedTextThenTruncatedTool',
    'terminalButUnclosedBlock',
    'emptyStream',
    'messageStopWithoutReason',
  ]) {
    expect(output[name], name).toMatchObject({
      calls: 2,
      errors: 0,
      recovered: true,
      toolMessages: 0,
    })
  }
  expect(output.completedToolThenTruncation).toEqual({
    calls: 1,
    errors: 1,
    recovered: false,
    toolMessages: 1,
  })
  for (const name of ['normal', 'terminalWithoutMessageStop', 'emptyEndTurn']) {
    expect(output[name], name).toMatchObject({
      calls: 1,
      errors: 0,
      recovered: false,
    })
  }
})
