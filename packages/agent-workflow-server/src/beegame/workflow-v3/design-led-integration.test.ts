import { test, expect } from 'bun:test'
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { createRun, digest, type AgentTurn } from './state'
import { createLocalWorkflowStore } from './store'
import { createAgentMeasurement } from './agent-measurement'
import { openAgentTools } from './agent-tools'
import { observeProjectCreation, installWebStarter } from './web-project-start'
import { projectPreviewCapabilityPath } from '../project-preview-capability'
import { writeDesignDocumentsFixture, designRequirementChecksFixture } from '../fixtures/layout-fixture'
import { DESIGN_ACCEPTANCE_PATH } from '../design-handoff'
import { inspectDesignAcceptance } from '../runtime-acceptance'
import { agentTurnHandoffReason } from './agent-goal'
import { writeBeeGameAssetManifest } from '../asset-contracts'
import { assetManifestAuthoringExamples } from '../asset-manifest-authoring-contract'
import { sharedPlaywright } from '../shared-playwright'

// A new-policy project, not the legacy starter. The authored fixture explicitly
// wires the public helpers; this proves integration, not model design ability.
test('new design-led project installs public helpers and consumes its registered resources in a nested build', async () => {
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-new-design-integration-')))
  const workspace=join(root,'project')
  await mkdir(workspace)
  const brief={creation_mode:'creative',build_source:null,game_user_visible_language:'zh',
    settings:{platform:'Web',engine:'React',dimension:'2D',orientation:'Landscape'}}
  const run=createRun({projectId:'new-design',ownerId:'owner',workspacePath:workspace,chatSessionId:'chat',
    requestKey:'goal',text:JSON.stringify(brief),constraints:brief.settings,ids:['goal']})
  run.creation=await observeProjectCreation(workspace,brief)
  const turn:AgentTurn={attemptId:crypto.randomUUID(),requestKey:'goal',sessionId:'chat',workerId:'fixture',
    fence:1,status:'running',startedAt:new Date().toISOString(),requirementsRevision:run.requirements.revision}
  run.agentTurns=[turn];run.fence=1;run.writer={attemptId:turn.attemptId,workerId:turn.workerId,fence:1}
  const store=createLocalWorkflowStore(join(root,'host'))
  await store.commit(run.projectId,run.ownerId,0,run,'fixture')
  const visual=await sharp({create:{width:960,height:540,channels:4,background:'#123456'}}).png().toBuffer()

  const measurement=createAgentMeasurement({run,turn,store})
  let tools:Awaited<ReturnType<typeof openAgentTools>>|undefined
  let browser:any,server:ReturnType<typeof Bun.serve>|undefined
  try {
    expect(run.creation?.initialDelivery).toBe('design-led-first-version')
    await installWebStarter(run)
    expect(await Bun.file(join(workspace,'package.json')).exists()).toBe(false)
    expect(await Bun.file(join(workspace,'content/index.json')).exists()).toBe(false)
    tools=await openAgentTools({workspacePath:workspace,sessionId:'chat',getAuthToken:()=>undefined,measurement,
      requireEditableContent:run.creation?.editableContent})
    const command=async(entry:string,...args:string[])=>{
      const child=Bun.spawn([process.execPath,join(workspace,tools!.directory,entry),...args],{cwd:workspace,
        env:{...process.env,BEEGAME_MEASUREMENT_CAPABILITY_FILE:projectPreviewCapabilityPath(workspace,'chat','measurement')},
        stdout:'pipe',stderr:'pipe'})
      const [code,out,error]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()])
      const result=JSON.parse(out)
      expect({code,error}).toEqual({code:result.valid===false?1:0,error:''})
      return result
    }
    await writeDesignDocumentsFixture(workspace)
    for(const path of ['src','scripts','assets/visual','assets/runtime','content/ui','content/scenes'])
      await mkdir(join(workspace,path),{recursive:true})
    await writeFile(join(workspace,'assets/visual/design.png'),visual)
    for(const name of ['UI_UX_SPEC.md','LEVEL_SCENE_DESIGN.md'])
      await writeFile(join(workspace,'docs',name),await readFile(join(workspace,'docs',name),'utf8')+'\n[Selected](../assets/visual/design.png)\n')
    expect((await command('handoff.mjs','--design','finalize')).valid).toBe(true)
    expect((await command('handoff.mjs','--design','baseline')).valid).toBe(true)
    await command('consumer.mjs','--install','src/consumer.mjs')
    await command('consumer.mjs','--install-runtime-files','scripts/runtime-files.mjs')
    const manifest=assetManifestAuthoringExamples().canonical
    manifest.project_target!.asset_format_capabilities=['png','json']
    const sheet='assets/runtime/sheet.png',atlas='assets/runtime/sheet.json',unbound='assets/runtime/unbound.png'
    await writeFile(join(workspace,sheet),await sharp(Buffer.from([255,0,0,255,0,255,0,255]),{raw:{width:2,height:1,channels:4}}).png().toBuffer())
    await writeFile(join(workspace,unbound),await readFile(join(workspace,sheet)))
    await writeFile(join(workspace,atlas),JSON.stringify({frameWidth:1,frameHeight:1,framesPerFacing:1,facings:['right','left']}))
    manifest.resources=[{...manifest.resources[0]!,id:'atlas',root_path:sheet,file_paths:[sheet,atlas,unbound],asset_kind:'sprite-sheet'}]
    await writeBeeGameAssetManifest(workspace,manifest)
    const scene={schema:'beegame-content.v1',id:'scene',kind:'scene-2d',assetRefs:['atlas'],data:{
      cameraNodeId:'camera',settings:{coordinateSystem:{origin:'top-left',units:'logical-pixels',width:960,height:540,pixelsPerUnit:100}},
      nodes:[{id:'camera',transform:{position:[480,270,0]},components:[{id:'camera',type:'camera',data:{orthographic:true,orthographicSize:2.7,
        coordinateSpace:'logical-pixels',viewport:{width:960,height:540},framing:'expand'}}]},
      {id:'image',transform:{position:[480,270,0]},components:[{id:'image',type:'sprite-renderer',assetRef:'atlas',
        data:{size:[960,540],member:sheet,frame:'left'}}]}]}}
    const ui={schema:'beegame-content.v1',id:'ui',kind:'ui-screen',assetRefs:['atlas'],data:{rootId:'root',nodes:[
      {id:'root',role:'screen-root',layout:{size:[960,540]},data:{referenceResolution:[960,540],targetViewports:[[960,540]]}},
      {id:'button',parentId:'root',role:'button',text:'Go',actions:{click:'go'},layout:{anchor:'top-left',position:[20,20],size:[100,50]},
        data:{image:{assetRef:'atlas',member:sheet,frame:'right'}}},
      {id:'status',parentId:'root',role:'text',bindings:{text:'status'},layout:{anchor:'top-left',position:[20,90],size:[200,50]},
        style:{fontSize:20,color:'#ffffff'}}]}}
    // These are exactly the files already linked by the owning documents.
    const scenePath='content/scenes/level.json',uiPath='content/ui/menu.json'
    await writeFile(join(workspace,scenePath),JSON.stringify(scene))
    await writeFile(join(workspace,uiPath),JSON.stringify(ui))
    await writeFile(join(workspace,'content/index.json'),JSON.stringify({schema:'beegame-content-package.v2',id:'fixture',
      dimension:'2d',sceneModel:'game-object-v2',documentRevision:digest(JSON.stringify([scene,ui])),assetManifestRevision:digest(JSON.stringify(manifest)),
      entryScene:'scene',files:['scenes/level.json','ui/menu.json'],documents:[
        {id:'scene',path:'scenes/level.json',kind:'scene-2d',loadPhase:'startup'},{id:'ui',path:'ui/menu.json',kind:'ui-screen',loadPhase:'startup'}]}))
    expect((await command('handoff.mjs','--design','finalize')).valid).toBe(true)
    const implementation=await command('handoff.mjs','--design','implementation')
    expect(implementation.valid).toBe(true)
    await writeFile(join(workspace,'src/main.js'),`import {parseBeeGameContentIndex,fetchStartupContentDocuments,readSceneData,readUiData,loadProductionResources,createProductionUiSurface,renderProductionScene2d} from './consumer.mjs';
const indexUrl=new URL('./content/index.json',document.baseURI);
const docs=await fetchStartupContentDocuments(parseBeeGameContentIndex(await (await fetch(indexUrl)).json()),indexUrl);
const resources=await loadProductionResources(new URL('./assets/asset-manifest.json',document.baseURI),docs);
const viewport={width:960,height:540};
renderProductionScene2d(document.querySelector('#scene'),readSceneData(docs.find(d=>d.kind==='scene-2d')),viewport,resources.assets);
const surface=await createProductionUiSurface(document.querySelector('#ui'));
const ui=readUiData(docs.find(d=>d.kind==='ui-screen'));let clicks=0;
const render=()=>surface.render(ui,viewport,{assets:resources.assets,fonts:resources.fonts,state:{status:String(clicks)},onAction:()=>{clicks++;render()}});
render();addEventListener('pagehide',()=>{surface.dispose();resources.dispose()});
`)
    await writeFile(join(workspace,'index.html'),'<style>body{margin:0}#scene,#ui{position:absolute;inset:0;width:960px;height:540px}</style><canvas id="scene"></canvas><div id="ui"></div><script type="module" src="./main.js"></script>')
    await writeFile(join(workspace,'scripts/build.mjs'),`import {mkdir,copyFile} from 'node:fs/promises';import {copyRegisteredRuntimeFiles} from './runtime-files.mjs';
const result=await Bun.build({entrypoints:['src/main.js'],outdir:'dist',target:'browser'});if(!result.success)throw Error(String(result.logs));
await mkdir('dist',{recursive:true});await copyFile('index.html','dist/index.html');await copyRegisteredRuntimeFiles(process.cwd(),'dist');`)
    const build=async()=>{
      const child=Bun.spawn([process.execPath,'scripts/build.mjs'],{cwd:workspace,stdout:'pipe',stderr:'pipe'})
      const [code,error]=await Promise.all([child.exited,new Response(child.stderr).text()])
      expect({code,error:code?error:''}).toEqual({code:0,error:''})
      for(const path of [scenePath,uiPath]) expect(await readFile(join(workspace,'dist',path),'utf8')).toBe(await readFile(join(workspace,path),'utf8'))
    }
    await build()
    expect(await Bun.file(join(workspace,'dist',unbound)).exists()).toBe(true)
    expect(await Bun.file(join(workspace,'dist/assets/visual/design.png')).exists()).toBe(false)
    server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
      const path=new URL(request.url).pathname.replace(/^\/nested\//,'')
      if(path==='favicon.ico')return new Response(null,{status:204})
      const file=Bun.file(join(workspace,'dist',path||'index.html'))
      return await file.exists()?new Response(file):new Response(null,{status:404})
    }})
    const {chromium}=await import(sharedPlaywright().moduleUrl)
    browser=await chromium.launch({headless:true,executablePath:process.env.BGS_LAYOUT_BROWSER_EXECUTABLE??chromium.executablePath()})
    const page=await browser.newPage({viewport:{width:960,height:540}})
    const errors:string[]=[]
    page.on('pageerror',(error:Error)=>errors.push(error.message))
    await page.goto('http://127.0.0.1:'+server.port+'/nested/')
    await page.locator('[data-node-id=status]').waitFor()
    const pixel=(x=480)=>page.locator('#scene').evaluate((canvas:any,x:number)=>Array.from(canvas.getContext('2d').getImageData(x,270,1,1).data),x)
    expect(await pixel()).toEqual([0,255,0,255])
    expect(await page.locator('[data-node-id=button] canvas').evaluate((canvas:any)=>Array.from(canvas.getContext('2d').getImageData(5,5,1,1).data))).toEqual([255,0,0,255])
    await page.locator('[data-node-id=button]').click()
    expect(await page.locator('[data-node-id=status]').innerText()).toBe('1')
    const beforeUi=await page.locator('[data-node-id=button]').boundingBox()
    expect(beforeUi).toEqual({x:20,y:20,width:100,height:50})
    // Change the design-linked source files, rebuild, and observe actual data
    // consumption. There is no replacement fixture layout or code mutation.
    const originalScene=JSON.stringify(scene),originalUi=JSON.stringify(ui)
    const imageData=scene.data.nodes[1]!.components[0]!.data
    if (!('frame' in imageData)) throw Error('Fixture image component is missing')
    imageData.frame='right'
    scene.data.nodes[1]!.transform!.position[0]=600
    ui.data.nodes[1]!.layout.position=[140,30];ui.data.nodes[1]!.layout.size=[120,60]
    ui.data.nodes[1]!.data!.image!.frame='left'
    await writeFile(join(workspace,scenePath),JSON.stringify(scene));await writeFile(join(workspace,uiPath),JSON.stringify(ui))
    await build()
    await page.reload();await page.locator('[data-node-id=status]').waitFor()
    const afterScene=await pixel(),afterEdge=await pixel(10),afterUi=await page.locator('[data-node-id=button]').boundingBox()
    const afterButton=await page.locator('[data-node-id=button] canvas').evaluate((canvas:any)=>Array.from(canvas.getContext('2d').getImageData(5,5,1,1).data))
    expect(afterScene).toEqual([255,0,0,255]);expect(afterEdge).toEqual([0,0,0,0])
    expect(afterUi).toEqual({x:140,y:30,width:120,height:60});expect(afterButton).toEqual([0,255,0,255])
    // Restore the tested author defaults before retaining their final evidence.
    await writeFile(join(workspace,scenePath),originalScene);await writeFile(join(workspace,uiPath),originalUi);await build()
    await page.reload();await page.locator('[data-node-id=status]').waitFor()
    expect(await pixel()).toEqual([0,255,0,255])
    expect(errors).toEqual([])
    await mkdir(join(workspace,'reports'),{recursive:true});await mkdir(join(workspace,'.beegame/delivery'),{recursive:true})
    const evidence='reports/browser-observation.json'
    await writeFile(join(workspace,evidence),JSON.stringify({fixture:true,beforeUi,afterUi,afterScene,afterEdge,afterButton,errors}))
    const contentChecks=[
      {kind:'ui-layout',document:uiPath,nodeId:'button',property:'layout',change:'Position/size',observed:JSON.stringify(afterUi)},
      {kind:'scene-layout',document:scenePath,nodeId:'image',property:'transform',change:'Move right 120px',observed:JSON.stringify(afterEdge)},
      {kind:'resource-binding',document:uiPath,nodeId:'button',property:'frame',change:'right to left',observed:JSON.stringify(afterButton)},
      {kind:'resource-binding',document:scenePath,nodeId:'image',property:'frame',change:'left to right',observed:JSON.stringify(afterScene)},
    ].map(check=>({...check,expected:check.observed,status:'passed',evidencePaths:[evidence]}))
    await writeFile(join(workspace,DESIGN_ACCEPTANCE_PATH),JSON.stringify({scope:'delivery',status:'passed',
      summary:'Synthetic helper integration; not game or visual-quality acceptance',environment:'Local Chrome fixture',
      evidencePaths:[evidence],artifactPaths:['dist'],verification:{target:'deployment',observation:'target-runtime',knownIssues:[],unverified:[],
        designRevision:implementation.designRevision,requirementChecks:designRequirementChecksFixture(workspace,[evidence]),contentChecks}}))
    expect(await command('handoff.mjs','--design','acceptance')).toMatchObject({valid:true,quality:'unverified'})
    expect((await measurement.handoff()).acceptance.valid).toBe(true)
    await writeFile(join(workspace,uiPath),JSON.stringify(ui))
    expect((await command('handoff.mjs','--design','acceptance')).valid).toBe(false)
    await writeFile(join(workspace,uiPath),originalUi)
    const index=await readFile(join(workspace,'content/index.json'),'utf8')
    await rm(join(workspace,'content/index.json'))
    expect((await command('handoff.mjs','--design','acceptance')).valid).toBe(false)
    expect((await measurement.handoff()).acceptance.valid).toBe(false)
    await writeFile(join(workspace,'content/index.json'),index)
    expect((await command('handoff.mjs','--design','acceptance')).valid).toBe(true)
    // An author cannot remove both the registry and its design links to erase
    // the host's confirmed editable-content requirement at final handoff.
    await rm(join(workspace,'content/index.json'))
    for(const name of ['UI_UX_SPEC.md','LEVEL_SCENE_DESIGN.md']) {
      const path=join(workspace,'docs',name)
      await writeFile(path,(await readFile(path,'utf8')).replace(/^.*\]\(\.\.\/content\/.*$/gm,''))
    }
    await command('handoff.mjs','--design','finalize')
    const sourceOnly=await command('handoff.mjs','--design','implementation')
    const report=JSON.parse(await readFile(join(workspace,DESIGN_ACCEPTANCE_PATH),'utf8'))
    report.verification={...report.verification,designRevision:sourceOnly.designRevision,contentChecks:[],
      requirementChecks:designRequirementChecksFixture(workspace,[evidence])}
    await writeFile(join(workspace,DESIGN_ACCEPTANCE_PATH),JSON.stringify(report))
    expect((await inspectDesignAcceptance(workspace,true,false)).valid).toBe(true)
    expect((await command('handoff.mjs','--design','acceptance')).valid).toBe(false)
    expect((await measurement.handoff()).acceptance.valid).toBe(false)
    expect(await agentTurnHandoffReason(run,turn)).toContain('editable content is missing')
  } finally {
    await browser?.close();server?.stop(true);await tools?.close();await measurement.close()
    await rm(root,{recursive:true,force:true})
  }
},30000)

