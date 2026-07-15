import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BeeGamePreviewManager, type BeeGamePreviewProcess } from '../beegame/preview-manager'

describe('BeeGamePreviewManager generic Vite contract', () => {
  const workspaces: string[] = []

  afterEach(async () => {
    await Promise.all(workspaces.splice(0).map(workspace => rm(workspace, { recursive: true, force: true })))
  })

  test('isolates a Vite development client from a production runtime environment', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'generic-vite-preview-'))
    workspaces.push(workspace)
    await writeFile(join(workspace, 'package.json'), JSON.stringify({
      scripts: { dev: 'vite' },
      devDependencies: { vite: '^8.0.0', '@vitejs/plugin-react': '^6.0.0' },
    }))

    const originalNodeEnv = process.env.NODE_ENV
    const originalSecret = process.env.BEEGAME_SKILLS_SERVICE_TOKEN
    const originalCwd = process.cwd()
    const captured: { command?: string[]; env?: Record<string, string> } = {}
    const processes: BeeGamePreviewProcess[] = []
    process.env.NODE_ENV = 'production'
    process.env.BEEGAME_SKILLS_SERVICE_TOKEN = 'must-not-reach-project-preview'
    try {
      const manager = new BeeGamePreviewManager(
        (command, options) => {
          captured.command = command
          captured.env = options.env
          const process = { kill: () => {}, exited: new Promise(() => {}) }
          processes.push(process)
          return process
        },
        63100,
        async () => 63100,
        async () => true,
      )
      await manager.start({ sessionId: 'generic-session', workspacePath: workspace })
    } finally {
      process.chdir(originalCwd)
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = originalNodeEnv
      if (originalSecret === undefined) delete process.env.BEEGAME_SKILLS_SERVICE_TOKEN
      else process.env.BEEGAME_SKILLS_SERVICE_TOKEN = originalSecret
    }

    expect(processes).toHaveLength(1)
    expect(captured.env?.NODE_ENV).toBe('development')
    expect(captured.env?.BEEGAME_SKILLS_SERVICE_TOKEN).toBeUndefined()
    expect(captured.command?.[0]).toBe(process.execPath)
    expect(captured.command?.[1]).toEndWith('vite-preview-host.ts')
    expect(captured.command).toContain('--base')
    expect(captured.command).toContain('/previews/generic-session/')
  })
})
