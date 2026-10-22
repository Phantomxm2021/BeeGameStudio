import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { bundleContentConsumer } from './game-content-consumer-cli'
import { uiLayoutFixture } from './fixtures/layout-fixture'
import { sharedPlaywright } from './shared-playwright'

// Current runtime APIs, real decoded image/font bytes, and a disposable browser.
// No retired inspect-design command or project/Preview service is involved.
test.skipIf(process.env.BGS_DESIGN_BROWSER !== '1')('shared runtime decodes selected atlas/font members and measures the rendered UI without fallback', async () => {
  const { chromium } = await import(sharedPlaywright().moduleUrl)
  const executablePath = process.env.BGS_LAYOUT_BROWSER_EXECUTABLE ?? chromium.executablePath()
  if (!existsSync(executablePath)) throw Error('An installed Chromium is required; no browser download')
  const source = await bundleContentConsumer()
  const image = await sharp({ create: { width: 8, height: 4, channels: 4, background: '#ff0000' } }).png().toBuffer()
  const font = await readFile(process.platform === 'darwin' ? '/System/Library/Fonts/Supplemental/Arial.ttf' : '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
  const resources = [
    { id:'atlas',root_path:'assets/atlas.png',file_paths:['assets/atlas.png','assets/atlas.json'],status:'verified' },
    { id:'font',root_path:'assets/font.ttf',file_paths:['assets/font.ttf','assets/second.ttf','assets/OFL.txt'],status:'verified' },
  ]
  const server = Bun.serve({ hostname:'127.0.0.1',port:0,fetch:request => {
    const path = new URL(request.url).pathname
    if (path === '/') return new Response('<!doctype html><body>')
    if (path === '/consumer.mjs') return new Response(source,{headers:{'content-type':'text/javascript'}})
    if (path === '/assets/asset-manifest.json') return Response.json({version:9,modules:{resources:['assets/atlas.resource.json','assets/font.resource.json']}})
    const resource = resources.find(item => path === '/assets/'+item.id+'.resource.json')
    if (resource) return Response.json(resource)
    if (path === '/assets/atlas.json') return Response.json({frames:{play:{frame:{x:0,y:0,w:4,h:4}}}})
    if (path === '/assets/atlas.png') return new Response(new Uint8Array(image),{headers:{'content-type':'image/png'}})
    if (path.endsWith('.ttf')) return new Response(font,{headers:{'content-type':'font/ttf'}})
    if (path === '/assets/OFL.txt') return new Response('Synthetic supporting licence')
    return new Response('Missing',{status:404})
  } })
  const ui: any = uiLayoutFixture()
  ui.assetRefs=['atlas','font']
  ui.data.nodes[0].data.background={color:'#123456'}
  Object.assign(ui.data.nodes[1],{text:'Play',style:{fontSize:20,lineHeight:28},data:{image:{assetRef:'atlas',member:'assets/atlas.png',frame:'play'},font:{assetRef:'font'}}})
  let browser
  try {
    browser=await chromium.launch({executablePath,headless:true})
    const page=await browser.newPage()
    await page.route('**/*',(route:any)=>new URL(route.request().url()).origin===server.url.origin?route.continue():route.abort())
    await page.goto(server.url.href)
    const result=await page.evaluate(async (ui:any)=>{
      const path='/consumer.mjs',lib=await import(path),before=JSON.stringify(ui),calls:string[]=[]
      const other=structuredClone(ui)
      other.id='status';other.data.nodes[1].id='status';other.data.nodes[1].text='OK'
      other.data.nodes[0].data.background={color:'#321654'}
      other.data.nodes[1].data.font.member='assets/second.ttf'
      const loaded=await lib.loadProductionResources(new URL('/assets/asset-manifest.json',location.href),[ui,other],async(url:any)=>{
        calls.push(new URL(url).pathname);return fetch(url)
      })
      const host=document.createElement('div');document.body.append(host)
      const surface=await lib.createProductionUiSurface(host),fontFaces=Object.fromEntries(loaded.fonts)
      const read=(doc:any)=>lib.readUiData(doc),viewport={width:600,height:360}
      const inspect=(doc:any,samples:any)=>lib.inspectUiLayoutInBrowser(read(doc).nodes,doc.data.rootId,viewport,
        {fontFamily:()=> 'Arial',fontFaces,textSamples:samples})
      try {
        surface.render(read(ui),viewport,{assets:loaded.assets,fonts:loaded.fonts,onAction:()=>{}})
        const measurement=await inspect(ui,{play:['Longest legal label']})
        const atlasPixel=[...host.querySelector('canvas')!.getContext('2d')!.getImageData(0,0,1,1).data]
        const background=getComputedStyle(host.querySelector('[data-node-id="root"]')!).backgroundColor
        surface.render(read(other),{width:640,height:360},{assets:loaded.assets,fonts:loaded.fonts,onAction:()=>{}})
        const second=await inspect(other,{status:['Ready']})
        const secondBackground=getComputedStyle(host.querySelector('[data-node-id="root"]')!).backgroundColor
        const staleNodes=host.querySelectorAll('[data-node-id="play"]').length
        const fail=async(action:()=>Promise<unknown>)=>{try{await action();return ''}catch(error){return String(error)}}
        const unknown=await fail(()=>inspect(ui,{mistyped:['x']}))
        const nonText=await fail(()=>inspect(ui,{root:['x']}))
        const missing=structuredClone(ui);missing.data.nodes[1].data.font.assetRef='missing'
        const missingFont=await fail(()=>inspect(missing,{}))
        const invalid=await fail(()=>lib.loadProductionResources(new URL('/assets/asset-manifest.json',location.href),[ui],
          (url:any)=>String(url).endsWith('/atlas.png')?Promise.resolve(new Response('not an image')):fetch(url)))
        const missingMember=structuredClone(ui);missingMember.data.nodes[1].data.font.member='assets/missing.ttf'
        const memberError=await fail(()=>lib.loadProductionResources(new URL('/assets/asset-manifest.json',location.href),[missingMember]))
        const faces=[...loaded.fonts.values()] as FontFace[]
        loaded.dispose()
        return {atlasPixel,background,secondBackground,staleNodes,measurement,second,unknown,nonText,missingFont,invalid,memberError,
          calls,preserved:JSON.stringify(ui)===before,released:faces.every(face=>!document.fonts.has(face))}
      } finally {surface.dispose();loaded.dispose()}
    },ui)
    expect(result.atlasPixel).toEqual([255,0,0,255])
    expect(result.background).toBe('rgb(18, 52, 86)')
    expect(result.secondBackground).toBe('rgb(50, 22, 84)')
    expect(result.staleNodes).toBe(0)
    expect(result.measurement.textMeasurements[0]).toMatchObject({nodeId:'play',basis:'registered-font',assetRef:'font'})
    expect(result.measurement.textMeasurements[0].values.map((value:any)=>value.text)).toEqual(['Play','Longest legal label'])
    expect(result.second.textMeasurements[0]).toMatchObject({nodeId:'status',basis:'registered-font',member:'assets/second.ttf'})
    expect(result.second.textMeasurements[0].values.map((value:any)=>value.text)).toEqual(['OK','Ready'])
    for(const path of ['/assets/atlas.png','/assets/atlas.json','/assets/font.ttf','/assets/second.ttf'])
      expect(result.calls.filter((value:string)=>value===path)).toHaveLength(1)
    expect(result.calls).not.toContain('/assets/OFL.txt') // Supporting files are not treated as fonts.
    expect(result.unknown).toContain('authored text node')
    expect(result.nonText).toContain('authored text node')
    expect(result.missingFont).toContain('Load and register the actual FontFace')
    expect(result.invalid).not.toBe('') // Browser decode failure cannot be hidden by status: verified.
    expect(result.memberError).toContain('Missing or ambiguous registered member')
    expect(result.preserved).toBe(true)
    expect(result.released).toBe(true)
  } finally {await browser?.close();server.stop(true)}
},30000)
