import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { artifactDigest } from '../beegame/runtime-acceptance'
import { computeWorkspaceRevision } from '../beegame/workspace-revision'
import {
  BeeGameDeploymentManager,
  createSupabaseStorageDeploymentPublisher,
  mergeDeploymentRecords,
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

  test('retention preserves rollback bytes and later collects them when unreferenced', async () => {
    await writeFile(join(workspace, 'package.json'), JSON.stringify({ scripts: { build: 'node build.js' } }))
    await mkdir(join(workspace, 'dist'))
    await writeFile(join(workspace, 'dist/index.html'), '<main>Original</main>')
    const manager = new BeeGameDeploymentManager({ dataRoot: root,
      runner: async () => ({ exitCode: 0, stdout: '', stderr: '' }) })
    const original = await manager.deploy({ sessionId: 'fixture', workspacePath: workspace })
    await Bun.sleep(2)
    const rollback = await manager.rollbackTo(original)
    expect(rollback.url).toBe(original.url)
    const plan = await manager.applyRetention({ dryRun: true, keepSuccessfulPerProject: 1 })
    expect(plan.plannedForDeletion).toEqual([])
    expect(plan.retained.find(item => item.id === original.id)?.reason).toBe('artifact_referenced_by_retained_deployment')
    await manager.applyRetention({ dryRun: false, keepSuccessfulPerProject: 1 })
    expect(await (await manager.readPublicFile(rollback.url))?.body.text()).toBe('<main>Original</main>')
    await Bun.sleep(2)
    const latest = await manager.deploy({ sessionId: 'fixture', workspacePath: workspace })
    const cleanup = await manager.applyRetention({ dryRun: false, keepSuccessfulPerProject: 1 })
    expect(cleanup.deleted.map(item => item.id).sort()).toEqual([original.id, rollback.id].sort())
    expect(await manager.readPublicFile(original.url)).toBeUndefined()
    expect((await manager.list()).map(item => item.id)).toEqual([latest.id])
    await expect(manager.rollbackTo(original)).rejects.toThrow('no longer available')
  })

  test('cleanup cannot overwrite a concurrently requested rollback', async () => {
    await writeFile(join(workspace, 'package.json'), JSON.stringify({ scripts: { build: 'node build.js' } }))
    await mkdir(join(workspace, 'dist'))
    await writeFile(join(workspace, 'dist/index.html'), '<main>Fixture</main>')
    const manager = new BeeGameDeploymentManager({ dataRoot: root,
      runner: async () => ({ exitCode: 0, stdout: '', stderr: '' }) })
    const original = await manager.deploy({ sessionId: 'fixture', workspacePath: workspace })
    await Bun.sleep(2)
    const latest = await manager.deploy({ sessionId: 'fixture', workspacePath: workspace })
    let entered!: () => void, release!: () => void
    const deleting = new Promise<void>(resolve => { entered = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    const internal = manager as unknown as { deleteLocalArtifact: (record: typeof original) => Promise<boolean> }
    const remove = internal.deleteLocalArtifact.bind(manager)
    internal.deleteLocalArtifact = async record => { entered(); await gate; return remove(record) }
    const cleaning = manager.applyRetention({ dryRun: false, keepSuccessfulPerProject: 1 })
    await deleting
    const rollback = manager.rollbackTo(latest)
    release()
    await cleaning
    const restored = await rollback
    expect((await manager.list()).some(item => item.id === restored.id)).toBe(true)
    await access(join(latest.artifactPath!, 'index.html'))
  })

  test.each(['unchanged-file', 'unchanged-directory', 'changed', 'extra', 'missing', 'source-changed'] as const)(
    'accepted deployment publishes only covered tested bytes: %s', async mode => {
      await writeFile(join(workspace, 'package.json'), JSON.stringify({ scripts: { build: 'node build.js' } }))
      await mkdir(join(workspace, 'dist'))
      await writeFile(join(workspace, 'dist/index.html'), '<main>Tested A</main>')
      const path = mode === 'unchanged-directory' ? 'dist' : 'dist/index.html'
      const acceptance = { revision: await computeWorkspaceRevision(workspace),
        artifacts: [{ path, sha256: await artifactDigest(workspace, path, true) }] }
      if (mode === 'changed') await writeFile(join(workspace, 'dist/index.html'), '<main>Untested B</main>')
      if (mode === 'extra') await writeFile(join(workspace, 'dist/untested.js'), 'untested')
      if (mode === 'missing') await rm(join(workspace, 'dist/index.html'))
      if (mode === 'source-changed') await writeFile(join(workspace, 'new-source.js'), 'unverified source')
      let builds = 0, uploads = 0
      const manager = new BeeGameDeploymentManager({ dataRoot: root,
        runner: async () => { builds++; throw new Error('Do not rebuild accepted output') },
        publisher: { async publishStaticDirectory(input) {
          uploads++
          expect(await input.files.find(file => file.path === 'index.html')!.text()).toBe('<main>Tested A</main>')
          return { url: 'https://synthetic.invalid/no-upload' }
        } } })
      const result = await manager.deploy({ sessionId: 'fixture', workspacePath: workspace, acceptance })
      const valid = mode.startsWith('unchanged')
      expect(result.status).toBe(valid ? 'succeeded' : 'failed')
      expect(uploads).toBe(valid ? 1 : 0)
      expect(builds).toBe(0)
      if (mode === 'changed') expect(result.message).toContain('differs from acceptance')
      if (mode === 'extra') expect(result.message).toContain('not covered by acceptance')
    })

  test.each([false, true])('registers before Worker verification and revokes failure: %s', async (rejectVerification) => {
    await writeFile(join(workspace, 'package.json'), JSON.stringify({ scripts: { build: 'node build.js' } }))
    const statuses: string[] = []
    const manager = new BeeGameDeploymentManager({ dataRoot: root,
      runner: async () => {
        await mkdir(join(workspace, 'dist'), { recursive: true })
        await writeFile(join(workspace, 'dist/index.html'), '<main>Ready</main>')
        return { exitCode: 0, stdout: '', stderr: '' }
      },
      publisher: {
        publishStaticDirectory: async () => ({ url: 'https://games.test/test', manifestStorageObjectId: 'manifest' }),
        verifyPublished: async () => {
          expect(statuses).toEqual(['succeeded'])
          expect((await manager.list())[0]?.status).toBe('publishing')
          if (rejectVerification) throw new Error('Public page mismatch')
        },
      },
    })
    const result = await manager.deploy({sessionId: 'test', workspacePath: workspace}, undefined,
      async record => { statuses.push(record.status) })
    expect(result.status).toBe(rejectVerification ? 'failed' : 'succeeded')
    expect(statuses).toEqual(rejectVerification ? ['succeeded', 'failed'] : ['succeeded'])
    if (rejectVerification) expect(result.url).toBe('')
  })

  test('background publishing returns before build completion and deduplicates repeated clicks', async () => {
    let release!: () => void
    let runs = 0
    const gate = new Promise<void>(resolve => { release = resolve })
    await writeFile(join(workspace, 'package.json'), JSON.stringify({ scripts: { build: 'node build.js' } }))
    const manager = new BeeGameDeploymentManager({ dataRoot: root, runner: async (_, options) => {
      runs++
      await gate
      await mkdir(join(options.cwd, 'dist'), { recursive: true })
      await writeFile(join(options.cwd, 'dist/index.html'), '<main>Ready</main>')
      return { exitCode: 0, stdout: 'Built', stderr: '' }
    } })
    let finish!: () => void
    const finished = new Promise<void>(resolve => { finish = resolve })
    const input = { sessionId: 'session', userId: 'owner', workspacePath: workspace }
    const first = await manager.start(input, async () => { finish() })
    try {
      const second = await manager.start(input)
      expect(first.status).toBe('queued')
      expect(second.id).toBe(first.id)
      expect(manager.isPublishing('owner', workspace)).toBe(true)
      expect(manager.isPublishing('other-owner', workspace)).toBe(false)
    } finally { release(); await finished }
    expect(runs).toBe(1)
    const final = (await manager.list('session'))[0]!
    expect(final.status).toBe('succeeded')
    expect(mergeDeploymentRecords([final], [first])[0]?.status).toBe('succeeded')
  })

  test('parallel project records are not lost and interrupted records become explicit failures after restart', async () => {
    const manager = new BeeGameDeploymentManager({ dataRoot: root })
    const records = await Promise.all(Array.from({ length: 8 }, (_, index) => manager.deploy({
      sessionId: `session-${index}`, workspacePath: workspace,
    })))
    expect(await manager.list()).toHaveLength(8)
    expect(new Set(records.map(record => record.id)).size).toBe(8)
    await writeFile(join(root, 'deployments/deployments.json'), JSON.stringify([
      { ...records[0], status: 'building' }, ...records.slice(1),
    ]))
    const restarted = new BeeGameDeploymentManager({ dataRoot: root })
    const recovered = (await restarted.list()).find(record => record.id === records[0]!.id)!
    expect(recovered.status).toBe('failed')
    expect(recovered.message).toContain('interrupted')
    expect(recovered.url).toBe('')
    expect(await restarted.list()).toHaveLength(8)
  })

  test('builds a package project and publishes static output', async () => {
    const commands: string[][] = []
    let buildEnv: Record<string, string> | undefined
    const originalSecret = process.env.BEEGAME_SKILLS_SERVICE_TOKEN
    process.env.BEEGAME_SKILLS_SERVICE_TOKEN = 'must-not-reach-project-build'
    const runner: BeeGameDeploymentRunner = async (command, options) => {
      commands.push(command)
      buildEnv = options.env
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
    }).finally(() => {
      if (originalSecret === undefined) delete process.env.BEEGAME_SKILLS_SERVICE_TOKEN
      else process.env.BEEGAME_SKILLS_SERVICE_TOKEN = originalSecret
    })

    expect(deployment.status).toBe('succeeded')
    expect(deployment.url).toMatch(/^http:\/\/127\.0\.0\.1:3040\/deployments\/deploy_/)
    expect(deployment.buildCommand).toBe('npm run build -- --base=./')
    expect(commands).toEqual([['npm', 'run', 'build', '--', '--base=./']])
    expect(buildEnv?.BEEGAME_DEPLOYMENT).toBe('1')
    expect(buildEnv?.BEEGAME_SKILLS_SERVICE_TOKEN).toBeUndefined()
    expect(await readFile(join(deployment.artifactPath || '', 'index.html'), 'utf8'))
      .toBe('<h1>Playable</h1>')
  })

  test('does not append Vite base flags to non-Vite build scripts', async () => {
    const commands: string[][] = []
    const runner: BeeGameDeploymentRunner = async (command, options) => {
      commands.push(command)
      await mkdir(join(options.cwd, 'dist'), { recursive: true })
      await writeFile(join(options.cwd, 'dist', 'index.html'), '<h1>Static</h1>')
      return { exitCode: 0, stdout: 'built', stderr: '' }
    }
    await writeFile(
      join(workspace, 'package.json'),
      JSON.stringify({ scripts: { build: 'node build.js' } }),
    )

    const manager = new BeeGameDeploymentManager({
      dataRoot: root,
      runner,
      publicBaseUrl: 'http://127.0.0.1:3040',
    })
    const deployment = await manager.deploy({
      sessionId: 'beegame_static',
      projectId: 'project_static',
      workspacePath: workspace,
    })

    expect(deployment.status).toBe('succeeded')
    expect(deployment.buildCommand).toBe('npm run build')
    expect(commands).toEqual([['npm', 'run', 'build']])
  })

  test('returns 404 semantics for a missing static asset instead of SPA HTML', async () => {
    const runner: BeeGameDeploymentRunner = async (_command, options) => {
      await mkdir(join(options.cwd, 'dist'), { recursive: true })
      await writeFile(join(options.cwd, 'dist', 'index.html'), '<main>Playable</main>')
      return { exitCode: 0, stdout: 'built', stderr: '' }
    }
    await writeFile(join(workspace, 'package.json'), JSON.stringify({ scripts: { build: 'vite build' } }))
    const manager = new BeeGameDeploymentManager({ dataRoot: root, runner })
    const deployment = await manager.deploy({ sessionId: 'beegame_static_404', workspacePath: workspace })

    expect(await manager.readPublicFile(`/deployments/${deployment.id}/assets/missing.glb`)).toBeUndefined()
    expect(await manager.readPublicFile(`/deployments/${deployment.id}/game-route`)).toEqual(
      expect.objectContaining({
        contentType: 'text/html; charset=utf-8',
        cacheControl: 'public, max-age=31536000, immutable',
      }),
    )
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
    expect(commands).toEqual([['npm', 'run', 'build', '--', '--base=./']])
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
      cacheControl: string | null
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
            cacheControl: init?.headers instanceof Headers
              ? init.headers.get('cache-control')
              : (init?.headers as Record<string, string>)['cache-control'],
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
        cacheControl: 'max-age=31536000',
        body: 'console.log("storage")',
      }),
      expect.objectContaining({
        authorization: 'Bearer user-jwt',
        apikey: 'anon-key',
        contentType: 'text/html; charset=utf-8',
        cacheControl: 'max-age=31536000',
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

  test('rejects source changes made during the deployment build', async () => {
    await mkdir(join(workspace, 'src'), { recursive: true })
    await writeFile(join(workspace, 'src', 'entry.ts'), 'export const ready = true\n')
    await writeFile(
      join(workspace, 'package.json'),
      JSON.stringify({ scripts: { build: 'vite build' } }),
    )
    const manager = new BeeGameDeploymentManager({
      dataRoot: root,
      runner: async (_command, options) => {
        await mkdir(join(options.cwd, 'dist'), { recursive: true })
        await writeFile(join(options.cwd, 'dist', 'index.html'), '<main>Changed</main>')
        await writeFile(join(options.cwd, 'src', 'entry.ts'), 'export const ready = false\n')
        return { exitCode: 0, stdout: 'built and changed source', stderr: '' }
      },
    })
    const changedDuringBuild = await manager.deploy({
      sessionId: 'delivery-gated-session',
      workspacePath: workspace,
    })
    expect(changedDuringBuild.status).toBe('failed')
    expect(changedDuringBuild.message).toContain('Project source changed during')
  })

  test('rejects malformed self-identifying files in the built artifact', async () => {
    const manager = new BeeGameDeploymentManager({
      dataRoot: root,
      runner: async (_command, options) => {
        await mkdir(join(options.cwd, 'dist', 'assets'), { recursive: true })
        await writeFile(join(options.cwd, 'dist', 'index.html'), '<main>Invalid asset</main>')
        await writeFile(join(options.cwd, 'dist', 'assets', 'model.glb'), '<!doctype html>')
        return { exitCode: 0, stdout: 'built', stderr: '' }
      },
    })
    await writeFile(
      join(workspace, 'package.json'),
      JSON.stringify({ scripts: { build: 'vite build' } }),
    )

    const deployment = await manager.deploy({
      sessionId: 'invalid-artifact-session',
      workspacePath: workspace,
    })

    expect(deployment.status).toBe('failed')
    expect(deployment.message).toContain('invalid GLB')
  })

  test('rejects source symbolic links before building or publishing', async () => {
    await writeFile(join(workspace, 'package.json'), JSON.stringify({ scripts: { build: 'node build.js' } }))
    await writeFile(join(workspace, 'actual.js'), 'export default "fixture"')
    await symlink('actual.js', join(workspace, 'entry.js'))
    let built = false
    const manager = new BeeGameDeploymentManager({ dataRoot: root, runner: async () => {
      built = true
      return { exitCode: 0, stdout: '', stderr: '' }
    } })
    const result = await manager.deploy({ sessionId: 'fixture', workspacePath: workspace })
    expect(result.status).toBe('failed')
    expect(result.message).toContain('unsupported symbolic link: entry.js')
    expect(result.url).toBe('')
    expect(built).toBe(false)
  })

  test('rejects symbolic links in deployment output', async () => {
    const outside = join(root, 'private.txt')
    await writeFile(outside, 'private')
    const manager = new BeeGameDeploymentManager({
      dataRoot: root,
      runner: async (_command, options) => {
        await mkdir(join(options.cwd, 'dist'), { recursive: true })
        await writeFile(join(options.cwd, 'dist', 'index.html'), '<main>Symlink</main>')
        await symlink(outside, join(options.cwd, 'dist', 'private.txt'))
        return { exitCode: 0, stdout: 'built', stderr: '' }
      },
    })
    await writeFile(
      join(workspace, 'package.json'),
      JSON.stringify({ scripts: { build: 'vite build' } }),
    )

    const deployment = await manager.deploy({
      sessionId: 'symlink-artifact-session',
      workspacePath: workspace,
    })

    expect(deployment.status).toBe('failed')
    expect(deployment.message).toContain('symbolic link')
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
