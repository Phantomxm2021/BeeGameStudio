import { describe, expect, test } from 'bun:test'
import { readCommittedGameIr } from './committed-reader'

describe('committed Game IR reader', () => {
  test('exposes the single workspace/run-bound reader entry point', async () => {
    await expect(
      readCommittedGameIr({ workspacePath: '/tmp/missing-game-ir', deliveryRun: {} as never }),
    ).rejects.toThrow()
  })
})
