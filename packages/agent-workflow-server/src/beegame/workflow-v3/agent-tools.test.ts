import { test, expect } from 'bun:test'
import { access, copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openAgentTools } from './agent-tools'
import { sharedContentChecker } from '../content-checker-runtime'
import { CONTENT_DRAFT_EXAMPLES } from '../game-content-validation-cli'
import { openPreviewTestAccess } from '../preview-test-access'
import { projectPreviewCapabilityPath } from '../project-preview-capability'
import { createPreviewTestBrowser } from '../preview-test-browser'
import { sharedPlaywright } from '../shared-playwright'
import { buildEditableProject } from './editable-project'
import { sceneLayoutFixture } from '../fixtures/layout-fixture'
import { createHash } from 'node:crypto'

async function command(root: string, directory: string, name: string, ...args: string[]) {
  const child = Bun.spawn([process.execPath, join(root, directory, name), ...args], {
    cwd: root, env: { ...process.env, BEEGAME_CONTENT_CHECKER_MODULE: (await sharedContentChecker()).moduleUrl },
    stdout: 'pipe', stderr: 'pipe',
  })
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  return { stdout, stderr, code }
}
test('autonomous tools use actual auth and drafts without stages, documents or invented authority', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-agent-tools-'))
  const calls: string[] = []; let token = 'synthetic-user-a'
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    calls.push(request.headers.get('authorization') ?? '')
    return Response.json({ items: [{ packId: 'actual-fixture', license: 'CC0' }] })
  } })
  const tools = await openAgentTools({ workspacePath: root, libraryBaseUrl: upstream.url.origin, getAuthToken: () => token })
  try {
    const source = await readFile(join(root, tools.directory, 'assets.mjs'), 'utf8')
    expect(source).not.toContain(token); expect(tools.turnContext).not.toContain(token)
    expect(tools.turnContext.length).toBeLessThan(2200)
    expect(tools.turnContext).toContain('React/Canvas does not waive promised editable data')
    expect(tools.turnContext).toContain('Runtime consumption needs separate evidence')
    expect(tools.turnContext).toContain(tools.directory+'/consumer.mjs')
    const consumerHelp=await command(root,tools.directory,'consumer.mjs','--help')
    expect(consumerHelp.code).toBe(0)
    expect(consumerHelp.stdout).toContain(tools.directory+'/content-consumer.mjs')
    expect(consumerHelp.stdout).toContain('host tool files are excluded')
    expect(consumerHelp.stdout).toContain('Camera center AND orthographicSize')
    expect(consumerHelp.stdout).toContain('beforeNavigate')
    const consumer=await import(join(root,tools.directory,'content-consumer.mjs'))
    expect(typeof consumer.createProductionUiSurface).toBe('function')
    expect(typeof consumer.sceneNodeClientPoint2d).toBe('function')
    expect((await command(root, tools.directory, 'assets.mjs', '--help')).stdout).toContain(tools.directory + '/media.mjs')
    expect(JSON.parse((await command(root, tools.directory, 'assets.mjs', 'catalog')).stdout).items[0].packId).toBe('actual-fixture')
    token = 'synthetic-user-b'
    expect((await command(root, tools.directory, 'assets.mjs', 'pack', 'actual-fixture')).code).toBe(0)
    expect(calls).toEqual(['Bearer synthetic-user-a', 'Bearer synthetic-user-b'])
    const format = await command(root, tools.directory, 'check-content.mjs', '--format', 'coordinates', 'uiVocabulary')
    expect(format.code, format.stdout).toBe(0)
    expect(JSON.parse(format.stdout).values).toHaveProperty('coordinates')
    expect(JSON.stringify(JSON.parse(format.stdout))).not.toContain('documentRevision')
    const ui = structuredClone(CONTENT_DRAFT_EXAMPLES.ui)
    await writeFile(join(root, 'menu.json'), JSON.stringify(ui))
    expect((await command(root, tools.directory, 'check-content.mjs', '--check-drafts', 'menu.json')).code).toBe(0)
    const layout = await command(root, tools.directory, 'check-content.mjs', '--layout-draft', 'menu.json', '960', '540')
    expect(layout.code, layout.stdout).toBe(0); expect(JSON.parse(layout.stdout).scope).toContain('draft')
    expect((await command(root, tools.directory, 'resources.mjs', '--contract')).stdout).toContain('Asset Manifest authoring contract')
    expect((await command(root, tools.directory, 'media.mjs', '--help')).code).toBe(0)
    for (const name of ['check-content.mjs', 'media.mjs', 'resources.mjs', 'bind-content.mjs']) {
      const wrongRuntime = Bun.spawn([Bun.which('node')!, join(root,tools.directory,name), '--help'], {
        cwd: root, env: { PATH: process.env.PATH, BEEGAME_CONTENT_CHECKER_MODULE: 'file:///absent-fixture.mjs' },
        stdout: 'pipe', stderr: 'pipe',
      })
      const output = await new Response(wrongRuntime.stdout).text()
      expect(await wrongRuntime.exited).toBe(1)
      expect(JSON.parse(output).issues[0]).toContain('BGS_BUN_REQUIRED')
      expect(output).not.toContain('UH is not a function')
    }
    const batch = await command(root, tools.directory, 'check-content.mjs', '--review-sources', 'menu.json', '--details')
    expect(batch.code, batch.stdout).toBe(0)
    expect(JSON.parse(batch.stdout).sources[0].text).toBe(await readFile(join(root,'menu.json'),'utf8'))
    const full = await command(root, tools.directory, 'check-content.mjs', '--authority')
    expect(full.code).toBe(1); expect(JSON.parse(full.stdout).valid).toBe(false)
    for (const path of ['docs', 'content/index.json', 'assets/asset-manifest.json', '.beegame/delivery/content-format.json'])
      await expect(access(join(root, path))).rejects.toThrow()
    // Use the actual V3-published tool, not a replacement wrapper, to create
    // only first-index metadata. The author still saves the registry.
    await mkdir(join(root, 'content/scenes'), { recursive: true })
    await mkdir(join(root, 'content/ui'), { recursive: true })
    await writeFile(join(root, 'content/scenes/level.json'), JSON.stringify(sceneLayoutFixture()))
    await writeFile(join(root, 'content/ui/menu.json'), JSON.stringify(ui))
    const first = await command(root, tools.directory, 'check-content.mjs', '--package-metadata',
      'content/scenes/level.json', 'content/ui/menu.json')
    expect(first.code, first.stdout + first.stderr).toBe(0)
    const metadata = JSON.parse(first.stdout)
    expect(metadata).toMatchObject({ valid: true, designVerified: false, runtimeVerified: false })
    await expect(access(join(root, 'content/index.json'))).rejects.toThrow()
    await writeFile(join(root, 'content/index.json'), JSON.stringify({ schema: 'beegame-content-package.v2',
      id: 'synthetic-first', dimension: '2d', sceneModel: 'game-object-v2', entryScene: 'level',
      files: ['scenes/level.json', 'ui/menu.json'], ...metadata.indexMetadata,
      documents: [{ id: 'level', kind: 'scene-2d', path: 'scenes/level.json', loadPhase: 'startup' },
        { id: 'menu', kind: 'ui-screen', path: 'ui/menu.json', loadPhase: 'on-demand' }] }))
    const current = await command(root, tools.directory, 'check-content.mjs')
    expect(current.code, current.stdout + current.stderr).toBe(0)
    expect(JSON.parse(current.stdout)).toMatchObject({ valid: true, designVerified: false, runtimeVerified: false })
    await expect(access(join(root, 'docs'))).rejects.toThrow()
    await expect(access(join(root, 'assets/asset-manifest.json'))).rejects.toThrow()
    await mkdir(join(root,'.beegame/delivery'),{recursive:true})
    await writeFile(join(root,'.beegame/delivery/content-format.json'),'{invalid-existing-format')
    const corrupt = await command(root,tools.directory,'check-content.mjs','--format','coordinates')
    expect(corrupt.code).toBe(1) // only absent format falls back; corruption stays visible
    await writeFile(join(root,'.beegame/delivery/content-format.json'),JSON.stringify({fixtureSection:{kept:true}}))
    const retained = await command(root,tools.directory,'check-content.mjs','--format','fixtureSection')
    expect(JSON.parse(retained.stdout).value).toEqual({kept:true})
    expect(await readFile(join(root,'.beegame/delivery/content-format.json'),'utf8')).toBe('{"fixtureSection":{"kept":true}}')
    await tools.close()
    const closed = await command(root, tools.directory, 'assets.mjs', 'catalog')
    expect(closed.code).toBe(1); expect(calls).toHaveLength(2)
  } finally { await tools.close(); upstream.stop(true); await rm(root, { recursive: true, force: true }) }
}, 30000)

test('missing credentials and invalid configuration do not become empty catalogs or block pure tools', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-agent-tools-unavailable-'))
  const upstream = Bun.serve({ hostname:'127.0.0.1', port:0, fetch:()=>{ throw Error('No unauthenticated upstream call allowed') } })
  const tools = await openAgentTools({ workspacePath:root, libraryBaseUrl:upstream.url.origin, getAuthToken:()=>undefined })
  try {
    const failed = await command(root,tools.directory,'assets.mjs','catalog')
    expect(failed.code).toBe(1); expect(failed.stderr).toContain('not an empty search result')
    const invalid = await openAgentTools({workspacePath:root,libraryBaseUrl:'file:///not-a-service',getAuthToken:()=>undefined})
    try {
      expect(invalid.turnContext).toContain('could not start')
      expect((await command(root,invalid.directory,'check-content.mjs','--format','coordinates')).code).toBe(0)
      expect((await command(root,invalid.directory,'assets.mjs','catalog')).code).toBe(1)
    } finally { await invalid.close() }
  } finally { await tools.close(); upstream.stop(true); await rm(root,{recursive:true,force:true}) }
},30000)

test('a chosen consumer copy remains buildable without the temporary host tools',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bgs-v3-consumer-build-'))
  const tools=await openAgentTools({workspacePath:root,getAuthToken:()=>undefined})
  try {
    await mkdir(join(root,'src'))
    await copyFile(join(root,tools.directory,'content-consumer.mjs'),join(root,'src/bgs-content-consumer.mjs'))
    await writeFile(join(root,'src/main.js'),"import{readUiData}from'./bgs-content-consumer.mjs';window.readUiData=readUiData;")
    await writeFile(join(root,'package.json'),JSON.stringify({scripts:{build:'bun build.mjs'}}))
    await writeFile(join(root,'build.mjs'),"import{writeFile}from'node:fs/promises';const r=await Bun.build({entrypoints:['src/main.js'],outdir:'dist',target:'browser'});if(!r.success)throw Error('Synthetic build failed');await writeFile('dist/index.html','<!doctype html><script src=main.js></script>');")
    const built=await buildEditableProject(root,{editableProject:true,runtimeArtifact:'dist',writablePaths:['dist/**']},[],[],undefined,true)
    expect(built.status,built.observation).toBe('passed')
    expect(built.projectBuild!.files.some(f=>f.path==='src/bgs-content-consumer.mjs')).toBe(true)
    expect(built.projectBuild!.files.some(f=>f.path.startsWith('.beegame/'))).toBe(false)
    expect(await readFile(join(root,'src/bgs-content-consumer.mjs'),'utf8')).toBe(await readFile(join(root,tools.directory,'content-consumer.mjs'),'utf8'))
  } finally {await tools.close();await rm(root,{recursive:true,force:true})}
},30000)

// Uses the module supplied by the V3 entry, not a hand-built replacement or a
// real game. No personal Chrome profile, model or resource download is involved.
test.skipIf(process.env.BGS_LAYOUT_BROWSER!=='1')('V3 consumer paints saved geometry/font mutations and applies the authored Camera',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bgs-v3-consumer-browser-'))
  const tools=await openAgentTools({workspacePath:root,getAuthToken:()=>undefined})
  const browserAccess=createPreviewTestBrowser()
  const source=await readFile(join(root,tools.directory,'content-consumer.mjs'),'utf8')
  const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(request){
    return new URL(request.url).pathname==='/consumer.mjs' ? new Response(source,{headers:{'Content-Type':'application/javascript'}})
      : new Response('<!doctype html><style>body{margin:0}</style><body></body>',{headers:{'Content-Type':'text/html'}})
  }})
  let driver:ReturnType<typeof Bun.spawn>|undefined
  try {
    const {endpoint}=await browserAccess.start()
    const probe=async()=>{
      const url='/consumer.mjs',lib=await import(url)
      const host=document.createElement('div');document.body.append(host)
      const data:any={rootId:'root',nodes:[
        {id:'root',role:'screen-root'},
        {id:'bar',parentId:'root',role:'container',layout:{anchorMin:[0,0],anchorMax:[1,0],sizeDelta:[0,48]}},
        {id:'label',parentId:'bar',role:'text',text:'Score',style:{fontSize:20},layout:{anchor:'top-left',position:[8,4],size:[120,40]}},
        {id:'action',parentId:'root',role:'button',text:'Go',actions:{click:'go'},layout:{anchor:'top-right',position:[-5,8],size:[40,30]}},
      ]}
      const surface=await lib.createProductionUiSurface(host),viewport={width:600,height:300}
      let clicks=0
      const options={onAction:()=>clicks++}
      const before=JSON.stringify(data);surface.render(data,viewport,options)
      const bar=()=>host.querySelector('[data-node-id="bar"]')!.getBoundingClientRect()
      const font=()=>getComputedStyle(host.querySelector('[data-node-id="label"]')!).fontSize
      const first={height:bar().height,font:font(),x:host.querySelector('[data-node-id="action"]')!.getBoundingClientRect().x}
      ;(host.querySelector('[data-node-id="action"]') as HTMLElement).click()
      const preserved=JSON.stringify(data)===before
      data.nodes[1].layout.sizeDelta[1]=72;data.nodes[2].style.fontSize=40
      surface.render(data,viewport,options);const changed={height:bar().height,font:font()}
      data.nodes[1].enabled=false;surface.render(data,viewport,options)
      const hidden=!host.querySelector('[data-node-id="bar"]')&&!host.querySelector('[data-node-id="label"]')
      const scene:any={cameraNodeId:'cam',settings:{coordinateSystem:{origin:'top-left',units:'logical-pixels',width:600,height:300,pixelsPerUnit:100}},nodes:[
        {id:'cam',transform:{position:[300,150,0]},components:[{id:'cam-c',type:'camera',data:{orthographic:true,orthographicSize:1.5,pixelsPerUnit:100,coordinateSpace:'logical-pixels',viewport,framing:'expand'}}]},
        {id:'group',transform:{position:[25,0,0]}},
        {id:'dot',parentId:'group',transform:{position:[100,100,0]},components:[{id:'dot-c',type:'sprite-renderer',data:{size:[20,20],color:'#ff0000'}}]},
      ]}
      const canvas=document.createElement('canvas');document.body.append(canvas)
      const sample=()=>{
        lib.renderProductionScene2d(canvas,scene,viewport)
        const point=lib.sceneNodeClientPoint2d(scene,'dot',viewport,{x:0,y:0,width:600,height:300})
        return {point,red:canvas.getContext('2d')!.getImageData(Math.round(point.x),Math.round(point.y),1,1).data[0]}
      }
      const initial=sample();scene.nodes[0].transform.position[0]+=20;const moved=sample()
      scene.nodes[0].components[0].data.orthographicSize=3;const zoomed=sample()
      surface.dispose()
      return {first,changed,preserved,hidden,clicks,initial,moved,zoomed}
    }
    // Node is also used by the existing production browser inspector. Bun's
    // WebSocket client cannot reliably complete Playwright's CDP handshake.
    const node=Bun.which('node');if(!node)throw Error('Installed Node required')
    const launched=Bun.spawn([node,'--input-type=module','-e',
      `const {chromium}=await import(process.env.BGS_PLAYWRIGHT_MODULE);const browser=await chromium.connectOverCDP(${JSON.stringify(endpoint)});try{const page=await browser.newPage();await page.goto(${JSON.stringify(server.url.origin)});console.log(JSON.stringify(await page.evaluate(${probe.toString()})))}finally{await browser.close()}`],
      {env:{PATH:process.env.PATH,BGS_PLAYWRIGHT_MODULE:sharedPlaywright().moduleUrl},stdout:'pipe',stderr:'pipe'})
    driver=launched
    const [output,errors,code]=await Promise.all([new Response(launched.stdout).text(),new Response(launched.stderr).text(),launched.exited])
    expect(code,errors).toBe(0);const result=JSON.parse(output)
    expect(result.first).toEqual({height:48,font:'20px',x:555})
    expect(result.changed).toEqual({height:72,font:'40px'})
    expect(result.preserved).toBe(true);expect(result.hidden).toBe(true);expect(result.clicks).toBe(1)
    expect(result.initial.red).toBe(255);expect(result.moved.red).toBe(255)
    expect(result.initial.point.x-result.moved.point.x).toBeCloseTo(20,4)
    // Independent expected projection: center (320,150), world point (125,100),
    // half-height 3*100=300 in a 600x300 viewport => scale 0.5.
    expect(result.zoomed.point.x).toBeCloseTo(202.5,4)
    expect(result.zoomed.point.y).toBeCloseTo(125,4)
    expect(result.zoomed.red).toBe(255)
  } finally {driver?.kill();await browserAccess.close();server.stop(true);await tools.close();await rm(root,{recursive:true,force:true})}
},30000)

test('existing layout CLI computes precise expectations from current saved bytes, not prose coordinates or a wide sample',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bgs-exact-source-'))
  const tools=await openAgentTools({workspacePath:root,getAuthToken:()=>undefined})
  try {
    const scene:any=sceneLayoutFixture()
    scene.data.nodes[0].transform={position:[480,270,0]}
    scene.data.nodes[1].transform.position=[337,210,0]
    scene.data.nodes[1].components=[{id:'board-visual',type:'sprite-renderer',data:{size:[20,20],color:'#ff0000'}}]
    const inspect=async()=>{
      const source=JSON.stringify(scene)
      await writeFile(join(root,'scene.json'),source)
      const output=await command(root,tools.directory,'check-content.mjs','--layout-draft','scene.json','960','540','--details')
      expect(output.code,output.stdout+output.stderr).toBe(0)
      const result=JSON.parse(output.stdout)
      expect(result.runtimeVerified).toBe(false)
      expect(JSON.stringify(result.inputLocation)).toContain(createHash('sha256').update(source).digest('hex'))
      expect(await readFile(join(root,'scene.json'),'utf8')).toBe(source)
      return result.nodes.find((node:any)=>node.id==='board').screenBounds
    }
    expect(await inspect()).toEqual({left:327,top:200,right:347,bottom:220})
    // Changed source center/zoom: scale .5, source point (337,210), camera
    // (510,270) => projected center (393.5,240), NOT a manually copied 373.5.
    scene.data.nodes[0].transform.position[0]=510
    scene.data.nodes[0].components[0].data.orthographicSize=5.4
    const bounds=await inspect()
    expect(bounds).toEqual({left:388.5,top:235,right:398.5,bottom:245})
    const actualCenter=(bounds.left+bounds.right)/2,wrongExpected=373.5
    expect(Math.abs(actualCenter-wrongExpected)).toBeLessThan(35) // broad 70px sample would conceal the defect
    expect(actualCenter).not.toBe(wrongExpected) // precise input-derived expectation does not
    expect((await command(root,tools.directory,'consumer.mjs','--help')).stdout).toContain('wide colored region')
  }finally{await tools.close();await rm(root,{recursive:true,force:true})}
},30000)

test('tool preparation refuses linked parent before writing outside the project', async () => {
  const root=await mkdtemp(join(tmpdir(),'bgs-agent-tools-link-')), outside=await mkdtemp(join(tmpdir(),'bgs-agent-tools-outside-'))
  try {
    await symlink(outside,join(root,'.beegame'))
    await expect(openAgentTools({workspacePath:root,getAuthToken:()=>undefined})).rejects.toThrow('link')
    await expect(access(join(outside,'tmp'))).rejects.toThrow()
    await rm(join(root,'.beegame')); await mkdir(join(root,'.beegame'))
    await symlink(outside,join(root,'.beegame/tmp'))
    await expect(openAgentTools({workspacePath:root,getAuthToken:()=>undefined})).rejects.toThrow('link')
  } finally { await rm(root,{recursive:true,force:true}); await rm(outside,{recursive:true,force:true}) }
})

test('optional Preview is published to the bound native session, lazy help works and close drains once', async () => {
  const root = await mkdtemp(join(tmpdir(),'bgs-agent-preview-'))
  let stops=0, closes=0, release!:()=>void
  const drained=new Promise<void>(resolve=>{release=resolve})
  const preview=openPreviewTestAccess({start:async()=>({status:'unsupported'}),status:()=>({status:'idle'}),
    stop(){stops++},browser:{start:async()=>{throw Error('Not started by preparation')},status:()=>({status:'not-running'}),
      close:async()=>{closes++;await drained}}})
  const tools=await openAgentTools({workspacePath:root,sessionId:'synthetic-preview',getAuthToken:()=>undefined,openPreview:()=>preview})
  try {
    const path=projectPreviewCapabilityPath(root,'synthetic-preview')
    expect(JSON.parse(await readFile(path,'utf8')).apiUrl).toBe(preview.baseUrl)
    expect(tools.turnContext).not.toContain(preview.baseUrl)
    expect(tools.turnContext.length).toBeLessThan(2600)
    expect((await command(root,tools.directory,'preview.mjs','--help')).stdout).toContain('POST /preview')
    expect((await fetch(preview.baseUrl+'/status')).status).toBe(200)
    const first=tools.close();expect(tools.close()).toBe(first)
    let finished=false;void first.then(()=>{finished=true})
    for(let i=0;i<100 && !closes;i++)await Bun.sleep(2)
    expect(closes).toBe(1);expect(finished).toBe(false)
    await expect(access(path)).rejects.toThrow()
    await expect(fetch(preview.baseUrl+'/status')).rejects.toThrow()
    release();await first;expect(stops).toBe(1)
  } finally {release();await tools.close();await rm(root,{recursive:true,force:true})}
},10000)

test('failed adapter preparation revokes an already opened Preview rather than leaking it', async () => {
  const root=await mkdtemp(join(tmpdir(),'bgs-agent-preview-failure-'));let closed=0
  const preview=openPreviewTestAccess({start:async()=>({status:'idle'}),status:()=>({status:'idle'}),stop(){closed++},
    browser:{start:async()=>{throw Error('Unused')},status:()=>({status:'not-running'}),close:async()=>{}}})
  try {
    await expect(openAgentTools({workspacePath:root,sessionId:'synthetic-preview',getAuthToken:()=>undefined,
      openPreview:async()=>{
        // Cause a real adapter write failure after capability publication.
        const {readdir}=await import('node:fs/promises')
        const directory=(await readdir(join(root,'.beegame/tmp')))[0]!
        await mkdir(join(root,'.beegame/tmp',directory,'preview.mjs'))
        return preview
      }})).rejects.toThrow()
    expect(closed).toBe(1)
    await expect(access(projectPreviewCapabilityPath(root,'synthetic-preview'))).rejects.toThrow()
    await expect(fetch(preview.baseUrl+'/status')).rejects.toThrow()
  }finally{await preview.close();await rm(root,{recursive:true,force:true})}
})
