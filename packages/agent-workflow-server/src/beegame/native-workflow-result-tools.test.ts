import { describe, expect, test } from 'bun:test'
import { createNativeWorkflowResultTool } from './native-workflow-result-tools'

describe('native workflow result tools', () => {
  test('does not expose a Reviewer semantic submission tool', () => {
    expect(() =>
      createNativeWorkflowResultTool({
        workerType: 'document-reviewer' as never,
        buildTool(value) {
          return value
        },
      }),
    ).toThrow()
  })
})
