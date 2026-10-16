import {expect,test} from 'bun:test'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import { runChecks } from './checker-test-driver'
import {uiLayoutFixture} from '../fixtures/layout-fixture'
import {taskSchema,type TaskSpec} from './state'
import {prepareFontProbes} from './font-consumption'

// Independent synthetic CSS surface, not a copy or repair of the paid game.
for(const mode of ['identity','scaled','letterbox','axis-scale','offset-root','root-size-fallback',
  'ignore','wrong-center','wrong-position','overflow','self','unrelated','missing','invalid-selector','rotate','perspective',
  'border','wrong-root-size','changing-basis','source-size-conflict','no-reference','legacy-window','hidden-target-wrapper','ancestor-clipped',
  'phone-required','phone-valid','missing-minimum'] as const)
test('UI reference coordinates preserve causality: '+mode,async()=>{
  const root=await mkdtemp(join(tmpdir(),'bgs-ui-coordinate-'))
  try {
    const windowSize:[number,number]=mode==='identity'?[1280,720]:['letterbox','axis-scale','offset-root','changing-basis'].includes(mode)?[1000,800]:[960,540]
    const ui=uiLayoutFixture(mode==='phone-valid'?96:52) as any
    // Coordinate-causality fixtures keep a permissive declared minimum so a
    // separate size failure cannot hide their specific geometry diagnostics.
    if(!['identity','scaled','phone-required','phone-valid','missing-minimum'].includes(mode))ui.data.nodes[0].data.minimumControlSize=[20,20]
    if(mode==='missing-minimum')delete ui.data.nodes[0].data.minimumControlSize
    ui.data.nodes[0].layout.size=[1280,720]
    ui.data.nodes[0].data.referenceResolution=[1280,720]
    ui.data.nodes[0].data.targetViewports=[windowSize]
    if(mode==='source-size-conflict')ui.data.nodes[0].layout.size=[1000,720]
    if(mode==='no-reference'){delete ui.data.nodes[0].data.referenceResolution;delete ui.data.nodes[0].layout.size}
    if(mode==='root-size-fallback')delete ui.data.nodes[0].data.referenceResolution
    const body=JSON.stringify(ui)
    await mkdir(join(root,'content/ui'),{recursive:true});await mkdir(join(root,'dist/content/ui'),{recursive:true})
    await writeFile(join(root,'content/ui/menu.json'),body);await writeFile(join(root,'dist/content/ui/menu.json'),body)
    await writeFile(join(root,'content/index.json'),JSON.stringify({schema:'beegame-content-package.v2',id:'fixture',sceneModel:'game-object-v2',
      documentRevision:'0'.repeat(64),assetManifestRevision:'0'.repeat(64),dimension:'2d',entryScene:'level',files:['ui/menu.json'],
      documents:[{id:'menu',kind:'ui-screen',path:'ui/menu.json',loadPhase:'startup'}]}))
    const html='<!doctype html><style>body{margin:0}#stage{position:fixed;inset:0;display:flex;justify-content:center;align-items:center}'+
      '#surface{position:relative;flex:none;width:'+(mode==='wrong-root-size'?1200:1280)+'px;height:720px;transform-origin:center center;'+
      (mode==='border'?'border:1px solid red;':'')+'}button{position:absolute;box-sizing:border-box;padding:0;border:0;font:16px/20px sans-serif}'+
      (mode==='overflow'?'button{line-height:52px}':'')+
      '</style><div id="stage"><div id="surface"><button id="play">'+
      (mode==='overflow'?'<span style="display:block">First</span><span style="display:block">Second</span>':'Play')+
      '</button></div></div><div id="other"></div><script>'+ (mode==='perspective'?'document.querySelector("#stage").style.perspective="1000px";':'')+
      'fetch("./content/ui/menu.json").then(r=>r.json()).then(d=>{const n=d.data.nodes[1],frame=document.querySelector("#surface"),b=document.querySelector("#play"),'+
      's='+(mode==='ignore'?'[200,52]':'n.layout.size')+',p='+(mode==='ignore'?'[0,0]':'n.layout.position||[0,0]')+';'+
      'const scale='+(['offset-root','changing-basis'].includes(mode)?'.65':'Math.min(innerWidth/1280,innerHeight/720)')+';frame.style.transform='+
      (mode==='axis-scale'?'"scale(.6,.8)"':'"scale("+scale+")"')+
      (mode==='offset-root'?'+" translate(12px,8px)"':mode==='rotate'?'+" rotate(2deg)"':mode==='changing-basis'?'+(p[0]?" translate(8px,0)":"")':'')+';'+
      'b.style.width=s[0]+"px";b.style.height=s[1]+"px";b.style.left=('+ (mode==='wrong-center'?'innerWidth/2':'640')+
      '-s[0]/2+p[0]'+(mode==='wrong-position'?'*2':'')+')+"px";b.style.top=(360-s[1]/2+p[1])+"px";if(n.enabled===false)b.style.display="none";})</script>'
    const targetHtml=['hidden-target-wrapper','ancestor-clipped'].includes(mode)?html.replace('<button id="play">',
      '<div style="'+(mode==='hidden-target-wrapper'?'opacity:0':'position:absolute;left:0;top:0;width:1280px;height:345px;overflow:hidden')+'"><button id="play">')
      .replace('</button>','</button></div>'):html
    await writeFile(join(root,'dist/index.html'),targetHtml)
    const coordinateRoot=mode==='self'?'#play':mode==='unrelated'?'#other':mode==='missing'?'#missing':mode==='invalid-selector'?'[':'#surface'
    const task:TaskSpec={id:'coords',kind:'game.verify',goal:'Independent root coordinate comparison',dependsOn:[],requirementIds:['geometry'],inputs:[],
      writablePaths:[],expectedOutputs:['dist/index.html'],checks:['ui-data-consumption'],runtimeArtifact:'dist',
      uiProbes:[{document:'content/ui/menu.json',nodeId:'play',selector:'#play',viewport:windowSize,
        ...(mode==='legacy-window'?{}:{coordinateRoot})}]}
    expect(taskSchema.safeParse(task).success).toBe(true)
    const result=(await runChecks(root,task,[],undefined,mode.startsWith('phone-')?{platform:'Web',inputs:['Touch'],orientation:'Landscape'}:{})).checks[0]!
    const expected=['identity','letterbox','axis-scale','offset-root','root-size-fallback','phone-valid'].includes(mode)?'passed':
      ['scaled','phone-required','ignore','wrong-center','wrong-position','overflow','legacy-window'].includes(mode)?'failed':'unverified'
    expect(result.status,result.observation).toBe(expected)
    if(mode==='source-size-conflict'||mode==='no-reference')expect(result.observation).toContain('[coordinateRoot]')
    else if(mode==='missing-minimum')expect(result.observation).toContain('[minimumControlSize]')
    else {
      const probe=JSON.parse(result.observation).probes[0]
      expect(probe.coordinateDomain).toBe(mode==='legacy-window'?'window CSS pixels':'saved logical UI pixels')
      if(['identity','scaled','letterbox','axis-scale','offset-root','root-size-fallback','phone-valid'].includes(mode)){
        for(const key of ['left','top','right','bottom'])expect(probe.before[key]).toBeCloseTo(probe.expectedBefore[key],3)
        expect(probe.before).toEqual(probe.restored)
        expect(probe.changed).toHaveLength(2)
        expect(probe.mappings).toHaveLength(4)
        expect(probe.layoutViewport).toEqual([1280,720])
        if(mode==='scaled'){
          expect(probe.before.left).toBe(540)
          expect(probe.mappings[0].physicalBounds.left).toBe(405)
          expect(probe.mappings[0].basis.scale).toEqual([.75,.75])
        }
      }
      if(mode==='changing-basis')expect(probe.reason).toContain('changed during source perturbation')
      if(mode==='self')expect(probe.reason).toContain('strict ancestor')
      if(mode==='invalid-selector')expect(probe.reason).toContain('not a valid CSS selector')
      if(['self','unrelated','missing','invalid-selector','rotate','perspective','border','wrong-root-size'].includes(mode)) {
        expect(probe.before).toBeUndefined()
        expect(probe.mappings[0].physicalBounds).toBeDefined()
      }
      if(mode==='overflow')expect(probe.textFit.before.status).toBe('failed')
      if(mode==='hidden-target-wrapper')expect(probe.reason).toContain('ancestor is hidden')
      if(mode==='ancestor-clipped')expect(probe.textFit.before.status).toBe('unverified')
      if(mode.startsWith('phone-')) {
        const phone=JSON.parse(result.observation).probes.find((value:any)=>value.viewport.join('x')==='844x390')
        expect(phone.status).toBe(mode==='phone-valid'?'passed':'failed')
        expect(phone.controlSize.minimum).toEqual([44,44])
        expect(phone.conditions.environment.maxTouchPoints).toBeGreaterThan(0)
        expect(phone.controlSize.before[1]).toBeCloseTo((mode==='phone-valid'?96:52)*390/720,1)
      }
      if(mode==='ignore')expect(probe.reason).toContain('position')
    }
    expect(await readFile(join(root,'content/ui/menu.json'),'utf8')).toBe(body)
    expect(await readFile(join(root,'dist/content/ui/menu.json'),'utf8')).toBe(body)
  }finally{await rm(root,{recursive:true,force:true})}
},30000)

test('geometry root is optional, nonempty and not silently accepted by unrelated audio/pixel probes',()=>{
  const probe={document:'content/ui/menu.json',nodeId:'play',selector:'#play',viewport:[960,540],coordinateRoot:'#surface'}
  const task={id:'coords',kind:'game.verify',goal:'Test schema scope',dependsOn:[],requirementIds:['req'],inputs:[],writablePaths:[],
    expectedOutputs:['dist/index.html'],checks:['ui-data-consumption'],runtimeArtifact:'dist'}
  expect(taskSchema.safeParse({...task,uiProbes:[probe]}).success).toBe(true)
  expect(taskSchema.safeParse({...task,uiProbes:[{...probe,coordinateRoot:' '}]}).success).toBe(false)
  expect(taskSchema.safeParse({...task,pixelProbes:[probe]}).success).toBe(false)
  expect(taskSchema.safeParse({...task,audioProbes:[{...probe,componentId:'audio',playSteps:[{click:'#play'}],stopSteps:[{click:'#stop'}]}]}).success).toBe(false)
})

test('font driver reports unsupported coordinateRoot instead of silently ignoring it',async()=>{
  await expect(prepareFontProbes('/not-accessed',{runtimeArtifact:'dist',uiProbes:[{document:'content/ui/menu.json',nodeId:'play',selector:'#play',viewport:[960,540],coordinateRoot:'#surface'}]},
    {id:'font-data-consumption',version:'test',status:'unverified',inputs:[],createdAt:'now',observation:''})).rejects.toThrow('ui-data-consumption only')
})
