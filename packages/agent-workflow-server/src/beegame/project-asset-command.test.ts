import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { writeProjectAssetCommand } from './project-asset-command'
import { parseSpriteSheet, readUiData, spriteSheetSelection } from './game-content-consumer'
import { writeBeeGameAssetManifest } from './asset-contracts'
import { assetManifestAuthoringExamples } from './asset-manifest-authoring-contract'
import { validateResourceDelivery } from './resource-validation-cli'

async function run(cwd: string, script: string, ...args: string[]) {
  const child = Bun.spawn([process.execPath, script, ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, code }
}

test('project asset command browses facts and returns image cost without forcing a source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-assets-command-'))
  const requests: string[] = []
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      requests.push(new URL(request.url).pathname)
      if (new URL(request.url).pathname.endsWith('/api/resource-catalog/packs'))
        return Response.json({
          items: [{ packId: 'pack-1', license: 'CC0' }],
          facets: { dimensions: ['2D'] },
        })
      return Response.json({
        available: true,
        quality: 'medium',
        size: '1024x1024',
        maxRequestCredits: 3,
      })
    },
  })
  try {
    const script = join(root, 'assets.mjs')
    await writeProjectAssetCommand(script, {
      libraryBaseUrl: `http://127.0.0.1:${server.port}`,
      imageEndpoint: `http://127.0.0.1:${server.port}/generate`,
    })
    expect(
      JSON.parse((await run(root, script, 'catalog')).stdout).items[0].license,
    ).toBe('CC0')
    expect(
      JSON.parse((await run(root, script, 'cost')).stdout).maxRequestCredits,
    ).toBe(3)
    expect(requests).toEqual(['/api/resource-catalog/packs', '/generate'])
  } finally {
    server.stop(true)
    await rm(root, { recursive: true, force: true })
  }
})

test('project asset command saves only successful images, returns hash and never overwrites', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-image-command-'))
  const image = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1])
  let calls = 0
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      if (request.method === 'GET') return Response.json({ available: true, provider: 'openai', maxRequestCredits: 3 })
      calls++
      const body = (await request.json()) as { requestId: string; size?: string; referenceImagePath?: string }
      if (body.requestId === 'asset-1') {
        expect(body.size).toBe('1536x1024')
        expect(body.referenceImagePath).toBe('assets/generated/board.png')
      }
      return body.requestId === 'failed'
        ? Response.json({ error: 'not delivered' }, { status: 502 })
        : new Response(image, {
            headers: {
              'content-type': 'image/png',
              'x-image-credits-micro': '420000',
              'x-image-billing-state': 'settled',
            },
          })
    },
  })
  try {
    await mkdir(join(root, 'assets'))
    const script = join(root, 'assets.mjs')
    await writeProjectAssetCommand(script, {
      imageEndpoint: `http://127.0.0.1:${server.port}/generate`,
    })
    const request = join(root, 'request.json')
    await writeFile(
      request,
      JSON.stringify({ requestId: 'asset-1', prompt: 'a sprite', size: '1536x1024',
        referenceImagePath: 'assets/generated/board.png' }),
    )
    const first = await run(
      root,
      script,
      'generate',
      request,
      'assets/sprite.png',
    )
    expect(first.code).toBe(0)
    expect(JSON.parse(first.stdout)).toMatchObject({
      path: 'assets/sprite.png',
      source: 'agent-authored',
      chargedCreditsMicro: '420000',
      billingState: 'settled',
    })
    expect(await readFile(join(root, 'assets/sprite.png'))).toEqual(image)
    expect(
      JSON.parse(
        (await run(root, script, 'inspect', 'assets/sprite.png')).stdout,
      ).sha256,
    ).toBe(JSON.parse(first.stdout).sha256)
    expect(
      (await run(root, script, 'generate', request, 'assets/sprite.png')).code,
    ).not.toBe(0)
    expect(calls).toBe(1)
    await writeFile(
      request,
      JSON.stringify({ requestId: 'failed', prompt: 'another sprite' }),
    )
    expect(
      (await run(root, script, 'generate', request, 'assets/failed.png')).code,
    ).not.toBe(0)
    await expect(
      readFile(join(root, 'assets/failed.png')),
    ).rejects.toMatchObject({ code: 'ENOENT' })
  } finally {
    server.stop(true)
    await rm(root, { recursive: true, force: true })
  }
})

test('project asset command keeps the generated sheet intact and writes frame metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-atlas-command-'))
  try {
    await mkdir(join(root, 'assets/generated'), { recursive: true })
    const script = join(root, 'assets.mjs')
    await writeProjectAssetCommand(script, {})
    const sheet = await sharp({ create: { width: 32, height: 16, channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer()
    await writeFile(join(root, 'assets/generated/elements.png'), sheet)
    const spec = join(root, 'assets/generated/frames.json')
    await writeFile(spec, JSON.stringify({ frames: {
      button: { x: 0, y: 0, w: 12, h: 12 },
      icon: { x: 16, y: 0, w: 12, h: 12 },
    } }))
    const result = await run(root, script, 'atlas', 'assets/generated/elements.png',
      'assets/generated/frames.json', 'assets/runtime/ui.png')
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout).frames).toEqual(['button', 'icon'])
    expect((await readFile(join(root, 'assets/runtime/ui.png'))).toString('hex')).toBe(sheet.toString('hex'))
    const atlas = JSON.parse(await readFile(join(root, 'assets/runtime/ui.json'), 'utf8'))
    expect(atlas).toEqual({ frames: {
      button: { frame: { x: 0, y: 0, w: 12, h: 12 } },
      icon: { frame: { x: 16, y: 0, w: 12, h: 12 } },
    } })
    expect(parseSpriteSheet(atlas)).toMatchObject({ frames: { button: { x: 0, y: 0, width: 12, height: 12 } } })
    const manifest = assetManifestAuthoringExamples().canonical
    manifest.requirements[0]!.acquisition_profile.asset_kinds = ['sprite-atlas']
    manifest.resources[0] = { ...manifest.resources[0]!, id: 'UI-ATLAS-01',
      root_path: 'assets/runtime/ui.png', file_paths: ['assets/runtime/ui.png', 'assets/runtime/ui.json'],
      asset_kind: 'sprite-atlas', dimension: '2D' }
    await writeBeeGameAssetManifest(root, manifest)
    expect(validateResourceDelivery(root).valid).toBe(true)
    const ui = readUiData({ schema: 'beegame-content.v1', id: 'title', kind: 'ui-screen',
      assetRefs: ['UI-ATLAS-01'], data: { rootId: 'root', nodes: [
        { id: 'root', role: 'screen-root' },
        { id: 'play-art', parentId: 'root', role: 'image', assetRef: 'UI-ATLAS-01', data: { frame: 'button' } },
      ] } })
    expect(spriteSheetSelection(parseSpriteSheet(atlas), ui.nodes[1]!.data).frame)
      .toEqual({ x: 0, y: 0, width: 12, height: 12 })
    await writeFile(spec, JSON.stringify({ frames: { a: { x: 0, y: 0, w: 20, h: 12 },
      b: { x: 16, y: 0, w: 12, h: 12 } } }))
    const invalid = await run(root, script, 'atlas', 'assets/generated/elements.png',
      'assets/generated/frames.json', 'assets/runtime/overlap.png')
    expect(invalid.code).not.toBe(0)
    await expect(readFile(join(root, 'assets/runtime/overlap.png'))).rejects.toMatchObject({ code: 'ENOENT' })
  } finally { await rm(root, { recursive: true, force: true }) }
})
