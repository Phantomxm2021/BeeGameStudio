import { mkdir, realpath } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'

export type DefaultWorkspaceOptions = {
  defaultWorkspacePath?: string
}

export async function getDefaultWorkspacePath(
  options: DefaultWorkspaceOptions = {},
): Promise<string> {
  const configuredRaw = (
    options.defaultWorkspacePath?.trim() ||
    process.env.AGENT_WORKFLOW_WORKSPACE_PATH?.trim() ||
    ''
  )
  if (!configuredRaw)
    throw new Error('AGENT_WORKFLOW_WORKSPACE_PATH is required')
  if (!isAbsolute(configuredRaw))
    throw new Error('AGENT_WORKFLOW_WORKSPACE_PATH must be absolute')
  const configured = resolve(configuredRaw)

  await mkdir(configured, { recursive: true })
  return realpath(configured)
}
