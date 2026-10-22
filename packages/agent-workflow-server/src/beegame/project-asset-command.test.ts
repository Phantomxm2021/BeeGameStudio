import { expect, test } from 'bun:test'
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { compileUiReferenceBoard } from '../image-generation/ui-reference-board.mjs'
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

test('asset tools stay with the loaded host after disk updates and refresh in a new process', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-tool-host-version-'))
  try {
    const commands = join(root, 'beegame'), images = join(root, 'image-generation')
    await mkdir(commands); await mkdir(images)
    for (const name of ['project-asset-command.ts', 'project-asset-cli.mjs'])
      await copyFile(new URL('./' + name, import.meta.url), join(commands, name))
    const compilerPath = join(images, 'ui-reference-board.mjs')
    await copyFile(new URL('../image-generation/ui-reference-board.mjs', import.meta.url), compilerPath)
    const moduleUrl = pathToFileURL(join(commands, 'project-asset-command.ts')).href
    const loadedHost = await import(moduleUrl)
    const loadedCompiler = await import(pathToFileURL(compilerPath).href)
    const input = { requestId: 'version-fixture', purpose: 'reference', uiReference: { viewport: { width: 800, height: 600 },
      style: 'Shared project style', screens: [{ id: 'play', description: 'Complete scene and HUD' }] } }
    await writeFile(join(root, 'request.json'), JSON.stringify(input))
    const cliPath = join(commands, 'project-asset-cli.mjs')
    await writeFile(cliPath, (await readFile(cliPath, 'utf8')) + '\n// NEXT_CLI_VERSION\n')
    await writeFile(compilerPath, (await readFile(compilerPath, 'utf8'))
      .replace('Create a visual reference board', 'NEXT_COMPILER_VERSION'))
    // A running host must keep both old sources, even for tools written after the update.
    const script = join(root, 'running-host.mjs')
    await loadedHost.writeProjectAssetCommand(script, {})
    expect(await readFile(script, 'utf8')).not.toContain('NEXT_CLI_VERSION')
    const result = await run(root, script, 'ui-board-plan', 'request.json')
    expect(result.code, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(loadedCompiler.compileUiReferenceBoard(input))
    // A fresh host picks up both updated sources without mutating the running process.
    const restart = join(root, 'fresh-host.mjs'), freshScript = join(root, 'fresh-tools.mjs')
    await writeFile(restart, `import { writeProjectAssetCommand } from ${JSON.stringify(moduleUrl)};
      await writeProjectAssetCommand(${JSON.stringify(freshScript)}, {});`)
    const started = await run(root, restart)
    expect(started.code, started.stderr).toBe(0)
    expect(await readFile(freshScript, 'utf8')).toContain('NEXT_CLI_VERSION')
    const fresh = await run(root, freshScript, 'ui-board-plan', 'request.json')
    expect(fresh.code, fresh.stderr).toBe(0)
    expect(JSON.parse(fresh.stdout).request.prompt).toContain('NEXT_COMPILER_VERSION')
  } finally { await rm(root, { recursive: true, force: true }) }
})

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
    const help = await run(root, script, '--help')
    expect(help.code).toBe(0)
    expect(help.stdout).toContain('generate --help')
    const imageHelp = await run(root, script, 'generate', '--help')
    expect(imageHelp.code).toBe(0)
    expect(imageHelp.stdout).toContain('complete game-screen design boards replace prompt with uiReference')
    expect(imageHelp.stdout).not.toContain('register needs with resources: []')
    const [example, revision] = imageHelp.stdout.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line))
    expect(revision).toMatchObject({ referenceImagePath: 'assets/reference/selected.png', quality: 'low' })
    await writeFile(file, JSON.stringify(example))
    const examplePlan = await run(root, script, 'ui-board-plan', file)
    expect(examplePlan.code).toBe(0)
    expect(JSON.parse(examplePlan.stdout).request).toMatchObject({ quality: 'low', background: 'opaque' })
    await writeFile(file, JSON.stringify(input))
    for (const command of ['cost', 'ui-board-plan', 'ui-assets-plan']) {
      const result = await run(root, script, command, '--help')
      expect(result.code).toBe(0)
      if (command === 'ui-assets-plan') expect(result.stdout).toContain('register needs with resources: []')
    }
    expect(received).toEqual([])
    const planned = await run(root, script, 'ui-board-plan', file)
    expect(planned.code).toBe(0)
    const plan = JSON.parse(planned.stdout)
    expect(plan).toEqual(compileUiReferenceBoard(input))
    expect(plan.layout).toMatchObject({ columns: 3, rows: 1 })
    expect(plan.request).toMatchObject({ size: '1536x1024', quality: 'low', background: 'opaque' })
    expect(plan.request.prompt).toContain('Keep each complete scene and its HUD together and readable')
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

test('UI skin planning requires a real selected reference and submits the design-linked production request unchanged', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-ui-skins-'))
  const received: unknown[] = []
  let supportsReference = true
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (request.method === 'GET') { received.push('quote'); return Response.json({ available: true, provider: 'cloudflare',
      billingSource: 'external', referenceImageSupported: supportsReference }) }
    received.push(await request.json())
    return new Response(new Uint8Array(await sharp({ create: { width: 8, height: 8, channels: 4, background: '#fff0' } }).png().toBuffer()),
      { headers: { 'content-type': 'image/png' } })
  } })
  try {
    await mkdir(join(root, 'assets/visual'), { recursive: true })
    const design = await sharp({ create: { width: 8, height: 8, channels: 4, background: '#123' } }).png().toBuffer()
    await writeFile(join(root, 'assets/visual/selected.png'), design)
    const script = join(root, 'assets.mjs'), file = join(root, 'request.json')
    const input = { requestId: 'ui-skins', purpose: 'production', requirementIds: ['ui-skins'], referenceImagePath: 'assets/visual/selected.png',
      uiAssets: { elements: [{ id: 'panel', description: 'The selected panel skin without text', width: 400, height: 240 }] } }
    await writeFile(file, JSON.stringify(input))
    await writeProjectAssetCommand(script, { imageEndpoint: `http://127.0.0.1:${server.port}/generate` })
    const planned = await run(root, script, 'ui-assets-plan', file)
    expect(planned.code, planned.stderr).toBe(0)
    expect(JSON.parse(planned.stdout).design).toMatchObject({ path: input.referenceImagePath,
      sha256: createHash('sha256').update(design).digest('hex') })
    expect(received).toEqual([])
    await writeFile(file, JSON.stringify({ ...input, referenceImagePath: 'assets/visual/missing.png' }))
    expect((await run(root, script, 'ui-assets-plan', file)).code).not.toBe(0)
    expect(received).toEqual([])
    await writeFile(file, JSON.stringify(input))
    supportsReference = false
    const unsupported = await run(root, script, 'generate', file, 'assets/runtime/unsupported.png')
    expect(unsupported.code).not.toBe(0); expect(unsupported.stderr).toContain('no generation was submitted')
    expect(received).toEqual(['quote']); received.length = 0; supportsReference = true
    expect((await run(root, script, 'generate', file, 'assets/runtime/skins.png')).code).toBe(0)
    expect(received).toEqual(['quote', input])
    expect(JSON.parse((await run(root, script, 'ui-assets-plan', file)).stdout).note).toContain('not an aesthetic verdict')
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
          if (url.pathname.includes('/elements/')) return Response.json({element:{path:'original/sample.bin',specs:${JSON.stringify({ contentHash: storedHash })}}});
          return Response.json({pack:{license:'CC0',version:'1.2'}});
        };
      `)
      const child = Bun.spawn([process.execPath, '--preload', preload, script, 'fetch', 'pack', 'element', 'assets/sample.bin'], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
      if (name === 'valid') {
        expect(code).toBe(0)
        expect(JSON.parse(stdout)).toMatchObject({ source: 'resource-library', sha256: hash, registrationSource: {type:'resource-library',pack_id:'pack',pack_version:'1.2',element_id:'element',element_path:'original/sample.bin'} })
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
    const help = await run(root, script, '--help')
    expect(help.code).toBe(0)
    expect(help.stdout).toContain('separate part files and repacking are not required')
    expect(help.stdout).toContain('operation:inspect')
    expect(help.stdout).toContain('Alpha bounds do not identify objects')
    expect(help.stdout).toContain('"frames":{"name":{"x":0,"y":0,"w":32,"h":32}}')
    expect(help.stdout).toContain('output sidecar format, not input')
    expect(help.stdout).toContain('integer source-image pixels from the top-left')
    expect(help.stdout).toContain('Both inputs are project-relative files under assets/')
    const mark = await sharp({ create: { width: 8, height: 8, channels: 4, background: '#30b464' } }).png().toBuffer()
    const sheet = await sharp({ create: { width: 32, height: 16, channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: mark, left: 2, top: 2 }, { input: mark, left: 18, top: 2 }]).png().toBuffer()
    await writeFile(join(root, 'assets/generated/elements.png'), sheet)
    const spec = join(root, 'assets/generated/frames.json')
    const example = JSON.parse(help.stdout.split('Atlas input: ')[1]!.split('. Frame values')[0]!)
    // Adapt the documented rectangle to this smaller synthetic image.
    example.frames.name.w = 12; example.frames.name.h = 12
    await writeFile(spec, JSON.stringify(example))
    const documented = await run(root, script, 'atlas', 'assets/generated/elements.png',
      'assets/generated/frames.json', 'assets/runtime/example.png')
    expect(documented.code, documented.stderr).toBe(0)
    expect(JSON.parse(await readFile(join(root, 'assets/runtime/example.json'), 'utf8')))
      .toEqual({ frames: { name: { frame: example.frames.name } } })
    for (const [frames, expected] of [
      [[{ name: 'button', x: 0, y: 0, w: 12, h: 12 }], 'Atlas input:'],
      [{ button: { frame: { x: 0, y: 0, w: 12, h: 12 } } }, 'Invalid atlas frame fields: button'],
      [{ button: { x: 0.5, y: 0, w: 12, h: 12 } }, 'must be integers'],
      [{ button: { x: 24, y: 0, w: 12, h: 12 } }, 'PNG=32x16'],
      [{ button: { x: 0, y: 0, w: 0, h: 12 } }, 'w/h > 0'],
      [{ 'bad name': { x: 0, y: 0, w: 12, h: 12 } }, 'Invalid atlas frame name'],
    ] as const) {
      await writeFile(spec, JSON.stringify({ frames }))
      const rejected = await run(root, script, 'atlas', 'assets/generated/elements.png',
        'assets/generated/frames.json', 'assets/runtime/rejected.png')
      expect(rejected.code).not.toBe(0)
      expect(rejected.stderr).toContain(expected)
      if (expected === 'Invalid atlas frame fields: button') {
        expect(rejected.stderr).toContain('output sidecar format, not input')
        expect(rejected.stderr).not.toContain('Out-of-bounds')
      }
      await expect(readFile(join(root, 'assets/runtime/rejected.png'))).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(readFile(join(root, 'assets/runtime/rejected.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    }
    await writeFile(spec, JSON.stringify({ frames: {
      button: { x: 0, y: 0, w: 12, h: 12 },
      icon: { x: 16, y: 0, w: 12, h: 12 },
    } }))
    const result = await run(root, script, 'atlas', 'assets/generated/elements.png',
      'assets/generated/frames.json', 'assets/runtime/ui.png')
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout).frames).toEqual(['button', 'icon'])
    expect((await readFile(join(root, 'assets/runtime/ui.png'))).toString('hex')).toBe(sheet.toString('hex'))
    expect((await readFile(join(root, 'assets/generated/elements.png'))).toString('hex')).toBe(sheet.toString('hex'))
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
    expect(invalid.stderr).toContain('Overlapping atlas frames: b')
    await expect(readFile(join(root, 'assets/runtime/overlap.png'))).rejects.toMatchObject({ code: 'ENOENT' })
  } finally { await rm(root, { recursive: true, force: true }) }
})


test('catalog lists are compact while details, selection IDs and pagination remain available', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-catalog-summary-'))
  const item = {packId:'pack-1',packVersion:'1',packName:'Sample',license:'CC0',
    elementId:'item-1',elementName:'Sample image',elementPath:'image.png',dimension:'2D',
    category:'ui',assetKind:'sprite',usageTags:['button'],capabilities:['static'],dependencyCount:2,
    description:'Long catalog description. '.repeat(200),technicalFacts:{notes:'Metadata. '.repeat(200)},
    relations:[{target:'item-2'}],contentProfile:{notes:'Profile. '.repeat(200)},preview:'https://example.test/image.png'}
  const response = {items:[item],total:100,facets:{dimensions:['2D']},nextCursor:'page-two'}
  const received: Array<{path:string,body:unknown}> = []
  const server = Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request) {
    const path = new URL(request.url).pathname
    received.push({path,body:request.method === 'POST' ? await request.json() : null})
    return Response.json(path.startsWith('/api/resource-catalog/') ? response : {element:item})
  }})
  try {
    const script = join(root,'assets.mjs')
    await writeProjectAssetCommand(script,{libraryBaseUrl:`http://127.0.0.1:${server.port}`})
    for (const command of [['catalog'],['elements','pack-1']]) {
      const query = JSON.stringify({filters:{formats:['png']},limit:10,cursor:'page-one'})
      const summary = await run(root,script,...command,query)
      expect(summary.code,summary.stderr).toBe(0)
      const result = JSON.parse(summary.stdout)
      expect(result).toMatchObject({total:100,facets:response.facets,nextCursor:'page-two'})
      expect(result.items[0]).toMatchObject({packId:'pack-1',packVersion:'1',dimension:'2D'})
      if (command[0] === 'catalog') expect(result.items[0].license).toBe('CC0')
      else expect(result.items[0]).toMatchObject({elementId:'item-1',elementPath:'image.png',dependencyCount:2})
      expect(result.items[0].technicalFacts).toBeUndefined()
      expect(result.items[0].description).toBeUndefined()
      const full = await run(root,script,...command,query,'--details')
      expect(full.code,full.stderr).toBe(0)
      expect(JSON.parse(full.stdout)).toEqual(response)
      expect(summary.stdout.length).toBeLessThan(full.stdout.length / 2)
      expect(received.at(-1)?.body).toEqual(JSON.parse(query))
      expect(received.at(-2)?.body).toEqual(JSON.parse(query))
    }
    expect(JSON.parse((await run(root,script,'element','pack-1','item-1')).stdout)).toEqual({element:item})
    expect(received).toHaveLength(5)
  } finally {server.stop(true);await rm(root,{recursive:true,force:true})}
})

test('managed asset commands reject absent or mismatched access and pin a paid attempt to one bridge', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-assets-access-'))
  const workspace = await realpath(root)
  const script = join(root, 'assets.mjs'), capabilityFile = join(root, 'current.json')
  let oldPosts = 0, newRequests = 0, mode = 'replace'
  const replacement = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() {
    newRequests++; return Response.json({ available: true })
  } })
  const capability = (endpoint: string) => ({ version: 1, workspace, sessionId: 'fixture', executionId: 'execution', assets: { imageEndpoint: endpoint } })
  const bridge = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request, server) {
    if (request.method === 'GET') {
      if (mode === 'http-error') return Response.json({ error: 'fixture upstream rejected' }, { status: 503 })
      await writeFile(capabilityFile, JSON.stringify(capability(replacement.url.origin)))
      return Response.json({ available: true })
    }
    oldPosts++
    server.stop(true) // Simulate a lost response after the request reached the bridge.
    return new Response('unreachable')
  } })
  const invoke = async (path: string | undefined, ...args: string[]) => {
    const env = { ...process.env, BEEGAME_ASSET_CAPABILITY_FILE: path }
    const child = Bun.spawn([process.execPath, script, ...args], { cwd: root, env, stdout: 'pipe', stderr: 'pipe' })
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    return { code, stdout, stderr }
  }
  const save = (value: unknown) => writeFile(capabilityFile, JSON.stringify(value))
  try {
    await writeProjectAssetCommand(script, { sessionId: 'fixture' })
    expect((await invoke(undefined, 'cost')).stderr).toContain('ASSET_CAPABILITY_MISSING')
    expect((await invoke(capabilityFile, 'cost')).stderr).toContain('ASSET_CAPABILITY_EXPIRED')
    expect((await invoke(capabilityFile, 'generate', '--help')).code).toBe(0)
    const valid = capability(bridge.url.origin)
    for (const invalid of [{ ...valid, sessionId: 'another-session' }, { ...valid, workspace: root + '/another-project' },
      { ...valid, assets: { imageEndpoint: 'https://example.com/image' } }, { ...valid, executionId: '' }]) {
      await save(invalid)
      expect((await invoke(capabilityFile, 'cost')).stderr).toContain('ASSET_CAPABILITY_MISMATCH')
    }
    await save({ ...valid, assets: {} })
    expect((await invoke(capabilityFile, 'cost')).stderr).toContain('AI image generation is unavailable for this turn')
    await save(valid)
    mode = 'http-error'
    const upstreamFailure = await invoke(capabilityFile, 'cost')
    expect(upstreamFailure.stderr).toContain('Capability HTTP 503')
    expect(upstreamFailure.stderr).not.toContain('ASSET_BRIDGE_UNREACHABLE')
    mode = 'replace'
    await writeFile(join(root, 'request.json'), JSON.stringify({ requestId: 'original-attempt', purpose: 'reference', prompt: 'Fixture' }))
    const result = await invoke(capabilityFile, 'generate', 'request.json', 'assets/result.png')
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('ASSET_REQUEST_OUTCOME_UNKNOWN')
    expect(result.stderr).toContain('requestId=original-attempt')
    expect(oldPosts).toBe(1)
    expect(newRequests).toBe(0)
    await expect(readFile(join(root, 'assets/result.png'))).rejects.toThrow()
    // A fresh host may publish a different private path: the retained entry uses its current environment.
    const restarted = join(root, 'restarted.json')
    await writeFile(restarted, JSON.stringify(capability(replacement.url.origin)))
    expect((await invoke(restarted, 'cost')).code).toBe(0)
    expect(newRequests).toBe(1)
    await save(valid)
    expect((await invoke(capabilityFile, 'cost')).stderr).toContain('ASSET_BRIDGE_UNREACHABLE')
    // Even legacy direct configuration must not override an explicitly supplied expired capability.
    const legacy = join(root, 'legacy.mjs')
    await writeProjectAssetCommand(legacy, { imageEndpoint: replacement.url.origin })
    await copyFile(legacy, script)
    expect((await invoke(join(root, 'missing.json'), 'cost')).stderr).toContain('ASSET_CAPABILITY_EXPIRED')
    expect(newRequests).toBe(1)
  } finally { bridge.stop(true); replacement.stop(true); await rm(root, { recursive: true, force: true }) }
}, 30000)
