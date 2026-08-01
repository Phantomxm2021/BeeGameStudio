import { describe, expect, it } from 'bun:test'
import { validateAtomicTaskGraph } from '../beegame/delivery-workflow/atomic-task-planner'
import type { AtomicTask } from '../beegame/delivery-workflow/types'

const task: AtomicTask = {
  id: 'implement-player', title: 'Implement player', checklistIds: ['check.player'],
  resourceIds: ['player-art'], contentIds: ['entities'], dependsOn: [],
  allowedPaths: ['src/'], expectedArtifacts: ['src/player.ts'],
  verification: [{ kind: 'build', commandOrAction: 'build', expectedResult: 'passes' }],
  status: 'pending', attempt: 0, evidenceRefs: [],
}

describe('atomic task planner resource-content boundary', () => {
  it('covers checklist and content dependencies', () => {
    expect(() => validateAtomicTaskGraph([task], {
      checklistIds: ['check.player'], resourceIds: ['player-art'], contentIds: ['entities'],
    })).not.toThrow()
  })
  it('rejects unknown content', () => {
    expect(() => validateAtomicTaskGraph([task], {
      checklistIds: ['check.player'], resourceIds: ['player-art'], contentIds: ['other'],
    })).toThrow(/unknown content/i)
  })
})
