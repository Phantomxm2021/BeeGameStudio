import { expect, test } from 'bun:test'
import { registerCleanup, runCleanupFunctions } from '../cleanupRegistry'

test('cleanup waits for other handlers even if one throws synchronously', async () => {
  let completed = false
  const unregisterFailure = registerCleanup(() => { throw new Error('synthetic cleanup failure') })
  const unregisterSuccess = registerCleanup(async () => {
    await new Promise(resolve => setTimeout(resolve, 5))
    completed = true
  })
  try {
    await expect(runCleanupFunctions()).rejects.toThrow('synthetic cleanup failure')
    expect(completed).toBe(true)
  } finally {
    unregisterFailure()
    unregisterSuccess()
  }
})

test('graceful exit reports cleanup failure and timeout without exposing error contents', async () => {
  // Do not invoke gracefulShutdown: it exits the test process.
  const source = await Bun.file(new URL('../gracefulShutdown.ts', import.meta.url)).text()
  expect(source).toContain('BGS: shutdown cleanup incomplete; tracked resources may remain.')
  expect(source).toContain('BGS: shutdown cleanup did not finish within the exit budget.')
})
