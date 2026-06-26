import { describe, expect, test } from 'bun:test'
import {
  type MutableAppState,
  stopRunningLocalShellTasks,
} from '../beegame/query-engine-runner'

describe('QueryEngineSessionRuntime shell cleanup', () => {
  test('kills only running local shell tasks for the current runtime app state', async () => {
    const killed: string[] = []
    let state: MutableAppState = {
      tasks: {
        bash_running: {
          type: 'local_bash',
          status: 'running',
        },
        bash_completed: {
          type: 'local_bash',
          status: 'completed',
        },
        agent_running: {
          type: 'local_agent',
          status: 'running',
        },
      },
    }

    const killedTaskIds = await stopRunningLocalShellTasks(
      state,
      updater => {
        state = updater(state)
      },
      taskId => {
        killed.push(taskId)
      },
    )

    expect(killedTaskIds).toEqual(['bash_running'])
    expect(killed).toEqual(['bash_running'])
  })
})
