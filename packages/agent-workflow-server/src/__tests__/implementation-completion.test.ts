import { describe, expect, it } from 'bun:test'
import { implementationComplete } from '../beegame/delivery-workflow/implementation-stage'
import type { DeliveryRun } from '../beegame/delivery-workflow/types'

describe('implementation completion boundary', () => {
  it('requires all resource-content tasks to complete', () => {
    const run = {
      phase: 'IMPLEMENTATION',
      tasks: [{ status: 'completed' }],
    } as DeliveryRun
    expect(implementationComplete(run)).toBe(true)
  })
})
