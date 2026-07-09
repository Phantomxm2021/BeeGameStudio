import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BeeGamePreviewManager,
  type BeeGamePreviewProcess,
} from '../beegame/preview-manager'

describe('BeeGamePreviewManager', () => {
  const workspaces: string[] = []

  afterEach(async () => {
    await Promise.all(workspaces.splice(0).map(workspace => rm(workspace, { recursive: true, force: true })))
  })

  test('identifies managed previews as web and advances generation only when replaced', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-preview-manager-'))
    workspaces.push(workspace)
    await writeFile(join(workspace, 'package.json'), JSON.stringify({
      scripts: { dev: 'vite' },
      devDependencies: { vite: '^6.0.0' },
    }))
    const processes: BeeGamePreviewProcess[] = []
    const manager = new BeeGamePreviewManager(
      (_command, options) => {
        options.onOutput('http://127.0.0.1:63100/\n')
        const process = { kill: () => {}, exited: new Promise(() => {}) }
        processes.push(process)
        return process
      },
      63100,
      async () => 63100,
      async () => true,
    )

    const started = await manager.start({ sessionId: 'session-a', workspacePath: workspace })
    const stopped = manager.stop('session-a', workspace)
    const restarted = await manager.start({ sessionId: 'session-a', workspacePath: workspace })

    expect(started).toMatchObject({ kind: 'web', engine: 'web', generation: 1 })
    expect(stopped.generation).toBe(started.generation)
    expect(restarted.generation).toBe(2)
    expect(processes).toHaveLength(2)
  })
})
