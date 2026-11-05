import { test, expect } from 'bun:test'
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath, symlink } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { observeProjectCreation } from './web-project-start'
import { webStarterFiles, writeWebContentFixture } from '../fixtures/web-content-fixture'
import { initialProductionAssignment } from './production-workflow'
import { activeUserTask } from './agent-measurement'
import { runContentCheck } from './content-checks'
import { createRun, type AgentTurn } from './state'
import { agentGoalPrompt, focusedExecutionFacts } from './agent-goal'
import { sharedPlaywright } from '../shared-playwright'
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

test('creation facts cover blank creative and blueprint intake; source/import/unknown are not silently migrated',async()=>{
  const f=await fixture(false)
  try {
    expect(f.run.creation).toEqual({initialDelivery:'complete-game',editableContent:false})
    for(const path of ['.beegame','.beegame-attachments','transcripts','logs'])await mkdir(join(f.root,path))
    await writeFile(join(f.root,'.gitignore'),'# Git configuration is not game source\nnode_modules/\n')
    await writeFile(join(f.root,'logs/index.json'),'{}')
    await writeFile(join(f.root,'.beegame-attachments/brief.txt'),'Reference input, not imported project source')
    expect(await observeProjectCreation(f.root,brief)).toEqual(f.run.creation)
    expect(await observeProjectCreation(f.root,{...brief,creation_mode:'blueprint'})).toEqual(f.run.creation)
    expect(await observeProjectCreation(f.root,{...brief,build_source:{kind:'import'}})).toBeUndefined()
    expect(await observeProjectCreation(f.root,{...brief,creation_mode:undefined})).toBeUndefined()
    expect(await observeProjectCreation(f.root,{...brief,creation_mode:'unknown'})).toBeUndefined()
    expect(await observeProjectCreation(f.root,{...brief,settings:{...brief.settings,bgsVisualEditing:false}}))
      .toEqual({initialDelivery:'complete-game',editableContent:false})
    expect((await observeProjectCreation(f.root,{...brief,settings:{platform:'Native',engine:'Unity'}}))?.webStarter).toBeUndefined()
    await writeFile(join(f.root,'README.md'),'Existing user source')
    expect(await observeProjectCreation(f.root,brief)).toBeUndefined()
    expect(await observeProjectCreation(f.root,{...brief,creation_mode:'blueprint'})).toBeUndefined()
    expect(await readFile(join(f.root,'README.md'),'utf8')).toBe('Existing user source')
    await expect(readFile(join(f.root,'package.json'))).rejects.toThrow()
    await rm(join(f.root,'README.md'))
    await rm(join(f.root,'.gitignore'))
    await symlink(join(f.root,'logs/index.json'),join(f.root,'.gitignore'))
    expect(await observeProjectCreation(f.root,brief)).toBeUndefined()
    await rm(join(f.root,'.gitignore'))
    await rm(join(f.root,'.beegame-attachments'),{recursive:true})
    await symlink(join(f.root,'.beegame'),join(f.root,'.beegame-attachments'))
    expect(await observeProjectCreation(f.root,brief)).toBeUndefined()
  }finally{await f.close()}
})

test.each(['React','Phaser','Three.js','Unity','Godot','Unreal'])('new-game creation does not impose browser acceptance: %s',async engine=>{
  const f=await fixture(false)
  try{
    const creation=await observeProjectCreation(f.root,{...brief,settings:{...brief.settings,engine}})
    expect(creation).toEqual({initialDelivery:'complete-game',editableContent:false})
    const assignment=initialProductionAssignment({...f.run,productionWorkflow:1,creation})
    expect(assignment).toEqual({stage:'design',originRequestKey:f.run.requestKey,stopAfter:'implementation'})
  }finally{await f.close()}
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

test('explicit legacy document checks validate only the supplied sources',async()=>{
  const f=await fixture()
  const task={expectedOutputs:['content/ui/hud.json','content/scenes/main.json']}
  try {
    const missing=await runContentCheck(f.root,'content-structure',task,[],{})
    expect(missing.status).toBe('failed')
    await writeWebContentFixture(f.root)
    for (const orientation of ['Landscape','Portrait'] as const) {
      const files=await webStarterFiles(orientation,'zh')
      for(const path of ['content/index.json','content/ui/hud.json','content/scenes/main.json'] as const)
        await writeFile(join(f.root,path),files[path])
      for(const id of ['content-structure','content-layout'] as const) {
        const checked=await runContentCheck(f.root,id,task,[],{orientation})
        expect(checked.status,checked.observation).toBe('passed')
      }
    }
    await writeFile(join(f.root,'content/ui/hud.json'),'{invalid')
    expect((await runContentCheck(f.root,'content-structure',task,[],{})).status).toBe('failed')
  }finally{await f.close()}
},30000)

// Local synthetic connection test, never a game acceptance or a paid model run.
test.each(['procedural','resources','pure-ui'])('test-authored Web content consumes edited scene/UI data and dispatches actions through real React/Canvas: %s',async mode=>{
  const f=await fixture()
  const require=createRequire(new URL('../../../../../apps/frontend/package.json',import.meta.url))
  let browser: any, server: ReturnType<typeof Bun.serve>|undefined
  try {
    await writeWebContentFixture(f.root)
    await mkdir(join(f.root,'node_modules'))
    for(const name of ['react','react-dom','vite'])
      await symlink(dirname(require.resolve(name+'/package.json')),join(f.root,'node_modules',name))
    // Exercise the optional consumer against the test-authored application.
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
      const index=JSON.parse(await readFile(join(f.root,'content/index.json'),'utf8'))
      const contentChecks = await Promise.all((['content-structure','content-layout','content-resources'] as const)
        .map(id=>runContentCheck(f.root,id,{expectedOutputs:index.files.map((path:string)=>'content/'+path)},[],{})))
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
    const errors:string[]=[],requested:string[]=[]
    page.on('request',(request:{url():string})=>requested.push(new URL(request.url()).pathname))
    page.on('pageerror',(e:Error)=>errors.push(e.message))
    await page.goto('http://127.0.0.1:'+server.port+'/nested/')
    await page.locator('[data-node-id=status]').waitFor()
    expect(await page.locator('[data-node-id=status]').innerText()).toBe('BGS · 0')
    const pixel=()=>page.locator('main > canvas').evaluate((c:any)=>Array.from(c.getContext('2d').getImageData(480,270,1,1).data))
    // Resource pixels also consume the saved Sprite tint (#224466, later #663322).
    if(mode!=='pure-ui')expect(await pixel()).toEqual(mode==='resources'?[0,68,0,255]:[34,68,102,255])
    else expect(await Bun.file(join(f.root,'dist/content/scenes/main.json')).exists()).toBe(false)
    if(mode==='resources') {
      expect(await page.locator('[data-node-id=reset] canvas').evaluate((c:any)=>Array.from(c.getContext('2d').getImageData(10,10,1,1).data))).toEqual([255,0,0,255])
      // A bound resource takes precedence over the fallback family string.
      expect(requested).toContain('/nested/assets/runtime/example/member.ttf')
      expect(requested).not.toContain('/nested/assets/runtime/example/default.ttf')
      expect(await page.locator('[data-node-id=status]').evaluate((el:Element)=>{
        const family=getComputedStyle(el).fontFamily.replaceAll('"','')
        return Array.from(document.fonts).some(face=>face.family===family&&face.status==='loaded')
      })).toBe(true)
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
    if(mode!=='pure-ui')expect(await pixel()).toEqual(mode==='resources'?[102,0,0,255]:[102,51,34,255])
    expect(errors).toEqual([])
    expect(await page.locator('[role=alert]').count()).toBe(0)
  }finally{await browser?.close();server?.stop(true);await f.close()}
},30000)

test('source-only React UI builds and responds in a browser without BGS Scene/UI documents',async()=>{
  const f=await fixture(false)
  const require=createRequire(new URL('../../../../../apps/frontend/package.json',import.meta.url))
  let browser:any,server:ReturnType<typeof Bun.serve>|undefined
  try {
    await mkdir(join(f.root,'node_modules'))
    for(const name of ['react','react-dom'])
      await symlink(dirname(require.resolve(name+'/package.json')),join(f.root,'node_modules',name))
    await writeFile(join(f.root,'game.js'),`import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
function Game(){const [count,setCount]=useState(0);return React.createElement('button',{
onClick:()=>setCount(count+1),style:{transform:'translateX('+count*20+'px)',transition:'transform 100ms linear'}},'Score '+count)}
createRoot(document.getElementById('root')).render(React.createElement(Game));`)
    const build=await Bun.build({entrypoints:[join(f.root,'game.js')],outdir:join(f.root,'dist'),target:'browser'})
    expect(build.success).toBe(true)
    await writeFile(join(f.root,'dist/index.html'),'<html><body><div id="root"></div><script type="module" src="./game.js"></script></body></html>')
    expect(await Bun.file(join(f.root,'content/index.json')).exists()).toBe(false)
    expect(f.run.creation?.editableContent).toBe(false)
    server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(request){
      const path=new URL(request.url).pathname
      if(path==='/favicon.ico')return new Response(null,{status:204})
      return new Response(Bun.file(join(f.root,'dist',path==='/'?'index.html':path.slice(1))))
    }})
    const {chromium}=await import(sharedPlaywright().moduleUrl)
    browser=await chromium.launch({headless:true,executablePath:process.env.BGS_LAYOUT_BROWSER_EXECUTABLE??chromium.executablePath()})
    const page=await browser.newPage(),errors:string[]=[]
    page.on('pageerror',(e:Error)=>errors.push(e.message))
    await page.goto('http://127.0.0.1:'+server.port)
    const button=page.getByRole('button',{name:'Score 0'})
    await button.click()
    await page.waitForFunction(()=>document.querySelector('button')?.textContent==='Score 1' &&
      getComputedStyle(document.querySelector('button')!).transform==='matrix(1, 0, 0, 1, 20, 0)')
    expect(errors).toEqual([])
    expect(f.run.creation?.editableContent).toBe(false)
    expect(initialProductionAssignment({...f.run,productionWorkflow:1})).not.toHaveProperty('browserVerification')
  } finally { await browser?.close();server?.stop(true);await f.close() }
},30000)
