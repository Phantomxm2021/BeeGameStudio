import { test, expect } from 'bun:test'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { checkIsCurrent, versionsMatch } from './checks'
import { runChecks } from './checker-test-driver'
import { uiLayoutFixture, sceneLayoutFixture } from '../fixtures/layout-fixture'
import type { TaskSpec } from './state'
import { prepareUiProbes } from './ui-consumption'
import { resolveUiNodesForViewport } from '../../../../scene-editor/src/ui-responsive'

test('UI consumption uses the saved Scene camera and tracks its packed identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-ui-consumption-camera-'))
  try {
    const ui: any = uiLayoutFixture(), scene = sceneLayoutFixture()
    ui.data.nodes[0].data.layoutCamera = { nodeId: 'game', path: 'content/scenes/level.json' }
    ui.data.nodes.push(
      { id: 'game', role: 'container', parentId: 'root', layout: { position: [20,20], size: [500,280] } },
      { id: 'plane', role: 'container', parentId: 'game', data: { space: 'camera-reference-2d' },
        layout: { size: [960,540], item: { absolute: true } } },
      { id: 'prompt', role: 'text', parentId: 'plane', text: 'World label', layout: { position: [100,100], size: [100,30] } },
    )
    for (const prefix of ['', 'dist/']) {
      await mkdir(join(root, prefix+'content/ui'), { recursive: true })
      await mkdir(join(root, prefix+'content/scenes'), { recursive: true })
      await writeFile(join(root, prefix+'content/ui/menu.json'), JSON.stringify(ui))
      await writeFile(join(root, prefix+'content/scenes/level.json'), JSON.stringify(scene))
    }
    await writeFile(join(root, 'content/index.json'), JSON.stringify({ schema:'beegame-content-package.v2', id:'fixture',
      dimension:'2d', entryScene:'level', files:['ui/menu.json','scenes/level.json'], documents:[
        { id:'menu', kind:'ui-screen', path:'ui/menu.json', loadPhase:'startup' },
        { id:'level', kind:'scene-2d', path:'scenes/level.json', loadPhase:'startup' },
      ] }))
    const task = { runtimeArtifact:'dist', uiProbes:[{ document:'content/ui/menu.json', nodeId:'prompt', selector:'#prompt', viewport:[600,360] as [number,number] }] }
    const result: any = { inputs:[] }
    const [probe] = await prepareUiProbes(root, task, result)
    expect(probe!.before.right - probe!.before.left).toBeCloseTo(100 * 280 / 540, 4)
    expect(probe!.variants.length).toBeGreaterThan(0)
    expect(result.inputs.map((input:any)=>input.path)).toContain('content/scenes/level.json')
    expect(result.inputs.map((input:any)=>input.path)).toContain('dist/content/scenes/level.json')
    expect(await versionsMatch(root, result.inputs)).toBe(true)
    await writeFile(join(root,'dist/content/scenes/level.json'), JSON.stringify({...scene,id:'wrong-copy'}))
    await expect(prepareUiProbes(root, task, {inputs:[]} as any)).rejects.toThrow('Packed Scene differs')
    expect(await versionsMatch(root, result.inputs)).toBe(false)
    expect(await readFile(join(root,'content/ui/menu.json'),'utf8')).toBe(JSON.stringify(ui))
  } finally { await rm(root, { recursive:true, force:true }) }
})

for (const mode of ['shown','hidden','ignore-visibility','ignore-width','partial-values'] as const)
  test('declared UI binding scenario observes actual visibility and geometry: '+mode, async()=>{
    const root=await mkdtemp(join(tmpdir(),'bgs-ui-state-scenario-'))
    try {
      const ui:any=uiLayoutFixture()
      ui.data.nodes[0].layout.size=[1280,720]
      ui.data.nodes[0].data.referenceResolution=[1280,720]
      ui.data.nodes[0].data.targetViewports=[[1280,720]]
      ui.data.nodes[1].bindings={enabled:'menuActive'}
      ui.data.nodes.push(
        {id:'toggle',parentId:'root',role:'button',text:'Toggle',layout:{position:[20,20],size:[100,52]}},
        {id:'panel',parentId:'root',role:'container',enabled:false,bindings:{enabled:'showControls'},layout:{position:[100,100],size:[300,200]}},
        {id:'bar',parentId:'panel',role:'container',bindings:{widthRatio:'progress'},layout:{position:[20,20],size:[120,30]}},
      )
      const body=JSON.stringify(ui),document='content/ui/menu.json'
      await mkdir(join(root,'content/ui'),{recursive:true});await mkdir(join(root,'dist/content/ui'),{recursive:true})
      await writeFile(join(root,document),body);await writeFile(join(root,'dist',document),body)
      await writeFile(join(root,'content/index.json'),JSON.stringify({schema:'beegame-content-package.v2',id:'fixture',dimension:'2d',
        entryScene:'menu',files:['ui/menu.json'],documents:[{id:'menu',kind:'ui-screen',path:'ui/menu.json',loadPhase:'startup'}]}))
      await writeFile(join(root,'dist/index.html'),`<!doctype html><style>body{margin:0}div,button{position:absolute;box-sizing:border-box;border:0;padding:0;margin:0}button{font:16px/20px sans-serif}</style><script>
        fetch('./content/ui/menu.json').then(r=>r.json()).then(d=>{
          const state={menuActive:true,showControls:false,progress:.5},elements=new Map();
          const render=()=>{for(const n of d.data.nodes){if(n.id==='root')continue;
            let el=elements.get(n.id);if(!el){el=document.createElement(n.role==='button'?'button':'div');el.id=n.id;el.dataset.nodeId=n.id;el.textContent=n.text||'';
              (elements.get(n.parentId)||document.body).append(el);elements.set(n.id,el);if(n.id==='toggle')el.onclick=()=>{state.showControls=true;render()};}
            const size=[...n.layout.size],p=n.layout.position||[0,0];
            if(n.bindings?.widthRatio && ${JSON.stringify(mode)}!=='ignore-width')size[0]*=state[n.bindings.widthRatio];
            const enabled=n.bindings?.enabled?state[n.bindings.enabled]:n.enabled!==false;
            Object.assign(el.style,{display:enabled||(${JSON.stringify(mode)}==='ignore-visibility'&&n.id==='panel')?'block':'none',
              left:(n.id==='play'?640-size[0]/2+p[0]:p[0])+'px',top:(n.id==='play'?360-size[1]/2+p[1]:p[1])+'px',width:size[0]+'px',height:size[1]+'px'});
          }};render();
        });</script>`)
      const shown=mode==='shown'||mode==='ignore-width'||mode==='partial-values'
      const task:TaskSpec={id:'state',kind:'game.verify',goal:'Fixture binding scenario',dependsOn:[],requirementIds:['ui'],inputs:[],writablePaths:[],
        expectedOutputs:['dist/index.html'],runtimeArtifact:'dist',checks:['ui-data-consumption'],uiProbes:[{document,nodeId:'play',selector:'#play',viewport:[1280,720],
          ...(shown?{steps:[{click:'#toggle'}]}:{}),bindingValues:{menuActive:true,showControls:shown,...(mode==='partial-values'?{}:{progress:.5})}}]}
      const result=(await runChecks(root,task,[])).checks[0]!
      expect(result.status,result.observation).toBe(mode==='shown'||mode==='hidden'?'passed':mode==='partial-values'?'unverified':'failed')
      const observation=JSON.parse(result.observation)
      expect(observation.probes[0].conditions.scenario.bindingValues.showControls).toBe(shown)
      if(mode==='shown')expect((await prepareUiProbes(root,task,{inputs:[]} as any,'selected')).map(probe=>probe.viewport)).toEqual([[1280,720]])
      if(mode==='ignore-visibility')expect(observation.probes[0].composition.before.issues).toContainEqual(expect.objectContaining({id:'panel',kind:'visibility'}))
      if(mode==='ignore-width')expect(observation.probes[0].composition.before.issues).toContainEqual(expect.objectContaining({id:'bar',kind:'geometry'}))
      expect(await readFile(join(root,document),'utf8')).toBe(body)
      expect(await readFile(join(root,'dist',document),'utf8')).toBe(body)
    }finally{await rm(root,{recursive:true,force:true})}
  },30000)

test.each(['base', 'compact', 'portrait', 'bound-node', 'bound-parent'])('enabled probe respects the actual authored/state layer: %s', async mode => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-enabled-preparation-'))
  try {
    const ui: any = uiLayoutFixture()
    const viewport: [number, number] = mode === 'portrait' ? [390, 844] : [600, 360]
    ui.data.nodes[0].data.targetViewports = [viewport]
    ui.data.nodes[0].data.compactMaxWidth = 650
    const node = ui.data.nodes[1]
    if (mode === 'compact' || mode === 'portrait') {
      node.enabled = false
      node.responsive = { compact: { enabled: true }, ...(mode === 'portrait' ? { portrait: { enabled: true } } : {}) }
    }
    if (mode === 'bound-node') node.bindings = { enabled: 'visible' }
    if (mode === 'bound-parent') ui.data.nodes[0].bindings = { enabled: 'screenVisible' }
    const body = JSON.stringify(ui), document = 'content/ui/menu.json'
    await mkdir(join(root, 'content/ui'), { recursive: true }); await mkdir(join(root, 'dist/content/ui'), { recursive: true })
    await writeFile(join(root, document), body); await writeFile(join(root, 'dist', document), body)
    await writeFile(join(root, 'content/index.json'), JSON.stringify({ schema: 'beegame-content-package.v2', id: 'fixture',
      dimension: '2d', entryScene: 'menu', files: ['ui/menu.json'], documents: [{ id: 'menu', kind: 'ui-screen', path: 'ui/menu.json', loadPhase: 'startup' }] }))
    const task = { runtimeArtifact: 'dist', uiProbes: [{ document, nodeId: 'play', selector: '#play', viewport }] }
    const result: any = { inputs: [] }
    if (mode.startsWith('bound-')) await expect(prepareUiProbes(root, task, result)).rejects.toThrow('State-bound enabled')
    else {
      const [probe] = await prepareUiProbes(root, task, result)
      const disabled = JSON.parse(probe!.disabledSource).data
      expect(resolveUiNodesForViewport(disabled.nodes, disabled.rootId, { width: viewport[0], height: viewport[1] })[1]!.enabled).toBe(false)
      if (mode !== 'base') expect(disabled.nodes[1].enabled).toBe(false)
      if (mode === 'portrait') expect(disabled.nodes[1].responsive.compact.enabled).toBe(true)
    }
    expect(await Bun.file(join(root, document)).text()).toBe(body)
    expect(await Bun.file(join(root, 'dist', document)).text()).toBe(body)
  } finally { await rm(root, { recursive: true, force: true }) }
})

for (const mode of ['correct', 'wrong-badge', 'wrong-font', 'small-sibling-control', 'missing-marker', 'dynamic-state', 'rotated-control'])
  test('runtime composition inspects unselected saved nodes: ' + mode, async () => {
    const root = await mkdtemp(join(tmpdir(), 'v3-ui-composition-'))
    try {
      const ui: any = uiLayoutFixture()
      ui.data.nodes[0].layout.size = [1280, 720]
      ui.data.nodes[0].data.referenceResolution = [1280, 720]
      ui.data.nodes[0].data.targetViewports = [[1280, 720]]
      ui.data.nodes.push(
        { id: 'panel', role: 'container', parentId: 'root', layout: { position: [100, 100], size: [300, 200] } },
        { id: 'badge', role: 'shape', parentId: 'panel', layout: { position: [20, 20], size: [80, 80] } },
        { id: 'grade', role: 'text', parentId: 'badge', text: 'A', layout: { anchor: 'middle-center', size: [60, 60] }, style: { fontSize: 24 },
          ...(mode === 'dynamic-state' ? { enabled: false, bindings: { enabled: 'showGrade' } } : {}) },
        { id: 'other-control', role: 'button', parentId: 'root', text: 'Other', layout: { position: [20, 20], size: [100, 64] } },
      )
      const body = JSON.stringify(ui)
      await mkdir(join(root, 'content/ui'), { recursive: true }); await mkdir(join(root, 'dist/content/ui'), { recursive: true })
      await writeFile(join(root, 'content/ui/menu.json'), body); await writeFile(join(root, 'dist/content/ui/menu.json'), body)
      await writeFile(join(root, 'content/index.json'), JSON.stringify({ schema: 'beegame-content-package.v2', id: 'fixture', sceneModel: 'game-object-v2',
        documentRevision: '0'.repeat(64), assetManifestRevision: '0'.repeat(64), dimension: '2d', entryScene: 'level', files: ['ui/menu.json'],
        documents: [{ id: 'menu', kind: 'ui-screen', path: 'ui/menu.json', loadPhase: 'startup' }] }))
      const html = '<!doctype html><style>body{margin:0}div,button{position:absolute;box-sizing:border-box;border:0;padding:0;margin:0}button{font:16px/20px sans-serif}</style>' +
        '<script>fetch("./content/ui/menu.json").then(r=>r.json()).then(d=>{for(const n of d.data.nodes){if(n.id==="root")continue;' +
        'const el=document.createElement(n.role==="button"?"button":"div");el.id=n.id;' +
        (mode === 'missing-marker' ? 'if(n.id!=="grade")' : '') + 'el.dataset.nodeId=n.id;' +
        'const size=n.layout.size,p=n.layout.position||[0,0];let x=p[0],y=p[1];if(n.id==="play"){x=640-size[0]/2+p[0];y=360-size[1]/2+p[1];}' +
        'if(n.id==="badge"){x=120;y=120;}if(n.id==="grade"){x=' + (mode === 'wrong-badge' ? 220 : 130) + ';y=130;}' +
        'Object.assign(el.style,{left:x+"px",top:y+"px",width:size[0]+"px",height:' +
        (mode === 'small-sibling-control' ? '(n.id==="other-control"?32:size[1])' : 'size[1]') + '+"px",fontSize:' +
        (mode === 'wrong-font' ? '(n.id==="grade"?48:n.style?.fontSize||16)' : '(n.style?.fontSize||16)') + '+"px"});el.textContent=n.text||"";' +
        (mode === 'rotated-control' ? 'if(n.id==="other-control")el.style.transform="rotate(45deg)";' : '') +
        'if(n.id==="play"&&n.enabled===false)el.style.display="none";document.body.append(el);}})</script>'
      await writeFile(join(root, 'dist/index.html'), html)
      const task: TaskSpec = { id: 'composition', kind: 'game.verify', goal: 'Synthetic unselected-node geometry', dependsOn: [], requirementIds: ['ui'],
        inputs: [], writablePaths: [], expectedOutputs: ['dist/index.html'], checks: ['ui-data-consumption'], runtimeArtifact: 'dist',
        uiProbes: [{ document: 'content/ui/menu.json', nodeId: 'play', selector: '#play', viewport: [1280, 720] }] }
      const result = (await runChecks(root, task, [])).checks[0]!
      expect(result.observation.startsWith('{'), result.observation).toBe(true)
      const observed = JSON.parse(result.observation).probes[0]
      expect(result.status, result.observation).toBe(['wrong-badge', 'wrong-font', 'small-sibling-control'].includes(mode) ? 'failed' :
        ['missing-marker', 'dynamic-state', 'rotated-control'].includes(mode) ? 'unverified' : 'passed')
      const composition = observed.composition.before
      if (mode === 'correct') expect(composition.status).toBe('passed')
      if (mode === 'wrong-badge') expect(composition.issues).toContainEqual(expect.objectContaining({ id: 'grade', kind: 'geometry' }))
      if (mode === 'wrong-font') expect(composition.issues).toContainEqual(expect.objectContaining({ id: 'grade', kind: 'font-size' }))
      if (mode === 'small-sibling-control') expect(composition.issues).toContainEqual(expect.objectContaining({ id: 'other-control', kind: 'minimum-control-size' }))
      if (mode === 'missing-marker' || mode === 'dynamic-state') {
        expect(composition.status).toBe('unverified')
        expect(composition.unverified).toContainEqual(expect.objectContaining({ id: 'grade' }))
      }
      if (mode === 'rotated-control') expect(composition.unverified).toContainEqual(expect.objectContaining({ id: 'other-control' }))
      expect(await Bun.file(join(root, 'content/ui/menu.json')).text()).toBe(body)
      expect(await Bun.file(join(root, 'dist/content/ui/menu.json')).text()).toBe(body)
    } finally { await rm(root, { recursive: true, force: true }) }
  }, 30000)

for (const mode of ['consume', 'ignore-enabled', 'remove-disabled', 'disabled-crash', 'disabled-missing-resource', 'disabled-activation', 'ignore', 'wrong', 'position-only', 'size-only', 'hidden', 'omit', 'stale-copy', 'missing-screen', 'missing-viewport', 'tiny', 'overflow', 'clipped', 'hidden-text', 'wrapped', 'pseudo', 'unknown-node', 'hidden-ancestor', 'ancestor-clipped', 'invalid-target-selector', 'source-inactive', 'rotated-control'] as const) {
  test('actual target UI source mutation: '+mode, async () => {
    const root = await mkdtemp(join(tmpdir(), 'bgs-v3-ui-consumption-'))
    try {
      const ui = uiLayoutFixture(); ui.data.nodes[0]!.data!.referenceResolution = [1280, 720]
      ui.data.nodes[0]!.data!.targetViewports = [[1280,720]]
      if (mode === 'missing-viewport') ui.data.nodes[0]!.data!.targetViewports = [[1280,720],[720,1280]]
      if (mode === 'tiny') Object.assign(ui.data.nodes[1]!.layout,{scale:[0.01,0.01]})
      if (mode === 'source-inactive') Object.assign(ui.data.nodes[1]!,{enabled:false})
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
        (mode==='rotated-control'?'#play{transform:rotate(45deg)}':'')+
        (mode==='pseudo'?'#play span::after{content:"Unmeasured label";display:block}':'')+'</style><button id="play">Play</button><script>'+
        (mode === 'omit' ? '' : 'fetch("./content/ui/menu.json").then(r=>r.json()).then(d=>{const n=d.data.nodes.find(n=>n.id==="play"), b=document.querySelector("#play"), s='+
        (['ignore','position-only'].includes(mode) ? '[200,52]' : 'n.layout.size')+',p='+(['ignore','size-only'].includes(mode) ? '[0,0]' : 'n.layout.position||[0,0]')+';'+
        'b.style.width=s[0]+"px";b.style.height=s[1]+"px";b.style.left=(640-s[0]/2+p[0]'+(mode === 'wrong' ? '*2' : '')+')+"px";b.style.top=(360-s[1]/2+p[1])+"px";'+
        (mode === 'ignore-enabled' ? '' : 'if(n.enabled===false){'+
          (mode === 'remove-disabled' || mode === 'disabled-crash' ? 'b.remove();' : 'b.style.display="none";')+
          (mode === 'disabled-crash' ? 'throw Error("Disabled render failed");' : '')+
          (mode === 'disabled-missing-resource' ? 'fetch("./missing.json");' : '')+'}')+
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
      if(mode==='source-inactive')task.uiProbes![0]!.steps=[{click:'#play'}]
      if(mode==='disabled-activation')task.uiProbes![0]!.steps=[{click:'#play'}]
      // One malformed runtime selector must not discard a separate valid
      // observation in the same batch, or lose the source/node identity.
      if(mode==='invalid-target-selector')task.uiProbes!.push({...task.uiProbes![0]!,selector:'['})
      const result = (await runChecks(root, task, [])).checks[0]!
      // Tiny skips the sub-tolerance size mutation, but its observable position
      // remains. This fixture renderer ignores scale: baseline mismatch is a
      // demonstrated failure, not a reason to discard the whole probe.
      expect(result.status, result.observation).toBe(['consume','remove-disabled','hidden-text','wrapped'].includes(mode) ? 'passed' : ['ignore-enabled','disabled-crash','disabled-missing-resource','ignore','wrong','position-only','size-only','overflow','tiny'].includes(mode) ? 'failed' : 'unverified')
      expect(await Bun.file(join(root,'content/ui/menu.json')).text()).toBe(body)
      if(mode!=='stale-copy')expect(await Bun.file(join(root,'dist/content/ui/menu.json')).text()).toBe(body)
      if(['consume','remove-disabled','ignore-enabled'].includes(mode)){
        const probe=JSON.parse(result.observation).probes[0]
        expect(probe.enabled).toEqual({beforeVisible:true,disabledVisible:mode==='ignore-enabled',restoredVisible:true})
        if(mode==='ignore-enabled')expect(probe.reason).toContain('enabled=false is ignored')
      }
      if(mode==='disabled-activation')expect(JSON.parse(result.observation).probes[0].reason).toContain('activation path')
      if(mode==='rotated-control')expect(JSON.parse(result.observation).probes[0].reason).toContain('bounding boxes are insufficient')
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
      if(mode==='source-inactive'){
        expect(result.observation).toContain('content/ui/menu.json#play @ 1280x720 [layout]')
        expect(result.observation).toContain('Click steps change the runtime DOM, not saved-layout eligibility')
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
      '</button></div><script>fetch("./content/ui/menu.json").then(r=>r.json()).then(d=>{const n=d.data.nodes[1],b=document.querySelector("#play");'+
      (stretch?'const s='+(mode==='stretch-ignore'?'[200,52]':'[1280+n.layout.sizeDelta[0],n.layout.sizeDelta[1]]')+
        ',p=n.layout.position||[0,0];b.style.left=p[0]+"px";b.style.top=p[1]+"px";':
        'const s='+(mode==='flow-ignore'?'[200,52]':'n.layout.size')+';')+
      'b.style.width=s[0]+"px";b.style.height=s[1]+"px";if(n.enabled===false)b.style.display="none";})</script>'
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
