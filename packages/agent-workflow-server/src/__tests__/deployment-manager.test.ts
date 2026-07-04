import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BeeGameDeploymentManager,
  createSupabaseStorageDeploymentPublisher,
  type BeeGameDeploymentRunner,
} from '../beegame/deployment-manager'

describe('BeeGameDeploymentManager', () => {
  let root: string
  let workspace: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-deployments-'))
    workspace = join(root, 'projects', 'sample-game')
    await mkdir(workspace, { recursive: true })
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('builds a package project and publishes static output', async () => {
    const commands: string[][] = []
    const runner: BeeGameDeploymentRunner = async (command, options) => {
      commands.push(command)
      await mkdir(join(options.cwd, 'dist'), { recursive: true })
      await writeFile(join(options.cwd, 'dist', 'index.html'), '<h1>Playable</h1>')
      return { exitCode: 0, stdout: 'built', stderr: '' }
    }
    await writeFile(
      join(workspace, 'package.json'),
      JSON.stringify({ scripts: { build: 'vite build' } }),
    )

    const manager = new BeeGameDeploymentManager({
      dataRoot: root,
      runner,
      publicBaseUrl: 'http://127.0.0.1:3040',
    })
    const deployment = await manager.deploy({
      sessionId: 'beegame_test',
      projectId: 'project_test',
      workspacePath: workspace,
    })

    expect(deployment.status).toBe('succeeded')
    expect(deployment.url).toMatch(/^http:\/\/127\.0\.0\.1:3040\/deployments\/deploy_/)
    expect(deployment.buildCommand).toBe('npm run build')
    expect(commands).toEqual([['npm', 'run', 'build']])
    expect(await readFile(join(deployment.artifactPath || '', 'index.html'), 'utf8'))
      .toBe('<h1>Playable</h1>')
  })

  test('publishes static output through a configured remote publisher', async () => {
    const commands: string[][] = []
    const publishedFiles: Array<{ path: string; content: string }> = []
    const runner: BeeGameDeploymentRunner = async (command, options) => {
      commands.push(command)
      await mkdir(join(options.cwd, 'dist', 'assets'), { recursive: true })
      await writeFile(join(options.cwd, 'dist', 'index.html'), '<main>Remote game</main>')
      await writeFile(join(options.cwd, 'dist', 'assets', 'game.js'), 'console.log("play")')
      return { exitCode: 0, stdout: 'built', stderr: '' }
    }
    await writeFile(
      join(workspace, 'package.json'),
      JSON.stringify({ scripts: { build: 'vite build' } }),
    )

    const manager = new BeeGameDeploymentManager({
      dataRoot: root,
      runner,
      publicBaseUrl: 'http://127.0.0.1:3040',
      publisher: {
        publishStaticDirectory: async input => {
          for (const file of input.files) {
            publishedFiles.push({
              path: file.path,
              content: await file.text(),
            })
          }
          return {
            url: `https://cdn.example.com/games/${input.deploymentId}/`,
            artifactPath: `remote://${input.deploymentId}`,
            message: 'Remote deployment published',
          }
        },
      },
    })
    const deployment = await manager.deploy({
      sessionId: 'beegame_remote',
      projectId: 'project_remote',
      workspacePath: workspace,
    })

    expect(deployment.status).toBe('succeeded')
    expect(deployment.url).toBe('https://cdn.example.com/games/' + deployment.id + '/')
    expect(deployment.artifactPath).toBe(`remote://${deployment.id}`)
    expect(deployment.message).toBe('Remote deployment published')
    expect(commands).toEqual([['npm', 'run', 'build']])
    expect(publishedFiles).toEqual([
      { path: 'assets/game.js', content: 'console.log("play")' },
      { path: 'index.html', content: '<main>Remote game</main>' },
    ])
  })

  test('publishes static output to Supabase Storage with the user token', async () => {
    const uploads: Array<{
      url: string
      authorization: string | null
      apikey: string | null
      contentType: string | null
      body: string
    }> = []
    const runner: BeeGameDeploymentRunner = async (_command, options) => {
      await mkdir(join(options.cwd, 'dist', 'assets'), { recursive: true })
      await writeFile(join(options.cwd, 'dist', 'index.html'), '<main>Storage game</main>')
      await writeFile(join(options.cwd, 'dist', 'assets', 'game.js'), 'console.log("storage")')
      return { exitCode: 0, stdout: 'built', stderr: '' }
    }
    await writeFile(
      join(workspace, 'package.json'),
      JSON.stringify({ scripts: { build: 'vite build' } }),
    )

    const manager = new BeeGameDeploymentManager({
      dataRoot: root,
      runner,
      publisher: createSupabaseStorageDeploymentPublisher({
        supabaseUrl: 'https://project.supabase.co',
        anonKey: 'anon-key',
        bucket: 'beegame-deployments',
        publicBaseUrl: 'https://games.example.com',
        fetch: (async (input, init) => {
          uploads.push({
            url: String(input),
            authorization: init?.headers instanceof Headers
              ? init.headers.get('authorization')
              : (init?.headers as Record<string, string>).authorization,
            apikey: init?.headers instanceof Headers
              ? init.headers.get('apikey')
              : (init?.headers as Record<string, string>).apikey,
            contentType: init?.headers instanceof Headers
              ? init.headers.get('content-type')
              : (init?.headers as Record<string, string>)['content-type'],
            body: await new Response(init?.body as BodyInit).text(),
          })
          return new Response('{}', { status: 200 })
        }) as typeof fetch,
      }),
    })
    const deployment = await manager.deploy({
      sessionId: 'beegame_storage',
      userId: 'user-storage',
      projectId: 'project_storage',
      workspacePath: workspace,
      authToken: 'user-jwt',
    })

    expect(deployment.status).toBe('succeeded')
    expect(deployment.url).toBe(`https://games.example.com/deployments/user-storage/${deployment.id}/index.html`)
    expect(deployment.artifactPath).toBe(`supabase://beegame-deployments/deployments/user-storage/${deployment.id}`)
    expect(uploads.map(upload => upload.url)).toEqual([
      `https://project.supabase.co/storage/v1/object/beegame-deployments/deployments/user-storage/${deployment.id}/assets/game.js`,
      `https://project.supabase.co/storage/v1/object/beegame-deployments/deployments/user-storage/${deployment.id}/index.html`,
    ])
    expect(uploads).toEqual([
      expect.objectContaining({
        authorization: 'Bearer user-jwt',
        apikey: 'anon-key',
        contentType: 'text/javascript; charset=utf-8',
        body: 'console.log("storage")',
      }),
      expect.objectContaining({
        authorization: 'Bearer user-jwt',
        apikey: 'anon-key',
        contentType: 'text/html; charset=utf-8',
        body: '<main>Storage game</main>',
      }),
    ])
  })

  test('fails when the project has no build script', async () => {
    await writeFile(
      join(workspace, 'package.json'),
      JSON.stringify({ scripts: { dev: 'vite --host 0.0.0.0' } }),
    )
    const manager = new BeeGameDeploymentManager({
      dataRoot: root,
      runner: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
      publicBaseUrl: 'http://127.0.0.1:3040',
    })

    const deployment = await manager.deploy({
      sessionId: 'beegame_test',
      projectId: 'project_test',
      workspacePath: workspace,
    })

    expect(deployment.status).toBe('failed')
    expect(deployment.message).toContain('build script')
    expect(deployment.url).toBe('')
  })

  test('rejects static output outside the workspace', async () => {
    const outside = join(root, 'outside-dist')
    const manager = new BeeGameDeploymentManager({
      dataRoot: root,
      runner: async () => {
        await mkdir(outside, { recursive: true })
        await writeFile(join(outside, 'index.html'), '<h1>Outside</h1>')
        return { exitCode: 0, stdout: 'built', stderr: '' }
      },
      outputCandidates: ['../../outside-dist'],
      publicBaseUrl: 'http://127.0.0.1:3040',
    })
    await writeFile(
      join(workspace, 'package.json'),
      JSON.stringify({ scripts: { build: 'vite build' } }),
    )

    const deployment = await manager.deploy({
      sessionId: 'beegame_test',
      projectId: 'project_test',
      workspacePath: workspace,
    })

    expect(deployment.status).toBe('failed')
    expect(deployment.message).toContain('inside the project workspace')
    expect(deployment.url).toBe('')
  })
})
