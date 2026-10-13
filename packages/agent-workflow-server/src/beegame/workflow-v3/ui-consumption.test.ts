import { test, expect } from 'bun:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runChecks, checkIsCurrent } from './checks'
import { uiLayoutFixture } from '../fixtures/layout-fixture'
import type { TaskSpec } from './state'

for (const mode of ['consume', 'ignore', 'wrong', 'position-only', 'size-only', 'hidden', 'omit', 'stale-copy', 'missing-screen', 'missing-viewport', 'tiny', 'overflow', 'clipped', 'hidden-text', 'wrapped', 'pseudo', 'unknown-node', 'hidden-ancestor', 'ancestor-clipped', 'invalid-target-selector'] as const) {
  test('actual target UI source mutation: '+mode, async () => {
    const root = await mkdtemp(join(tmpdir(), 'bgs-v3-ui-consumption-'))
    try {
      const ui = uiLayoutFixture(); ui.data.nodes[0]!.data!.referenceResolution = [1280, 720]
      ui.data.nodes[0]!.data!.targetViewports = [[1280,720]]
      if (mode === 'missing-viewport') ui.data.nodes[0]!.data!.targetViewports = [[1280,720],[720,1280]]
      if (mode === 'tiny') Object.assign(ui.data.nodes[1]!.layout,{scale:[0.01,0.01]})
      ui.data.nodes[0]!.layout.size = [1280, 720]
      await mkdir(join(root, 'content/ui'), { recursive: true }); await mkdir(join(root, 'dist/content/ui'), { recursive: true })
      const body = JSON.stringify(ui)
      await writeFile(join(root, 'content/ui/menu.json'), body)
      await writeFile(join(root, 'dist/content/ui/menu.json'), mode === 'stale-copy' ? JSON.stringify(uiLayoutFixture()) : body)
      await writeFile(join(root, 'content/index.json'), JSON.stringify({ schema: 'beegame-content-package.v2', id: 'fixture', sceneModel: 'game-object-v2', documentRevision: '0'.repeat(64), assetManifestRevision: '0'.repeat(64),
        dimension: '2d', entryScene: 'level', files: ['ui/menu.json','scenes/level.json'], documents: [
          { id: 'menu', kind: 'ui-screen', path: 'ui/menu.json', loadPhase: 'startup' }, { id: 'level', kind: 'scene-2d', path: 'scenes/level.json', loadPhase: 'startup' },
          ...(mode === 'missing-screen' ? [{id:'pause',kind:'ui-screen',path:'ui/pause.json',loadPhase:'on-demand'}] : []),
        ] }))
      // Different target renderer, not BGS's preview or an Agent PASS driver.
      const html = '<!doctype html><style>body{margin:0}button{position:absolute;box-sizing:border-box}'+
        (mode==='pseudo'?'#play span::after{content:"Unmeasured label";display:block}':'')+'</style><button id="play">Play</button><script>'+
        (mode === 'omit' ? '' : 'fetch("/content/ui/menu.json").then(r=>r.json()).then(d=>{const n=d.data.nodes.find(n=>n.id==="play"), b=document.querySelector("#play"), s='+
        (['ignore','position-only'].includes(mode) ? '[200,52]' : 'n.layout.size')+',p='+(['ignore','size-only'].includes(mode) ? '[0,0]' : 'n.layout.position||[0,0]')+';'+
        'b.style.width=s[0]+"px";b.style.height=s[1]+"px";b.style.left=(640-s[0]/2+p[0]'+(mode === 'wrong' ? '*2' : '')+')+"px";b.style.top=(360-s[1]/2+p[1])+"px";'+
        (mode === 'hidden' ? 'b.style.display="none";' : '')+
        (['overflow','clipped'].includes(mode) ? 'b.style.padding="0";b.style.fontSize="20px";b.style.lineHeight="52px";b.innerHTML="<span style=display:block>First row</span><span style=display:block>Second row</span>";'+(mode==='clipped'?'b.style.overflow="hidden";':'') : '')+
        (mode==='hidden-text' ? 'b.innerHTML="Play<span style=display:none;position:absolute;top:200px>Hidden text</span>";' : '')+
        (mode==='wrapped' ? 'b.style.fontSize="16px";b.style.lineHeight="20px";b.innerHTML="<span>First line<br>Second line</span>";' : '')+'})')+'</script>'
      const targetHtml=mode==='pseudo'?html.replace('<button id="play">Play</button>','<button id="play"><span>Play</span></button>'):
        mode==='hidden-ancestor'?html.replace('<button id="play">Play</button>','<div style="opacity:0"><button id="play">Play</button></div>'):
        mode==='ancestor-clipped'?html.replace('<button id="play">Play</button>','<div style="position:absolute;left:0;top:0;width:1280px;height:345px;overflow:hidden"><button id="play">Play</button></div>'):html
      await writeFile(join(root, 'dist/index.html'), targetHtml)
      const task: TaskSpec = { id: 'consume', kind: 'game.verify', goal: 'Verify saved UI is used', dependsOn: [], requirementIds: ['req.loop'], inputs: [],
        writablePaths: [], expectedOutputs: ['dist/index.html'], checks: ['ui-data-consumption'], runtimeArtifact: 'dist',
        uiProbes: [{ document: 'content/ui/menu.json', nodeId: 'play', selector: '#play', viewport: [1280,720] }] }
      if(mode==='unknown-node')task.uiProbes!.push({document:'content/ui/menu.json',nodeId:'missing',selector:'#missing',viewport:[1280,720]})
      // One malformed runtime selector must not discard a separate valid
      // observation in the same batch, or lose the source/node identity.
      if(mode==='invalid-target-selector')task.uiProbes!.push({...task.uiProbes![0]!,selector:'['})
      const result = (await runChecks(root, task, [])).checks[0]!
      // Tiny skips the sub-tolerance size mutation, but its observable position
      // remains. This fixture renderer ignores scale: baseline mismatch is a
      // demonstrated failure, not a reason to discard the whole probe.
      expect(result.status, result.observation).toBe(['consume','hidden-text','wrapped'].includes(mode) ? 'passed' : ['ignore','wrong','position-only','size-only','overflow','tiny'].includes(mode) ? 'failed' : 'unverified')
      expect(await Bun.file(join(root,'content/ui/menu.json')).text()).toBe(body)
      if(mode==='missing-screen')expect(result.observation).toContain('omit registered UI')
      if(mode==='missing-viewport')expect(result.observation).toContain('omit authored target viewports')
      if(mode==='overflow')expect(JSON.parse(result.observation).probes[0].textFit.before).toMatchObject({status:'failed'})
      if(mode==='clipped')expect(JSON.parse(result.observation).probes[0].textFit.before).toMatchObject({status:'unverified'})
      if(mode==='pseudo')expect(JSON.parse(result.observation).probes[0].textFit.before).toMatchObject({status:'unverified',pseudo:true})
      if(mode==='hidden-ancestor')expect(JSON.parse(result.observation).probes[0].reason).toContain('ancestor is hidden')
      if(mode==='ancestor-clipped')expect(JSON.parse(result.observation).probes[0].textFit.before).toMatchObject({status:'unverified',clippedCount:expect.any(Number)})
      if(mode==='invalid-target-selector'){
        const actual=JSON.parse(result.observation)
        expect(actual.probes).toHaveLength(2)
        expect(actual.probes[0].status).toBe('passed')
        expect(actual.probes[1]).toMatchObject({document:'content/ui/menu.json',nodeId:'play',viewport:[1280,720],status:'unverified'})
        expect(actual.probes[1].reason).toContain('selector')
      }
      if(['hidden-text','wrapped'].includes(mode))expect(JSON.parse(result.observation).probes[0].textFit.before).toMatchObject({status:'passed'})
      if(mode==='tiny')expect(result.observation).toContain('below observation tolerance')
      if(['stale-copy','tiny'].includes(mode))expect(JSON.stringify(result)).toContain('content/ui/menu.json')
      if(mode==='stale-copy'){
        expect(result.observation).toContain('#play @ 1280x720 [packedSource]')
        expect(result.coverage?.files).toEqual([])
      }
      if(mode==='unknown-node'){
        expect(result.observation).toContain('content/ui/menu.json#missing @ 1280x720 [node]')
        expect(result.coverage?.files).toEqual([])
      }
      if (mode === 'consume') {
        const actual = JSON.parse(result.observation)
        expect(actual.probes[0].changed).toHaveLength(2)
        for(const changed of actual.probes[0].changed)expect(actual.probes[0].before).not.toEqual(changed.actual)
        expect(actual.probes[0].before).toEqual(actual.probes[0].restored)
        expect(await checkIsCurrent(root, result)).toBe(true)
        await writeFile(join(root, 'content/ui/menu.json'), JSON.stringify(uiLayoutFixture(64)))
        expect(await checkIsCurrent(root, result)).toBe(false)
      }
      expect(await Bun.file(join(root, 'dist/content/ui/menu.json')).text()).toBe(mode === 'stale-copy' ? JSON.stringify(uiLayoutFixture()) : body)
    } finally { await rm(root, { recursive: true, force: true }) }
  }, 30000)
}

// Independent native CSS rendering of normal flow/stretch/clamped layouts.
// These synthetic roots are not a repair or copy of the paid test game.
for(const mode of ['flow','flow-ignore','stretch','stretch-ignore','fixed','fixed-overflow'] as const)
test('UI causality uses observable properties, not forced anchored boxes: '+mode,async()=>{
  const root=await mkdtemp(join(tmpdir(),'bgs-ui-observable-'))
  try{
    const ui=uiLayoutFixture() as any
    ui.data.nodes[0].data.targetViewports=[[1280,720]]
    ui.data.nodes[0].layout.size=[1280,720]
    const stretch=mode.startsWith('stretch'),fixed=mode.startsWith('fixed')
    ui.data.nodes[1].layout=stretch?{anchor:'top-left',anchorMin:[0,0],anchorMax:[1,0],sizeDelta:[-1080,52]}:
      {size:[200,52],...(fixed?{minSize:[200,52],maxSize:[200,52]}:{})}
    if(!stretch)ui.data.nodes[0].layout.container={direction:'column',align:'start',justify:'start'}
    await mkdir(join(root,'content/ui'),{recursive:true});await mkdir(join(root,'dist/content/ui'),{recursive:true})
    const body=JSON.stringify(ui)
    await writeFile(join(root,'content/ui/menu.json'),body);await writeFile(join(root,'dist/content/ui/menu.json'),body)
    await writeFile(join(root,'content/index.json'),JSON.stringify({schema:'beegame-content-package.v2',id:'fixture',sceneModel:'game-object-v2',
      documentRevision:'0'.repeat(64),assetManifestRevision:'0'.repeat(64),dimension:'2d',entryScene:'level',
      files:['ui/menu.json','scenes/level.json'],documents:[{id:'menu',kind:'ui-screen',path:'ui/menu.json',loadPhase:'startup'},
      {id:'level',kind:'scene-2d',path:'scenes/level.json',loadPhase:'startup'}]}))
    const html='<!doctype html><style>body{margin:0}#panel{width:1280px;height:720px;display:flex;flex-direction:column;align-items:flex-start}'+
      'button{box-sizing:border-box;padding:0;border:0;font-size:16px;line-height:20px}'+(stretch?'button{position:absolute}':'')+
      (fixed?'button{min-width:200px;max-width:200px;min-height:52px;max-height:52px}':'')+
      (mode==='fixed-overflow'?'button{line-height:52px}':'')+'</style><div id="panel"><button id="play">'+
      (mode==='fixed-overflow'?'<span style="display:block">First row</span><span style="display:block">Second row</span>':'Play')+
      '</button></div><script>fetch("/content/ui/menu.json").then(r=>r.json()).then(d=>{const n=d.data.nodes[1],b=document.querySelector("#play");'+
      (stretch?'const s='+(mode==='stretch-ignore'?'[200,52]':'[1280+n.layout.sizeDelta[0],n.layout.sizeDelta[1]]')+
        ',p=n.layout.position||[0,0];b.style.left=p[0]+"px";b.style.top=p[1]+"px";':
        'const s='+(mode==='flow-ignore'?'[200,52]':'n.layout.size')+';')+
      'b.style.width=s[0]+"px";b.style.height=s[1]+"px";})</script>'
    await writeFile(join(root,'dist/index.html'),html)
    const task:TaskSpec={id:'observable',kind:'game.verify',goal:'Synthetic layout causality',dependsOn:[],requirementIds:['req'],
      inputs:[],writablePaths:[],expectedOutputs:['dist/index.html'],checks:['ui-data-consumption'],runtimeArtifact:'dist',
      uiProbes:[{document:'content/ui/menu.json',nodeId:'play',selector:'#play',viewport:[1280,720]}]}
    const result=(await runChecks(root,task,[])).checks[0]!,actual=JSON.parse(result.observation).probes[0]
    expect(result.status,result.observation).toBe(mode==='flow'||mode==='stretch'?'passed':mode==='fixed'?'unverified':'failed')
    expect(actual.document).toBe('content/ui/menu.json');expect(actual.nodeId).toBe('play')
    if(stretch)expect(actual.changed.map((v:any)=>v.property)).toEqual(['position','sizeDelta'])
    else{
      expect(actual.changed.map((v:any)=>v.property)).toEqual(fixed?[]:['size'])
      expect(actual.unobservedProperties).toContainEqual({property:'position',reason:expect.stringContaining('overrides')})
      expect(result.coverage?.limitations.join(' ')).toContain('unobserved: position')
    }
    if(mode==='flow-ignore'||mode==='stretch-ignore')expect(actual.reason).toContain(stretch?'sizeDelta':'size')
    if(mode==='fixed')expect(actual.reason).toContain('No observable saved layout property')
    if(mode==='fixed-overflow'){
      expect(actual.textFit.before.status).toBe('failed')
      expect(actual.reason).toContain('Visible text exceeds node bounds at baseline')
    }
    expect(await Bun.file(join(root,'content/ui/menu.json')).text()).toBe(body)
    expect(await Bun.file(join(root,'dist/content/ui/menu.json')).text()).toBe(body)
  }finally{await rm(root,{recursive:true,force:true})}
},30000)
