import { describe, expect, test } from 'bun:test'
import { createNativeFoundationFactResultTool } from './native-foundation-fact-result-tool'

describe('native foundation fact terminal tool', () => {
  test('is the single read-only scoped terminal and fences identity', async () => {
    const tool = createNativeFoundationFactResultTool({
      buildTool: definition => definition,
      runId: 'run-1',
      dispatchId: 'dispatch-1',
      taskId: 'task-1',
      revision: 'rev-1',
      packetDigest: 'a'.repeat(64),
    }) as Record<string, any>
    expect(tool.name).toBe('SubmitFoundationFactResult')
    expect(tool.isReadOnly()).toBe(true)
    expect(await tool.checkPermissions({
      runId: 'run-1', dispatchId: 'dispatch-1', taskId: 'task-1', revision: 'rev-1', packetDigest: 'a'.repeat(64), results: [],
    })).toEqual({ behavior: 'allow', updatedInput: expect.any(Object) })
    expect(await tool.checkPermissions({
      runId: 'other', dispatchId: 'dispatch-1', taskId: 'task-1', revision: 'rev-1', packetDigest: 'a'.repeat(64), results: [],
    })).toMatchObject({ behavior: 'deny' })
  })
})
