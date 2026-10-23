import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BeeGamePreviewManager, type BeeGamePreviewProcess } from '../beegame/preview-manager'

describe('BeeGamePreviewManager generic Vite contract', () => {
  const workspaces: string[] = []

  afterEach(async () => {
    await Promise.all(workspaces.splice(0).map(workspace => rm(workspace, { recursive: true, force: true })))
  })

  test('production selection never silently reuses development or starts a build', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'preview-modes-'))
    workspaces.push(workspace)
    await writeFile(join(workspace, 'package.json'), JSON.stringify({ scripts: { dev: 'vite', preview: 'vite preview', build: 'vite build' }, devDependencies: { vite: '*' } }))
    const calls: { command: string[]; env: Record<string, string> }[] = []
    let stopped = 0
    const manager = new BeeGamePreviewManager((command, options) => {
      calls.push({ command, env: options.env }); return { kill() { stopped++ } }
    }, 63100, async () => 63100, async () => true)
    try {
      await manager.start({ sessionId: 'test', workspacePath: workspace })
      const production = await manager.start({ sessionId: 'test', workspacePath: workspace, mode: 'production' })
      expect(calls).toHaveLength(2)
      expect(stopped).toBe(1)
      expect(production.mode).toBe('production')
      expect(calls[1]!.command).toContain('preview')
      expect(calls[1]!.command).not.toContain('build')
      expect(calls[1]!.env.NODE_ENV).toBe('production')
      await manager.start({ sessionId: 'test', workspacePath: workspace, mode: 'production' })
      expect(calls).toHaveLength(2)
    } finally { manager.dispose() }
    await writeFile(join(workspace, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }))
    const missing = await manager.start({ sessionId: 'missing', workspacePath: workspace, mode: 'production' })
    expect(missing.status).toBe('unsupported')
    expect(calls).toHaveLength(2)
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
      expect(manager.runningForWorkspace(workspace)?.sessionId).toBe('generic-session')
      expect(manager.runningForWorkspace(join(workspace, 'different-project'))).toBeUndefined()
      manager.stop('generic-session', workspace)
      expect(manager.runningForWorkspace(workspace)).toBeUndefined()
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

  test('stops every owned preview process when the server lifecycle is disposed', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'generic-vite-preview-dispose-'))
    workspaces.push(workspace)
    await writeFile(join(workspace, 'package.json'), JSON.stringify({
      scripts: { dev: 'vite' },
      devDependencies: { vite: '^8.0.0' },
    }))
    let killed = 0
    const manager = new BeeGamePreviewManager(
      () => ({
        kill: () => { killed += 1 },
        exited: new Promise(() => {}),
      }),
      63100,
      async () => 63100,
      async () => true,
    )

    await manager.start({ sessionId: 'generic-dispose-session', workspacePath: workspace })
    manager.dispose()

    expect(killed).toBe(1)
    expect(manager.status('generic-dispose-session', workspace).status).toBe('idle')
  })

  const sandboxTest = process.env.BGS_SANDBOX_TESTS === '1' ? test : test.skip
  sandboxTest('default preview runner keeps dev scripts inside the project sandbox', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preview-sandbox-'))
    const workspace = join(root, 'project')
    const outside = join(root, 'outside')
    await mkdir(workspace, { recursive: true })
    await mkdir(outside, { recursive: true })
    const outsideSecret = join(outside, 'secret.txt')
    const outsideMarker = join(outside, 'marker.txt')
    await writeFile(outsideSecret, 'sandbox-secret')
    await writeFile(join(workspace, 'package.json'), JSON.stringify({ scripts: { dev: 'node dev.cjs' } }))
    await writeFile(join(workspace, 'dev.cjs'), `const fs=require('node:fs');const path=require('node:path');const outside=path.resolve(process.cwd(),'..','outside');let read=false,write=false;try{fs.readFileSync(path.join(outside,'secret.txt'));read=true}catch{}try{fs.writeFileSync(path.join(outside,'marker.txt'),'escaped');write=true}catch{}fs.writeFileSync(path.join(process.cwd(),'sandbox-result.json'),JSON.stringify({read,write}));process.on('SIGTERM',()=>{});require('node:http').createServer((_req,res)=>res.end('ok')).listen(Number(process.env.PORT),'127.0.0.1')`)
    const readiness = async (url: string): Promise<boolean> => {
      const deadline = Date.now() + 5_000
      while (Date.now() < deadline) {
        try {
          const response = await fetch(url)
          await response.body?.cancel()
          if (response.ok) return true
        } catch { /* The child may still be starting. */ }
        await Bun.sleep(25)
      }
      return false
    }
    const manager = new BeeGamePreviewManager(undefined, 63100, async () => 63100, readiness)
    try {
      const snapshot = await manager.start({ sessionId: 'sandbox-preview', workspacePath: workspace })
      expect(snapshot.status).toBe('running')
      const result = JSON.parse(await Bun.file(join(workspace, 'sandbox-result.json')).text()) as { read: boolean; write: boolean }
      expect(result).toEqual({ read: false, write: false })
      expect(await Bun.file(outsideMarker).exists()).toBe(false)
      expect(await Bun.file(outsideSecret).text()).toBe('sandbox-secret')
      manager.dispose()
      await Bun.sleep(1_100)
      await expect(fetch(`http://127.0.0.1:${snapshot.port}/`)).rejects.toThrow()
    } finally {
      manager.dispose()
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)
})
