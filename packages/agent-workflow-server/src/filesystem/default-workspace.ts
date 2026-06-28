import { mkdir, realpath } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'

export type DefaultWorkspaceOptions = {
  defaultWorkspacePath?: string
}

export async function getDefaultWorkspacePath(
  options: DefaultWorkspaceOptions = {},
): Promise<string> {
  const configuredRaw =
    options.defaultWorkspacePath?.trim() ||
    process.env.AGENT_WORKFLOW_WORKSPACE_PATH?.trim() ||
    resolve(process.cwd(), 'Projects')
  const configured = isAbsolute(configuredRaw)
    ? configuredRaw
    : resolve(process.cwd(), configuredRaw)
  if (!isAbsolute(configured)) {
    throw new Error('Default workspace path must be absolute')
  }

  await mkdir(configured, { recursive: true })
  return realpath(configured)
}
