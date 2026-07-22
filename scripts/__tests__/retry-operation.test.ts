import { describe, expect, test } from 'bun:test'
import { retryOperation } from '../retry-operation'

describe('retryOperation', () => {
  test('retries an idempotent operation with bounded backoff', async () => {
    let calls = 0
    const delays: number[] = []
    const result = await retryOperation(
      async () => {
        calls += 1
        if (calls < 3) throw new Error('transient')
        return 'ready'
      },
      { baseDelayMs: 10, sleep: async delay => void delays.push(delay) },
    )
    expect(result).toBe('ready')
    expect(calls).toBe(3)
    expect(delays).toEqual([10, 20])
  })

  test('preserves the terminal failure after the configured bound', async () => {
    let calls = 0
    await expect(
      retryOperation(
        async () => {
          calls += 1
          throw new Error('still unavailable')
        },
        { attempts: 2, baseDelayMs: 0, sleep: async () => undefined },
      ),
    ).rejects.toThrow('still unavailable')
    expect(calls).toBe(2)
  })
})
