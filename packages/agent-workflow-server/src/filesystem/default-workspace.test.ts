import { afterEach, describe, expect, test } from 'bun:test'
import { getDefaultWorkspacePath } from './default-workspace'

const originalWorkspacePath = process.env.AGENT_WORKFLOW_WORKSPACE_PATH

afterEach(() => {
  if (originalWorkspacePath === undefined)
    delete process.env.AGENT_WORKFLOW_WORKSPACE_PATH
  else process.env.AGENT_WORKFLOW_WORKSPACE_PATH = originalWorkspacePath
})

describe('default workspace', () => {
  test('fails closed instead of storing projects relative to the process cwd', async () => {
    delete process.env.AGENT_WORKFLOW_WORKSPACE_PATH

    await expect(getDefaultWorkspacePath()).rejects.toThrow(
      'AGENT_WORKFLOW_WORKSPACE_PATH is required',
    )
  })

  test('rejects a relative server-managed workspace root', async () => {
    process.env.AGENT_WORKFLOW_WORKSPACE_PATH = './Projects'

    await expect(getDefaultWorkspacePath()).rejects.toThrow(
      'AGENT_WORKFLOW_WORKSPACE_PATH must be absolute',
    )
  })
})
