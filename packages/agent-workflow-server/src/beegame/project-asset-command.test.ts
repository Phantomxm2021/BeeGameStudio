import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
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

test('UI board CLI plans offline, quotes the computed canvas and submits structured inventory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-ui-board-'))
  const received: unknown[] = []
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (request.method === 'GET') {
      received.push(Object.fromEntries(new URL(request.url).searchParams))
      return Response.json({ available: true, provider: 'openai' })
    }
    received.push(await request.json())
    return new Response(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]), { headers: { 'content-type': 'image/png' } })
  } })
  try {
    const script = join(root, 'assets.mjs'), file = join(root, 'request.json')
    const input = { purpose: 'reference', requestId: 'ui-board', uiReference: { viewport: { width: 720, height: 1280 },
      style: 'Flat colorful UI', screens: ['play', 'pause', 'result'].map(id => ({ id, description: `Complete ${id} screen and HUD` })) } }
    await writeFile(file, JSON.stringify(input))
    await writeProjectAssetCommand(script, {})
    const planned = await run(root, script, 'ui-board-plan', file)
    expect(planned.code).toBe(0)
    const plan = JSON.parse(planned.stdout)
    expect(plan.layout).toMatchObject({ columns: 3, rows: 1 })
    expect(plan.request).toMatchObject({ size: '1536x1024', quality: 'low', background: 'opaque' })
    expect(received).toEqual([])
    await writeProjectAssetCommand(script, { imageEndpoint: `http://127.0.0.1:${server.port}/generate` })
    await writeFile(file, JSON.stringify({ ...input, uiReference: { ...input.uiReference, columns: 2 } }))
    expect((await run(root, script, 'generate', file, 'assets/invalid.png')).code).not.toBe(0)
    expect(received).toEqual([])
    await writeFile(file, JSON.stringify(input))
    const generated = await run(root, script, 'generate', file, 'assets/board.png')
    expect(generated.code).toBe(0)
    expect(received).toEqual([{ quality: 'low', size: '1536x1024' }, input])
    expect(JSON.parse(generated.stdout).requestedLayout).toEqual(plan.layout)
    expect(JSON.parse(generated.stdout).note).toContain('none is certified')
  } finally { server.stop(true); await rm(root, { recursive: true, force: true }) }
})

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

test('catalog CLI preserves structured filters and pagination, rejects ignored parameters before network', async () => {
  const root=await mkdtemp(join(tmpdir(),'bgs-catalog-parameters-'))
  const received:unknown[]=[]
  const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
    received.push(await request.json());return Response.json({items:[],nextCursor:'page-two'})
  }})
  try {
    const script=join(root,'assets.mjs')
    await writeProjectAssetCommand(script,{libraryBaseUrl:`http://127.0.0.1:${server.port}`})
    for(const command of [['catalog'],['elements','pack-1']]) {
      for(const input of [undefined,{formats:['png']},{formats:['png'],limit:10,cursor:'page-two'},
        {filters:{formats:['png']},limit:10,cursor:'page-two'}]) {
        const result=await run(root,script,...command,...(input?[JSON.stringify(input)]:[]))
        expect(result.stderr).toBe('');expect(result.code).toBe(0)
        expect(received.at(-1)).toEqual(input===undefined?{filters:{}}:'filters' in input?input:
          {filters:{formats:['png']},...('limit' in input?{limit:10,cursor:'page-two'}:{})})
      }
      const before=received.length
      for(const input of [{query:'train'},{search:'audio'},{filters:{query:'train'}},{filters:{limit:10}},
        {filters:{formats:'png'}},{formats:null},{formats:['']},{filters:{},formats:['png']},
        {limit:0},{limit:'10'},{cursor:99},null,[],{filters:{formtas:['png']}}]) {
        const result=await run(root,script,...command,JSON.stringify(input))
        expect(result.code).not.toBe(0);expect(result.stderr).toMatch(/Catalog|catalog/)
      }
      expect(received.length).toBe(before)
    }
    const help=await run(root,script,'--help')
    expect(help.stdout).toContain('No free-text query/search')
    expect(help.stdout).toContain('nextCursor')
    expect(help.stdout).toContain('Honor explicit user source choices')
    expect(help.stdout).toContain('first consider suitable supplied or built-in licensed resources')
    expect(help.stdout).toContain('not as the default for all core art')
    expect(help.stdout).not.toContain('AI generation is the primary route')
  }finally{server.stop(true);await rm(root,{recursive:true,force:true})}
})

test('library fetch requires a stored hash, checks bytes and removes mismatches without overwriting', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-library-download-hash-'))
  const bytes = 'synthetic library asset'
  const hash = createHash('sha256').update(bytes).digest('hex')
  try {
    const script = join(root, 'assets.mjs'), preload = join(root, 'fake-transport.mjs')
    await writeProjectAssetCommand(script, { libraryBaseUrl: 'https://library.test' })
    // Offline transport only; production CLI validation, file writes and cleanup run unchanged.
    for (const [name, storedHash] of [['missing', undefined], ['invalid', 'g'.repeat(64)], ['mismatch', 'a'.repeat(64)], ['valid', hash]] as const) {
      await writeFile(preload, `
        globalThis.fetch = async input => {
          const url = new URL(input);
          if (url.origin === 'https://asset.test') {
            if (${JSON.stringify(name)} === 'missing' || ${JSON.stringify(name)} === 'invalid')
              throw Error('Unexpected download before hash validation');
            return new Response(${JSON.stringify(bytes)});
          }
          if (url.origin !== 'https://library.test') throw Error('Unexpected external request');
          if (url.pathname.endsWith('/resource-url')) return Response.json({url:'https://asset.test/file'});
          if (url.pathname.includes('/elements/')) return Response.json({element:{specs:${JSON.stringify({ contentHash: storedHash })}}});
          return Response.json({pack:{license:'CC0'}});
        };
      `)
      const child = Bun.spawn([process.execPath, '--preload', preload, script, 'fetch', 'pack', 'element', 'assets/sample.bin'], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
      if (name === 'valid') {
        expect(code).toBe(0)
        expect(JSON.parse(stdout)).toMatchObject({ source: 'resource-library', sha256: hash })
        expect(await readFile(join(root, 'assets/sample.bin'), 'utf8')).toBe(bytes)
        const again = Bun.spawn([process.execPath, '--preload', preload, script, 'fetch', 'pack', 'element', 'assets/sample.bin'], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
        expect(await again.exited).not.toBe(0)
        expect(await readFile(join(root, 'assets/sample.bin'), 'utf8')).toBe(bytes)
      } else {
        expect(code).not.toBe(0)
        expect(stderr).toContain(name === 'mismatch' ? 'hash does not match' : 'valid stored content hash')
        expect(await Bun.file(join(root, 'assets/sample.bin')).exists()).toBe(false)
      }
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('project asset command saves only successful images, returns hash and never overwrites', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-image-command-'))
  const image = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1])
  let calls = 0
  let quotes = 0
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      if (request.method === 'GET') {
        quotes++
        return Response.json({ available: true, provider: 'openai', maxRequestCredits: 3 })
      }
      calls++
      const body = (await request.json()) as { requestId: string; purpose?: string; requirementIds?: string[]; background?: string; size?: string; referenceImagePath?: string }
      if (body.requestId === 'asset-1') {
        expect(body.purpose).toBe('production')
        expect(body.requirementIds).toEqual(['sprite-part'])
        expect(body.background).toBe('opaque')
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
    for (const [invalid, message] of [
      [{ background: 'white' }, /background must be one of: auto, opaque, transparent/],
      [{ quality: 'ultra' }, /quality must be one of:/],
      [{ size: '2048x2048' }, /size must be one of:/],
      [{ backgroun: 'opaque' }, /Unknown image request fields: backgroun/],
    ] as const) {
      await writeFile(request, JSON.stringify({ requestId: 'invalid', prompt: 'a sprite', ...invalid }))
      const result = await run(root, script, 'generate', request, 'assets/invalid.png')
      expect(result.code).not.toBe(0)
      expect(result.stderr).toMatch(message)
    }
    expect(quotes).toBe(0)
    expect(calls).toBe(0)
    await expect(readFile(join(root, 'assets/invalid.png'))).rejects.toMatchObject({ code: 'ENOENT' })
    await writeFile(
      request,
      JSON.stringify({ requestId: 'asset-1', purpose: 'production', requirementIds: ['sprite-part'], prompt: 'a sprite', background: 'opaque', size: '1536x1024',
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
