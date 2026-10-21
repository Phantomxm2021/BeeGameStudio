import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { contentConsumerCommand, contentConsumerDistribution, CONTENT_CONSUMER_API } from './game-content-consumer-cli'
import { projectFiles } from './workflow-v3/editable-project'

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-runtime-delivery-')))
  const tools = join(root, '.beegame/tools')
  await mkdir(tools, { recursive: true })
  const files = await contentConsumerDistribution()
  for (const [name, body] of Object.entries(files)) await writeFile(join(tools, name), body)
  await writeFile(join(tools, 'consumer.mjs'), contentConsumerCommand(root, '.beegame/tools/content-consumer.mjs'))
  const run = async (args: string[], executable = process.execPath) => {
    const child = Bun.spawn([executable, ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    return { code, stdout, stderr }
  }
  return { root, files, run, install: (...args: string[]) => run([join(tools, 'consumer.mjs'), '--install', ...args]),
    close: () => rm(root, { recursive: true, force: true }) }
}

test('runtime installation includes exact source, provenance and licenses and exports without host tools', async () => {
  const f = await fixture()
  try {
    const installed = await f.install()
    expect(installed.code, installed.stderr).toBe(0)
    expect(JSON.parse(installed.stdout)).toMatchObject({ path: 'vendor/bgs-runtime/content-consumer.mjs', runtimeVerified: false, alreadyPresent: false })
    expect(JSON.parse((await f.install()).stdout).alreadyPresent).toBe(true)
    const runtime = join(f.root, 'vendor/bgs-runtime')
    const hash = (text: string) => createHash('sha256').update(text).digest('hex')
    const provenance = JSON.parse(await readFile(join(runtime, 'provenance.json'), 'utf8'))
    expect(provenance.moduleSha256).toBe(hash(f.files['content-consumer.mjs']!))
    expect(provenance.sourceMapSha256).toBe(hash(f.files['content-consumer.mjs.map']!))
    const map = JSON.parse(f.files['content-consumer.mjs.map']!)
    expect(map.sources).toHaveLength(map.sourcesContent.length)
    const owner = map.sources.indexOf(provenance.entry)
    expect(owner).toBeGreaterThanOrEqual(0)
    expect(map.sourcesContent[owner]).toBe(await readFile(new URL('./game-content-consumer.ts', import.meta.url), 'utf8'))
    for (const [i, source] of map.sources.entries()) {
      expect(source).not.toMatch(/^(?:\/|\.\.\/|[a-z]+:)/i)
      expect(provenance.sources[i]).toEqual({ path: source, sha256: hash(map.sourcesContent[i]) })
    }
    expect(JSON.parse(await readFile(join(runtime, 'api.json'), 'utf8'))).toEqual(CONTENT_CONSUMER_API)
    expect(f.files['NOTICE.md']).toContain('Meta Platforms')
    expect(f.files['NOTICE.md']).toContain('Colin McDonnell')
    await writeFile(join(f.root, 'package.json'), JSON.stringify({ type: 'module', scripts: { build: 'bun build src/main.js --target=browser --outdir dist' } }))
    await mkdir(join(f.root, 'src'))
    await writeFile(join(f.root, 'src/main.js'), "import {readUiData} from '../vendor/bgs-runtime/content-consumer.mjs'; window.readUiData=readUiData;")
    const exported = await projectFiles(f.root, 'dist', [])
    for (const name of Object.keys(f.files)) expect(exported.some(file => file.path === 'vendor/bgs-runtime/' + name)).toBe(true)
    expect(exported.some(file => file.path.startsWith('.beegame/'))).toBe(false)
    await rm(join(f.root, '.beegame'), { recursive: true })
    const built = await f.run(['run', 'build'])
    expect(built.code, built.stderr).toBe(0)
    expect((await readFile(join(f.root, 'dist/main.js'), 'utf8')).length).toBeGreaterThan(0)
  } finally { await f.close() }
})

test('dependency conflicts are checked before copying any runtime member and custom filenames remain supported', async () => {
  const f = await fixture()
  try {
    await mkdir(join(f.root, 'vendor/bgs-runtime'), { recursive: true })
    await writeFile(join(f.root, 'vendor/bgs-runtime/api.json'), 'Existing project file')
    const conflict = await f.install()
    expect(conflict.code).toBe(1)
    expect(conflict.stderr).toContain('no overwrite')
    expect(await Bun.file(join(f.root, 'vendor/bgs-runtime/content-consumer.mjs')).exists()).toBe(false)
    expect(await readFile(join(f.root, 'vendor/bgs-runtime/api.json'), 'utf8')).toBe('Existing project file')
    const custom = await f.install('lib/runtime.mjs')
    expect(custom.code, custom.stderr).toBe(0)
    expect(await readFile(join(f.root, 'lib/runtime.mjs'), 'utf8')).toBe(f.files['content-consumer.mjs']!)
    expect(await Bun.file(join(f.root, 'lib/content-consumer.mjs.map')).exists()).toBe(true)
  } finally { await f.close() }
})

test('installed source map resolves a real runtime failure to the shipped source after host tools are removed', async () => {
  const f = await fixture()
  try {
    const installed = await f.install()
    expect(installed.code, installed.stderr).toBe(0)
    await rm(join(f.root, '.beegame'), { recursive: true })
    const script = join(f.root, 'debug.mjs')
    await writeFile(script, "import{readUiData}from'./vendor/bgs-runtime/content-consumer.mjs';try{readUiData({})}catch(error){console.log(error.stack)}")
    const observed = await f.run(['--enable-source-maps', script], Bun.which('node')!)
    expect(observed.code, observed.stderr).toBe(0)
    expect(observed.stdout).toContain('game-content-consumer.ts:')
    expect(observed.stdout).toContain('game-content-schema.ts:')
    // Mapped frames refer to the new project's embedded source, never the host checkout.
    expect(observed.stdout).not.toContain(dirname(new URL(import.meta.url).pathname))
  } finally { await f.close() }
})
