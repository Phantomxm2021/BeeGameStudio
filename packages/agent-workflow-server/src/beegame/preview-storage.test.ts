import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createPreviewStorageStore } from './preview-storage-store'
import { createGameStorage, handlePreviewStorageRequest, PREVIEW_STORAGE_PATH, PREVIEW_STORAGE_HEADER, PREVIEW_STORAGE_VERSION } from './preview-storage.mjs'
import { createMeasuredPreview } from './workflow-v3/measured-preview'
import { createRun } from './workflow-v3/state'
import { createPreviewCapabilityManager } from '../auth/preview-capability'
import { previewTestHostDocument } from './preview-test-access'
import { sharedPlaywright } from './shared-playwright'
import { bundleContentConsumer } from './game-content-consumer-cli'
import { runChecks } from './workflow-v3/checker-test-driver'

test('Preview saves survive store recreation, isolate both identity axes, enforce atomic quotas and do not follow directory aliases',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-preview-saves-')))
  let store:ReturnType<typeof createPreviewStorageStore>|undefined
  try {
    store=createPreviewStorageStore(root)
    const a=store.forProject('alice','one'),b=store.forProject('bob','one'),c=store.forProject('alice','two')
    a.setItem('best','42');b.setItem('best','7');c.setItem('best','9')
    a.setItem('__proto__','literal key');a.setItem('empty','')
    expect(a.getItem('empty')).toBe('');expect(a.getItem('missing')).toBeNull()
    expect(()=>a.setItem('best','x'.repeat(65537))).toThrow('64 KiB')
    expect(a.getItem('best')).toBe('42')
    for(let i=0;i<3;i++)a.setItem('large-'+i,'x'.repeat(65536))
    expect(()=>a.setItem('large-3','x'.repeat(65536))).toThrow('quota')
    expect(a.getItem('large-3')).toBeNull()
    const limited=store.forProject('alice','keys')
    for(let i=0;i<128;i++)limited.setItem('k'+i,'')
    expect(()=>limited.setItem('overflow','')).toThrow('quota')
    limited.setItem('k0',null);limited.setItem('replacement','ok')
    expect(limited.getItem('replacement')).toBe('ok')
    store.close();store=createPreviewStorageStore(root)
    expect(store.forProject('alice','one').getItem('best')).toBe('42')
    expect(store.forProject('bob','one').getItem('best')).toBe('7')
    expect(store.forProject('alice','two').getItem('best')).toBe('9')
    expect(store.forProject('alice','one').getItem('__proto__')).toBe('literal key')
    store.forProject('alice','one').setItem('best',null)
    expect(store.forProject('alice','one').getItem('best')).toBeNull()
    expect(store.forProject('bob','one').getItem('best')).toBe('7')
    const alias=join(root,'alias');await mkdir(alias);await symlink(join(root,'preview-saves'),join(alias,'preview-saves'))
    expect(()=>createPreviewStorageStore(alias)).toThrow('cannot be an alias')
  }finally{store?.close();await rm(root,{recursive:true,force:true})}
})

test('save HTTP contract rejects scope spoofing, non-opaque foreign origins, malformed/oversized requests and failed durability',async()=>{
  const entries=new Map<string,string>(),store={getItem:(key:string)=>entries.get(key)??null,setItem:(key:string,value:string|null)=>{if(value===null)entries.delete(key);else entries.set(key,value)}}
  const url='https://cap.preview.test'+PREVIEW_STORAGE_PATH
  const send=(body:unknown,origin='null',method='POST')=>handlePreviewStorageRequest(new Request(url,{method,headers:{'content-type':'application/json',origin},body:JSON.stringify(body)}),store)
  expect((await send({key:'best',value:'10'})).status).toBe(200)
  expect((await send({key:'best',value:'stolen',userId:'bob'})).status).toBe(400)
  expect((await send({key:'best',value:'evil'},'https://foreign.test')).status).toBe(403)
  expect((await send({key:'',value:'x'})).status).toBe(400)
  expect((await send({key:'best',value:{score:1}})).status).toBe(400)
  expect((await send({key:'best',value:'x'.repeat(65537)})).status).toBe(413)
  expect((await send({key:'best',value:'x'.repeat(400000)})).status).toBe(413)
  expect(entries.get('best')).toBe('10')
  expect((await handlePreviewStorageRequest(new Request(url+'?key=best&projectId=other'),store)).status).toBe(400)
  expect((await handlePreviewStorageRequest(new Request(url,{method:'OPTIONS',headers:{origin:'null'}}),store)).status).toBe(204)
  const failure=await handlePreviewStorageRequest(new Request(url,{method:'POST',headers:{'content-type':'application/json'},body:'{"key":"best","value":"11"}'}),
    {...store,setItem(){throw Error('private database location')}})
  expect(failure.status).toBe(503);expect(await failure.text()).not.toContain('private database')
  const client=await createGameStorage('https://cap.preview.test/index.html',async(_input,init)=>init?.method==='HEAD'
    ?new Response(null,{headers:{[PREVIEW_STORAGE_HEADER]:PREVIEW_STORAGE_VERSION}}):failure.clone())
  await expect(client.setItem('best','11')).rejects.toThrow('HTTP 503')
  await expect(client.setItem('best',null as any)).rejects.toThrow('requires a string')
})

const gameHtml='<!doctype html><output id="best">Loading</output><button id="save">Save</button><script type="module">'+
  'import {createGameStorage} from "./consumer.mjs";const saves=await createGameStorage();window.saves=saves;'+
  'document.querySelector("#best").textContent=(await saves.getItem("best"))??"EMPTY";'+
  'document.querySelector("#save").onclick=async()=>{await saves.setItem("best","42");document.querySelector("#best").textContent=await saves.getItem("best")};</script>'

test('opaque Preview preserves saves across new browsers, Chat sessions and server stores, without host or deployment storage access',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-save-browser-'))),workspace=join(root,'project')
  let storage:ReturnType<typeof createPreviewStorageStore>|undefined,preview:ReturnType<typeof createMeasuredPreview>|undefined,browser:any,viewUrl=''
  const runs=new Map<string,ReturnType<typeof createRun>>()
  const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
    const url=new URL(request.url)
    if(url.hostname==='localhost'&&url.pathname==='/host')return new Response(previewTestHostDocument(new URL(viewUrl)).body,{headers:{'content-type':'text/html'}})
    if(url.hostname==='localhost'&&url.pathname.startsWith('/deployment/')) {
      const file=url.pathname.endsWith('consumer.mjs')?'consumer.mjs':'index.html'
      return new Response(await readFile(join(workspace,'dist',file)),{headers:{'content-type':file.endsWith('.mjs')?'text/javascript':'text/html'}})
    }
    return await preview?.handle(request)??new Response('No host API',{status:404})
  }})
  const origin='http://localhost:'+server.port
  const recreate=()=>{
    preview?.dispose();storage?.close();storage=createPreviewStorageStore(join(root,'host-data'))
    preview=createMeasuredPreview({origin,capabilities:createPreviewCapabilityManager(),storage,
      readRun:async(project,user)=>runs.get(JSON.stringify([user,project])),isBusy:()=>false})
  }
  try {
    await mkdir(join(workspace,'dist'),{recursive:true})
    await writeFile(join(workspace,'dist/index.html'),gameHtml)
    await writeFile(join(workspace,'dist/consumer.mjs'),await bundleContentConsumer())
    const make=(user:string,project:string)=>{
      const run=createRun({projectId:project,ownerId:user,workspacePath:workspace,chatSessionId:crypto.randomUUID(),requestKey:'fixture',text:'Synthetic',constraints:{},ids:['save']})
      runs.set(JSON.stringify([user,project]),run);return run
    }
    recreate()
    let run=make('alice','one');viewUrl=(await preview!.openCandidate(run)).url
    const oldUrl=viewUrl
    const {chromium}=await import(sharedPlaywright().moduleUrl)
    browser=await chromium.launch({headless:true,executablePath:process.env.BGS_LAYOUT_BROWSER_EXECUTABLE??chromium.executablePath()})
    let context=await browser.newContext(),page=await context.newPage()
    await page.goto(origin+'/host')
    let frame=page.frameLocator('#beegame-preview')
    await expectText(frame,'EMPTY');await frame.locator('#save').click();await expectText(frame,'42')
    expect(await frame.locator('body').evaluate(()=>({origin:globalThis.origin,native:(()=>{try{localStorage.setItem('secret','x');return true}catch{return false}})(),
      parent:(()=>{try{return Boolean(parent.document.body)}catch{return false}})()}))).toEqual({origin:'null',native:false,parent:false})
    const bytes=await readFile(join(workspace,'dist/index.html'),'utf8')
    expect(await (await preview!.handle(new Request(viewUrl)))!.text()).toBe(bytes)
    await context.close();await browser.close();browser=undefined
    // Recreate both the backing store and manager, then replace the Chat/Run.
    recreate();run=make('alice','one');viewUrl=(await preview!.openCandidate(run)).url
    expect(viewUrl).not.toBe(oldUrl)
    expect((await preview!.handle(new Request(new URL(PREVIEW_STORAGE_PATH+'?key=best',oldUrl))))!.status).toBe(404)
    browser=await chromium.launch({headless:true,executablePath:process.env.BGS_LAYOUT_BROWSER_EXECUTABLE??chromium.executablePath()})
    context=await browser.newContext();page=await context.newPage();await page.goto(origin+'/host')
    frame=page.frameLocator('#beegame-preview');await expectText(frame,'42')
    await page.goto(origin+'/deployment/index.html')
    await expectText(page,'EMPTY');await page.evaluate(async()=>{await (window as any).saves.setItem('best','999')})
    await page.reload();await expectText(page,'999')
    await page.goto(origin+'/host');await expectText(page.frameLocator('#beegame-preview'),'42')
    for(const [user,project] of [['bob','one'],['alice','two']]) {
      viewUrl=(await preview!.openCandidate(make(user!,project!))).url
      await page.goto(origin+'/host');await expectText(page.frameLocator('#beegame-preview'),'EMPTY')
    }
    // A request whose body arrives only after its capability was closed cannot save.
    const last=runs.get(JSON.stringify(['alice','two']))!,id=new URL(viewUrl).hostname.split('.')[0]!
    let finish!:()=>void
    const body=new ReadableStream<Uint8Array>({start(controller){finish=()=>{controller.enqueue(new TextEncoder().encode('{"key":"late","value":"bad"}'));controller.close()}}})
    const pending=preview!.handle(new Request(new URL(PREVIEW_STORAGE_PATH,viewUrl),{method:'POST',headers:{'content-type':'application/json'},body}))
    preview!.closeCandidate(last.projectId,last.ownerId,id);finish()
    expect((await pending)!.status).toBe(409)
    expect(storage!.forProject('alice','two').getItem('late')).toBeNull()
    expect(await readFile(join(workspace,'dist/index.html'),'utf8')).toBe(gameHtml)
  }finally{await browser?.close();preview?.dispose();storage?.close();server.stop(true);await rm(root,{recursive:true,force:true})}
},30000)

async function expectText(surface:any,text:string) {
  await surface.locator('#best').filter({hasText:text}).waitFor({timeout:5000})
  expect(await surface.locator('#best').textContent()).toBe(text)
}

test('measurement provides the same async storage contract in a disposable namespace, without persisting test writes',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-measure-saves-')))
  try {
    await mkdir(join(root,'dist'))
    await writeFile(join(root,'dist/consumer.mjs'),await bundleContentConsumer())
    await writeFile(join(root,'dist/index.html'),'<!doctype html><output>Loading</output><script type="module">import {createGameStorage} from "./consumer.mjs";'+
      'const s=await createGameStorage();if(await s.getItem("best")!==null)throw Error("Leaked saved test state");await s.setItem("best","123");'+
      'if(await s.getItem("best")!=="123")throw Error("Save failed");document.querySelector("output").textContent="Measured";</script>')
    const task:any={id:'storage-smoke',kind:'game.verify',goal:'Synthetic',dependsOn:[],requirementIds:['save'],inputs:[],writablePaths:[],expectedOutputs:['dist/index.html'],runtimeArtifact:'dist',checks:['runtime-smoke']}
    for(let i=0;i<2;i++) {
      const result=(await runChecks(root,task,[])).checks[0]!
      expect(result.status,result.observation).toBe('passed')
      expect(JSON.parse(result.observation).environment.storage).toBe('disposable-preview')
    }
    expect(await Bun.file(join(root,'preview-saves/saves.sqlite')).exists()).toBe(false)
  }finally{await rm(root,{recursive:true,force:true})}
},30000)
