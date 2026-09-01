import { describe, expect, test } from 'bun:test'
import {
  GameIrStageCheckpointLoader,
  GameIrStageCheckpointWriter,
  GAME_IR_CHECKPOINT_SCHEMA_VERSION,
} from './stage-checkpoint'

describe('v46 Game IR stage checkpoint boundary', () => {
  test('exports the strict v46 checkpoint protocol', () => {
    expect(GAME_IR_CHECKPOINT_SCHEMA_VERSION).toBe('game-ir-stage-checkpoint.v46')
    expect(new GameIrStageCheckpointWriter()).toBeDefined()
    expect(new GameIrStageCheckpointLoader()).toBeDefined()
  })

  test('rejects a checkpoint write without an admitted stage authority', async () => {
    const writer = new GameIrStageCheckpointWriter()
    await expect(
      writer.write({
        workspacePath: '/tmp/game-ir-stage-checkpoint-test',
        deliveryRun: {} as never,
        step: { kind: 'phase4.gameplay.source', record: {} } as never,
        authority: {} as never,
      }),
    ).rejects.toThrow()
  })
})
