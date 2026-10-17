import { afterEach, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { readDesignHandoff, readImplementationTask, checkResourcesAndBindings, readVerificationResults } from './workflow-read-tools'
import { prepareNativeMcpConfig, NATIVE_READ_TOOLS } from './native-mcp-config'
import { projectPreviewCapabilityPath, publishProjectPreviewCapability } from './project-preview-capability'
import { designHandoffFixture, writeDesignDocumentFixture, writeDesignDocumentsFixture, uiLayoutFixture } from './fixtures/layout-fixture'
import { designHandoffPath } from './design-handoff'
import { assetManifestAuthoringExamples } from './asset-manifest-authoring-contract'
import { writeBeeGameAssetManifest } from './asset-contracts'
import sharp from 'sharp'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bgs-read-tools-'))); roots.push(root)
  return root
}
function save(root: string, file: string, value: unknown) {
  const path = join(root, file); mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value))
}
function snapshot(root: string) {
  return Object.fromEntries((readdirSync(root, { recursive: true, withFileTypes: true }) as any[])
    .filter(entry => entry.isFile()).map(entry => {
      const path = join(entry.parentPath, entry.name)
      return [path.slice(root.length + 1), createHash('sha256').update(readFileSync(path)).digest('hex')]
    }))
}

test('design read retains available source text with missing siblings; no finalize/lock/files', async () => {
  const root = fixture()
  await writeDesignDocumentFixture(root, 'GDD.md')
  const before = snapshot(root)
  const result = readDesignHandoff(root, { read: [
    { document: 'GDD.md', sections: ['Design'] }, { document: 'AUDIO_DESIGN.md', sections: ['Absent'] },
  ] })
  expect(result.valid).toBe(false)
  expect(result.documents).toHaveLength(8)
  expect(result.sources[0]!.reads[0]!.text).toContain('Fixture decision.')
  expect(result.documents.find(item => item.document === 'GDD.md')!.requirements[0]!.id).toBe('play')
  expect(snapshot(root)).toEqual(before)
  expect(() => readDesignHandoff(root, { read: [{ document: '../secret.md', sections: ['Design'] }] })).toThrow()
})

test('task reader supplies exact task and owner/acceptance prose despite unrelated missing inputs', async () => {
  const root = fixture(), handoff = designHandoffFixture('TECHNICAL_DESIGN.md')
  handoff.implementationItems = [{ id: 'restart', section: 'Restart task', dependsOn: ['initialize'],
    requirementRefs: [{ document: 'GDD.md', id: 'play' }] }]
  await writeDesignDocumentFixture(root, 'TECHNICAL_DESIGN.md', handoff,
    '# Design\n- Version: v1.0\nTechnical decisions.\n## Restart task\nCall shared initialization; clear old timers.\n')
  const gdd = designHandoffFixture('GDD.md'); gdd.outputs[0]!.acceptance!.section = 'Restart acceptance'
  await writeDesignDocumentFixture(root, 'GDD.md', gdd,
    '# Design\n- Version: v1.0\nRestart uses initial state.\n## Restart acceptance\nRetry twice; old timers must not fire.\n')
  const before = snapshot(root), result = readImplementationTask(root, { id: 'restart' })
  expect(result.valid).toBe(false) // unknown dependency and missing siblings remain visible
  expect('task' in result && result.task.id).toBe('restart')
  expect(JSON.stringify(result)).toContain('clear old timers')
  expect(JSON.stringify(result)).toContain('Retry twice; old timers must not fire.')
  expect(JSON.stringify(result)).toContain('Restart uses initial state.')
  expect(readImplementationTask(root, { id: 'unknown' }).issues.join(' ')).toContain('Unknown task ID')
  handoff.implementationItems.push(handoff.implementationItems[0]!)
  save(root, designHandoffPath('TECHNICAL_DESIGN.md'), handoff)
  expect(readImplementationTask(root, { id: 'restart' }).issues.join(' ')).toContain('Ambiguous task ID')
  save(root, designHandoffPath('TECHNICAL_DESIGN.md'), { ...handoff, implementationItems: handoff.implementationItems.slice(0, 1) })
  expect(snapshot(root)).toEqual(before)
})

test('binding check catches nested unknown resources and missing manifest, keeps actual operands and all-file scope', async () => {
  const root = fixture(), ui = uiLayoutFixture()
  ;(ui.data.nodes[1] as any).data = { image: { assetRef: 'missing-atlas', member: 'no.png', frame: 'idle' } }
  ui.assetRefs = ['missing-atlas'] as never[]
  save(root, 'content/ui/menu.json', ui)
  const other = uiLayoutFixture(); other.id = 'other'
  save(root, 'content/ui/other.json', other)
  mkdirSync(join(root, 'content/scenes'), { recursive: true })
  const beforeMissing = snapshot(root)
  const missing = await checkResourcesAndBindings(root, { detailsFor: 'content/ui/menu.json' })
  expect(missing.valid).toBe(false)
  expect(missing.issues.join(' ')).toContain('manifest.json is missing')
  expect(missing.files).toHaveLength(2)
  expect(JSON.stringify(missing.files)).toContain('missing-atlas')
  expect(snapshot(root)).toEqual(beforeMissing)
  const manifest = assetManifestAuthoringExamples().canonical
  manifest.resources = []; manifest.requirements = []
  await writeBeeGameAssetManifest(root, manifest)
  const before = snapshot(root), result = await checkResourcesAndBindings(root, {})
  expect(result.issues.join(' ')).toContain('Unknown resource missing-atlas')
  expect(result.issues.join(' ')).toContain('content/ui/menu.json')
  expect(snapshot(root)).toEqual(before)
  await expect(checkResourcesAndBindings(root, { detailsFor: 'content/ui/../../secret.json' })).rejects.toThrow()
  symlinkSync(join(root, 'content/ui/menu.json'), join(root, 'content/ui/alias.json'))
  expect((await checkResourcesAndBindings(root, {})).issues.join(' ')).toContain('symlink')
})

test('binding check verifies current bytes/hash and exact atlas member rather than inventory success', async () => {
  const root = fixture(), manifest = assetManifestAuthoringExamples().canonical
  const resource = manifest.resources[0]!, path = resource.file_paths[0]!
  resource.local_file_hashes = { [path]: createHash('sha256').update('{}').digest('hex') }
  save(root, path, '{}')
  await writeBeeGameAssetManifest(root, manifest)
  const ui = uiLayoutFixture()
  ui.assetRefs = [resource.id] as never[]
  ;(ui.data.nodes[1] as any).data = { image: { assetRef: resource.id, member: 'nonexistent-file', atlasMember: path, frame: 'missing-frame' } }
  save(root, 'content/ui/menu.json', ui)
  mkdirSync(join(root, 'content/scenes'), { recursive: true })
  const before = snapshot(root), broken = await checkResourcesAndBindings(root, {})
  expect(broken.valid).toBe(false)
  expect(broken.issues.join(' ')).toContain('Missing or ambiguous member')
  expect(snapshot(root)).toEqual(before)
  save(root, path, '{"changed":true}')
  expect((await checkResourcesAndBindings(root, {})).issues.join(' ')).toContain('hash does not match')
})

test('binding check resolves exact atlas frames and reports missing required asset bindings', async () => {
  const root = fixture(), manifest = assetManifestAuthoringExamples().canonical, resource = manifest.resources[0]!
  const image = 'assets/runtime/atlas.png', atlas = 'assets/runtime/atlas.json'
  resource.root_path = image; resource.file_paths = [image, atlas]; resource.asset_kind = 'sprite-atlas'
  const png = await sharp({ create: { width: 16, height: 16, channels: 4, background: '#ffffff' } }).png().toBuffer()
  mkdirSync(join(root, 'assets/runtime'), { recursive: true }); writeFileSync(join(root, image), png)
  save(root, atlas, { frames: { idle: { frame: { x: 0, y: 0, w: 16, h: 16 } } } })
  await writeBeeGameAssetManifest(root, manifest)
  const ui = uiLayoutFixture(); ui.assetRefs = [resource.id] as never[]
  ;(ui.data.nodes[1] as any).data = { image: { assetRef: resource.id, member: image, atlasMember: atlas, frame: 'missing' } }
  save(root, 'content/ui/menu.json', ui); mkdirSync(join(root, 'content/scenes'), { recursive: true })
  expect((await checkResourcesAndBindings(root, {})).issues.join(' ')).toContain('no frame "missing"')
  ;(ui.data.nodes[1] as any).data.image.frame = 'idle'
  save(root, 'content/ui/menu.json', ui)
  expect((await checkResourcesAndBindings(root, {})).issues.join(' ')).not.toContain('no frame "missing"')
  ;(ui.data.nodes[1] as any).role = 'image'; delete (ui.data.nodes[1] as any).data
  save(root, 'content/ui/menu.json', ui)
  expect((await checkResourcesAndBindings(root, {})).issues.join(' ')).toContain('requires assetRef')
})

test('native tools discover all six; result reads use fixed read requests, preserve newest failure and do not execute receipts', async () => {
  const root = fixture(), sessionId = 'offline-session'
  await writeDesignDocumentsFixture(root)
  const requests: unknown[] = [], server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const body = await request.json(); requests.push(body)
    if (body.executionInputs === true) return Response.json({ files: [], requirementsRevision: 'r1', runId: 'run', attemptId: 'turn' })
    if (body.inspectRequestKey) return Response.json({ id: body.inspectRequestKey, freshness: { current: false }, error: 'retained failure' })
    if (Array.isArray(body.handoffPaths)) return Response.json({ scope: 'agent-task-evidence-handoff',
      measurement: { id: 'newest-interrupted', error: 'interrupted', freshness: { current: false } },
      acceptance: { valid: false }, checkScope: { build: 'source-copy only' }, note: 'No executions',
      measurements: [{ id: 'older-success' }, { id: 'newest-interrupted' }] })
    throw Error('Unexpected request could start verification')
  } })
  const revoke = await publishProjectPreviewCapability(root, sessionId, server.url.origin + '/fixture', 'measurement')
  save(root, 'test.mjs', 'throw Error("Receipt inspection must never run this script")')
  save(root, '.beegame/tmp/preview-test-fixture/execution.json', { script: 'test.mjs', status: 'interrupted',
    stdoutPath: '.beegame/tmp/preview-test-fixture/stdout.txt', after: { status: 'observed', scriptSha256: 'old',
      inputs: { files: [], requirementsRevision: 'r1', runId: 'run', attemptId: 'old-turn' } } })
  const prepared = await prepareNativeMcpConfig({}, root, { dimension: '2D' }, sessionId)
  const config = JSON.parse(readFileSync(prepared.flags[1]!, 'utf8'))
  const client = new Client({ name: 'offline-reader-test', version: '1' })
  const before = snapshot(root)
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const response = await client.callTool({ name, arguments: args })
    const text = (response.content as { text: string }[])[0]!.text
    return { response, text, json: () => JSON.parse(text) }
  }
  try {
    await client.connect(new StdioClientTransport({ ...config.mcpServers['bgs-ui-layout'], cwd: root }))
    const tools = (await client.listTools()).tools
    expect(tools.map(tool => tool.name).sort()).toEqual([...NATIVE_READ_TOOLS].sort())
    expect(tools.every(tool => tool.annotations?.readOnlyHint && tool._meta?.['anthropic/alwaysLoad'])).toBe(true)
    expect((await call('ReadDesignHandoff')).json().documents).toHaveLength(8)
    const task = await call('ReadImplementationTask', { id: 'fixture-GDD' })
    expect(task.response.isError).toBe(false)
    expect(task.text).toContain('Fixture decision.')
    expect((await call('CheckResourcesAndBindings')).response.isError).toBe(true)
    const latest = (await call('ReadVerificationResults')).json()
    expect(latest.measurement.id).toBe('newest-interrupted')
    expect(latest.measurement.freshness.current).toBe(false)
    expect((await call('ReadVerificationResults', { measurementId: 'exact-id', details: true })).json().id).toBe('exact-id')
    const receipt = (await call('ReadVerificationResults', { previewReceipt: '.beegame/tmp/preview-test-fixture/execution.json' })).json()
    expect(receipt.status).toBe('interrupted')
    expect(receipt.freshness.status).toBe('changed')
    expect(receipt.toolingFreshness?.status ?? 'unverified').toBe('unverified') // Legacy receipts/inspectors may omit tooling identity; neither proves it
    const count = requests.length
    expect((await call('ReadVerificationResults', { operation: 'measure' })).response.isError).toBe(true)
    expect((await call('ReadVerificationResults', { measurementId: 'x', previewReceipt: 'x' })).response.isError).toBe(true)
    expect(requests).toHaveLength(count)
    expect(requests.every((body: any) => body.executionInputs === true || Array.isArray(body.handoffPaths) || typeof body.inspectRequestKey === 'string')).toBe(true)
    await revoke()
    expect((await call('ReadVerificationResults')).response.isError).toBe(true)
    expect(requests).toHaveLength(count)
    expect(snapshot(root)).toEqual(before)
  } finally { await client.close(); await prepared.close(); await revoke(); server.stop(true) }
}, 20_000)

test('result access rejects another project/session before any host request', async () => {
  const root = fixture(), other = fixture(), file = projectPreviewCapabilityPath(root, 'ours', 'measurement')
  const revoke = await publishProjectPreviewCapability(root, 'ours', 'http://127.0.0.1:1/unused', 'measurement')
  try {
    await expect(readVerificationResults(other, {}, { capabilityFile: file, sessionId: 'ours' })).rejects.toThrow('does not match')
    await expect(readVerificationResults(root, {}, { capabilityFile: file, sessionId: 'other' })).rejects.toThrow('does not match')
    await expect(readVerificationResults(root, {})).rejects.toThrow('unavailable')
  } finally { await revoke() }
})
