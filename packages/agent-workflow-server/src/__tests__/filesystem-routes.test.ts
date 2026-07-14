import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, mkdir, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentWorkflowApp } from '../app'

describe('filesystem routes', () => {
  test('lists directories from an absolute path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cc-fs-'))
    try {
      await mkdir(join(root, 'ProjectA'))
      await mkdir(join(root, 'ProjectB'))
      const app = createAgentWorkflowApp({
        currentUser: { id: 'filesystem-owner', role: 'owner' },
      })

      const res = await app.request(
        `/api/filesystem/directories?path=${encodeURIComponent(root)}`,
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      const resolvedRoot = await realpath(root)
      expect(body.path).toBe(resolvedRoot)
      expect(body.parentPath).toBe(await realpath(tmpdir()))
      expect(body.entries).toEqual([
        expect.objectContaining({
          name: 'ProjectA',
          path: join(resolvedRoot, 'ProjectA'),
        }),
        expect.objectContaining({
          name: 'ProjectB',
          path: join(resolvedRoot, 'ProjectB'),
        }),
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('rejects relative directory listing paths', async () => {
    const app = createAgentWorkflowApp({
      currentUser: { id: 'filesystem-owner', role: 'owner' },
    })

    const res = await app.request('/api/filesystem/directories?path=./WO')

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'Path must be absolute',
    })
  })

  test('creates and returns a default workspace directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cc-default-workspace-'))
    const workspace = join(root, 'Projects')
    const app = createAgentWorkflowApp({
      defaultWorkspacePath: workspace,
      currentUser: { id: 'filesystem-owner', role: 'owner' },
    })

    try {
      const res = await app.request('/api/filesystem/default-workspace')

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        path: await realpath(workspace),
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
