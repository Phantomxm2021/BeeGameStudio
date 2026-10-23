import { afterEach, describe, expect, test } from 'bun:test'
import { access, mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getDashboardDataRoot,
  resolveSessionWorkspacePath,
  createManagedProjectWorkspacePath,
} from './local-runtime-service'

const originalWorkspacePath = process.env.AGENT_WORKFLOW_WORKSPACE_PATH
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true})))
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
    roots.push(root)
    process.env.AGENT_WORKFLOW_WORKSPACE_PATH = root

    await expect(
      resolveSessionWorkspacePath('/tmp/unmanaged-project'),
    ).rejects.toThrow(
      'Workspace path must stay inside the default Projects directory',
    )
  })

  test('rejects linked project roots and linked parents of new managed workspaces', async () => {
    const root = await mkdtemp(join(tmpdir(), 'beegame-workspace-link-')); roots.push(root)
    const projects = join(root, 'projects'), outside = join(root, 'outside')
    await Promise.all([mkdir(projects), mkdir(outside)])
    await symlink(outside, join(projects, 'alias'))
    await symlink(outside, join(projects, 'users'))
    await expect(resolveSessionWorkspacePath(join(projects, 'alias'), projects)).rejects.toThrow('symbolic link')
    await expect(resolveSessionWorkspacePath(join(projects, 'alias/new-project'), projects)).rejects.toThrow('symbolic link')
    await expect(createManagedProjectWorkspacePath({defaultWorkspacePath: projects, userId: 'owner', projectName: 'new-project'})).rejects.toThrow('symbolic link')
    await expect(access(join(outside, 'owner'))).rejects.toThrow()
  })

  test('allows the operator-configured root alias and ordinary new project directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'beegame-workspace-configured-')); roots.push(root)
    const projects = join(root, 'projects'), configured = join(root, 'configured')
    await mkdir(projects)
    await symlink(projects, configured)
    expect(await resolveSessionWorkspacePath(join(configured, 'new-project'), configured))
      .toBe(join(await realpath(projects), 'new-project'))
    const created = await createManagedProjectWorkspacePath({defaultWorkspacePath: configured, userId: 'owner', projectName: 'new-project'})
    expect(created).toBe(join(await realpath(projects), 'users/owner/new-project'))
    await access(created)
  })
})
