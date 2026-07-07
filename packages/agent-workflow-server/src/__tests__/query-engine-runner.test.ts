import { describe, expect, test } from 'bun:test'
import {
  ensureBeeGameMacroGlobals,
  type MutableAppState,
  stopRunningLocalShellTasks,
  toQueryEngineThinkingConfig,
} from '../beegame/query-engine-runner'

describe('QueryEngineSessionRuntime shell cleanup', () => {

  test('installs MACRO globals before loading root CLI modules', () => {
    const target = globalThis as typeof globalThis & { MACRO?: Record<string, string> }
    const previous = target.MACRO
    Reflect.deleteProperty(target, 'MACRO')
    try {
      ensureBeeGameMacroGlobals()

      expect(target.MACRO).toEqual(expect.objectContaining({
        VERSION: expect.any(String),
        BUILD_TIME: expect.any(String),
        FEEDBACK_CHANNEL: '',
        ISSUES_EXPLAINER: '',
        NATIVE_PACKAGE_URL: '',
        PACKAGE_URL: '',
        VERSION_CHANGELOG: '',
      }))
    } finally {
      if (previous === undefined) {
        Reflect.deleteProperty(target, 'MACRO')
      } else {
        target.MACRO = previous
      }
    }
  })

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

  test('maps BeeGame chat thinking mode to QueryEngine thinking config', () => {
    expect(toQueryEngineThinkingConfig('disabled')).toEqual({ type: 'disabled' })
    expect(toQueryEngineThinkingConfig('enabled')).toEqual({ type: 'adaptive' })
  })
})
