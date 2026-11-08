import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { expect, test } from 'bun:test'
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { compileUiReferenceBoard } from '../image-generation/ui-reference-board.mjs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { writeProjectAssetCommand } from './project-asset-command'
import { produceResources } from './resource-production'
import { parseSpriteSheet, readUiData, spriteSheetSelection } from './game-content-consumer'
import { writeBeeGameAssetManifest } from './asset-contracts'
import { assetManifestAuthoringExamples } from './asset-manifest-authoring-contract'
import { auditAssetContract } from './asset-contract-audit'
import { resolveExactResourceElement, type ResourceElement, type ResourcePack } from '@bee-game-studio/beegame-resource-core'

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
    expect(await readFile(script,'utf8')).not.toContain('NEXT_COMPILER_VERSION')
    expect((await run(root,script,'--help')).code).toBe(0)
    // A fresh host picks up both updated sources without mutating the running process.
    const restart = join(root, 'fresh-host.mjs'), freshScript = join(root, 'fresh-tools.mjs')
    await writeFile(restart, `import { writeProjectAssetCommand } from ${JSON.stringify(moduleUrl)};
      await writeProjectAssetCommand(${JSON.stringify(freshScript)}, {});`)
    const started = await run(root, restart)
    expect(started.code, started.stderr).toBe(0)
    expect(await readFile(freshScript, 'utf8')).toContain('NEXT_CLI_VERSION')
    expect(await readFile(freshScript,'utf8')).toContain('NEXT_COMPILER_VERSION')
    expect((await run(root,freshScript,'--help')).code).toBe(0)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('retired UI planning commands are absent while ordinary generation stays discoverable',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bgs-retired-ui-planning-'))
  try {
    const script=join(root,'assets.mjs');await writeProjectAssetCommand(script,{})
    for(const command of ['ui-board-plan','ui-assets-plan']) {
      expect((await run(root,script,command,'--help')).code).not.toBe(0)
      expect((await run(root,script,command,'missing.json')).code).not.toBe(0)
    }
    const mainHelp=await run(root,script,'--help')
    expect(mainHelp.stdout).not.toContain('ui-board-plan')
    expect(mainHelp.stdout).not.toContain('ui-assets-plan')
    const help=await run(root,script,'generate','--help')
    expect(help.code).toBe(0)
    expect(help.stdout).toContain('Use prompt for new image requests')
    expect(help.stdout).not.toContain('ui-board-plan')
    expect(help.stdout).not.toContain('ui-assets-plan')
  }finally{await rm(root,{recursive:true,force:true})}
})

test('production atlas deliverables submit once per family without a selected design or reference image', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-ui-skins-'))
  const received: unknown[] = []
  const server = Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request) {
    if (request.method === 'GET') return Response.json({available:true,provider:'openai',referenceImageSupported:false,billingSource:'external'})
    received.push(await request.json())
    return new Response(new Uint8Array(await sharp({create:{width:8,height:8,channels:4,background:'#fff0'}}).png().toBuffer()),
      {headers:{'content-type':'image/png'}})
  }})
  try {
    const script = join(root,'assets.mjs'), file = join(root,'request.json')
    await writeProjectAssetCommand(script,{imageEndpoint:`http://127.0.0.1:${server.port}/generate`})
    const help = await run(root,script,'generate','--help')
    expect(help.code).toBe(0)
    expect(help.stdout).toContain('Use purpose: reference|experiment|production')
    expect(help.stdout).toContain('Optional keys: referenceImagePath')
    expect(help.stdout).not.toContain('Submit each atlas as one image request')
    expect(help.stdout).not.toContain('For parts that cannot be extracted intact from the selected design')
    const inputs = [
      {purpose:'production',requestId:'ui-atlas',background:'transparent',size:'1024x1024',
        prompt:'UI atlas: empty paper panel and button skin, warm hand-drawn ink, complete shapes with transparent separation.'},
      {purpose:'production',requestId:'game-atlas',background:'transparent',size:'1024x1024',
        prompt:'Game-element atlas: wooden crate and blue gem, warm hand-drawn ink, distinct proportions and transparent separation.'},
    ]
    for (const input of inputs) {
      await writeFile(file,JSON.stringify(input))
      const output = await run(root,script,'generate',file,`assets/runtime/${input.requestId}.png`)
      expect(output.code,output.stderr).toBe(0)
      expect(JSON.parse(output.stdout).path).toBe(`assets/runtime/${input.requestId}.png`)
      const saved = `assets/${input.requestId}-result.json`
      await writeFile(join(root,saved),output.stdout)
      const fixture = assetManifestAuthoringExamples().canonical
      fixture.project_target!.asset_format_capabilities.push('png')
      const registered = await produceResources(root,{operation:'register',
        ...(input.requestId==='ui-atlas'?{projectTarget:fixture.project_target,requirements:fixture.requirements}:{}),
        resources:[{acquisition:saved,id:input.requestId,fulfills:[fixture.requirements[0]!.id],
          provisional:false,reason:'Synthetic generated artwork',selection_reason:['Synthetic fixture']}]})
      expect(registered.valid).toBe(true)
      expect(registered.operation==='register' && registered.resources[0]!.file_paths).toEqual([`assets/runtime/${input.requestId}.png`])
    }
    expect(received).toEqual(inputs)
  } finally {server.stop(true);await rm(root,{recursive:true,force:true})}
})

test('saved structured UI recovery preserves its request without an offline planning route', async () => {
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
    supportsReference = false
    const unsupported = await run(root, script, 'generate', file, 'assets/runtime/unsupported.png')
    expect(unsupported.code).not.toBe(0); expect(unsupported.stderr).toContain('no generation was submitted')
    expect(received).toEqual(['quote']); received.length = 0; supportsReference = true
    expect((await run(root, script, 'generate', file, 'assets/runtime/skins.png')).code).toBe(0)
    expect(received).toEqual(['quote', input])
  } finally { server.stop(true); await rm(root, { recursive: true, force: true }) }
})

test('project asset command browses facts and returns image cost without forcing a source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-assets-command-'))
  const requests: string[] = []
  let fixedPrice = false
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
        available: true, model: fixedPrice ? 'next-configured-image-model' : 'configured-image-model',
        outputFormat: 'png', referenceImageSupported: true, maxReferenceImages: 1,
        backgroundModes: ['auto', 'opaque', 'transparent'], availableSizes: ['1024x1024', '1024x1536', '1536x1024'],
        quality: 'medium',
        size: '1024x1024',
        maxRequestCredits: 3,
        fixedPrice,
        ...(fixedPrice ? { quotedCreditsMicro: 2_500_000 } : {}),
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
    const cost = await run(root, script, 'cost')
    expect(JSON.parse(cost.stdout)).toMatchObject({ available: true, fixedPrice: false, model: 'configured-image-model',
      outputFormat: 'png', referenceImageSupported: true, maxReferenceImages: 1,
      backgroundModes: ['auto', 'opaque', 'transparent'], availableSizes: ['1024x1024', '1024x1536', '1536x1024'],
      quotedCredits: null, currency: 'Credits' })
    expect(JSON.parse(cost.stdout)).not.toHaveProperty('maxRequestCredits')
    expect(cost.stderr).toContain('actual billing follows returned usage')
    fixedPrice = true
    const fixedCost = await run(root, script, 'cost')
    expect(JSON.parse(fixedCost.stdout)).toMatchObject({ fixedPrice: true, quotedCredits: 2.5, model: 'next-configured-image-model' })
    expect(JSON.parse(fixedCost.stdout)).not.toHaveProperty('maxRequestCredits')
    expect(fixedCost.stderr).not.toContain('Usage-priced')
    expect(requests).toEqual(['/api/resource-catalog/packs', '/generate', '/generate'])
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
    const offlineScript=join(root,'offline-assets.mjs')
    await writeProjectAssetCommand(offlineScript,{})
    for(const command of [['catalog','--help'],['elements','--help'],['elements','pack-1','--help']]) {
      const help=await run(root,offlineScript,...command)
      expect(help.code,help.stderr).toBe(0)
      expect(help.stdout).toContain('a .json file path or inline JSON')
      expect(help.stdout).not.toContain('Image commands')
      expect(help.stdout).not.toContain('Use atlas to publish')
    }
    expect(received).toEqual([])
    for(const command of [['catalog'],['elements','pack-1']]) {
      for(const input of [undefined,{formats:['png']},{formats:['png'],limit:10,cursor:'page-two'},
        {filters:{formats:['png']},limit:10,cursor:'page-two'}]) {
        const result=await run(root,script,...command,...(input?[JSON.stringify(input)]:[]))
        expect(result.stderr).toBe('');expect(result.code).toBe(0)
        expect(received.at(-1)).toEqual(input===undefined?{filters:{}}:'filters' in input?input:
          {filters:{formats:['png']},...('limit' in input?{limit:10,cursor:'page-two'}:{})})
      }
      const request={filters:{formats:['png']},limit:10,cursor:'page-two'}
      await writeFile(join(root,'request.json'),JSON.stringify(request))
      for(const file of ['request.json',join(root,'request.json')]) {
        const result=await run(root,script,...command,file)
        expect(result.code,result.stderr).toBe(0)
        expect(received.at(-1)).toEqual(request)
      }
      const before=received.length
      await writeFile(join(root,'invalid.json'),JSON.stringify({filters:{formats:'png'}}))
      const invalidFile=await run(root,script,...command,'invalid.json')
      expect(invalidFile.code).not.toBe(0)
      expect(invalidFile.stderr).toContain('Catalog filters.formats')
      const missingFile=await run(root,script,...command,'missing.json')
      expect(missingFile.code).not.toBe(0)
      expect(missingFile.stderr).toContain('missing.json')
      const badHelp=await run(root,script,...command,'unexpected.json','--help')
      expect(badHelp.code).not.toBe(0)
      expect(badHelp.stderr).toContain('Usage:')
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
    expect(help.stdout).toContain('Honor explicit source and resource-library preferences')
    expect(help.stdout).toContain('search the library, then suitable Web sources, then authorized AI generation; programmatic drawing is the fallback')
    expect(help.stdout).toContain('explicit source and resource-library preferences')
    expect(help.stdout).toContain('Preserve required appearance and behavior')
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
          if (url.pathname.endsWith('/resource-library/resolve')) return Response.json({selections:[{resourceId:'element',sourceUrl:'https://asset.test/file',sourceHash:${JSON.stringify(storedHash)},dependencies:[]}]});
          if (url.pathname.endsWith('/resource-url')) return Response.json({url:'https://asset.test/file'});
          if (url.pathname.includes('/elements/')) return Response.json({element:{path:'original/sample.bin',specs:${JSON.stringify({ contentHash: storedHash })}}});
          return Response.json({pack:{license:'CC0',version:'1.2'}});
        };
      `)
      const child = Bun.spawn([process.execPath, '--preload', preload, script, 'fetch', 'pack', 'element', 'assets/runtime/sample.bin'], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
      if (name === 'valid') {
        expect(code).toBe(0)
        expect(JSON.parse(stdout)).toMatchObject({ source: 'resource-library', sha256: hash, registrationSource: {type:'resource-library',pack_id:'pack',pack_version:'1.2',element_id:'element',element_path:'original/sample.bin'} })
        expect(await readFile(join(root, 'assets/runtime/sample.bin'), 'utf8')).toBe(bytes)
        await writeFile(join(root,'assets/library-result.json'),stdout)
        const fixture = assetManifestAuthoringExamples().canonical
        fixture.project_target!.asset_format_capabilities.push('bin')
        const registered = await produceResources(root,{operation:'register',projectTarget:fixture.project_target,requirements:fixture.requirements,
          resources:[{acquisition:'assets/library-result.json',id:'downloaded',fulfills:[fixture.requirements[0]!.id],
            provisional:false,reason:'Synthetic library asset',selection_reason:['Synthetic fixture']}]})
        expect(registered.valid).toBe(true)
        expect(registered.operation==='register' && registered.resources[0]!.source).toEqual(JSON.parse(stdout).registrationSource)
        const again = Bun.spawn([process.execPath, '--preload', preload, script, 'fetch', 'pack', 'element', 'assets/runtime/sample.bin'], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
        expect(await again.exited).toBe(0)
        expect(JSON.parse(await new Response(again.stdout).text())).toMatchObject({ reused: true, sha256: hash })
        expect(await readFile(join(root, 'assets/runtime/sample.bin'), 'utf8')).toBe(bytes)
        await rm(join(root, 'assets/runtime/sample.bin'))
        await writeFile(join(root, 'outside.bin'), bytes)
        await symlink(join(root, 'outside.bin'), join(root, 'assets/runtime/sample.bin'))
        const linked = Bun.spawn([process.execPath, '--preload', preload, script, 'fetch', 'pack', 'element', 'assets/runtime/sample.bin'], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
        const linkedStderr = await new Response(linked.stderr).text()
        expect(await linked.exited).not.toBe(0)
        expect(linkedStderr).toContain('must not be a link')
        expect(await readFile(join(root, 'outside.bin'), 'utf8')).toBe(bytes)
      } else {
        expect(code).not.toBe(0)
        expect(stderr).toContain(name === 'mismatch' ? 'hash does not match' : 'valid stored content hash')
        expect(await Bun.file(join(root, 'assets/runtime/sample.bin')).exists()).toBe(false)
      }
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('library fetch resolves a nested dependency closure beside the selected asset', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-library-dependency-'))
  const scene = 'synthetic scene', material = 'synthetic material', texture = 'synthetic texture'
  const sceneHash = createHash('sha256').update(scene).digest('hex')
  const materialHash = createHash('sha256').update(material).digest('hex')
  const textureHash = createHash('sha256').update(texture).digest('hex')
  const selectedPack = {
    id: 'pack', name: 'Synthetic Pack', styles: [], gameTypes: [], dimension: '3D',
    primaryCategory: '3d-assets', categories: ['models'], license: 'CC0', version: '1.2', status: 'published',
  } as ResourcePack
  const selectedElements = [
    {
      id: 'element', packId: 'pack', name: 'Scene', path: 'models/scene.glb', category: 'models', kind: 'model',
      assetKind: 'model', usageTags: ['scene'], specs: {}, dependencies: ['material', 'texture'], status: 'ready',
      dependencyBindings: [
        { referencePath: 'Textures/material.json', dependencyElementId: 'material', kind: 'material' },
        { referencePath: 'shared/base%20.png', dependencyElementId: 'texture', kind: 'image' },
      ],
    },
    {
      id: 'material', packId: 'pack', name: 'Material', path: 'materials/material.json', category: 'models', kind: 'material',
      specs: {}, dependencies: ['texture'], status: 'ready',
      dependencyBindings: [{ referencePath: '../shared/base%20.png', dependencyElementId: 'texture', kind: 'image' }],
    },
    { id: 'texture', packId: 'pack', name: 'Texture', path: 'textures/base .png', category: 'textures', kind: 'image', specs: {}, dependencies: [], status: 'ready' },
  ] as ResourceElement[]
  const resolved = resolveExactResourceElement(selectedPack, selectedElements, 'element')
  expect(resolved?.dependencies).toHaveLength(3)
  const dependencyRecords = resolved!.dependencies!.map(dependency => ({
    ...dependency,
    sourceUrl: dependency.elementId === 'material' ? 'https://asset.test/material' : 'https://asset.test/texture',
    sourceHash: dependency.elementId === 'material' ? materialHash : textureHash,
  }))
  try {
    const script = join(root, 'assets.mjs'), preload = join(root, 'fake-transport.mjs')
    await writeProjectAssetCommand(script, { libraryBaseUrl: 'https://library.test' })
    await writeFile(preload, `
      globalThis.fetch = async input => {
        const url = new URL(input);
        if (url.origin === 'https://asset.test') {
          if (url.pathname.endsWith('/scene')) return new Response(${JSON.stringify(scene)});
          if (url.pathname.endsWith('/material')) return new Response(${JSON.stringify(material)});
          if (url.pathname.endsWith('/texture')) return new Response(${JSON.stringify(texture)});
          throw Error('Unexpected asset URL');
        }
        if (url.origin !== 'https://library.test') throw Error('Unexpected external request');
        if (url.pathname.endsWith('/resource-library/resolve')) return Response.json({selections:[{resourceId:'element',sourceUrl:'https://asset.test/scene',sourceHash:${JSON.stringify(sceneHash)},dependencies:${JSON.stringify(dependencyRecords)}}]});
        if (url.pathname.includes('/elements/')) return Response.json({element:{path:'models/scene.glb',specs:{contentHash:${JSON.stringify(sceneHash)}}}});
        return Response.json({pack:{license:'CC0',version:'1.2'}});
      };
    `)
    const child = Bun.spawn([process.execPath, '--preload', preload, script, 'fetch', 'pack', 'element', 'assets/models/scene.glb'], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    expect(code, stderr).toBe(0)
    expect(JSON.parse(stdout)).toMatchObject({
      sha256: sceneHash,
      root_path: 'assets/models/scene.glb',
      file_paths: ['assets/models/scene.glb', 'assets/models/Textures/material.json', 'assets/models/shared/base .png'],
      dependencies: [
        { key: 'root.0', parent_key: 'root', element_id: 'material', element_path: 'materials/material.json', reference_path: 'Textures/material.json', local_path: 'assets/models/Textures/material.json', kind: 'material' },
        { key: 'root.0.0', parent_key: 'root.0', element_id: 'texture', element_path: 'textures/base .png', reference_path: '../shared/base%20.png', local_path: 'assets/models/shared/base .png', kind: 'image' },
        { key: 'root.1', parent_key: 'root', element_id: 'texture', element_path: 'textures/base .png', reference_path: 'shared/base%20.png', local_path: 'assets/models/shared/base .png', kind: 'image' },
      ],
    })
    expect(await readFile(join(root, 'assets/models/scene.glb'), 'utf8')).toBe(scene)
    expect(await readFile(join(root, 'assets/models/Textures/material.json'), 'utf8')).toBe(material)
    expect(await readFile(join(root, 'assets/models/shared/base .png'), 'utf8')).toBe(texture)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('library fetch rejects dependency target collisions with different hashes before downloading', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-library-dependency-conflict-'))
  const scene = 'synthetic scene', first = 'first dependency', second = 'second dependency'
  const sceneHash = createHash('sha256').update(scene).digest('hex')
  const firstHash = createHash('sha256').update(first).digest('hex')
  const secondHash = createHash('sha256').update(second).digest('hex')
  try {
    const script = join(root, 'assets.mjs'), preload = join(root, 'fake-transport.mjs')
    await writeProjectAssetCommand(script, { libraryBaseUrl: 'https://library.test' })
    await writeFile(preload, `
      globalThis.fetch = async input => {
        const url = new URL(input);
        if (url.origin === 'https://asset.test') throw Error('Unexpected download before dependency conflict validation');
        if (url.origin !== 'https://library.test') throw Error('Unexpected external request');
        if (url.pathname.endsWith('/resource-library/resolve')) return Response.json({selections:[{resourceId:'element',sourceUrl:'https://asset.test/scene',sourceHash:${JSON.stringify(sceneHash)},dependencies:[
          {key:'root.0',parentKey:'root',elementId:'first',elementPath:'first.bin',referencePath:'shared.bin',sourceUrl:'https://asset.test/first',sourceHash:${JSON.stringify(firstHash)}},
          {key:'root.1',parentKey:'root',elementId:'second',elementPath:'second.bin',referencePath:'shared.bin',sourceUrl:'https://asset.test/second',sourceHash:${JSON.stringify(secondHash)}}
        ]}]});
        if (url.pathname.includes('/elements/')) return Response.json({element:{path:'models/scene.glb',specs:{contentHash:${JSON.stringify(sceneHash)}}}});
        return Response.json({pack:{license:'CC0',version:'1.2'}});
      };
    `)
    const child = Bun.spawn([process.execPath, '--preload', preload, script, 'fetch', 'pack', 'element', 'assets/models/scene.glb'], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
    const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited])
    expect(code).not.toBe(0)
    expect(stderr).toContain('different content hashes')
    expect(await Bun.file(join(root, 'assets/models/scene.glb')).exists()).toBe(false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('project asset command saves only successful images, returns hash and never overwrites', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-image-command-'))
  const image = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1])
  let calls = 0
  let quotes = 0
  const submitted: unknown[] = []
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
      submitted.push(body)
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
    expect(quotes).toBe(1)
    expect(calls).toBe(1)
    expect(JSON.parse(first.stdout)).toMatchObject({
      path: 'assets/sprite.png',
      source: 'agent-authored',
      chargedCredits: 0.42,
      billingState: 'settled',
      note: 'Inspect the actual image; registration can reuse this saved result with acquisition:"assets/result.json". Declare its actual use; generation is not registration.',
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
    for (const purpose of ['reference', 'experiment', undefined] as const) {
      const requestId = 'saved-' + (purpose ?? 'legacy')
      const input = { requestId, ...(purpose ? { purpose } : {}), prompt: 'Preserve the selected composition and uncover its primary action',
        referenceImagePath: 'assets/sprite.png' }
      const saved = JSON.stringify(input)
      await writeFile(request, saved)
      const revision = await run(root, script, 'generate', request, 'assets/' + requestId + '.png')
      expect(revision.code, revision.stderr).toBe(0)
      expect(submitted.at(-1)).toEqual(input)
      expect(await readFile(request, 'utf8')).toBe(saved)
      const receipt = JSON.parse(revision.stdout)
      expect(receipt).toMatchObject({ requestId, chargedCredits: 0.42, billingState: 'settled' })
      expect(receipt).not.toHaveProperty('requestedLayout')
      expect(receipt.note).toContain('Inspect the actual image')
      expect(receipt.note).not.toContain('register the selected file')
    }
    expect(calls).toBe(4)
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

test('acquisition entry rejects removed atlas commands and points to media',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bgs-atlas-owner-'))
  try {
    const script=join(root,'assets.mjs');await writeProjectAssetCommand(script,{})
    const help=await run(root,script,'--help')
    expect(help.stdout).toContain('media.mjs')
    expect(help.stdout).not.toContain('atlas <assets/sheet.png>')
    const result=await run(root,script,'atlas','assets/input.png','assets/frames.json','assets/runtime/sheet.png')
    expect(result.code).not.toBe(0);expect(result.stderr).toContain('Unknown command')
    await expect(readFile(join(root,'assets/runtime/sheet.png'))).rejects.toMatchObject({code:'ENOENT'})
  }finally{await rm(root,{recursive:true,force:true})}
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

test('managed asset commands diagnose a subdirectory cwd without relaxing workspace or capability checks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-assets-cwd-'))
  const project = join(root, 'project'), sibling = join(root, 'project-other')
  const tools = join(project, '.beegame/tmp/tools'), script = join(tools, 'assets.mjs')
  const capabilityFile = join(root, 'current.json')
  let requests = 0
  const bridge = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() {
    requests++; return Response.json({ available: true, items: [] })
  } })
  const invoke = async (cwd: string, args: string[]) => {
    const child = Bun.spawn([process.execPath, script, ...args], {
      cwd, env: { ...process.env, BEEGAME_ASSET_CAPABILITY_FILE: capabilityFile }, stdout: 'pipe', stderr: 'pipe',
    })
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    return { code, stdout, stderr }
  }
  try {
    await mkdir(tools, { recursive: true }); await mkdir(sibling)
    await writeProjectAssetCommand(script, { sessionId: 'fixture' })
    const valid = { version: 1, workspace: await realpath(project), sessionId: 'fixture', executionId: 'execution',
      assets: { libraryBaseUrl: bridge.url.origin, imageEndpoint: bridge.url.origin } }
    // Help remains available even when there is no readable capability file.
    for (const args of [['--help'], ['generate', '--help']]) {
      const result = await invoke(tools, args)
      expect(result.code, result.stderr).toBe(0)
      expect(result.stdout.split('\n')[1]).toContain('Run from the project root: bun <current-tools-directory>/assets.mjs')
      expect(result.stdout).toContain('Relative JSON input paths and assets/ output paths are relative to the project root')
    }
    await writeFile(capabilityFile, JSON.stringify(valid))
    for (const args of [['cost'], ['catalog'], ['generate', 'missing.json', 'assets/result.png']]) {
      const result = await invoke(tools, args)
      expect(result.code).toBe(1)
      expect(result.stderr).toContain('ASSET_WORKSPACE_CWD')
      expect(result.stderr).toContain('Return to the current project root')
      expect(result.stderr).toContain('No resource request was sent')
      expect(result.stderr).toContain('does not establish provider availability')
    }
    await expect(readFile(join(tools, 'assets/result.png'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(project, 'assets/result.png'))).rejects.toMatchObject({ code: 'ENOENT' })
    const escape = join(project, 'escape')
    await symlink(sibling, escape, 'dir')
    for (const cwd of [root, sibling, escape]) {
      const result = await invoke(cwd, ['cost'])
      expect(result.code).toBe(1)
      expect(result.stderr).toContain('ASSET_CAPABILITY_MISMATCH')
      expect(result.stderr).not.toContain('ASSET_WORKSPACE_CWD')
    }
    // Invalid identity or endpoints must not become a misleading directory correction.
    for (const invalid of [{ ...valid, sessionId: 'other' }, { ...valid, executionId: '' },
      { ...valid, workspace: null }, { ...valid, workspace: 'project' },
      { ...valid, assets: { imageEndpoint: 'https://example.com/image' } }]) {
      await writeFile(capabilityFile, JSON.stringify(invalid))
      const result = await invoke(tools, ['cost'])
      expect(result.code).toBe(1)
      expect(result.stderr).toContain('ASSET_CAPABILITY_MISMATCH')
      expect(result.stderr).not.toContain('ASSET_WORKSPACE_CWD')
    }
    expect(requests).toBe(0)
    await writeFile(capabilityFile, JSON.stringify(valid))
    for (const command of ['cost', 'catalog']) {
      const result = await invoke(project, [command])
      expect(result.code, result.stderr).toBe(0)
    }
    expect(requests).toBe(2)
  } finally { bridge.stop(true); await rm(root, { recursive: true, force: true }) }
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
      { ...valid, assets: { imageEndpoint: 'https://example.com/image' } }, { ...valid, executionId: '' },
      { ...valid, assets: { ...valid.assets, screenOrientation: 'Diagonal' } }]) {
      await save(invalid)
      expect((await invoke(capabilityFile, 'cost')).stderr).toContain('ASSET_CAPABILITY_MISMATCH')
    }
    await save({ ...valid, assets: {} })
    expect((await invoke(capabilityFile, 'cost')).stderr).toContain('AI image generation is unavailable for this turn')
    const board = { purpose: 'reference', uiReference: { viewport: { width: 720, height: 1280 },
      style: 'Selected game design', screens: [{ id: 'menu', description: 'Main menu composition' }] } }
    await writeFile(join(root, 'board.json'), JSON.stringify(board))
    await save({ ...valid, assets: { ...valid.assets, screenOrientation: 'Landscape' } })
    for (const args of [['ui-board-plan', 'board.json'], ['generate', 'board.json', 'assets/rejected-board.png']]) {
      const result = await invoke(capabilityFile, ...args)
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain(args[0]==='generate'?'New image requests use prompt':'Unknown command')
    }
    expect(oldPosts).toBe(0); expect(newRequests).toBe(0)
    expect(JSON.parse(await readFile(join(root, 'board.json'), 'utf8'))).not.toHaveProperty('requestId')
    await save({ ...valid, assets: { ...valid.assets, screenOrientation: 'Portrait' } })
    expect((await invoke(capabilityFile, 'ui-board-plan', 'board.json')).code).not.toBe(0)
    await save(valid)
    expect((await invoke(capabilityFile, 'ui-board-plan', 'board.json')).code).not.toBe(0)
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

for(const mode of ['transparent','transparent-large','opaque','opaque-alpha','opaque-reference','opaque-reference-large','opaque-alpha-reference','preview-unavailable'] as const)
test('image MCP returns source facts and a bounded viewing thumbnail without changing the paid image: '+mode,async()=>{
  const root=await mkdtemp(join(tmpdir(),'bgs-image-mcp-preview-'))
  const reference=mode.includes('reference'), opaque=mode.startsWith('opaque')
  const rgb=mode==='opaque'||mode.startsWith('opaque-reference')
  const large=mode.endsWith('large')
  const width=large?1536:40,height=large?1024:40
  const original=await sharp({create:{width,height,channels:rgb?3:4,
    background:opaque?'#d66':{r:10,g:20,b:30,alpha:1/255}}}).png().toBuffer()
  let calls=0
  const api=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
    if(request.method==='GET')return Response.json({available:true,billingSource:'external'})
    calls++;return new Response(new Uint8Array(original),{headers:{'content-type':'image/png','x-image-billing-state':'generated','x-image-credits-micro':'100'}})
  }})
  const client=new Client({name:'fixture',version:'1'})
  try {
    const script=join(root,'images.mjs')
    await writeProjectAssetCommand(script,{imageEndpoint:api.url.origin+'/generate',imageMcpModules:{
      server:import.meta.resolve('@modelcontextprotocol/sdk/server/index.js'),stdio:import.meta.resolve('@modelcontextprotocol/sdk/server/stdio.js'),types:import.meta.resolve('@modelcontextprotocol/sdk/types.js')}})
    await client.connect(new StdioClientTransport({command:process.execPath,args:[script,'--mcp'],cwd:root,stderr:'pipe',
      env:{...Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>typeof entry[1]==='string')),
        BEEGAME_ASSET_CAPABILITY_FILE:'',BEEGAME_SHARP_MODULE:mode==='preview-unavailable'?new URL('./absent-preview-decoder.mjs',import.meta.url).href:import.meta.resolve('sharp')}}))
    const tools = await client.listTools()
    expect(tools.tools.map(tool => tool.name)).toEqual(['generate_image'])
    const description = tools.tools[0]!.description!
    for (const use of ['character reference sheets', 'per-character action pose sheets', 'game-element atlases', 'UI atlases', 'backgrounds', 'assets.mjs cost']) expect(description).toContain(use)
    expect(description).toContain('pose consistency, frame geometry and playback need inspection')
    expect(calls).toBe(0)
    const result=await client.callTool({name:'generate_image',arguments:{request:{purpose:reference?'reference':'production',prompt:'Synthetic artwork',background:opaque?'opaque':'transparent'},outputPath:'assets/sheet.png'}})
    expect(result.isError).not.toBe(true)
    if(!Array.isArray(result.content))throw Error('Missing MCP contents')
    const facts=JSON.parse(result.content[0].text)
    expect(facts).toMatchObject({path:'assets/sheet.png',sha256:createHash('sha256').update(original).digest('hex'),width,height,billingState:'generated',chargedCredits:0.0001})
    if(mode!=='preview-unavailable')expect(facts).toMatchObject({hasAlpha:!rgb,isOpaque:opaque})
    else {expect(facts).not.toHaveProperty('isOpaque');expect(facts.imageFactsError).toEqual(expect.any(String))}
    expect((await readFile(join(root,'assets/sheet.png'))).equals(original)).toBe(true)
    const images=result.content.filter(item=>item.type==='image')
    expect(images).toHaveLength(mode.startsWith('transparent')||reference?1:0)
    if(images.length) {
      expect(facts.note).toContain('Use the attached viewing preview')
      expect(result.content.some(item=>item.type==='text'&&item.text.includes('not a production asset'))).toBe(true)
      expect(images[0].mimeType).toBe('image/webp')
      const preview=Buffer.from(images[0].data,'base64')
      const decoded=sharp(preview)
      expect((await decoded.metadata()).format).toBe('webp')
      const {data,info}=await decoded.ensureAlpha().raw().toBuffer({resolveWithObject:true})
      expect([info.width,info.height]).toEqual(large?[512,341]:[width,height])
      expect(data.every((value,index)=>index%4!==3||value===255)).toBe(true)
      if(mode==='transparent') {
        expect([...data.subarray(0,4)]).toEqual([249,249,249,255])
        expect([...data.subarray(16*4,16*4+4)]).toEqual([219,219,219,255])
      }
      expect(preview.length).toBeLessThan((await decoded.png().toBuffer()).length)
      if(reference) {
        expect(result.content.some(item=>item.type==='text'&&item.text.startsWith('Reference viewing thumbnail'))).toBe(true)
        const expected=await sharp(original).resize({width:512,height:512,fit:'inside',withoutEnlargement:true}).ensureAlpha().raw().toBuffer()
        expect(data.equals(expected)).toBe(true)
      } else expect(new Set(Array.from({length:info.width},(_,x)=>data[x*4])).size).toBeGreaterThan(1)
    }
    if(mode==='preview-unavailable')expect(result.content.some(item=>item.type==='text'&&item.text.includes('Image saved; viewing preview unavailable'))).toBe(true)
    expect(calls).toBe(1)
    expect(await (await import('node:fs/promises')).readdir(join(root,'assets'))).toEqual(['sheet.png'])
  }finally{await client.close();api.stop(true);await rm(root,{recursive:true,force:true})}
},15_000)


test('image MCP rejects the observed misplaced purpose locally and distinguishes unpaid validation from unknown paid outcomes',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bgs-image-mcp-preview-'))
  const png=await sharp({create:{width:2,height:2,channels:3,background:'#123456'}}).png().toBuffer()
  let quotes=0,mode:'valid'|'invalid'|'unknown'='valid'
  const submissions:any[]=[]
  const api=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
    if(request.method==='GET'){quotes++;return Response.json({available:true,billingSource:'external'})}
    submissions.push(await request.json())
    if(mode==='invalid')return Response.json({error:'Wrong resource intent',code:'resource-intent',note:'No provider submission or new Credit reservation.'},{status:422})
    if(mode==='unknown')return Response.json({error:'Unknown provider outcome',code:'unknown'},{status:503})
    return new Response(new Uint8Array(png),{headers:{'content-type':'image/png','x-image-billing-state':'generated'}})
  }})
  const client=new Client({name:'fixture',version:'1'})
  const files=async()=> (await import('node:fs/promises')).readdir(root)
  try{
    const script=join(root,'images.mjs')
    await writeProjectAssetCommand(script,{imageEndpoint:api.url.origin+'/generate',imageMcpModules:{
      server:import.meta.resolve('@modelcontextprotocol/sdk/server/index.js'),stdio:import.meta.resolve('@modelcontextprotocol/sdk/server/stdio.js'),types:import.meta.resolve('@modelcontextprotocol/sdk/types.js')}})
    await client.connect(new StdioClientTransport({command:process.execPath,args:[script,'--mcp'],cwd:root,stderr:'pipe',
      env:{...Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>typeof entry[1]==='string')),BEEGAME_ASSET_CAPABILITY_FILE:''}}))
    const schema:any=(await client.listTools()).tools[0]!.inputSchema
    expect(schema.additionalProperties).toBe(false)
    expect(schema.properties.request.required).toContain('purpose')
    const prompt='Synthetic game elements atlas'
    const before=await files()
    for(const args of [
      {purpose:'production',request:{prompt},outputPath:'assets/wrong-level.png'},
      {request:{prompt},outputPath:'assets/missing.png'},
      {request:{purpose:'invented',prompt},outputPath:'assets/invalid.png'},
    ]){
      const result:any=await client.callTool({name:'generate_image',arguments:args})
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('purpose')
      expect(result.content[0].text).not.toContain('Original request:')
      expect(await files()).toEqual(before)
    }
    expect(quotes).toBe(0);expect(submissions).toHaveLength(0)
    const valid:any=await client.callTool({name:'generate_image',arguments:{request:{purpose:'production',prompt},outputPath:'assets/valid.png'}})
    expect(valid.isError).not.toBe(true)
    expect(submissions).toHaveLength(1);expect(submissions[0]).toMatchObject({purpose:'production',prompt})
    const facts=JSON.parse(valid.content[0].text)
    expect(JSON.parse(await readFile(facts.requestFile,'utf8'))).toMatchObject({purpose:'production',requestId:submissions[0].requestId})
    mode='invalid'
    const rejected:any=await client.callTool({name:'generate_image',arguments:{request:{purpose:'production',requestId:'known-unpaid',prompt},outputPath:'assets/unpaid.png'}})
    expect(rejected.isError).toBe(true)
    expect(rejected.content[0].text).toContain('Correct the input before another call and preserve this ID')
    expect(rejected.content[0].text).not.toContain('Do not automatically resubmit or change this ID')
    expect(submissions).toHaveLength(2)
    mode='unknown'
    const unknown:any=await client.callTool({name:'generate_image',arguments:{request:{purpose:'production',requestId:'unknown-paid',prompt},outputPath:'assets/unknown.png'}})
    expect(unknown.isError).toBe(true)
    expect(unknown.content[0].text).toContain('Do not automatically resubmit or change this ID')
    expect(submissions).toHaveLength(3)
    mode='valid'
    const legacy:any=await client.callTool({name:'generate_image',arguments:{request:{requestId:'existing-paid',prompt},outputPath:'assets/recovered.png'}})
    expect(legacy.isError).not.toBe(true)
    expect(submissions).toHaveLength(4);expect(submissions[3]).not.toHaveProperty('purpose')
    expect(submissions[3].requestId).toBe('existing-paid')
    expect(quotes).toBe(4)
  }finally{await client.close();api.stop(true);await rm(root,{recursive:true,force:true})}
},15000)


for(const mode of ['transparent','opaque-alpha','opaque-rgb','decoder-unavailable'] as const)
test('CLI generation reports decoded transparency facts without changing the paid image: '+mode,async()=>{
  const root=await mkdtemp(join(tmpdir(),'bgs-image-mcp-preview-'))
  const original=await sharp({create:{width:8,height:8,channels:mode==='opaque-rgb'?3:4,
    background:{r:0,g:0,b:0,alpha:mode==='transparent'?0:1}}}).png().toBuffer()
  let submitted=0
  const api=Bun.serve({hostname:'127.0.0.1',port:0,fetch(request){
    if(request.method==='GET')return Response.json({available:true,billingSource:'external'})
    submitted++;return new Response(new Uint8Array(original),{headers:{'content-type':'image/png','x-image-billing-state':'settled'}})
  }})
  try{
    const script=join(root,'assets.mjs');await writeProjectAssetCommand(script,{imageEndpoint:api.url.origin+'/generate'})
    await writeFile(join(root,'request.json'),JSON.stringify({purpose:'production',prompt:'Synthetic local image',background:'transparent'}))
    const child=Bun.spawn([process.execPath,script,'generate','request.json','assets/sheet.png'],{cwd:root,stdout:'pipe',stderr:'pipe',env:{...process.env,
      BEEGAME_ASSET_CAPABILITY_FILE:'',BEEGAME_SHARP_MODULE:mode==='decoder-unavailable'?new URL('./absent-preview-decoder.mjs',import.meta.url).href:import.meta.resolve('sharp')}})
    const [stdout,stderr,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited])
    expect(code,stderr).toBe(0)
    const facts=JSON.parse(stdout)
    expect(facts).toMatchObject({path:'assets/sheet.png',width:8,height:8,sha256:createHash('sha256').update(original).digest('hex'),billingState:'settled'})
    if(mode==='decoder-unavailable'){
      expect(facts).not.toHaveProperty('hasAlpha');expect(facts).not.toHaveProperty('isOpaque')
      expect(facts.imageFactsError).toEqual(expect.any(String))
    }else expect(facts).toMatchObject({hasAlpha:mode!=='opaque-rgb',isOpaque:mode!=='transparent'})
    expect((await readFile(join(root,'assets/sheet.png'))).equals(original)).toBe(true)
    expect(submitted).toBe(1)
    expect(await (await import('node:fs/promises')).readdir(join(root,'assets'))).toEqual(['sheet.png'])
  }finally{api.stop(true);await rm(root,{recursive:true,force:true})}
})


test('document image MCP saves only reference files and never submits disallowed production or destinations', async () => {
  const root = await mkdtemp(join(tmpdir(),'bgs-reference-image-mcp-'))
  const png = await sharp({create:{width:8,height:8,channels:3,background:'#abcdef'}}).png().toBuffer()
  let gets = 0, posts = 0
  const api = Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request) {
    if (request.method === 'GET') {gets++;return Response.json({available:true})}
    posts++;expect((await request.json()).purpose).toBe('reference')
    return new Response(new Uint8Array(png),{headers:{'content-type':'image/png'}})
  }})
  const client = new Client({name:'fixture',version:'1'})
  try {
    const script = join(root,'images.mjs')
    await writeProjectAssetCommand(script,{referenceOnly:true,imageEndpoint:api.url.origin,imageMcpModules:{
      server:import.meta.resolve('@modelcontextprotocol/sdk/server/index.js'),stdio:import.meta.resolve('@modelcontextprotocol/sdk/server/stdio.js'),types:import.meta.resolve('@modelcontextprotocol/sdk/types.js')}})
    await client.connect(new StdioClientTransport({command:process.execPath,args:[script,'--mcp'],cwd:root,stderr:'pipe',
      env:{BEEGAME_ASSET_CAPABILITY_FILE:'',BEEGAME_SHARP_MODULE:import.meta.resolve('sharp')}}))
    const tools = await client.listTools()
    const requestSchema = tools.tools[0]!.inputSchema.properties?.request as {properties:Record<string,unknown>;required:string[]}
    expect(Object.keys(requestSchema.properties).sort()).toEqual(['requestId','purpose','prompt','referenceImagePath','background','quality','size'].sort())
    expect(requestSchema).toMatchObject({properties:{purpose:{enum:['reference']}},required:['purpose','prompt']})
    const help = await run(root,script,'generate','--help')
    expect(help.code,help.stderr).toBe(0)
    expect(help.stdout).toContain('assets/reference/new-file.png')
    expect(help.stdout).not.toMatch(/uiAssets|uiReference|requirementIds|ui-assets-plan|ui-board-plan/)
    for (const args of [
      {request:{purpose:'production',prompt:'Production'},outputPath:'assets/reference/production.png'},
      ...['uiReference','uiAssets','requirementIds'].map(key=>({request:{purpose:'reference',prompt:'Reference',[key]:key==='requirementIds'?[]:{}},outputPath:'assets/reference/invalid.png'})),
      {request:{purpose:'reference'},outputPath:'assets/reference/missing-prompt.png'},
      {request:{purpose:'reference',prompt:'Reference'},outputPath:'assets/runtime/ref.png'},
      {request:{purpose:'reference',prompt:'Reference'},outputPath:'assets/reference/../runtime/ref.png'},
    ]) {
      expect((await client.callTool({name:'generate_image',arguments:args})).isError).toBe(true)
    }
    expect(gets).toBe(0);expect(posts).toBe(0)
    const result = await client.callTool({name:'generate_image',arguments:{request:{purpose:'reference',prompt:'Composition reference'},outputPath:'assets/reference/scene.png'}})
    expect(result.isError).not.toBe(true)
    expect((await readFile(join(root,'assets/reference/scene.png'))).equals(png)).toBe(true)
    expect(posts).toBe(1)
    expect((await client.callTool({name:'generate_image',arguments:{request:{purpose:'reference',prompt:'Do not overwrite'},outputPath:'assets/reference/scene.png'}})).isError).toBe(true)
    expect(posts).toBe(1)
  } finally {await client.close();api.stop(true);await rm(root,{recursive:true,force:true})}
})
