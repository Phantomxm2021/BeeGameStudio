import { describe, expect, test } from 'bun:test'
import { checkpointCoversGameIrTerminal } from './recovery'
import type { DeliveryRun } from './types'

function runFor(moduleId: string, operation: 'projection' | 'validation') {
  return {
    phase: 'GAME_IR_COMPILATION',
    activeDispatch: {
      workerType: 'game-ir-compiler',
      status: 'completed',
      request: {
        contract: {
          kind: operation,
          packet:
            operation === 'projection'
              ? { source: { moduleId } }
              : { moduleId },
        },
      },
      terminalResult: {
        workerType: 'game-ir-compiler',
        status: 'completed',
        operation,
      },
    },
  } as unknown as DeliveryRun
}

describe('Game IR checkpoint terminal recovery', () => {
  test('consumes only the terminal already represented by the exact checkpoint step', () => {
    expect(
      checkpointCoversGameIrTerminal(
        runFor('gameplay', 'projection'),
        'phase4/gameplay/projection',
      ),
    ).toBe(true)
    expect(
      checkpointCoversGameIrTerminal(
        runFor('gameplay', 'validation'),
        'phase4/gameplay/projection',
      ),
    ).toBe(false)
    expect(
      checkpointCoversGameIrTerminal(
        runFor('balance', 'projection'),
        'phase4/gameplay/projection',
      ),
    ).toBe(false)
  })
})
