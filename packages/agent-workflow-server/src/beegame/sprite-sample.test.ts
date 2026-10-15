import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { spriteClip } from './sprite-sample.mjs'
import { openAgentTools } from './workflow-v3/agent-tools'
import { openPreviewTestAccess } from './preview-test-access'
import { projectExecutionAccess } from './project-execution-access'
import { projectFiles } from './workflow-v3/editable-project'
import { artifactDigest } from './runtime-acceptance'
import { BeeGamePreviewManager } from './preview-manager'

const atlas = { frames: { left: { frame: { x: 0, y: 0, w: 32, h: 32 } }, right: { frame: { x: 32, y: 0, w: 32, h: 32 } } } }
test('sample consumes the existing rectangle-only atlas contract, rejecting missing/duplicate/out-of-bounds frames', () => {
  expect(spriteClip(atlas, 100, ['right', 'left'], { w: 64, h: 32 }).frames.map(f => f.id)).toEqual(['right', 'left'])
  for (const ids of [['left', 'missing'], ['left', 'left']]) expect(() => spriteClip(atlas, 100, ids, { w: 64, h: 32 })).toThrow()
  expect(() => spriteClip(atlas, 100, ['left', 'right'], { w: 32, h: 32 })).toThrow('out-of-bounds')
  expect(() => spriteClip(atlas, NaN, ['left', 'right'], { w: 64, h: 32 })).toThrow()
})

// All writes are disposable synthetic fixtures. No BGS user project or paid API.
test('supplied sample command is non-overwriting, dependency-free and produces a self-contained static build', async () => {
  const f = await fixture()
  const manager = new BeeGamePreviewManager()
  try {
    const created = await f.command('--sprite-sample', 'assets/sheet.png', 'assets/sheet.json', '100', 'right', 'left')
    expect(created.code, created.error + created.out).toBe(0)
    expect(JSON.parse(created.out).quality).toBe('unverified')
    expect(JSON.parse(created.out).image).toMatchObject({ hasAlpha: true, isOpaque: false, width: 64, height: 32 })
    const pkg = await readFile(join(f.root, 'package.json'), 'utf8')
    expect(JSON.parse(pkg).dependencies).toBeUndefined()
    const refused = await f.command('--sprite-sample', 'assets/sheet.png', 'assets/sheet.json', '100', 'left', 'right')
    expect(refused.code).toBe(1)
    expect(refused.out).toContain('will not overwrite package.json')
    expect(await readFile(join(f.root, 'package.json'), 'utf8')).toBe(pkg)
    const build = await f.build()
    expect(build.code, build.error).toBe(0)
    expect(await readFile(join(f.root, 'dist/sheet.png'))).toEqual(await readFile(join(f.root, 'assets/sheet.png')))
    expect(await readFile(join(f.root, 'dist/index.html'), 'utf8')).not.toContain('.beegame')
    const preview = await manager.start({ sessionId: 'offline-sprite', workspacePath: f.root, mode: 'production' })
    expect(preview.status, preview.message).toBe('running')
    const url = manager.internalUrl('offline-sprite')!
    expect(await (await fetch(url)).text()).toContain('Sprite playback sample')
    expect((await fetch(new URL('/package.json', url))).status).toBe(404)
    expect((await readdir(f.root)).sort()).toEqual(['.beegame', 'assets', 'dist', 'package.json', 'sprite-sample-build.mjs', 'sprite-sample-preview.mjs'])
  } finally { await manager.dispose(); await f.close() }
}, 30_000)

test.skipIf(process.env.BGS_PLAY_CAPTURE_BROWSER !== '1')('offline Preview capture asserts controls and keeps evidence outside measured sources', async () => {
  const f = await fixture()
  try {
    expect((await f.command('--sprite-sample', 'assets/sheet.png', 'assets/sheet.json', '100', 'left', 'right')).code).toBe(0)
    const built = await f.build(); expect(built.code, built.error).toBe(0)
    const sources = await projectFiles(f.root, 'dist', ['reports'])
    const artifact = await artifactDigest(f.root, 'dist', true)
    const normal = await f.command('--sprite-capture')
    expect(normal.code, normal.error + normal.out).toBe(0)
    const report = JSON.parse(normal.out)
    expect(report.observations.status).toBe('passed')
    expect(report.observations.expectedFrames).toEqual(['left', 'right'])
    expect((await readFile(join(f.root, report.video))).length).toBeGreaterThan(500)
    const saved = JSON.parse(await readFile(join(f.root, report.directory, 'observation.json'), 'utf8'))
    expect(saved.observations.status).toBe('passed')
    expect(saved.observations.playback.length).toBe(report.observations.sampleCounts.playback)
    expect(report.observations.playback).toBeUndefined()
    for (const failure of ['pause', 'resume'] as const) {
      f.breakControl(failure)
      const failed = await f.command('--sprite-capture')
      expect(failed.code, failed.out).toBe(1)
      expect(failed.out).toContain('assertions failed; retained')
    }
    const captures = (await readdir(join(f.root, '.beegame/tmp'))).filter(n => n.startsWith('play-capture-'))
    const results = await Promise.all(captures.map(async n => JSON.parse(await readFile(join(f.root, '.beegame/tmp', n, 'observation.json'), 'utf8'))))
    expect(results).toHaveLength(3)
    expect(results.some(r => r.observations.error?.includes('Pause did not hold'))).toBe(true)
    expect(results.some(r => r.observations.error?.includes('Resume did not advance'))).toBe(true)
    expect(results.every(r => r.video && r.quality === 'unverified')).toBe(true)
    const unavailable = await f.withoutRecorder()
    expect(unavailable.code).toBe(1)
    expect(unavailable.out).toContain('Preview recording unavailable')
    expect(unavailable.out).toContain('No installation or retry was attempted')
    expect(await projectFiles(f.root, 'dist', ['reports'])).toEqual(sources)
    expect(await artifactDigest(f.root, 'dist', true)).toBe(artifact)
  } finally { await f.close() }
}, 45_000)

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-sprite-sample-test-')))
  await mkdir(join(root, 'assets'))
  // Two visibly distinct synthetic crops, not generated or redrawn user art.
  const png = await sharp({ create: { width: 64, height: 32, channels: 4, background: '#00000000' } })
    .composite([{ input: Buffer.from('<svg width="64" height="32"><rect x="4" y="4" width="20" height="20" fill="red"/><circle cx="48" cy="16" r="10" fill="blue"/></svg>') }]).png().toBuffer()
  await writeFile(join(root, 'assets/sheet.png'), png)
  await writeFile(join(root, 'assets/sheet.json'), JSON.stringify(atlas))
  let broken: string | undefined
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const path = new URL(request.url).pathname
    if (path === '/sheet.png') return new Response(Bun.file(join(root, 'dist/sheet.png')))
    if (path !== '/' && path !== '/index.html') return new Response(null, { status: 404 })
    let html = await readFile(join(root, 'dist/index.html'), 'utf8')
    // Fault injection in fixture responses only; sources/artifact stay untouched.
    if (broken === 'pause') html = html.replace('playing = !playing;', 'playing = true;')
    if (broken === 'resume') html = html.replace('playing = !playing;', 'playing = false;')
    return new Response(html, { headers: { 'Content-Type': 'text/html' } })
  } })
  const snapshot = { status: 'running', mode: 'production', url: server.url.href }
  const access = openPreviewTestAccess({ start: async () => snapshot, status: () => snapshot, stop() {} })
  const tools = await openAgentTools({ workspacePath: root, sessionId: 'fixture', getAuthToken: () => undefined, openPreview: () => access })
  const execution = await projectExecutionAccess({ workspacePath: root, sessionId: 'fixture', environment: {} })
  const run = async (cmd: string[], env: Record<string, string> = {}) => {
    const child = Bun.spawn(cmd, { cwd: root, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, ...execution.environment, ...env } })
    const [code, out, error] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    return { code, out, error }
  }
  return { root, command: (...args: string[]) => run(['node', join(root, tools.directory, 'preview.mjs'), ...args]),
    withoutRecorder: () => run(['node', join(root, tools.directory, 'preview.mjs'), '--sprite-capture'],
      { PLAYWRIGHT_BROWSERS_PATH: join(root, '.beegame/tmp/missing-recorder') }),
    build: () => run([process.execPath, 'run', 'build']), breakControl: (fault: string) => { broken = fault },
    async close() { await tools.close(); server.stop(true); await rm(root, { recursive: true, force: true }); await rm(execution.nativeOutput, { recursive: true, force: true }) } }
}
