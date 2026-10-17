import { test, expect } from 'bun:test'
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath, symlink } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { observeProjectCreation, installWebStarter, webStarterFiles } from './web-project-start'
import { registeredContentChecks, activeUserTask } from './agent-measurement'
import { createRun, type AgentTurn } from './state'
import { assertCommit } from './store'
import { agentGoalPrompt, focusedExecutionFacts } from './agent-goal'
import { sharedPlaywright } from '../shared-playwright'
import { CONTENT_CONSUMER_API } from '../game-content-consumer-cli'
import { assetManifestAuthoringExamples } from '../asset-manifest-authoring-contract'
import { writeBeeGameAssetManifest } from '../asset-contracts'
import sharp from 'sharp'

const brief = {creation_mode:'creative',build_source:null,game_user_visible_language:'zh',
  settings:{platform:'Web',engine:'React',dimension:'2D',orientation:'Landscape'}}
async function fixture(legacy = true) {
  const root = await realpath(await mkdtemp(join(tmpdir(),'bgs-web-start-test-')))
  const run = createRun({projectId:'sample',ownerId:'owner',workspacePath:root,chatSessionId:'chat',
    requestKey:'start',text:JSON.stringify(brief),constraints:brief.settings,ids:['goal']})
  run.creation = await observeProjectCreation(root,brief)
  if (legacy && run.creation) run.creation.initialDelivery = 'playable-slice'
  return {root,run,close:()=>rm(root,{recursive:true,force:true})}
}

test('creation facts require a blank creative intake; source/import/unknown/explicit exclusion are not silently migrated',async()=>{
  const f=await fixture(false)
  try {
    expect(f.run.creation).toEqual({initialDelivery:'design-led-first-version',editableContent:true,webStarter:'react-canvas-2d-v1',webBoot:'react-web-storage-v1'})
    for(const path of ['.beegame','transcripts','logs'])await mkdir(join(f.root,path))
    await writeFile(join(f.root,'logs/index.json'),'{}')
    expect(await observeProjectCreation(f.root,brief)).toEqual(f.run.creation)
    expect(await observeProjectCreation(f.root,{...brief,build_source:{kind:'import'}})).toBeUndefined()
    expect(await observeProjectCreation(f.root,{...brief,creation_mode:undefined})).toBeUndefined()
    expect(await observeProjectCreation(f.root,{...brief,settings:{...brief.settings,bgsVisualEditing:false}}))
      .toEqual({initialDelivery:'design-led-first-version',editableContent:false,webBoot:'react-web-storage-v1'})
    expect((await observeProjectCreation(f.root,{...brief,settings:{platform:'Native',engine:'Unity'}}))?.webStarter).toBeUndefined()
    await writeFile(join(f.root,'README.md'),'Existing user source')
    expect(await observeProjectCreation(f.root,brief)).toBeUndefined()
    await installWebStarter(f.run)
    expect(await readFile(join(f.root,'README.md'),'utf8')).toBe('Existing user source')
    await expect(readFile(join(f.root,'package.json'))).rejects.toThrow()
  }finally{await f.close()}
})

test('starter installs once, recovers exact partial writes, preserves edits and retains initial scope facts',async()=>{
  const f=await fixture()
  try {
    await installWebStarter(f.run)
    const before=await readFile(join(f.root,'src/game.js'),'utf8')
    expect(JSON.parse(await readFile(join(f.root,'src/bgs-content-api.json'),'utf8'))).toEqual(CONTENT_CONSUMER_API)
    expect(before).toContain('./bgs-content-api.json')
    await rm(join(f.root,'src/style.css'))
    await installWebStarter(f.run)
    expect(await readFile(join(f.root,'src/game.js'),'utf8')).toBe(before)
    await writeFile(join(f.root,'src/game.js'),'// user edit')
    await expect(installWebStarter(f.run)).rejects.toThrow('Existing project source preserved')
    expect(await readFile(join(f.root,'src/game.js'),'utf8')).toBe('// user edit')
    expect(agentGoalPrompt(f.run)).toContain('then end this turn for user feedback')
    expect(agentGoalPrompt(f.run)).toContain(f.run.requirements.text)
    const next=structuredClone(f.run); next.version++; delete next.creation
    expect(()=>assertCommit('sample','owner',f.run.version,next,f.run)).toThrow('creation facts')
  }finally{await f.close()}
})

test('starter rejects aliased destinations without writing through them',async()=>{
  const f=await fixture(),other=await fixture()
  try {
    await symlink(other.root,join(f.root,'src'))
    await expect(installWebStarter(f.run)).rejects.toThrow('Existing project source preserved')
    await expect(readFile(join(other.root,'game.js'))).rejects.toThrow()
  }finally{await f.close();await other.close()}
})

test('focused interrupted continuation retains the slice assignment; new user work keeps its own scope',async()=>{
  const f=await fixture()
  try {
    const first={attemptId:'first',requestKey:'start',status:'interrupted'} as AgentTurn
    const resumed={...first,attemptId:'again',message:{intent:'continue',continuationOf:'first',
      text:'Continue the interrupted work'}} as AgentTurn
    f.run.agentTurns=[first,resumed]
    expect(focusedExecutionFacts(f.run,[]).initialAssignment).toContain('then end this turn for user feedback')
    expect(activeUserTask(f.run,resumed)).toMatchObject({deliveryScope:'playable-slice'})
    resumed.message!.intent='work'
    expect(focusedExecutionFacts(f.run,[])).not.toHaveProperty('initialAssignment')
    expect(activeUserTask(f.run,resumed)).not.toHaveProperty('deliveryScope')
  }finally{await f.close()}
})

test('existing content check distinguishes required absence, exemption and valid connected starter',async()=>{
  const f=await fixture()
  try {
    expect(await registeredContentChecks(f.root,{},false)).toEqual([])
    expect(await registeredContentChecks(f.root,{},true)).toMatchObject([{id:'content-structure',status:'failed'}])
    await installWebStarter(f.run)
    for (const orientation of ['Landscape','Portrait'] as const) {
      const files=await webStarterFiles(orientation,'zh')
      for(const path of ['content/index.json','content/ui/hud.json','content/scenes/main.json'] as const)
        await writeFile(join(f.root,path),files[path])
      const checks=await registeredContentChecks(f.root,{orientation},true)
      expect(checks.find(c=>c.id==='content-structure')?.status).toBe('passed')
      expect(checks.find(c=>c.id==='content-layout')?.status).toBe('passed')
    }
    const index=JSON.parse(await readFile(join(f.root,'content/index.json'),'utf8'))
    index.documents=index.documents.filter((d:any)=>d.kind!=='ui-hud')
    index.files=index.files.filter((p:string)=>!p.startsWith('ui/'))
    await writeFile(join(f.root,'content/index.json'),JSON.stringify(index))
    expect((await registeredContentChecks(f.root,{},true))[0]).toMatchObject({id:'content-structure',status:'failed'})
    expect((await registeredContentChecks(f.root,{},false)).find(c=>c.id==='content-structure')?.status).toBe('passed')
  }finally{await f.close()}
},30000)

// Local synthetic connection test, never a game acceptance or a paid model run.
test.each(['procedural','resources','pure-ui'])('built starter consumes edited scene/UI data and dispatches actions through real React/Canvas: %s',async mode=>{
  const f=await fixture()
  const require=createRequire(new URL('../../../../../apps/frontend/package.json',import.meta.url))
  let browser: any, server: ReturnType<typeof Bun.serve>|undefined
  try {
    await installWebStarter(f.run)
    await mkdir(join(f.root,'node_modules'))
    for(const name of ['react','react-dom','vite'])
      await symlink(dirname(require.resolve(name+'/package.json')),join(f.root,'node_modules',name))
    // Exercise the shipped example itself, not a replacement game callback.
    const scene=JSON.parse(await readFile(join(f.root,'content/scenes/main.json'),'utf8'))
    scene.data.nodes[1].components[0].data.color='#224466'
    if (mode === 'resources') {
      const manifest = assetManifestAuthoringExamples().canonical
      manifest.project_target!.asset_format_capabilities = ['png','json','ttf']
      const base = manifest.resources[0]!
      const sheet = 'assets/runtime/example/sheet.png', atlas = 'assets/runtime/example/sheet.json'
      const font = 'assets/runtime/example/default.ttf', member = 'assets/runtime/example/member.ttf'
      await mkdir(join(f.root,'assets/runtime/example'),{recursive:true})
      await writeFile(join(f.root,sheet),await sharp(Buffer.from([255,0,0,255,0,255,0,255]),{raw:{width:2,height:1,channels:4}}).png().toBuffer())
      await writeFile(join(f.root,atlas),JSON.stringify({frames:{red:{frame:{x:0,y:0,w:1,h:1}},green:{frame:{x:1,y:0,w:1,h:1}}}}))
      const systemFont = process.platform === 'darwin' ? '/System/Library/Fonts/Supplemental/Arial.ttf' : '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
      await writeFile(join(f.root,font),await readFile(systemFont));await writeFile(join(f.root,member),await readFile(systemFont))
      await writeFile(join(f.root,'assets/runtime/example/unbound.png'),await readFile(join(f.root,sheet)))
      manifest.resources = [
        {...base,id:'atlas',root_path:sheet,file_paths:[sheet,atlas,'assets/runtime/example/unbound.png'],asset_kind:'sprite-sheet'},
        {...base,id:'font',root_path:font,file_paths:[font,member],asset_kind:'font'},
      ]
      await writeBeeGameAssetManifest(f.root,manifest)
      await mkdir(join(f.root,'assets/visual'),{recursive:true})
      await writeFile(join(f.root,'assets/visual/design.html'),'<main>Production-only reference</main>')
      scene.assetRefs = ['atlas']
      Object.assign(scene.data.nodes[1].components[0],{assetRef:'atlas'})
      Object.assign(scene.data.nodes[1].components[0].data,{member:sheet,frame:'green'})
      const ui=JSON.parse(await readFile(join(f.root,'content/ui/hud.json'),'utf8'))
      ui.assetRefs=['atlas','font']
      ui.data.nodes[1].data={font:{assetRef:'font',member}}
      ui.data.nodes[1].style.fontFamily='FixtureFont'
      ui.data.nodes[2].data={image:{assetRef:'atlas',member:sheet,frame:'red'}}
      await writeFile(join(f.root,'content/ui/hud.json'),JSON.stringify(ui))
    }
    await writeFile(join(f.root,'content/scenes/main.json'),JSON.stringify(scene))
    if (mode === 'pure-ui') {
      const index=JSON.parse(await readFile(join(f.root,'content/index.json'),'utf8'))
      index.entryScene='hud'
      index.files=['ui/hud.json']
      index.documents=index.documents.filter((d:any)=>d.kind==='ui-hud')
      await writeFile(join(f.root,'content/index.json'),JSON.stringify(index))
      await rm(join(f.root,'content/scenes'),{recursive:true})
      expect(index).not.toHaveProperty('documentRevision')
      expect(index).not.toHaveProperty('assetManifestRevision')
    }
    // Rendering alone previously hid the color-only Sprite/resource-check
    // contradiction. Exercise both sides of the shipped content contract.
    // The resource-loader fixture retains an unrelated example
    // production obligation; it does not establish that asset's delivery.
    if (mode !== 'resources') {
      const contentChecks = await registeredContentChecks(f.root,{},true)
      expect(contentChecks.filter(c=>c.status!=='passed')).toEqual([])
    }
    const build=Bun.spawn([process.execPath,join(dirname(require.resolve('vite/package.json')),'bin/vite.js'),'build'],
      {cwd:f.root,stdout:'pipe',stderr:'pipe'})
    const [code,stdout,stderr]=await Promise.all([build.exited,new Response(build.stdout).text(),new Response(build.stderr).text()])
    expect({code,stderr:code?stderr:'',stdout:code?stdout:''}).toEqual({code:0,stderr:'',stdout:''})
    server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request) {
      const path=new URL(request.url).pathname.replace(/^\/nested\//,'')
      if(path==='favicon.ico')return new Response(null,{status:204})
      if(path.includes('..'))return new Response(null,{status:400})
      const file=Bun.file(join(f.root,'dist',path||'index.html'))
      return await file.exists()?new Response(file):new Response(null,{status:404})
    }})
    const {chromium}=await import(sharedPlaywright().moduleUrl)
    browser=await chromium.launch({headless:true,executablePath:process.env.BGS_LAYOUT_BROWSER_EXECUTABLE ?? chromium.executablePath()})
    const page=await browser.newPage({viewport:{width:960,height:540}})
    const errors:string[]=[]
    page.on('pageerror',(e:Error)=>errors.push(e.message))
    await page.goto('http://127.0.0.1:'+server.port+'/nested/')
    await page.locator('[data-node-id=status]').waitFor()
    expect(await page.locator('[data-node-id=status]').innerText()).toBe('BGS · 0')
    const pixel=()=>page.locator('main > canvas').evaluate((c:any)=>Array.from(c.getContext('2d').getImageData(480,270,1,1).data))
    if(mode!=='pure-ui')expect(await pixel()).toEqual(mode==='resources'?[0,255,0,255]:[34,68,102,255])
    else expect(await Bun.file(join(f.root,'dist/content/scenes/main.json')).exists()).toBe(false)
    if(mode==='resources') {
      expect(await page.locator('[data-node-id=reset] canvas').evaluate((c:any)=>Array.from(c.getContext('2d').getImageData(10,10,1,1).data))).toEqual([255,0,0,255])
      expect(await page.locator('[data-node-id=status]').evaluate((el:Element)=>getComputedStyle(el).fontFamily)).toBe('FixtureFont')
      expect(await page.evaluate(()=>Array.from(document.fonts).some(face=>face.family==='FixtureFont'&&face.status==='loaded'))).toBe(true)
      expect(await Bun.file(join(f.root,'dist/assets/runtime/example/unbound.png')).exists()).toBe(true)
      expect(await Bun.file(join(f.root,'dist/assets/visual/design.html')).exists()).toBe(false)
    }
    await page.locator('[data-node-id=reset]').click()
    await page.waitForFunction(()=>document.querySelector('[data-node-id=status]')?.textContent==='BGS · 1')
    await page.locator('[data-node-id=reset]').click()
    await page.waitForFunction(()=>document.querySelector('[data-node-id=status]')?.textContent==='BGS · 2')
    const ui=JSON.parse(await readFile(join(f.root,'dist/content/ui/hud.json'),'utf8'))
    ui.data.nodes[1].style.fontSize=30
    await writeFile(join(f.root,'dist/content/ui/hud.json'),JSON.stringify(ui))
    scene.data.nodes[1].components[0].data.color='#663322'
    if(mode==='resources')scene.data.nodes[1].components[0].data.frame='red'
    if(mode!=='pure-ui')await writeFile(join(f.root,'dist/content/scenes/main.json'),JSON.stringify(scene))
    await page.reload()
    await page.waitForFunction(()=>document.querySelector('[data-node-id=status]')?.textContent==='BGS · 0')
    expect(await page.locator('[data-node-id=status]').evaluate((el:Element)=>getComputedStyle(el).fontSize)).toBe('30px')
    if(mode!=='pure-ui')expect(await pixel()).toEqual(mode==='resources'?[255,0,0,255]:[102,51,34,255])
    expect(errors).toEqual([])
    expect(await page.locator('[role=alert]').count()).toBe(0)
  }finally{await browser?.close();server?.stop(true);await f.close()}
},30000)
