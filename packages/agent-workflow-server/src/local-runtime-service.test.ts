import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getDashboardDataRoot,
  resolveSessionWorkspacePath,
} from './local-runtime-service'

const originalWorkspacePath = process.env.AGENT_WORKFLOW_WORKSPACE_PATH

afterEach(() => {
  if (originalWorkspacePath === undefined) {
    delete process.env.AGENT_WORKFLOW_WORKSPACE_PATH
  } else {
    process.env.AGENT_WORKFLOW_WORKSPACE_PATH = originalWorkspacePath
  }
})

describe('server-managed workspace boundary', () => {
  test('does not fall back to a Projects directory under the process cwd', () => {
    delete process.env.AGENT_WORKFLOW_WORKSPACE_PATH

    expect(() => getDashboardDataRoot()).toThrow(
      'AGENT_WORKFLOW_WORKSPACE_PATH is required',
    )
  })

  test('always rejects a session workspace outside the configured root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'beegame-workspace-root-'))
    process.env.AGENT_WORKFLOW_WORKSPACE_PATH = root

    await expect(
      resolveSessionWorkspacePath('/tmp/unmanaged-project'),
    ).rejects.toThrow(
      'Workspace path must stay inside the default Projects directory',
    )
  })
})
