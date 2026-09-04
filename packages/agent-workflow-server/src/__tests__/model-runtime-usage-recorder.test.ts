import { describe, expect, test } from 'bun:test'
import { createUsageRecorder } from '../app'

const usage = {
  input_tokens: 100,
  output_tokens: 40,
  cache_read_tokens: 20,
  cache_creation_tokens: 10,
  total_tokens: 170,
}

describe('model runtime usage recorder', () => {
  test('keeps a completed model result when the single terminal debit fails', async () => {
    const recorded: Array<{ idempotencyKey: string; usage: unknown }> = []
    const debited: string[] = []
    const failures: Array<{
      diagnosticId: string
      idempotencyKey: string
      retryable: boolean
    }> = []
    const recorder = createUsageRecorder({
      sessionId: 'idea-intake:test',
      record: async input => {
        recorded.push(input)
        return { creditsMicro: 125 }
      },
      debit: async input => {
        debited.push(input.idempotencyKey)
        throw Object.assign(new Error('Insufficient realtime usage credits'), {
          retryable: false,
        })
      },
      onDebitFailed: failure => {
        failures.push(failure)
      },
    })

    await expect(recorder(usage, 'beegame_idea_intake')).resolves.toBeUndefined()
    await expect(recorder(usage, 'beegame_idea_intake')).resolves.toBeUndefined()

    expect(recorded).toHaveLength(1)
    expect(debited).toHaveLength(1)
    expect(recorded[0]?.usage).toEqual({
      prompt_tokens: 100,
      completion_tokens: 40,
      cache_read_tokens: 20,
      cache_creation_tokens: 10,
      total_tokens: 170,
    })
    expect(failures).toEqual([
      expect.objectContaining({
        diagnosticId: expect.stringMatching(/^billing_[a-f0-9]{16}$/),
        idempotencyKey: recorded[0]?.idempotencyKey,
        retryable: false,
      }),
    ])
  })

  test('does not hide a usage persistence failure', async () => {
    let attempts = 0
    const recorder = createUsageRecorder({
      sessionId: 'idea-intake:record-failure',
      record: async () => {
        attempts += 1
        throw new Error('usage ledger unavailable')
      },
      debit: async () => ({ creditsMicro: 0 }),
    })

    await expect(recorder(usage, 'beegame_idea_intake')).rejects.toThrow(
      'usage ledger unavailable',
    )
    await expect(recorder(usage, 'beegame_idea_intake')).rejects.toThrow(
      'usage ledger unavailable',
    )
    expect(attempts).toBe(2)
  })
})
