import {test,expect} from 'bun:test'
import {mkdtemp,mkdir,writeFile,readFile,cp,rm,realpath} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createRequire} from 'node:module'
import {createRun,type AgentTurn,type AgentMeasurement} from './state'
import {createLocalWorkflowStore} from './store'
import {createAgentMeasurement,measurementRequest} from './agent-measurement'
import {selectAgentMeasuredBuild,exportAgentMeasuredBuild,inspectAgentMeasurementInputs} from './measured-build'
import {openAgentTools} from './agent-tools'
import {projectPreviewCapabilityPath} from '../project-preview-capability'
import {uiLayoutFixture,sceneLayoutFixture} from '../fixtures/layout-fixture'
import {assetManifestAuthoringExamples} from '../asset-manifest-authoring-contract'
import {writeBeeGameAssetManifest} from '../asset-contracts'
import {sharedSharp} from '../shared-sharp'
import {audioProbeWav} from './audio-consumption'

type Consumption=NonNullable<AgentMeasurement['consumption']>
const JSZip=createRequire(import.meta.resolve('exceljs'))('jszip')
const uiProbe={document:'content/ui/menu.json',nodeId:'play',selector:'#play',viewport:[1280,720] as [number,number]}
const checkFor = (checks: AgentMeasurement['checks'], id: string) => checks.find(check => check.id === id)!
test('optional autonomous consumption reuses existing probe schemas; invalid selection never dispatches',()=>{
  const base={requestKey:'test',runtimeArtifact:'dist'}
  expect(measurementRequest.parse(base).consumption).toBeUndefined()
  expect(measurementRequest.parse({...base,consumption:{checks:['font-data-consumption'],uiProbes:[uiProbe]}}).consumption!.checks).toEqual(['font-data-consumption'])
  expect(measurementRequest.parse({...base,consumption:{checks:['ui-data-consumption'],uiProbes:[{...uiProbe,deviceScaleFactor:2}]}})
    .consumption!.uiProbes![0]!.deviceScaleFactor).toBe(2)
  expect(measurementRequest.parse({...base,consumption:{checks:['ui-data-consumption'],
    uiProbes:[{...uiProbe,steps:[{click:'#start'}]}]}}).consumption!.uiProbes![0]!.steps).toEqual([{click:'#start'}])
  for(const deviceScaleFactor of [0,-1,Infinity,NaN,'2'])
    expect(()=>measurementRequest.parse({...base,consumption:{checks:['ui-data-consumption'],uiProbes:[{...uiProbe,deviceScaleFactor}]}})).toThrow()
  for(const consumption of [
    {checks:[]},{checks:['rule-tests']},{checks:['ui-data-consumption']},
    {checks:['ui-data-consumption','ui-data-consumption'],uiProbes:[uiProbe]},
    {checks:['ui-data-consumption'],uiProbes:[{...uiProbe,viewport:[0,720]}]},
    {checks:['ui-data-consumption'],uiProbes:[uiProbe],pixelProbes:[uiProbe]},
    {checks:['ui-data-consumption'],uiProbes:[uiProbe],writablePaths:['**']},
    {checks:['ui-data-consumption'],uiProbes:[uiProbe],steps:[{click:'#start'}]},
    {checks:['audio-data-consumption'],audioProbes:[uiProbe]},
  ])expect(()=>measurementRequest.parse({...base,consumption})).toThrow()
})

async function fixture(kind:'ui'|'pixel'|'font'|'audio',ignore=false) {
  const temporary=await realpath(await mkdtemp(join(tmpdir(),'bgs-agent-consumption-'))),root=join(temporary,'project')
  await mkdir(join(root,'content/ui'),{recursive:true});await mkdir(join(root,'content/scenes'),{recursive:true})
  const ui=uiLayoutFixture() as any,scene=sceneLayoutFixture() as any
  ui.data.nodes[0].data.referenceResolution=[1280,720];ui.data.nodes[0].data.targetViewports=[[1280,720]]
  ui.data.nodes[0].layout.size=[1280,720]
  let html='',consumption:Consumption
  if(kind==='ui') {
    html='<style>body{margin:0}button{position:absolute;box-sizing:border-box}</style><button id="play">Play</button><script>'+
      'fetch("./content/ui/menu.json").then(r=>r.json()).then(d=>{const n=d.data.nodes.find(n=>n.id==="play"),b=document.querySelector("#play"),'+
      's='+(ignore?'[200,52]':'n.layout.size')+',p='+(ignore?'[0,0]':'n.layout.position||[0,0]')+';'+
      'b.style.width=s[0]+"px";b.style.height=s[1]+"px";b.style.left=(640-s[0]/2+p[0])+"px";b.style.top=(360-s[1]/2+p[1])+"px";if(n.enabled===false)b.style.display="none";})</script>'
    consumption={checks:['ui-data-consumption'],uiProbes:[uiProbe]}
  } else {
    const manifest=assetManifestAuthoringExamples().canonical,asset=manifest.resources[0]!
    await mkdir(join(root,'assets/runtime/example'),{recursive:true})
    if(kind==='pixel') {
      const path='assets/runtime/example/image.png'
      asset.root_path=path;asset.file_paths=[path];asset.asset_kind='sprite';manifest.project_target!.asset_format_capabilities=['png']
      const sharp=(await import((await sharedSharp()).moduleUrl)).default
      await writeFile(join(root,path),await sharp({create:{width:80,height:40,channels:4,background:'#327bb8'}}).png().toBuffer())
      scene.assetRefs=[asset.id];scene.data.nodes[0].transform={position:[25,15,0]}
      scene.data.nodes[1].transform={position:[-100,-50,0]}
      scene.data.nodes[1].components=[{id:'sprite',type:'sprite-renderer',assetRef:asset.id,data:{size:[80,40]}}]
      html='<style>body{margin:0}</style><canvas width="960" height="540"></canvas><script type="module">'+
        'const d=await fetch("./content/scenes/level.json").then(r=>r.json()),n=d.data.nodes.find(n=>n.id==="board"),'+
        'c=d.data.nodes.find(n=>n.id===d.data.cameraNodeId),im=new Image();im.src="./'+path+'";await im.decode();'+
        'const raw=n.components[0].data.size,scale=n.transform.scale||[1,1],s=[raw[0]*scale[0],raw[1]*scale[1]],p=n.transform.position,ctx=document.querySelector("canvas").getContext("2d");'+
        'ctx.drawImage(im,480+p[0]-'+(ignore?'0':'c.transform.position[0]')+'-s[0]/2,270+p[1]-'+(ignore?'0':'c.transform.position[1]')+'-s[1]/2,s[0],s[1]);</script>'
      consumption={checks:['pixel-data-consumption'],pixelProbes:[{document:'content/scenes/level.json',nodeId:'board',componentId:'sprite',selector:'canvas',viewport:[960,540]}]}
    } else if(kind==='font') {
      const path='assets/runtime/example/font.ttf'
      asset.root_path=path;asset.file_paths=[path];asset.asset_kind='font';manifest.project_target!.asset_format_capabilities=['ttf']
      await cp(process.platform==='darwin'?'/System/Library/Fonts/Supplemental/Arial.ttf':'/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',join(root,path))
      ui.assetRefs=[asset.id];Object.assign(ui.data.nodes[1],{text:'Signal 19AB',style:{fontSize:28},data:{font:{assetRef:asset.id}}})
      html='<button id="play"></button><script type="module">const d=await fetch("./content/ui/menu.json").then(r=>r.json()),'+
        'n=d.data.nodes.find(n=>n.id==="play"),b=document.querySelector("#play");'+
        'try{document.fonts.add(await new FontFace("Measured","url(./'+path+')").load())}catch{}'+
        'b.style.fontFamily="Measured, monospace";b.style.fontSize=n.style.fontSize+"px";b.textContent=n.text;</script>'
      consumption={checks:['font-data-consumption'],uiProbes:[uiProbe]}
    } else {
      const path='assets/runtime/example/clip.wav'
      asset.root_path=path;asset.file_paths=[path];asset.asset_kind='audio-clip';manifest.project_target!.asset_format_capabilities=['wav']
      await writeFile(join(root,path),audioProbeWav(false));scene.assetRefs=[asset.id]
      scene.data.nodes[1].components=[{id:'sound',type:'audio-source',assetRef:asset.id,data:{volume:.6,loop:false}}]
      html='<button id="start">Play</button><button id="stop">Stop</button><audio id="clip" preload="auto"></audio><script type="module">'+
        'const d=await fetch("./content/scenes/level.json").then(r=>r.json()),c=d.data.nodes[1].components[0],a=document.querySelector("#clip");'+
        'a.src="./'+path+'";a.volume=c.data.volume;a.loop=c.data.loop;document.querySelector("#start").onclick=()=>a.play().catch(()=>{});'+
        'document.querySelector("#stop").onclick=()=>a.pause();</script>'
      consumption={checks:['audio-data-consumption'],audioProbes:[{document:'content/scenes/level.json',nodeId:'board',componentId:'sound',selector:'#clip',viewport:[960,540],playSteps:[{click:'#start'}],stopSteps:[{click:'#stop'}]}]}
    }
    await writeBeeGameAssetManifest(root,manifest)
  }
  await writeFile(join(root,'content/ui/menu.json'),JSON.stringify(ui));await writeFile(join(root,'content/scenes/level.json'),JSON.stringify(scene))
  await writeFile(join(root,'content/index.json'),JSON.stringify({schema:'beegame-content-package.v2',id:'fixture',sceneModel:'game-object-v2',
    dimension:'2d',entryScene:'level',documentRevision:'0'.repeat(64),assetManifestRevision:'0'.repeat(64),files:['ui/menu.json','scenes/level.json'],documents:[
      {id:'menu',kind:'ui-screen',path:'ui/menu.json',loadPhase:'startup'},{id:'level',kind:'scene-2d',path:'scenes/level.json',loadPhase:'startup'}]}))
  await writeFile(join(root,'index.html'),'<!doctype html>'+html)
  await writeFile(join(root,'package.json'),JSON.stringify({scripts:{build:'bun build.mjs'}}))
  // The copied build consumes the fixture's actual content and resources.
  await writeFile(join(root,'build.mjs'),"import{cp,mkdir,stat}from'node:fs/promises';await mkdir('dist',{recursive:true});await cp('index.html','dist/index.html');await cp('content','dist/content',{recursive:true});try{await stat('assets');await cp('assets','dist/assets',{recursive:true})}catch(e){if(e.code!=='ENOENT')throw e}")
  const store=createLocalWorkflowStore(join(temporary,'store')),run=createRun({projectId:'consume',ownerId:'owner',workspacePath:root,
    chatSessionId:'chat',requestKey:'goal',text:'Synthetic probe route',constraints:{},ids:['goal']})
  const turn:AgentTurn={attemptId:crypto.randomUUID(),requestKey:'goal',sessionId:'chat',workerId:'worker',fence:1,status:'running',
    startedAt:new Date().toISOString(),requirementsRevision:run.requirements.revision}
  run.agentTurns=[turn];run.writer={attemptId:turn.attemptId,workerId:turn.workerId,fence:1};run.fence=1
  await store.commit(run.projectId,run.ownerId,0,run,'fixture')
  const measurement=createAgentMeasurement({run,turn,store})
  const current=async()=>(await store.read(run.projectId,run.ownerId))!
  return {root,run,turn,store,measurement,current,consumption,async close(){await measurement.close();await rm(temporary,{recursive:true,force:true})}}
}

test('misplaced click steps give a precise input error without reserving or running a measurement',async()=>{
  const f=await fixture('ui')
  try {
    expect(()=>f.measurement.measure({requestKey:'misplaced-steps',runtimeArtifact:'dist',
      consumption:{...f.consumption,steps:[{click:'#start'}]}})).toThrow('put steps inside the relevant uiProbes item')
    expect((await f.current()).agentTurns![0]!.measurements).toBeUndefined()
  }finally{await f.close()}
})

test('published audio example validates and measurement input errors stay structured without starting work',async()=>{
  const f=await fixture('ui')
  let tools:Awaited<ReturnType<typeof openAgentTools>>|undefined
  try {
    tools=await openAgentTools({workspacePath:f.root,sessionId:'chat',getAuthToken:()=>undefined,measurement:f.measurement})
    const entry=join(f.root,tools.directory,'measure.mjs')
    const command=async(...args:string[])=>{
      const child=Bun.spawn([process.execPath,entry,...args],{cwd:f.root,
        env:{...process.env,BEEGAME_MEASUREMENT_CAPABILITY_FILE:projectPreviewCapabilityPath(f.root,'chat','measurement')},stdout:'pipe',stderr:'pipe'})
      const [stdout,stderr,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited])
      return {stdout,stderr,code}
    }
    const help=await command('--help')
    expect(help.code,help.stderr).toBe(0)
    const example=help.stdout.match(/Audio JSON example: (\{.+?\})\. Replace/)
    expect(example).not.toBeNull()
    const consumption=JSON.parse(example![1]!)
    expect(measurementRequest.parse({requestKey:'example',runtimeArtifact:'dist',consumption}).consumption).toEqual(consumption)
    expect(help.stdout).toContain('wait steps are not supported')
    expect(help.stdout).toContain('not WebAudio synthesis, concurrency or listening quality')

    const before=await f.current()
    const invalid={...consumption,audioProbes:[{...consumption.audioProbes[0],document:undefined,
      playSteps:[{wait:1}],privateInput:'DO_NOT_ECHO_INPUT_VALUE'}]}
    const rejected=await command('--request','invalid-audio','--artifact','dist','--consumption-json',JSON.stringify(invalid))
    expect(rejected.code).toBe(1)
    const result=JSON.parse(rejected.stdout)
    expect(typeof result.error).toBe('string')
    expect(result.issues).toEqual(JSON.parse(result.error).map(({path,code,message}:any)=>({path,code,message})))
    expect(result.issues).toContainEqual({path:['consumption','audioProbes',0,'document'],code:'invalid_type',
      message:'Invalid input: expected string, received undefined'})
    expect(result.issues.some((issue:any)=>issue.code==='unrecognized_keys')).toBe(true)
    expect(rejected.stdout).not.toContain('DO_NOT_ECHO_INPUT_VALUE')

    const misplaced=await command('--request','misplaced','--artifact','dist','--consumption-json',
      JSON.stringify({...f.consumption,steps:[{click:'#start'}]}))
    expect(misplaced.code).toBe(1)
    expect(JSON.parse(misplaced.stdout).error).toContain('put steps inside the relevant uiProbes item')
    expect(JSON.parse(misplaced.stdout).issues).toBeUndefined()
    expect(await f.current()).toEqual(before)
    await expect(readFile(join(f.root,'dist/index.html'))).rejects.toMatchObject({code:'ENOENT'})
  }finally{await tools?.close();await f.close()}
},30000)

for(const kind of ['ui','pixel','font','audio'] as const)test('autonomous saved build actually consumes '+kind+' without host Tasks',async()=>{
  const f=await fixture(kind),tools=await openAgentTools({workspacePath:f.root,sessionId:'chat',getAuthToken:()=>undefined,measurement:f.measurement})
  const command=async(...args:string[])=>{
    const child=Bun.spawn([process.execPath,join(f.root,tools.directory,'measure.mjs'),...args],{cwd:f.root,
      env:{...process.env,BEEGAME_MEASUREMENT_CAPABILITY_FILE:projectPreviewCapabilityPath(f.root,'chat','measurement')},stdout:'pipe',stderr:'pipe'})
    return {code:await child.exited,stdout:await new Response(child.stdout).text(),stderr:await new Response(child.stderr).text()}
  }
  try {
    expect(tools.turnContext).toContain('source-copy build and smoke measurement (no separate prebuild)')
    if(kind==='ui'){
      const help=(await command('--help')).stdout
      expect(help).toContain('Put steps INSIDE each uiProbes item, not at the consumption JSON root')
      expect(help).toContain('cannot make an inactive saved-layout node eligible')
      expect(help).toContain('Default inspection includes failed check identities and reasons')
      const misplaced=await command('--request','misplaced','--artifact','dist','--consumption-json',
        JSON.stringify({...f.consumption,steps:[{click:'#start'}]}))
      expect(misplaced.code).toBe(1)
      expect(misplaced.stdout).toContain('put steps inside the relevant uiProbes item')
      expect((await f.current()).agentTurns![0]!.measurements).toBeUndefined()
    }
    const original=await readFile(join(f.root,'content/index.json'),'utf8')
    const result=await command('--request','actual','--artifact','dist','--consumption-json',JSON.stringify(f.consumption))
    expect(result.code,result.stdout+result.stderr).toBe(0)
    const receipt=JSON.parse(result.stdout),run=await f.current(),saved=run.agentTurns![0]!.measurements![0]!
    expect(checkFor(saved.checks,'build').status).toBe('passed')
    expect(checkFor(saved.checks,'runtime-smoke').status).toBe('passed')
    expect(checkFor(saved.checks,f.consumption.checks[0]!).status).toBe('passed')
    expect(saved.consumption).toEqual(f.consumption);expect(['plans','tasks','attempts'].some(key=>key in run)).toBe(false)
    expect(receipt.deliveryEligible).toBe(false);expect(receipt.quality).toBe('unverified')
    expect(await readFile(join(f.root,'content/index.json'),'utf8')).toBe(original)
    expect((await f.measurement.context()).checkScope.consumption).toEqual(f.consumption.checks)
    expect(receipt.checkScope.unmeasuredConsumptionChecks).not.toContain(f.consumption.checks[0])
    expect(receipt.checkScope.unmeasuredConsumptionChecks).toHaveLength(4)
    expect(receipt.checks.find((check:any)=>check.id===f.consumption.checks[0])!.coverage.files).toContain(kind==='ui'||kind==='font'?'content/ui/menu.json':'content/scenes/level.json')
    expect((await f.measurement.handoff()).checkScope).toEqual(receipt.checkScope)
    const retry=await command('--request','actual','--artifact','dist','--consumption-json',JSON.stringify(f.consumption))
    expect(JSON.parse(retry.stdout).id).toBe(saved.id);expect(await f.current()).toEqual(run)
    const changed={...f.consumption,checks:['ui-data-consumption','font-data-consumption'],uiProbes:[uiProbe]}
    if(kind==='ui')expect((await command('--request','actual','--artifact','dist','--consumption-json',JSON.stringify(changed))).code).toBe(1)
    if(kind==='ui') {
      const differentDensity={...f.consumption,uiProbes:[{...uiProbe,deviceScaleFactor:2}]}
      expect((await command('--request','actual','--artifact','dist','--consumption-json',JSON.stringify(differentDensity))).code).toBe(1)
      expect(await f.current()).toEqual(run) // A DPR-1 receipt cannot be relabeled or replayed as DPR-2 evidence.
    }
    const detailed=await f.measurement.inspect(saved.id,true)
    expect(detailed.checks.find((check:any)=>check.id===f.consumption.checks[0])).toHaveProperty('observation')
    const ended=structuredClone(run);delete ended.writer
    Object.assign(ended.agentTurns![0]!,{status:'ended',quiescedAt:new Date().toISOString()})
    const exported=await exportAgentMeasuredBuild(ended,saved.id,{read:async()=>ended,busy:()=>false},'project')
    const zip=await JSZip.loadAsync(exported.data),packaged=JSON.parse(await zip.file('measurement.json').async('string'))
    expect(packaged.consumption).toEqual(f.consumption)
    expect(packaged.consumptionChecks).toEqual(saved.checks.filter(check=>f.consumption.checks.includes(check.id as any)).map(({inputs:_inputs,...check})=>check))
    expect(packaged.consumptionChecks[0]).not.toHaveProperty('inputs')
    expect(packaged.deliveryEligible).toBe(false)
    for(const variant of ['missing','obsolete'] as const) {
      const incomplete=structuredClone(ended),record=incomplete.agentTurns![0]!.measurements![0]!
      if(variant==='missing')record.checks.pop()
      else checkFor(record.checks,f.consumption.checks[0]!).version='obsolete-driver-version'
      expect((await inspectAgentMeasurementInputs(incomplete,record)).current).toBe(false)
      await expect(selectAgentMeasuredBuild(incomplete,saved.id)).rejects.toThrow('consumption checks')
    }
    await writeFile(join(f.root,'index.html'),'<!doctype html><button>Changed</button>')
    expect((await f.measurement.inspect(saved.id)).freshness.current).toBe(false)
  }finally{await tools.close();await f.close()}
},60000)

test('autonomous measurement and export retain explicit logical-root coordinates without scheduling Tasks',async()=>{
  const f=await fixture('ui')
  try {
    const file=join(f.root,'content/ui/menu.json'),ui=JSON.parse(await readFile(file,'utf8'))
    ui.data.nodes[0].data.targetViewports=[[960,540]]
    // This is a coordinate/export fixture: retain the 44px control minimum
    // with a 64px logical height (48 CSS pixels after the .75 scale).
    ui.data.nodes[1].layout.size[1]=64
    await writeFile(file,JSON.stringify(ui))
    const html=await readFile(join(f.root,'index.html'),'utf8')
    await writeFile(join(f.root,'index.html'),html.replace('<button id="play">Play</button>',
      '<div id="logical-root"><button id="play">Play</button></div>')+
      '<style>#logical-root{position:absolute;width:1280px;height:720px;transform:scale(.75);transform-origin:top left}</style>')
    const consumption:Consumption={checks:['ui-data-consumption'],uiProbes:[{...uiProbe,viewport:[960,540],coordinateRoot:'#logical-root'}]}
    const request=measurementRequest.parse({requestKey:'logical-root',runtimeArtifact:'dist',consumption})
    const original=await readFile(file,'utf8'),saved=await f.measurement.measure(request)
    expect(checkFor(saved.checks,'build').status).toBe('passed')
    expect(checkFor(saved.checks,'runtime-smoke').status).toBe('passed')
    expect(checkFor(saved.checks,'ui-data-consumption').status,checkFor(saved.checks,'ui-data-consumption').observation).toBe('passed')
    expect(saved.consumption).toEqual(consumption)
    const observed=JSON.parse(checkFor(saved.checks,'ui-data-consumption').observation).probes[0]
    expect(observed.coordinateDomain).toBe('saved logical UI pixels')
    expect(observed.mappings[0].physicalBounds.left).toBe(405)
    expect(observed.before.left).toBe(540)
    const handoff=await f.measurement.handoff(),run=await f.current()
    expect(handoff.measurement!.checks.find((check:any)=>check.id==='ui-data-consumption')!.coverage).toEqual(checkFor(saved.checks,'ui-data-consumption').coverage)
    expect(['plans','tasks','attempts'].some(key=>key in run)).toBe(false)
    const ended=structuredClone(run);delete ended.writer
    Object.assign(ended.agentTurns![0]!,{status:'ended',quiescedAt:new Date().toISOString()})
    const exported=await exportAgentMeasuredBuild(ended,saved.id,{read:async()=>ended,busy:()=>false},'project')
    const zip=await JSZip.loadAsync(exported.data),receipt=JSON.parse(await zip.file('measurement.json').async('string'))
    expect(receipt.consumption).toEqual(consumption)
    expect(receipt.deliveryEligible).toBe(false)
    expect(await readFile(file,'utf8')).toBe(original)
  }finally{await f.close()}
},60000)

for(const kind of ['ui','pixel'] as const)test('requested '+kind+' failure cannot be hidden by passed build/smoke or receipt export',async()=>{
  const f=await fixture(kind,true)
  try {
    const saved=await f.measurement.measure({requestKey:'ignore',runtimeArtifact:'dist',consumption:f.consumption})
    expect(checkFor(saved.checks,'build').status).toBe('passed')
    expect(checkFor(saved.checks,'runtime-smoke').status).toBe('passed')
    expect(checkFor(saved.checks,f.consumption.checks[0]!).status).toBe('failed')
    const result=await f.measurement.inspect(saved.id)
    expect(result.freshness).toMatchObject({current:false,code:'preview-unverified'})
    const before=await f.current(),run=structuredClone(before)
    delete run.writer;Object.assign(run.agentTurns![0]!,{status:'ended',quiescedAt:new Date().toISOString()})
    await expect(selectAgentMeasuredBuild(run,saved.id)).rejects.toThrow('consumption checks')
    await expect(exportAgentMeasuredBuild(run,saved.id,{read:async()=>run,busy:()=>false})).rejects.toThrow('consumption checks')
    expect(await f.current()).toEqual(before)
  }finally{await f.close()}
},60000)

test('autonomous UI probes run a selected state and report unobserved screens/viewports without blocking unrelated work',async()=>{
  const f=await fixture('ui')
  try {
    const source=join(f.root,'content/ui/menu.json'),ui=JSON.parse(await readFile(source,'utf8'))
    ui.data.nodes[0].data.targetViewports=[[1280,720],[960,540]]
    await writeFile(source,JSON.stringify(ui))
    await writeFile(join(f.root,'content/ui/pause.json'),JSON.stringify({...ui,id:'pause'}))
    const indexPath=join(f.root,'content/index.json'),index=JSON.parse(await readFile(indexPath,'utf8'))
    index.files.push('ui/pause.json');index.documents.push({id:'pause',kind:'ui-screen',path:'ui/pause.json',loadPhase:'on-demand'})
    await writeFile(indexPath,JSON.stringify(index))
    const original=await readFile(source,'utf8'),saved=await f.measurement.measure({requestKey:'partial',runtimeArtifact:'dist',consumption:f.consumption})
    const check=saved.checks.find(c=>c.id==='ui-data-consumption')!
    expect(check.status,check.observation).toBe('passed')
    expect(check.coverage?.files).toEqual(['content/ui/menu.json'])
    expect(check.coverage?.limitations.join(' ')).toContain('content/ui/pause.json')
    expect(check.coverage?.limitations.join(' ')).toContain('960x540')
    const receipt=await f.measurement.inspect(saved.id)
    expect(receipt.checks.find((item:any)=>item.id==='ui-data-consumption')!.coverage).toEqual(check.coverage)
    expect(receipt.quality).toBe('unverified');expect(receipt.deliveryEligible).toBe(false)
    expect(await readFile(source,'utf8')).toBe(original)
  }finally{await f.close()}
},60000)

test('dynamic DOM text overflow fails a real autonomous receipt despite correct outer geometry',async()=>{
  const f=await fixture('ui')
  try {
    const html=await readFile(join(f.root,'index.html'),'utf8')
    await writeFile(join(f.root,'index.html'),html+'<script>const b=document.querySelector("#play");b.style.padding="0";'+
      'b.style.fontSize="20px";b.style.lineHeight="52px";b.innerHTML="<span style=display:block>First row</span><span style=display:block>Second row</span>";</script>')
    const source=await readFile(join(f.root,'content/ui/menu.json'),'utf8')
    const saved=await f.measurement.measure({requestKey:'overflow',runtimeArtifact:'dist',consumption:f.consumption})
    expect(checkFor(saved.checks,'build').status).toBe('passed')
    expect(checkFor(saved.checks,'runtime-smoke').status).toBe('passed')
    const check=checkFor(saved.checks,'ui-data-consumption')
    expect(check.status,check.observation).toBe('failed')
    expect(JSON.parse(check.observation).probes[0].textFit.before.overflowCount).toBeGreaterThan(0)
    expect((await f.measurement.handoff()).measurement?.checks.find((item:any)=>item.id==='ui-data-consumption')).toMatchObject({status:'failed',coverage:check.coverage})
    const ended=structuredClone(await f.current());delete ended.writer
    Object.assign(ended.agentTurns![0]!,{status:'ended',quiescedAt:new Date().toISOString()})
    await expect(exportAgentMeasuredBuild(ended,saved.id,{read:async()=>ended,busy:()=>false})).rejects.toThrow('consumption checks')
    expect(await readFile(join(f.root,'content/ui/menu.json'),'utf8')).toBe(source)
  }finally{await f.close()}
},60000)

test('receipt locates a rejected probe and never treats a container PASS as text/game quality evidence',async()=>{
  const f=await fixture('ui')
  try{
    const invalid={...f.consumption,uiProbes:[uiProbe,{...uiProbe,nodeId:'missing',selector:'#missing'}]}
    const rejected=await f.measurement.measure({requestKey:'rejected',runtimeArtifact:'dist',consumption:invalid})
    const rejectedCheck=checkFor(rejected.checks,'ui-data-consumption')
    expect(rejectedCheck.status).toBe('unverified')
    expect(rejectedCheck.observation).toContain('content/ui/menu.json#missing @ 1280x720 [node]')
    expect(rejectedCheck.coverage?.files).toEqual([])
    expect((await f.measurement.handoff()).measurement?.checks.find((item:any)=>item.id==='ui-data-consumption')).toMatchObject({status:'unverified',coverage:{files:[]}})
    const file=join(f.root,'content/ui/menu.json'),ui=JSON.parse(await readFile(file,'utf8'))
    ui.data.nodes[1].role='container'
    await writeFile(file,JSON.stringify(ui))
    const original=await readFile(file,'utf8'),saved=await f.measurement.measure({requestKey:'container',runtimeArtifact:'dist',consumption:f.consumption})
    const check=checkFor(saved.checks,'ui-data-consumption'),scope=check.coverage!.limitations.join(' ')
    expect(check.status,check.observation).toBe('passed')
    expect(scope).toContain('content/ui/menu.json#play @ 1280x720')
    expect(scope).toContain('observable properties: position, size')
    expect(scope).toContain('visible text fit: not checked for this node role')
    expect(JSON.parse(check.observation).probes[0].textFit).toBeUndefined()
    const handoff=await f.measurement.handoff()
    expect(handoff.measurement?.checks.find((item:any)=>item.id==='ui-data-consumption')?.coverage).toEqual(check.coverage)
    expect(handoff.quality).toBe('unverified');expect(handoff.deliveryEligible).toBe(false)
    expect(await readFile(file,'utf8')).toBe(original)
  }finally{await f.close()}
},60000)
