import { BeeGameModelRuntimeError } from '../beegame/model-runtime-host'
import { test, expect } from 'bun:test'
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import type { ImageBillingClient, ImageBillingReceipt } from '@bee-game-studio/beegame-billing-core/image-billing'
import { ImageAttemptStore } from './attempt'
import { ImageGenerationService } from './service'
import { imageConfigSchema } from './config'
import { imageChargeCreditsMicro, fixedImageChargeCreditsMicro, CLOUDFLARE_INITIAL_FIXED_CREDITS } from './pricing'
import { ImageProviderError } from './provider'
import { createImageGenerationProvider } from './index'
import { writeProjectAssetCommand } from '../beegame/project-asset-command'
import { createImageGenerationAccess } from './access'

function openImageGenerationAccess(input: Parameters<typeof createImageGenerationAccess>[0]) {
  const access = createImageGenerationAccess(input)
  const path='/'+crypto.randomUUID()+'/generate'
  const server = Bun.serve({hostname:'127.0.0.1',port:0,idleTimeout:0,maxRequestBodySize:256*1024,
    fetch:request=>new URL(request.url).pathname===path ? access.fetch(request) : new Response('Not found',{status:404})})
  return {...access,endpoint:server.url.origin+path,close(){access.close();return server.stop(false)}}
}

import { ImageConfigurationError } from './runtime-config'
import { imagePromptReviewInput, parseImagePromptReview } from './prompt-review'
import { compileUiReferenceBoard, compileUiAssetSheet } from './ui-reference-board.mjs'
import { readProjectReferenceImage, renderUiReferenceLayout } from './reference-image'
import { writeBeeGameAssetManifest, type BeeGameAssetManifest } from '../beegame/asset-contracts'

async function retainHistoricalUiReceipt(service:ImageGenerationService,root:string,value:any,settings=config) {
  const compiled=value.uiReference!==undefined?compileUiReferenceBoard(value):compileUiAssetSheet(value)
  const {requestId,purpose,requirementIds,referenceImagePath,...request}={...compiled.request,purpose:value.purpose,requirementIds:value.requirementIds}
  const referenceImage=referenceImagePath?await readProjectReferenceImage(root,referenceImagePath)
    :value.uiReference!==undefined?await renderUiReferenceLayout(compiled.layout):undefined
  return service.generate({ownerId:'owner',projectId:'project',requestId:requestId!,config:settings,
    request:{...request,...(referenceImage?{referenceImage}:{})}})
}

test.each(['platform', 'byok'] as const)('resource intent rejects new incompatible requests before billing/provider and does not alter recovery: %s', async source => {
  const root = mkdtempSync(join(tmpdir(), 'image-resource-intent-'))
  const billing = fakeBilling()
  let calls = 0
  const service = new ImageGenerationService(new ImageAttemptStore(join(root,'host'), { generate: async (_config, request) => {
    calls++
    expect(request).not.toHaveProperty('purpose')
    expect(request).not.toHaveProperty('requirementIds')
    return { bytes: await png(), model: config.model, mimeType: 'image/png', usage }
  } }), billing.client)
  const manifest: BeeGameAssetManifest = { version: 9, resources: [], requirements: [
    { id: 'surface', acquisition_profile: { dimensions: ['3D'], asset_kinds: ['texture'], styles: [] } },
    { id: 'actor', acquisition_profile: { dimensions: ['3D'], asset_kinds: ['model'], styles: [], capabilities: ['rigged'] } },
    { id: 'licensed', acquisition_profile: { dimensions: ['2D'], asset_kinds: ['image'], styles: [],
      sourcing_policy: {allowed_source_kinds:['resource-library'],license_constraints:['licensed'],responsible_party:'author',handoff_criteria:['usable file']} } },
  ] }
  await writeBeeGameAssetManifest(root, manifest)
  const access = openImageGenerationAccess({ userId: 'owner', projectId: 'project', workspacePath: root, source,
    loadConfig: async () => config, service })
  const send = (metadata: object) => fetch(access.endpoint, {method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({requestId:'production',prompt:'Surface artwork',...metadata})})
  try {
    for (const metadata of [{}, {purpose:'production'}, {purpose:'production',requirementIds:['absent']},
      {purpose:'production',requirementIds:['actor']}, {purpose:'production',requirementIds:['licensed']},
      {purpose:'reference',requirementIds:['surface']}, {purpose:'experiment',requirementIds:['surface']}]) {
      const response = await send(metadata)
      expect(response.status).toBe(422)
      expect(await response.json()).toMatchObject({code:'resource-intent'})
    }
    expect(calls).toBe(0)
    expect(billing.actions).toEqual([])
    const valid = await send({purpose:'production',requirementIds:['surface']})
    expect(valid.status).toBe(200)
    const bytes = await valid.arrayBuffer()
    expect(calls).toBe(1)
    expect(readFileSync(join(root,'assets/ai-generation-prompts.md'),'utf8')).toContain('surface')
    // A changed Manifest and missing/new metadata cannot invalidate paid bytes.
    await writeBeeGameAssetManifest(root,{...manifest,requirements:[]})
    const recovered = await send({})
    expect(recovered.status).toBe(200)
    expect(await recovered.arrayBuffer()).toEqual(bytes)
    const rebound = await send({purpose:'production',requirementIds:['removed']})
    expect(rebound.status).toBe(200)
    await rebound.arrayBuffer()
    expect(calls).toBe(1)
    expect(billing.actions).toEqual(source === 'byok' ? [] : ['reserve','settle','reserve','settle','reserve','settle'])
  } finally { await access.close(); rmSync(root,{recursive:true,force:true}) }
})

test('image parameter errors identify the failing fields without creating attempts, charges or provider work', async () => {
  const root = mkdtempSync(join(tmpdir(),'image-parameter-errors-'))
  const billing = fakeBilling()
  let configurations = 0, calls = 0
  const service = new ImageGenerationService(new ImageAttemptStore(join(root,'host'),{generate:async()=>{
    calls++;return {bytes:await png(),model:config.model,mimeType:'image/png',usage}
  }}),billing.client)
  const access = openImageGenerationAccess({userId:'owner',projectId:'project',workspacePath:root,
    loadConfig:async()=>{configurations++;return config},service})
  const request = {requestId:'parameter-error',purpose:'production',prompt:'Private artwork prompt'}
  const send = (value:unknown)=>fetch(access.endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)})
  try {
    for (const [value,path,code] of [
      [{...request,requirementIds:[]},['requirementIds'],'too_small'],
      [{...request,requirementIds:['']},['requirementIds',0],'too_small'],
      [{...request,quality:'unknown'},['quality'],'invalid_value'],
      [{...request,requestId:undefined},['requestId'],'invalid_type'],
      [{...request,prompt:''},['prompt'],'too_small'],
      [{...request,providerKey:'fixture-private-value'},[],'unrecognized_keys'],
      [{...request,uiReference:{}},[],'custom'],
    ] as const) {
      const response = await send(value)
      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body).toMatchObject({error:'Invalid image request',issues:expect.arrayContaining([{path:[...path],code,message:expect.any(String)}])})
      expect(JSON.stringify(body)).not.toContain(request.prompt)
      expect(JSON.stringify(body)).not.toContain('fixture-private-value')
    }
    expect(configurations).toBe(0);expect(calls).toBe(0);expect(billing.actions).toEqual([])
    expect(existsSync(join(root,'host'))).toBe(false)
    expect(existsSync(join(root,'assets/ai-generation-prompts.md'))).toBe(false)
    // The existing command must preserve the same HTTP field diagnostic for the Agent.
    const script = join(root,'images.mjs'), requestFile = join(root,'request.json')
    await writeProjectAssetCommand(script,{imageEndpoint:access.endpoint})
    writeFileSync(requestFile,JSON.stringify({...request,requirementIds:[]}))
    const child = Bun.spawn([process.execPath,script,'generate',requestFile,'assets/rejected.png'],{cwd:root,
      stdout:'pipe',stderr:'pipe',env:{...process.env,BEEGAME_ASSET_CAPABILITY_FILE:''}})
    const [stdout,stderr,code] = await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited])
    expect(code).toBe(1)
    expect(stdout+stderr).toContain('Capability HTTP 400')
    expect(stdout+stderr).toContain('"path":["requirementIds"]')
    expect(stdout+stderr).toContain('"code":"too_small"')
    expect(calls).toBe(0);expect(billing.actions).toEqual([])
    expect(existsSync(join(root,'assets/rejected.png'))).toBe(false)
    // Correct only the empty association; retain the purpose, prompt and original request ID.
    const corrected = await send(request)
    expect(corrected.status).toBe(200);await corrected.arrayBuffer()
    expect(calls).toBe(1)
    expect(billing.actions).toEqual(['reserve','settle'])
  } finally {await access.close();rmSync(root,{recursive:true,force:true})}
})

test.each(['platform', 'byok'] as const)('final compiled prompt is checked before image billing; corrections and paid recovery: %s', async source => {
  const root = mkdtempSync(join(tmpdir(), 'image-prompt-check-'))
  const billing = fakeBilling(), checked: string[] = [], reviewInputs: string[] = []
  const design = '# Design\n## Artwork\nThe background contains no red fruit.\n'
  mkdirSync(join(root, 'docs'))
  writeFileSync(join(root, 'docs/GDD.md'), design)
  let calls = 0
  let review = { issues: ['The shared blue-only background conflicts with a red background in the same screen.'] }
  const service = new ImageGenerationService(new ImageAttemptStore(join(root, 'host'), { generate: async () => {
    calls++; return { bytes: await png(), model: config.model, mimeType: 'image/png', usage }
  } }), billing.client)
  const access = openImageGenerationAccess({ userId: 'owner', projectId: 'project', workspacePath: root, source,
    loadConfig: async () => config, service, reviewPrompt: async prompt => {
      reviewInputs.push(imagePromptReviewInput(root, 'Confirmed user requirements', prompt))
      checked.push(prompt)
      return review
    } })
  const request = {purpose:'reference',requestId:'prompt-check',prompt:'Background uses blue only. Ready screen with a red background'}
  const send = () => fetch(access.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) })
  try {
    const rejected = await send()
    expect(rejected.status).toBe(422)
    expect(await rejected.json()).toMatchObject({ code: 'image-prompt-conflict', requestId: request.requestId })
    expect(checked).toHaveLength(1)
    expect(checked[0]).toBe(request.prompt)
    const firstInput = JSON.parse(reviewInputs[0]!)
    expect(Object.keys(firstInput).sort()).toEqual(['confirmedRequirements', 'design', 'prompt'])
    expect(firstInput.confirmedRequirements).toBe('Confirmed user requirements')
    expect(firstInput.prompt).toBe(checked[0])
    expect(firstInput.design).toEqual([{ path: 'docs/GDD.md', sha256: new Bun.CryptoHasher('sha256').update(design).digest('hex'),
      bytes: Buffer.byteLength(design), text: design }])
    // A design restriction omitted from the image prompt still reaches the checker.
    expect(firstInput.prompt).not.toContain('no red fruit')
    expect(firstInput.design[0].text).toContain('no red fruit')
    expect(calls).toBe(0)
    expect(billing.actions).toEqual([])
    review = { issues: [] }
    request.prompt = 'Background uses blue only. Ready screen with a blue background'
    const currentDesign = design + 'Preserve the paper material.\n'
    writeFileSync(join(root, 'docs/GDD.md'), currentDesign)
    const generated = await send()
    expect(generated.status).toBe(200)
    const bytes = await generated.arrayBuffer()
    expect(checked).toHaveLength(2)
    expect(checked[1]).toContain('Ready screen with a blue background')
    expect(JSON.parse(reviewInputs[1]!).design).toEqual([{ path: 'docs/GDD.md',
      sha256: new Bun.CryptoHasher('sha256').update(currentDesign).digest('hex'), bytes: Buffer.byteLength(currentDesign), text: currentDesign }])
    expect(calls).toBe(1)
    const actions = source === 'platform' ? ['reserve', 'settle'] : []
    expect(billing.actions).toEqual(actions)
    review = { issues: ['A different current judgment must not invalidate an already-paid result.'] }
    rmSync(join(root, 'docs/GDD.md')) // Paid recovery must not read or require a new design snapshot.
    const recovered = await send()
    expect(recovered.status).toBe(200)
    expect(await recovered.arrayBuffer()).toEqual(bytes)
    expect(checked).toHaveLength(2)
    expect(calls).toBe(1)
    const record = readFileSync(join(root, 'assets/ai-generation-prompts.md'), 'utf8')
    expect(record).toContain('prompt-checked')
    expect(record).toContain('image-prompt-conflict')
  } finally { await access.close(); rmSync(root, { recursive: true, force: true }) }
})

test('invalid or unavailable prompt checking never becomes permission to generate', async () => {
  const root = mkdtempSync(join(tmpdir(), 'image-prompt-failure-'))
  const billing = fakeBilling()
  let calls = 0
  let modelFailure: BeeGameModelRuntimeError | undefined
  const service = new ImageGenerationService(new ImageAttemptStore(join(root, 'host'), { generate: async () => {
    calls++; return { bytes: await png(), model: config.model, mimeType: 'image/png', usage }
  } }), billing.client)
  const access = openImageGenerationAccess({ userId: 'owner', projectId: 'project', workspacePath: root,
    loadConfig: async () => config, service, reviewPrompt: async prompt => {
      if(modelFailure)throw modelFailure
      imagePromptReviewInput(root, 'Confirmed user requirements', prompt)
      return parseImagePromptReview('{"checked":true}')
    } })
  const send = () => fetch(access.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ purpose: 'reference', requestId: 'invalid-check', prompt: 'A complete screen' }) })
  try {
    // Missing source fails before model checking, image reservation or generation.
    expect(() => imagePromptReviewInput(root, 'Confirmed user requirements', 'A complete screen')).toThrow('Cannot check image prompt against the saved GDD')
    const missing = await send()
    expect(missing.status).toBe(503)
    expect(await missing.json()).toMatchObject({ code: 'prompt-review-unavailable' })
    mkdirSync(join(root, 'docs'))
    writeFileSync(join(root, 'docs/GDD.md'), '# Current design\nScreen definitions.\n')
    const response = await send()
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ code: 'prompt-review-unavailable', failureCode:'invalid-review-schema', diagnosticId:expect.any(String) })
    modelFailure=new BeeGameModelRuntimeError('PRIVATE_PROVIDER_BODY', 'model_response', {failureCode:'structured-output-missing',diagnosticId:'fixed-diagnostic'})
    const failed=await send()
    expect(failed.status).toBe(503)
    const detail=await failed.json()
    expect(detail).toMatchObject({code:'prompt-review-unavailable',failureCode:'structured-output-missing',modelStage:'model_response',diagnosticId:'fixed-diagnostic'})
    expect(JSON.stringify(detail)).not.toContain('PRIVATE_PROVIDER_BODY')
    expect(readFileSync(join(root,'assets/ai-generation-prompts.md'),'utf8')).toContain('fixed-diagnostic')
    expect(calls).toBe(0)
    expect(billing.actions).toEqual([])
    for (const value of ['not JSON', '{}', '{"issues":"none"}', '{"issues":[" "]}', '{"issues":[],"passed":true}'])
      expect(() => parseImagePromptReview(value)).toThrow()
    expect(parseImagePromptReview('{"issues":[]}')).toEqual({ issues: [] })
  } finally { await access.close(); rmSync(root, { recursive: true, force: true }) }
})

test.each(['platform', 'byok'] as const)('cancelled prompt checking cannot later submit or reserve an image: %s', async source => {
  const root = mkdtempSync(join(tmpdir(), 'image-prompt-cancel-'))
  const billing = fakeBilling(), controller = new AbortController()
  let calls = 0
  const service = new ImageGenerationService(new ImageAttemptStore(root, { generate: async () => {
    calls++; return { bytes: await png(), model: config.model, mimeType: 'image/png', usage }
  } }), billing.client)
  try {
    await expect(service.generate({ ...input, request: { ...input.request, signal: controller.signal },
      reviewPrompt: async () => { controller.abort(); } }, source)).rejects.toThrow()
    expect(calls).toBe(0)
    expect(billing.actions).toEqual([])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a pre-metadata paid receipt is recoverable through the new bridge', async () => {
  const root = mkdtempSync(join(tmpdir(),'image-legacy-intent-'))
  const billing = fakeBilling()
  let calls = 0
  const service = new ImageGenerationService(new ImageAttemptStore(root,{generate:async()=>{
    calls++; return {bytes:await png(),model:config.model,mimeType:'image/png',usage}
  }}),billing.client)
  await service.generate(input) // Historical request: no resource-intent metadata.
  const access = openImageGenerationAccess({userId:'owner',projectId:'project',workspacePath:root,loadConfig:async()=>config,service,
    reviewPrompt:async()=>{throw Error('Historical paid recovery must not start prompt checking')}})
  try {
    const response=await fetch(access.endpoint,{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({requestId:input.requestId,prompt:input.request.prompt})})
    expect(response.status).toBe(200); await response.arrayBuffer()
    expect(calls).toBe(1)
  } finally { await access.close();rmSync(root,{recursive:true,force:true}) }
})

test('saved screen revisions recover original bytes; new structured requests and invalid inventory are rejected', async () => {
  const root = mkdtempSync(join(tmpdir(), 'image-ui-board-'))
  const billing = fakeBilling(), received: unknown[] = []
  const design = await png()
  mkdirSync(join(root, 'assets/reference'), { recursive: true })
  writeFileSync(join(root, 'assets/reference/selected.png'), design)
  let configurations = 0
  const service = new ImageGenerationService(new ImageAttemptStore(root, { generate: async (_config, request) => {
    received.push(request)
    return { bytes: await png(), model: config.model, mimeType: 'image/png', usage }
  } }), billing.client)
  const access = openImageGenerationAccess({ userId: 'owner', projectId: 'project', workspacePath: root,
    screenOrientation: 'Landscape', loadConfig: async () => { configurations++; return cloudflareConfig }, service })
  const input = { purpose: 'reference', requestId: 'ui-board', referenceImagePath: 'assets/reference/selected.png',
    uiReference: { viewport: { width: 1280, height: 720 }, style: 'Keep the original composition and subjects; change only button contrast',
      screens: ['play', 'pause', 'result'].map(id => ({ id, description: `Full ${id} screen with HUD` })) } }
  const submit = (body: unknown) => fetch(access.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  try {
    for (const body of [
      { ...input, prompt: 'custom collage' },
      { ...input, uiReference: { ...input.uiReference, viewport: { width: 720, height: 1280 } } },
      { ...input, uiReference: { ...input.uiReference, rows: 2 } },
      { ...input, uiReference: { ...input.uiReference, screens: [input.uiReference.screens[0], input.uiReference.screens[0]] } },
    ]) expect((await submit(body)).status).toBe(400)
    expect(received).toEqual([])
    expect(billing.actions).toEqual([])
    expect(configurations).toBe(0)
    expect((await submit({ ...input, referenceImagePath: 'assets/reference/missing.png' })).status).toBe(400)
    expect(received).toEqual([])
    expect(billing.actions).toEqual([])
    expect((await submit(input)).status).toBe(422)
    expect(received).toEqual([]);expect(billing.actions).toEqual([])
    await retainHistoricalUiReceipt(service,root,input,cloudflareConfig)
    const response = await submit(input)
    expect(response.status).toBe(200)
    await response.arrayBuffer()
    const expected = compileUiReferenceBoard(input).request
    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({ prompt: expected.prompt, size: '1024x1536', quality: 'low', background: 'opaque' })
    expect(received[0]).toMatchObject({ referenceImage: { bytes: design } })
    expect(received[0]).not.toHaveProperty('referenceImagePath')
    expect(received[0]).not.toHaveProperty('uiReference')
    const record = readFileSync(join(root, 'assets/ai-generation-prompts.md'), 'utf8')
    expect(record).toContain(JSON.stringify(expected.prompt))
    expect(billing.actions).toEqual(['reserve','settle','reserve','settle'])
    const changed=await submit({...input,uiReference:{...input.uiReference,style:'A different composition'}})
    expect(changed.status).toBe(409)
    expect(received).toHaveLength(1)
  } finally { await access.close(); rmSync(root, { recursive: true, force: true }) }
})

test('saved UI skins recover their original selected design; new structured skins never reach billing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'image-ui-skins-')), billing = fakeBilling(), received: any[] = []
  const design = await png()
  mkdirSync(join(root, 'assets/visual'), { recursive: true }); writeFileSync(join(root, 'assets/visual/design.png'), design)
  await writeBeeGameAssetManifest(root, { version: 9, resources: [], requirements: [
    { id: 'ui-skins', acquisition_profile: { dimensions: ['2D'], asset_kinds: ['sprite-atlas'], styles: [] } },
  ] })
  const service = new ImageGenerationService(new ImageAttemptStore(root, { generate: async (_config, request) => {
    received.push(request); return { bytes: await png(), model: config.model, mimeType: 'image/png', usage }
  } }), billing.client)
  const access = openImageGenerationAccess({ userId: 'owner', projectId: 'project', workspacePath: root,
    loadConfig: async () => cloudflareConfig, service })
  const input = { requestId: 'skins', purpose: 'production', requirementIds: ['ui-skins'], referenceImagePath: 'assets/visual/design.png',
    uiAssets: { elements: [{ id: 'control', description: 'Primary control skin from the selected design, no label', width: 240, height: 64 }] } }
  const send = (value: unknown) => fetch(access.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) })
  try {
    expect((await send({ ...input, referenceImagePath: undefined })).status).toBe(400)
    expect((await send({ ...input, referenceImagePath: 'assets/visual/missing.png' })).status).toBe(400)
    expect(received).toEqual([]); expect(billing.actions).toEqual([])
    expect((await send(input)).status).toBe(422)
    expect(received).toEqual([]);expect(billing.actions).toEqual([])
    await retainHistoricalUiReceipt(service,root,input,cloudflareConfig)
    const response = await send(input)
    expect(response.status).toBe(200); await response.arrayBuffer()
    expect(received).toHaveLength(1)
    expect(received[0].referenceImage.bytes).toEqual(design)
    expect(received[0].prompt).toBe(compileUiAssetSheet(input).request.prompt)
    expect(received[0].background).toBe('transparent')
    expect(received[0]).not.toHaveProperty('uiAssets')
    expect(billing.actions).toEqual(['reserve','settle','reserve','settle'])
  } finally { await access.close(); rmSync(root, { recursive: true, force: true }) }
})

test('one image capability continues from a screen design into UI skins and game assets without a new stage request', async () => {
  const root = mkdtempSync(join(tmpdir(), 'image-production-continuation-'))
  const received: any[] = [], bytes = await png(), actions: string[] = []
  // The shared one-request billing fixture needs one receipt per request here.
  const wallets = new Map<string, ReturnType<typeof fakeBilling>>()
  const billing: ImageBillingClient = { async apply(user, request) {
    actions.push(request.action)
    const key = JSON.stringify([user, request.projectId, request.requestId])
    if (!wallets.has(key)) wallets.set(key, fakeBilling())
    return wallets.get(key)!.client.apply(user, request)
  } }
  // A local provider stub only: no model, network provider or real billing.
  const service = new ImageGenerationService(new ImageAttemptStore(root, { generate: async (_config, request) => {
    received.push(request)
    return { bytes, model: config.model, mimeType: 'image/png', usage }
  } }), billing)
  const access = openImageGenerationAccess({ userId: 'owner', projectId: 'project', workspacePath: root,
    screenOrientation: 'Landscape', loadConfig: async () => cloudflareConfig, service })
  const send = (value: unknown) => fetch(access.endpoint, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) })
  try {
    const design = await send({requestId:'screen',purpose:'reference',quality:'low',prompt:'Confirmed visual direction: complete scene, character, prop and HUD'})
    expect(design.status).toBe(200)
    mkdirSync(join(root, 'assets/reference'), { recursive: true })
    const referenceImagePath = 'assets/reference/selected.png'
    writeFileSync(join(root, referenceImagePath), Buffer.from(await design.arrayBuffer()))
    expect(access.screenOrientation).toBe('Landscape')
    const overlay = await send({ requestId: 'orientation-overlay', purpose: 'reference', referenceImagePath,
      size: '1024x1536', prompt: 'Adaptation notice using the selected paper treatment; no gameplay or new controls' })
    expect(overlay.status).toBe(200)
    expect(Buffer.from(await overlay.arrayBuffer()).equals(bytes)).toBe(true)
    expect(received[1]).toMatchObject({ size: '1024x1536', referenceImage: { bytes } })
    // Register needs through the existing resource contract, not another user request.
    await writeBeeGameAssetManifest(root, { version: 9, resources: [], requirements: [
      { id: 'ui', acquisition_profile: { dimensions: ['2D'], asset_kinds: ['sprite-atlas'], styles: [] } },
      ...['character', 'prop'].map(id => ({ id, acquisition_profile: {
        dimensions: ['2D' as const], asset_kinds: ['sprite' as const], styles: [] } })),
    ] })
    const requests = [
      {requestId:'ui',requirementIds:['ui'],prompt:'UI atlas with the selected control skin, without live text',background:'transparent'},
      ...['character', 'prop'].map(id => ({ requestId: id, requirementIds: [id],
        prompt: `Isolated ${id} matching the selected design`, background: 'transparent' })),
    ]
    for (const request of requests) {
      const result = await send({ ...request, purpose: 'production', referenceImagePath })
      expect(result.status).toBe(200)
      expect(Buffer.from(await result.arrayBuffer()).equals(bytes)).toBe(true)
    }
    expect(received).toHaveLength(5)
    expect(received.map(r => r.quality ?? cloudflareConfig.quality)).toEqual(['low', 'medium', 'medium', 'medium', 'medium'])
    for (const asset of received.slice(2)) {
      expect(asset.referenceImage.bytes).toEqual(bytes)
      expect(asset.background).toBe('transparent')
    }
    expect(actions).toEqual(Array(5).fill(['reserve', 'settle']).flat())
  } finally { await access.close(); rmSync(root, { recursive: true, force: true }) }
})

test('closing image access drains an in-flight paid outcome before workspace quiescence',async()=>{
  const root=mkdtempSync(join(tmpdir(),'image-access-drain-'))
  let release!:()=>void,entered!:()=>void
  const wait=new Promise<void>(r=>{release=r}),started=new Promise<void>(r=>{entered=r})
  const service=new ImageGenerationService(new ImageAttemptStore(root,{generate:async()=>{
    entered();await wait;return {bytes:await png(),model:config.model,mimeType:'image/png',usage}
  }}),fakeBilling().client)
  const access=openImageGenerationAccess({userId:'owner',projectId:'synthetic',workspacePath:root,loadConfig:async()=>config,service})
  try {
    const response=fetch(access.endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({purpose:'experiment',requestId:'one',prompt:'synthetic'})})
    await started
    let drained=false;const closing=access.close().then(()=>{drained=true})
    await Bun.sleep(20);expect(drained).toBe(false)
    release();expect((await response).status).toBe(200);await (await response).arrayBuffer();await closing
    expect(drained).toBe(true)
    expect(readFileSync(join(root,'assets/ai-generation-prompts.md'),'utf8')).toContain('image-returned')
    // Bun may retain a keep-alive socket; either connection refusal or the
    // closed capability's 404 is valid. Neither may initiate another call.
    const after=await fetch(access.endpoint).catch(()=>undefined)
    if(after)expect(after.status).toBe(404)
  }finally{release();await access.close();rmSync(root,{recursive:true,force:true})}
})

test('access exposes safe failure facts and identifies a replay without another upstream call', async () => {
  const root = mkdtempSync(join(tmpdir(), 'image-error-access-'))
  let calls = 0
  const service = new ImageGenerationService(new ImageAttemptStore(root, { generate: async () => {
    calls++
    expect(readFileSync(join(root, 'assets/ai-generation-prompts.md'), 'utf8')).toContain('request-received')
    throw new ImageProviderError('private upstream response with secret', 'unknown', 504, 'upstream-http')
  } }), fakeBilling().client)
  const access = openImageGenerationAccess({ userId: 'owner', projectId: 'project', workspacePath: root, loadConfig: async () => config, service })
  const url = access.endpoint
  try {
    const request = () => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ purpose: 'experiment', requestId: 'error-1', prompt: 'private prompt' }) })
    const first = await request()
    expect(first.status).toBe(502)
    const details = await first.json() as any
    expect(details).toMatchObject({ code: 'upstream-http', upstreamStatus: 504, replayed: false, outcome: 'unknown' })
    expect(details.diagnosticId).toBeString()
    const second = await request()
    expect(second.status).toBe(409)
    expect(await second.json()).toMatchObject({ diagnosticId: details.diagnosticId, replayed: true, upstreamStatus: 504 })
    expect(calls).toBe(1)
    expect(JSON.stringify(details)).not.toContain('private')
    const document = readFileSync(join(root, 'assets/ai-generation-prompts.md'), 'utf8')
    expect(document).toContain('private prompt')
    expect(document).toContain(details.diagnosticId)
    expect(document).toContain('"replayed": true')
    expect(document.match(/<!-- image-request:/g)).toHaveLength(1)
    expect(document).not.toContain('private upstream response')
  } finally { access.close(); rmSync(root, { recursive: true, force: true }) }
})

test('configuration failure is recorded without submitting upstream', async () => {
  const root = mkdtempSync(join(tmpdir(), 'image-config-record-'))
  let calls = 0
  const service = new ImageGenerationService(new ImageAttemptStore(root, { generate: async () => {
    calls++
    throw new Error('Unexpected submission')
  } }), fakeBilling().client)
  const access = openImageGenerationAccess({ userId: 'owner', projectId: 'project', workspacePath: root,
    loadConfig: async () => { throw new ImageConfigurationError('database-http', {
      source: 'service-platform', databaseHttpStatus: 403, serviceHttpStatus: 503,
    }) }, service })
  try {
    const url = access.endpoint
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ purpose: 'experiment', requestId: 'config-1', prompt: 'an icon' }) })
    const details = await response.json() as any
    expect(details).toMatchObject({ stage: 'configuration', promptRecord: 'recorded',
      code: 'database-http', source: 'service-platform', databaseHttpStatus: 403, serviceHttpStatus: 503 })
    expect(details.diagnosticId).toBeString()
    const doc = readFileSync(join(root, 'assets/ai-generation-prompts.md'), 'utf8')
    expect(doc).toContain('"model": "unknown"')
    expect(doc).toContain('delivery-failed')
    expect(doc).not.toContain('private settings error')
    expect(calls).toBe(0)
  } finally { access.close(); rmSync(root, { recursive: true, force: true }) }
})

test('record write failure does not discard a paid PNG or trigger regeneration', async () => {
  const root = mkdtempSync(join(tmpdir(), 'image-write-failure-'))
  mkdirSync(join(root, 'project'))
  mkdirSync(join(root, 'outside'))
  symlinkSync(join(root, 'outside'), join(root, 'project/assets'))
  let calls = 0
  const service = new ImageGenerationService(new ImageAttemptStore(root, { generate: async () => {
    calls++
    return { bytes: await png(), model: config.model, mimeType: 'image/png', usage }
  } }), fakeBilling().client)
  const access = openImageGenerationAccess({ userId: 'owner', projectId: 'project',
    workspacePath: join(root, 'project'), loadConfig: async () => config, service })
  try {
    const url = access.endpoint
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ purpose: 'experiment', requestId: 'write-1', prompt: 'an icon' }) })
    expect(response.status).toBe(200)
    expect(response.headers.get('x-image-prompt-record')).toBe('failed')
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(8)
    expect(calls).toBe(1)
    expect(existsSync(join(root, 'outside/ai-generation-prompts.md'))).toBe(false)
  } finally { access.close(); rmSync(root, { recursive: true, force: true }) }
})

const pricing = { model: 'test-model', version: 'test-v2', markupMultiplier: 1.5, textInputUsdPerMillion: 5,
  cachedTextInputUsdPerMillion: 1.25, imageInputUsdPerMillion: 8,
  cachedImageInputUsdPerMillion: 3, imageOutputUsdPerMillion: 30,
  maxRequestCredits: 2, projectBudgetCredits: 10 }
const config = imageConfigSchema.parse({ model: 'test-model', apiKey: 'secret', billing: pricing })

test('reference defaults stay local while production honors explicit and configured quality', async () => {
  const root = mkdtempSync(join(tmpdir(), 'image-quality-'))
  const qualities: string[] = [], billing = fakeBilling()
  let currentConfig = config
  const service = new ImageGenerationService(new ImageAttemptStore(root, { generate: async (settings, request) => {
    qualities.push(request.quality ?? settings.quality)
    return { bytes: await png(), model: settings.model, mimeType: 'image/png', usage }
  } }), billing.client)
  const access = openImageGenerationAccess({ userId: 'owner', projectId: 'project', workspacePath: root,
    loadConfig: async () => currentConfig, service })
  const send = async (value: unknown) => {
    const response = await fetch(access.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(value) })
    expect(response.status).toBe(200)
    await response.arrayBuffer()
  }
  const reference={purpose:'reference',requestId:'reference',quality:'low',prompt:'Original artwork: the required player view'}
  try {
    expect(await (await fetch(access.endpoint)).json()).toMatchObject({ available: true, quality: 'medium' })
    expect(await (await fetch(access.endpoint + '?quality=high')).json()).toMatchObject({ available: true, quality: 'high' })
    await send(reference)
    await send({ purpose: 'production', requestId: 'default', prompt: 'Character action sequence' })
    await send({ purpose: 'production', requestId: 'explicit', prompt: 'Character action sequence', quality: 'high' })
    expect(qualities).toEqual(['low', 'medium', 'high'])
    // Recover the paid concept with its original compiled quality; do not regenerate.
    await send(reference)
    expect(qualities).toHaveLength(3)
    currentConfig = { ...config, quality: 'high' }
    await send({ purpose: 'production', requestId: 'new-default', prompt: 'Character action sequence' })
    expect(qualities).toEqual(['low', 'medium', 'high', 'high'])
    // Recovery reuses the existing paid receipt and idempotent settlement.
    expect(billing.actions.filter(action => action === 'settle')).toHaveLength(5)
    expect(access.instruction).not.toContain('other quality requests are unavailable')
  } finally { access.close(); rmSync(root, { recursive: true, force: true }) }
})
const usage = { input_tokens: 100, output_tokens: 200, total_tokens: 300,
  input_tokens_details: { text_tokens: 100, image_tokens: 0 }, output_tokens_details: { text_tokens: 0, image_tokens: 200 } }
const input = { ownerId: 'owner', projectId: 'project', requestId: 'image-1', config, request: { prompt: 'an icon' } }
test('a renamed unresolved billing receipt blocks upstream work and exposes the original ID', async () => {
  const root = mkdtempSync(join(tmpdir(), 'image-unresolved-retry-'))
  let providerCalls = 0
  const actions: string[] = []
  const billing: ImageBillingClient = { async apply(_user, request) {
    actions.push(request.action)
    return { created: false, state: 'reserved', blockedByRequestId: 'original',
      reservedCreditsMicro: 100, chargedCreditsMicro: 0, metadata: {} }
  } }
  const service = new ImageGenerationService(new ImageAttemptStore(root, { generate: async () => {
    providerCalls++
    return { bytes: await png(), model: config.model, mimeType: 'image/png', usage }
  } }), billing)
  const access = openImageGenerationAccess({ userId: 'owner', projectId: 'project', workspacePath: root,
    loadConfig: async () => config, service })
  try {
    const response = await fetch(access.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ purpose: 'experiment', requestId: 'renamed', prompt: 'an icon' }) })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'unresolved-image-request', requestId: 'renamed', recoveryRequestId: 'original' })
    expect(providerCalls).toBe(0)
    expect(actions).toEqual(['reserve'])
  } finally { await access.close(); rmSync(root, { recursive: true, force: true }) }
})
function fakeBilling() {
  const receipts = new Map<string, ImageBillingReceipt>()
  const actions: string[] = []
  const client: ImageBillingClient = { async apply(user, request) {
    const key = JSON.stringify([user, request.projectId, request.requestId])
    let receipt = receipts.get(key)
    actions.push(request.action)
    if (request.action === 'reserve') {
      if (receipt) return { ...receipt, created: false }
      receipt = { created: true, state: 'reserved', metadata: request.metadata!, reservedCreditsMicro: request.amountCreditsMicro, chargedCreditsMicro: 0 }
    } else {
      if (!receipt) throw new Error('No reservation')
      receipt = { ...receipt, created: false, state: request.action === 'settle' ? 'settled' : 'released', chargedCreditsMicro: request.amountCreditsMicro }
    }
    receipts.set(key, receipt)
    return receipt
  } }
  return { client, actions }
}
async function png() { return sharp({ create: { width: 2, height: 2, channels: 4, background: '#fff' } }).png().toBuffer() }

test('OpenRouter platform billing is unavailable before reservation; BYOK remains external', async () => {
  const root = mkdtempSync(join(tmpdir(), 'image-router-billing-'))
  const billing = fakeBilling()
  const routerConfig = imageConfigSchema.parse({ ...config, provider: 'openrouter' })
  let calls = 0
  const service = new ImageGenerationService(new ImageAttemptStore(join(root, 'host'), { generate: async () => {
    calls++; return { bytes: await png(), model: config.model, mimeType: 'image/png', usage: { cost: 0.042 } }
  } }), billing.client)
  const platform = openImageGenerationAccess({ userId: 'owner', projectId: 'project', workspacePath: root,
    loadConfig: async () => routerConfig, service })
  const byok = openImageGenerationAccess({ userId: 'owner', projectId: 'personal', workspacePath: root,
    source: 'byok', loadConfig: async () => routerConfig, service })
  try {
    const capability = await (await fetch(platform.endpoint)).json()
    expect(capability).toMatchObject({ available: false, billingSource: 'platform' })
    expect(capability.unavailableReason).toContain('OpenRouter')
    await expect(service.generate({ ...input, config: routerConfig })).rejects.toMatchObject({ stage: 'billing-unsupported' })
    const response = await fetch(platform.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ purpose: 'experiment', requestId: 'new', prompt: 'an icon' }) })
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ code: 'billing-unsupported' })
    expect(calls).toBe(0)
    expect(billing.actions).toEqual([])
    expect(existsSync(join(root, 'host'))).toBe(false)
    expect(await (await fetch(byok.endpoint)).json()).toMatchObject({ available: true, billingSource: 'external' })
    const external = await service.generate({ ...input, config: routerConfig }, 'byok')
    expect(external).toMatchObject({ billingState: 'external', chargedCreditsMicro: null, usage: { cost: 0.042 } })
    expect(calls).toBe(1)
    expect(billing.actions).toEqual([])
  } finally { await platform.close(); await byok.close(); rmSync(root, { recursive: true, force: true }) }
})

test('asset command recovers existing OpenRouter output but cannot submit new platform work', async () => {
  const root = mkdtempSync(join(tmpdir(), 'image-router-recovery-'))
  const workspace = join(root, 'workspace')
  mkdirSync(join(workspace, 'assets'), { recursive: true })
  const billing = fakeBilling()
  const historical = { ...input, config: imageConfigSchema.parse({ ...config, provider: 'openrouter' }) }
  let calls = 0
  const attempts = new ImageAttemptStore(join(root, 'host'), { generate: async () => {
    calls++; return { bytes: await png(), model: config.model, mimeType: 'image/png', usage: { cost: 0.042 } }
  } })
  const access = openImageGenerationAccess({ userId: 'owner', projectId: 'project', workspacePath: workspace,
    loadConfig: async () => historical.config, service: new ImageGenerationService(attempts, billing.client) })
  try {
    // Seed a pre-fix paid attempt through the existing stores, without a live provider or wallet.
    await billing.client.apply('owner', { projectId: 'project', requestId: 'image-1', digest: 'historical',
      action: 'reserve', amountCreditsMicro: 2e6, projectBudgetCreditsMicro: 10e6, metadata: { pricing } })
    const original = await attempts.generate(historical)
    const script = join(workspace, 'assets.mjs')
    await writeProjectAssetCommand(script, { imageEndpoint: access.endpoint })
    for (const [requestId, output] of [['image-1', 'first'], ['image-1', 'again'], ['new', 'blocked']]) {
      const request = join(workspace, 'request.json')
      writeFileSync(request, JSON.stringify({ requestId, prompt: input.request.prompt, ...(requestId === 'new' ? { purpose: 'experiment' } : {}) }))
      const child = Bun.spawn([process.execPath, script, 'generate', request, `assets/${output}.png`],
        { cwd: workspace, stdout: 'pipe', stderr: 'pipe' })
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
      ])
      if (requestId === 'new') {
        expect(code).toBe(1)
        expect(stderr).toContain('billing-unsupported')
        expect(existsSync(join(workspace, `assets/${output}.png`))).toBe(false)
      } else {
        expect(code).toBe(0)
        expect(JSON.parse(stdout)).toMatchObject({ billingState: 'pending', chargedCredits: null })
        expect(readFileSync(join(workspace, `assets/${output}.png`))).toEqual(Buffer.from(original.bytes))
      }
    }
    expect(calls).toBe(1)
    expect(billing.actions).toEqual(['reserve', 'reserve', 'reserve'])
  } finally { await access.close(); rmSync(root, { recursive: true, force: true }) }
})

test('image pricing uses detailed usage and exact micro-Credits; missing or inconsistent usage is not free', () => {
  expect(imageChargeCreditsMicro(usage, pricing)).toBe(975000)
  expect(imageChargeCreditsMicro(usage, { ...pricing, markupMultiplier: 1 })).toBe(650000)
  expect(imageChargeCreditsMicro({ ...usage, input_tokens_details: { text_tokens: 100, image_tokens: 0,
    cached_text_tokens: 40, cached_image_tokens: 0 } }, pricing)).toBe(952500)
  const mixedUsage = { input_tokens: 200, output_tokens: 200, total_tokens: 400,
    input_tokens_details: { text_tokens: 100, image_tokens: 100,
      cached_text_tokens: 20, cached_image_tokens: 40 },
    output_tokens_details: { text_tokens: 0, image_tokens: 200 } }
  expect(imageChargeCreditsMicro(mixedUsage, pricing)).toBe(1053750)
  expect(imageChargeCreditsMicro(mixedUsage, { ...pricing, imageOutputUsdPerMillion: 40 })).toBe(1353750)
  expect(() => imageChargeCreditsMicro(null, pricing)).toThrow()
  expect(() => imageChargeCreditsMicro({ ...usage, total_tokens: 0 }, pricing)).toThrow()
  expect(() => imageChargeCreditsMicro({ ...usage, input_tokens_details: { ...usage.input_tokens_details, cached_tokens: 5 } }, pricing)).toThrow()
  expect(() => imageChargeCreditsMicro(usage, { ...pricing, maxRequestCredits: 0.000001 })).toThrow()
})

test('a reservation from before markup keeps its frozen 1x price', async () => {
  const root = mkdtempSync(join(tmpdir(), 'image-old-price-'))
  const { markupMultiplier: _markup, ...oldPricing } = pricing
  let charged = -1
  const billing: ImageBillingClient = { async apply(_owner, request) {
    if (request.action === 'reserve') return { created: true, state: 'reserved',
      reservedCreditsMicro: request.amountCreditsMicro, chargedCreditsMicro: 0,
      metadata: { pricing: oldPricing } }
    charged = request.amountCreditsMicro
    return { created: false, state: 'settled', reservedCreditsMicro: 2_000_000,
      chargedCreditsMicro: charged, metadata: { pricing: oldPricing } }
  } }
  try {
    const service = new ImageGenerationService(new ImageAttemptStore(root, { generate: async () => ({
      bytes: await png(), model: config.model, mimeType: 'image/png', usage,
    }) }), billing)
    const result = await service.generate(input)
    expect(result.chargedCreditsMicro).toBe(650000)
    expect(charged).toBe(650000)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

const cloudflareConfig = imageConfigSchema.parse({ ...config, provider: 'cloudflare', billing: {
  ...pricing, maxRequestCredits: 20, projectBudgetCredits: 100,
  fixedCreditsByVariant: CLOUDFLARE_INITIAL_FIXED_CREDITS,
} })

test('configured Cloudflare prices cover exactly the approved low and medium variants', () => {
  const configured = cloudflareConfig.billing!
  for (const [variant, credits] of Object.entries(CLOUDFLARE_INITIAL_FIXED_CREDITS)) {
    const [quality, size] = variant.split(':')
    expect(fixedImageChargeCreditsMicro(configured, quality!, size!)).toBe(credits * 1_000_000)
  }
  expect(() => fixedImageChargeCreditsMicro(configured, 'high', '1024x1024')).toThrow()
})

test('Cloudflare settles a configured fixed price without token usage and rejects unpriced variants before billing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'image-cloudflare-fixed-'))
  const billing = fakeBilling()
  let calls = 0
  const service = new ImageGenerationService(new ImageAttemptStore(root, {
    generate: async () => { calls++; return { bytes: await png(), model: config.model, mimeType: 'image/png' as const, usage: null } },
  }), billing.client)
  try {
    await expect(service.generate({ ...input, config: cloudflareConfig, request: { prompt: 'an icon', quality: 'high' } }))
      .rejects.toMatchObject({ stage: 'price-unavailable' })
    expect(billing.actions).toEqual([])
    const first = await service.generate({ ...input, config: cloudflareConfig })
    const recovered = await service.generate({ ...input, config: cloudflareConfig })
    expect(first.chargedCreditsMicro).toBe(8_000_000)
    expect(recovered.chargedCreditsMicro).toBe(8_000_000)
    expect(billing.actions).toEqual(['reserve', 'settle', 'reserve', 'settle'])
    expect(calls).toBe(1)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('service reserves before generating, settles usage, recovers without another provider call', async () => {
  const root = mkdtempSync(join(tmpdir(), 'image-service-'))
  const billing = fakeBilling()
  let calls = 0
  const provider = { generate: async () => {
    expect(billing.actions.at(-1)).toBe('reserve'); calls++
    return { bytes: await png(), model: config.model, mimeType: 'image/png' as const, usage }
  } }
  try {
    const first = await new ImageGenerationService(new ImageAttemptStore(root, provider), billing.client).generate(input)
    const second = await new ImageGenerationService(new ImageAttemptStore(root, provider), billing.client).generate(input)
    expect(first.bytes).toEqual(second.bytes)
    expect(second.chargedCreditsMicro).toBe(975000)
    expect(calls).toBe(1)
    expect(billing.actions).toEqual(['reserve', 'settle', 'reserve', 'settle'])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a paid request identity cannot be silently changed on replay', async () => {
  const root = mkdtempSync(join(tmpdir(), 'image-request-identity-'))
  const billing = fakeBilling()
  let calls = 0
  const provider = { generate: async () => {
    calls++
    return { bytes: await png(), model: config.model, mimeType: 'image/png' as const, usage }
  } }
  const service = new ImageGenerationService(new ImageAttemptStore(root, provider), billing.client)
  try {
    await service.generate(input)
    await service.generate(input)
    await expect(service.generate({ ...input, request: { ...input.request,
      prompt: 'different icon' } })).rejects.toMatchObject({ reason: 'conflict' })
    await expect(service.generate({ ...input, request: { ...input.request,
      background: 'transparent' as const } })).rejects.toMatchObject({ reason: 'conflict' })
    expect(calls).toBe(1)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('reference images and explicit sizes pass through the service with normal billing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'image-reference-service-')), billing = fakeBilling()
  const bytes = await png(), referenceImage = { bytes, sha256: 'a'.repeat(64), mimeType: 'image/png' as const }
  let calls = 0
  const service = new ImageGenerationService(new ImageAttemptStore(root, {
    generate: async (selected, request) => {
      calls++
      expect(selected.provider).toBe('openai')
      expect(request).toMatchObject({ size: '1536x1024', referenceImage })
      return { bytes, model: config.model, mimeType: 'image/png', usage }
    },
  }), billing.client)
  try {
    await service.generate({ ...input, request: { prompt: 'icon', size: '1536x1024', referenceImage } })
    expect(calls).toBe(1)
    expect(billing.actions).toEqual(['reserve', 'settle'])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('lost local receipt cannot reuse existing wallet reservation to generate again', async () => {
  const root = mkdtempSync(join(tmpdir(), 'image-lost-'))
  const billing = fakeBilling()
  await billing.client.apply('owner', { projectId: 'project', requestId: 'image-1', digest: 'test', action: 'reserve', amountCreditsMicro: 2e6, projectBudgetCreditsMicro: 10e6, metadata: { pricing } })
  let calls = 0
  try {
    const service = new ImageGenerationService(new ImageAttemptStore(root, { generate: async () => { calls++; throw new Error() } }), billing.client)
    await expect(service.generate(input)).rejects.toMatchObject({ reason: 'unknown' })
    expect(calls).toBe(0)
    expect(billing.actions).not.toContain('release')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('only confirmed rejected requests release holds; unknown provider outcome does not', async () => {
  for (const outcome of ['rejected', 'unknown'] as const) {
    const root = mkdtempSync(join(tmpdir(), 'image-failure-'))
    const billing = fakeBilling()
    try {
      const service = new ImageGenerationService(new ImageAttemptStore(root, { generate: async () => { throw new ImageProviderError('failure', outcome) } }), billing.client)
      await expect(service.generate(input)).rejects.toMatchObject({ reason: outcome })
      expect(billing.actions).toEqual(outcome === 'rejected' ? ['reserve', 'release'] : ['reserve'])
    } finally { rmSync(root, { recursive: true, force: true }) }
  }
})

test('missing billing or mismatched model never calls the provider or wallet', async () => {
  const billing = fakeBilling()
  const service = new ImageGenerationService(new ImageAttemptStore('/unused-image-path', { generate: async () => { throw new Error('should not call') } }), billing.client)
  await expect(service.generate({ ...input, config: { ...config, billing: null } })).rejects.toThrow()
  await expect(service.generate({ ...input, config: { ...config, model: 'changed' } })).rejects.toThrow()
  expect(billing.actions).toEqual([])
})

test('received image survives missing usage and settlement failure without another paid generation', async () => {
  for (const failure of ['usage', 'settle']) {
    const root = mkdtempSync(join(tmpdir(), 'image-paid-recovery-'))
    const billing = fakeBilling()
    let calls = 0
    const client: ImageBillingClient = { apply(user, request) {
      if (failure === 'settle' && request.action === 'settle') throw new Error('billing unavailable')
      return billing.client.apply(user, request)
    } }
    const provider = { generate: async () => {
      calls++
      return { bytes: await png(), model: config.model, mimeType: 'image/png' as const,
        usage: failure === 'usage' ? { keySource: 'Unified' } : usage }
    } }
    const service = new ImageGenerationService(new ImageAttemptStore(root, provider), client)
    const access = openImageGenerationAccess({ userId: 'owner', projectId: 'project', workspacePath: root,
      loadConfig: async () => config, service })
    try {
      const url = access.endpoint
      for (let replay = 0; replay < 2; replay++) {
        const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ purpose: 'experiment', requestId: 'image-1', prompt: 'an icon' }) })
        expect(response.status).toBe(200)
        expect(response.headers.get('x-image-billing-state')).toBe('pending')
        expect(response.headers.has('x-image-credits-micro')).toBe(false)
        expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(8)
      }
      expect(calls).toBe(1)
      expect(billing.actions).not.toContain('release')
    } finally { access.close(); rmSync(root, { recursive: true, force: true }) }
  }
})

test('image capability binds identity, reports cost without secrets, and rejects arbitrary parameters and browser origins', async () => {
  const root = mkdtempSync(join(tmpdir(), 'image-access-'))
  let calls = 0
  const billing = fakeBilling()
  const service = new ImageGenerationService(new ImageAttemptStore(root, { generate: async () => {
    calls++; return { bytes: await png(), model: config.model, mimeType: 'image/png', usage }
  } }), billing.client)
  const access = openImageGenerationAccess({ userId: 'owner', projectId: 'project', workspacePath: root, loadConfig: async () => config, service })
  const url = access.endpoint
  const body = JSON.stringify({ purpose: 'experiment', requestId: 'image-1', prompt: 'an icon' })
  const headers = { 'content-type': 'application/json' }
  try {
    expect(access.instruction).not.toContain(config.apiKey)
    expect(access.instruction).toContain('no manual maintenance is needed')
    expect(access.instruction).toContain('beegame-images generate_image when available')
    expect(access.instruction).toContain('assets.mjs generate is the CLI alternative')
    expect(access.instruction).not.toContain('Use the optional project asset command')
    expect(access.instruction).not.toContain(url)
    const quote = await (await fetch(url)).json()
    expect(quote).toMatchObject({ available: true, model: config.model,
      outputFormat: 'png', backgroundModes: ['auto', 'opaque', 'transparent'], maxReferenceImages: 1,
      quality: 'medium', size: '1024x1024', maxRequestCredits: 2, fixedPrice: false })
    for (const key of ['provider', 'modelPriceMultiplier', 'creditFaceValuePerUsd', 'apiKey', 'upstreamApiKey', 'subscriptionOwnerId', 'responseModel']) expect(quote).not.toHaveProperty(key)
    expect(calls).toBe(0); expect(billing.actions).toEqual([])
    expect(access.instruction).not.toMatch(/cloudflare|gpt-image|GPT Image/i)
    expect(await (await fetch(url)).text()).not.toContain(config.apiKey)
    expect(existsSync(join(root, 'assets/ai-generation-prompts.md'))).toBe(false)
    expect((await fetch(url, { method: 'POST', headers: { ...headers, origin: 'http://evil.test' }, body })).status).toBe(404)
    expect((await fetch(url, { method: 'POST', headers, body: JSON.stringify({ purpose: 'experiment', requestId: 'x', prompt: 'x', userId: 'other' }) })).status).toBe(400)
    const response = await fetch(url, { method: 'POST', headers, body })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('x-image-credits-micro')).toBe('975000')
    expect(response.headers.get('x-image-prompt-record')).toBe('recorded')
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(8)
    expect(calls).toBe(1)
    const document = readFileSync(join(root, 'assets/ai-generation-prompts.md'), 'utf8')
    expect(document).toContain('"prompt": "an icon"')
    expect(document).toContain('"model": "test-model"')
    expect(document).toContain('image-returned')
    expect(document).not.toContain(config.apiKey)
    expect(document).not.toContain(url)
  } finally { access.close(); rmSync(root, { recursive: true, force: true }) }
})

test.each(['openai', 'cloudflare', 'openrouter', 'vercel', 'chatgpt-subscription'] as const)('image capability follows the selected image model without probing or charging: %s', async provider => {
  const root = mkdtempSync(join(tmpdir(), 'image-model-capability-')), billing = fakeBilling()
  let selected = imageConfigSchema.parse({ ...config, provider, responseModel: 'chat-orchestrator',
    subscriptionOwnerId: 'private-administrator', upstreamApiKey: 'private-upstream-key' })
  let calls = 0
  const service = new ImageGenerationService(new ImageAttemptStore(root, { generate: async () => {
    calls++; throw Error('A capability query must not call the provider')
  } }), billing.client)
  const open = () => openImageGenerationAccess({ userId: 'owner', projectId: 'project', workspacePath: root,
    source: provider === 'chatgpt-subscription' ? 'chatgpt-subscription' : 'byok', loadConfig: async () => selected, service })
  const access = open()
  let resumed: ReturnType<typeof open> | undefined
  const inspect = async (endpoint: string) => {
    const response = await fetch(endpoint)
    expect(response.status).toBe(200)
    const info = await response.json()
    expect(info).toMatchObject({ available: true, model: selected.model, outputFormat: 'png',
      backgroundModes: ['auto', 'opaque', 'transparent'], maxReferenceImages: 1, referenceImageSupported: true })
    for (const key of ['apiKey', 'upstreamApiKey', 'subscriptionOwnerId', 'responseModel', 'baseUrl']) expect(info).not.toHaveProperty(key)
    expect(JSON.stringify(info)).not.toMatch(/private-administrator|private-upstream-key|chat-orchestrator/)
    if (provider === 'cloudflare' || provider === 'chatgpt-subscription')
      expect(info.availableSizes).toEqual(['1024x1024', '1024x1536', '1536x1024'])
    return info
  }
  try {
    await inspect(access.endpoint)
    selected = { ...selected, model: 'selected-next-image-model' }
    await inspect(access.endpoint)
    await access.close()
    resumed = open()
    await inspect(resumed.endpoint)
    selected = { ...selected, apiKey: '', responseModel: undefined }
    expect(await (await fetch(resumed.endpoint)).json()).toMatchObject({ available: false, model: selected.model })
    expect(calls).toBe(0); expect(billing.actions).toEqual([])
    expect(existsSync(join(root, 'assets/ai-generation-prompts.md'))).toBe(false)
  } finally { await access.close(); await resumed?.close(); rmSync(root, { recursive: true, force: true }) }
})

test('Cloudflare reference request reads only a project image before billing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'image-reference-access-'))
  mkdirSync(join(root, 'assets/generated'), { recursive: true })
  const image = await png()
  writeFileSync(join(root, 'assets/generated/board.png'), image)
  const billing = fakeBilling()
  let calls = 0
  const service = new ImageGenerationService(new ImageAttemptStore(root, { generate: async (_config, request) => {
    calls++
    expect(request.referenceImage?.bytes).toEqual(image)
    return { bytes: image, model: config.model, mimeType: 'image/png', usage }
  } }), billing.client)
  const access = openImageGenerationAccess({ userId: 'owner', projectId: 'project', workspacePath: root,
    loadConfig: async () => cloudflareConfig, service })
  try {
    expect(await (await fetch(access.endpoint)).json()).toMatchObject({ referenceImageSupported: true,
      fixedPrice: true,
      available: true, quotedCreditsMicro: 8_000_000,
      availableSizes: ['1024x1024', '1024x1536', '1536x1024'] })
    expect(await (await fetch(access.endpoint + '?quality=low&size=1536x1024')).json()).toMatchObject({
      available: true, quality: 'low', size: '1536x1024', quotedCreditsMicro: 4_000_000,
    })
    expect(await (await fetch(access.endpoint + '?quality=high')).json()).toMatchObject({
      available: false, quotedCreditsMicro: null,
    })
    const send = (requestId: string, referenceImagePath: string) => fetch(access.endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ purpose: 'experiment', requestId, prompt: 'matching UI elements', referenceImagePath }),
    })
    const denied = await send('denied', '../secret.png')
    expect(denied.status).toBe(400)
    expect((await denied.json() as any).code).toBe('path')
    expect(billing.actions).toEqual([])
    const accepted = await send('board-1', 'assets/generated/board.png')
    expect(accepted.status).toBe(200)
    expect(accepted.headers.get('x-image-credits-micro')).toBe('8000000')
    expect(calls).toBe(1)
    expect(billing.actions).toEqual(['reserve', 'settle'])
    expect(readFileSync(join(root, 'assets/ai-generation-prompts.md'), 'utf8'))
      .toContain('assets/generated/board.png')
  } finally { access.close(); rmSync(root, { recursive: true, force: true }) }
})


test('one live image capability follows provider changes for layout guides and selected reference images', async () => {
  const root = mkdtempSync(join(tmpdir(), 'image-reference-switch-')), billing = fakeBilling()
  const bytes = Buffer.from(await png())
  mkdirSync(join(root, 'assets/reference'), { recursive: true })
  writeFileSync(join(root, 'assets/reference/design.png'), bytes)
  let selected = { ...config, provider: 'cloudflare' as 'cloudflare' | 'openai' | 'vercel' | 'openrouter', baseUrl: 'https://gateway.example/ai/run' }
  const received: Array<{ provider: string; url: string; body: any }> = []
  const service = new ImageGenerationService(new ImageAttemptStore(root, {
    generate: (cfg, request) => createImageGenerationProvider(cfg.provider, async (url, init) => {
      const body = JSON.parse(String(init.body))
      received.push({ provider: cfg.provider, url, body })
      return cfg.provider === 'cloudflare'
        ? Response.json({ result: { state: 'Completed', result: { image: 'https://cdn.example/output.png' } } })
        : Response.json({ data: [{ b64_json: bytes.toString('base64') }], usage })
    }, async () => new Response(bytes)).generate(cfg, request),
  }), billing.client)
  const access = openImageGenerationAccess({ userId: 'owner', projectId: 'project', workspacePath: root,
    source: 'byok', loadConfig: async () => selected, service })
  try {
    for (const [index, provider] of (['cloudflare', 'openai', 'vercel', 'openrouter'] as const).entries()) {
      // A quote from the previous provider must not pin the subsequent submission.
      expect(await (await fetch(access.endpoint)).json()).toMatchObject({ available: true, referenceImageSupported: true })
      selected = { ...config, provider, baseUrl: provider === 'cloudflare' ? 'https://gateway.example/ai/run'
        : provider === 'openrouter' ? 'https://gateway.example/api/v1/images' : 'https://gateway.example/v1/images/generations' }
      const response = await fetch(access.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: 'switch-' + index, purpose: 'reference',
          referenceImagePath:'assets/reference/design.png',prompt:'Shared visual identity: actual gameplay state' }) })
      expect(response.status).toBe(200)
      expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes)
      const item = received.at(-1)!
      expect(item.provider).toBe(provider)
      expect(item.url).toBe(provider === 'openai' || provider === 'vercel'
        ? 'https://gateway.example/v1/images/edits' : selected.baseUrl)
      const data = provider === 'cloudflare' ? item.body.input.images[0]
        : provider === 'openrouter' ? item.body.input_references[0].image_url.url : item.body.images[0].image_url
      const reference = Buffer.from(data.split(',')[1], 'base64')
      expect(reference).toEqual(bytes)
    }
    expect(received).toHaveLength(4)
    expect(billing.actions).toEqual([])
  } finally { await access.close(); rmSync(root, { recursive: true, force: true }) }
})


test('reference-purpose prompt checks follow requests rather than stages, while production resources keep their own contract', async () => {
  const root=mkdtempSync(join(tmpdir(),'image-purpose-review-'))
  const billing=fakeBilling();let checked=0,generated=0
  const service=new ImageGenerationService(new ImageAttemptStore(join(root,'host'),{generate:async()=>{
    generated++;return {bytes:await png(),model:config.model,mimeType:'image/png',usage}
  }}),billing.client)
  const access=openImageGenerationAccess({userId:'owner',projectId:'project',workspacePath:root,source:'byok',loadConfig:async()=>config,service,
    reviewPrompt:async prompt=>{checked++;const data=JSON.parse(imagePromptReviewInput(root,'Standalone appearance request',prompt,false));expect(data.design).toEqual([]);return {issues:[]}}})
  try {
    const send=(value:object)=>fetch(access.endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)})
    const reference=await send({requestId:'reference',purpose:'reference',prompt:'A standalone character reference'})
    expect(reference.status).toBe(200);await reference.arrayBuffer()
    expect(checked).toBe(1)
    await writeBeeGameAssetManifest(root,{version:9,resources:[],requirements:[{id:'ui',acquisition_profile:{dimensions:['2D'],asset_kinds:['sprite-atlas'],styles:[]}}]})
    const production=await send({requestId:'production',purpose:'production',requirementIds:['ui'],prompt:'UI artwork atlas'})
    expect(production.status).toBe(200);await production.arrayBuffer()
    expect(checked).toBe(1)
    const invalid=await send({requestId:'bad-production',purpose:'production',requirementIds:['missing'],prompt:'Unregistered resource'})
    expect(invalid.status).toBe(422)
    expect(checked).toBe(1);expect(generated).toBe(2);expect(billing.actions).toEqual([])
    expect(()=>imagePromptReviewInput(root,'A complete game','A screen concept',true)).toThrow('saved GDD')
    mkdirSync(join(root,'docs'))
    writeFileSync(join(root,'docs/GDD.md'),Buffer.from([0xff,0xfe]))
    expect(()=>imagePromptReviewInput(root,'Standalone appearance','A screen',false)).toThrow('saved GDD')
  } finally {await access.close();rmSync(root,{recursive:true,force:true})}
})


test.each(['platform', 'byok'] as const)('new artwork needs no empty registry, while established constraints and invalid manifests still fail before charging: %s', async source => {
  const root = mkdtempSync(join(tmpdir(), 'image-before-inventory-'))
  const billing = fakeBilling()
  let calls = 0
  const service = new ImageGenerationService(new ImageAttemptStore(join(root, 'host'), { generate: async () => {
    calls++
    return { bytes: await png(), model: config.model, mimeType: 'image/png', usage }
  } }), billing.client)
  const access = openImageGenerationAccess({userId:'owner',projectId:'project',workspacePath:root,source,loadConfig:async()=>config,service})
  const send = (requestId:string, metadata:object={}) => fetch(access.endpoint,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({requestId,purpose:'production',prompt:'New game parts atlas',...metadata})})
  try {
    const produced = await send('new-art')
    expect(produced.status).toBe(200)
    writeFileSync(join(root,'assets/design.png'),Buffer.from(await produced.arrayBuffer()))
    const skins=await send('new-skins',{referenceImagePath:'assets/design.png',prompt:'UI atlas: the supplied panel skin, without text'})
    expect(skins.status).toBe(200)
    await skins.arrayBuffer()
    expect(calls).toBe(2)
    expect(existsSync(join(root,'assets/asset-manifest.json'))).toBe(false)
    const actions = [...billing.actions]
    expect((await send('unknown-id',{requirementIds:['absent']})).status).toBe(422)
    await writeBeeGameAssetManifest(root,{version:9,resources:[],requirements:[],project_target:{
      platform:'web',runtime:'fixture',asset_format_capabilities:['png'],resource_library_usage:'required',
      runtime_asset_root:'assets/runtime',generated_asset_root:'assets/generated'}})
    expect((await send('omit-library-preference')).status).toBe(422)
    await writeBeeGameAssetManifest(root,{version:9,resources:[],requirements:[{id:'licensed',acquisition_profile:{
      dimensions:['2D'],asset_kinds:['image'],styles:[],sourcing_policy:{allowed_source_kinds:['resource-library'],
        license_constraints:['licensed'],responsible_party:'author',handoff_criteria:['usable file']}}}]})
    expect((await send('omit-existing')).status).toBe(422)
    expect((await send('disallowed-existing',{requirementIds:['licensed']})).status).toBe(422)
    writeFileSync(join(root,'assets/asset-manifest.json'),'{invalid')
    expect((await send('invalid-manifest')).status).toBe(422)
    expect(calls).toBe(2)
    expect(billing.actions).toEqual(actions)
  } finally { await access.close(); rmSync(root,{recursive:true,force:true}) }
})
