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

const brief = {creation_mode:'creative',build_source:null,game_user_visible_language:'zh',
  settings:{platform:'Web',engine:'React',dimension:'2D',orientation:'Landscape'}}
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(),'bgs-web-start-test-')))
  const run = createRun({projectId:'sample',ownerId:'owner',workspacePath:root,chatSessionId:'chat',
    requestKey:'start',text:JSON.stringify(brief),constraints:brief.settings,ids:['goal']})
  run.creation = await observeProjectCreation(root,brief)
  return {root,run,close:()=>rm(root,{recursive:true,force:true})}
}

test('creation facts require a blank creative intake; source/import/unknown/explicit exclusion are not silently migrated',async()=>{
  const f=await fixture()
  try {
    expect(f.run.creation).toEqual({initialDelivery:'playable-slice',editableContent:true,webStarter:'react-canvas-2d-v1'})
    for(const path of ['.beegame','transcripts','logs'])await mkdir(join(f.root,path))
    await writeFile(join(f.root,'logs/index.json'),'{}')
    expect(await observeProjectCreation(f.root,brief)).toEqual(f.run.creation)
    expect(await observeProjectCreation(f.root,{...brief,build_source:{kind:'import'}})).toBeUndefined()
    expect(await observeProjectCreation(f.root,{...brief,creation_mode:undefined})).toBeUndefined()
    expect(await observeProjectCreation(f.root,{...brief,settings:{...brief.settings,bgsVisualEditing:false}}))
      .toEqual({initialDelivery:'playable-slice',editableContent:false})
    expect((await observeProjectCreation(f.root,{...brief,settings:{platform:'Native',engine:'Unity'}}))?.webStarter).toBeUndefined()
    await writeFile(join(f.root,'README.md'),'Existing user source')
    expect(await observeProjectCreation(f.root,brief)).toBeUndefined()
    await expect(installWebStarter(f.run)).rejects.toThrow('Existing project source preserved')
    expect(await readFile(join(f.root,'README.md'),'utf8')).toBe('Existing user source')
    await expect(readFile(join(f.root,'package.json'))).rejects.toThrow()
  }finally{await f.close()}
})

test('starter installs once, recovers exact partial writes, preserves edits and retains initial scope facts',async()=>{
  const f=await fixture()
  try {
    await installWebStarter(f.run)
    const before=await readFile(join(f.root,'src/game.js'),'utf8')
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
test('built starter consumes edited scene/UI data and dispatches actions through real React/Canvas',async()=>{
  const f=await fixture()
  const require=createRequire(new URL('../../../../../apps/frontend/package.json',import.meta.url))
  let browser: any, server: ReturnType<typeof Bun.serve>|undefined
  try {
    await installWebStarter(f.run)
    await mkdir(join(f.root,'node_modules'))
    for(const name of ['react','react-dom','vite'])
      await symlink(dirname(require.resolve(name+'/package.json')),join(f.root,'node_modules',name))
    // A synthetic game callback verifies the extension point; no project answers.
    await writeFile(join(f.root,'src/game.js'),`export function createGame({scene}) {
      const state={status:String(scene.settings.value)};
      return {state,update(){},draw(){},action(){state.status=String(Number(state.status)+1)},dispose(){}};
    }`)
    const scene=JSON.parse(await readFile(join(f.root,'content/scenes/main.json'),'utf8'))
    scene.data.settings.value=7
    scene.data.nodes[1].components[0].data.color='#224466'
    await writeFile(join(f.root,'content/scenes/main.json'),JSON.stringify(scene))
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
    expect(await page.locator('[data-node-id=status]').innerText()).toBe('7')
    const pixel=()=>page.locator('canvas').evaluate((c:any)=>Array.from(c.getContext('2d').getImageData(480,270,1,1).data))
    expect(await pixel()).toEqual([34,68,102,255])
    await page.locator('[data-node-id=reset]').click()
    await page.waitForFunction(()=>document.querySelector('[data-node-id=status]')?.textContent==='8')
    const ui=JSON.parse(await readFile(join(f.root,'dist/content/ui/hud.json'),'utf8'))
    ui.data.nodes[1].style.fontSize=30
    await writeFile(join(f.root,'dist/content/ui/hud.json'),JSON.stringify(ui))
    scene.data.settings.value=11
    scene.data.nodes[1].components[0].data.color='#663322'
    await writeFile(join(f.root,'dist/content/scenes/main.json'),JSON.stringify(scene))
    await page.reload()
    await page.waitForFunction(()=>document.querySelector('[data-node-id=status]')?.textContent==='11')
    expect(await page.locator('[data-node-id=status]').evaluate((el:Element)=>getComputedStyle(el).fontSize)).toBe('30px')
    expect(await pixel()).toEqual([102,51,34,255])
    expect(errors).toEqual([])
    expect(await page.locator('[role=alert]').count()).toBe(0)
  }finally{await browser?.close();server?.stop(true);await f.close()}
},30000)
