import { test, expect } from 'bun:test'
import { mkdtemp, mkdir, writeFile, rm, cp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sceneLayoutFixture } from '../fixtures/layout-fixture'
import { runChecks } from './checker-test-driver'
import { consumptionRequest } from './agent-measurement'
import type { TaskSpec } from './state'

for (const mode of ['consume','ignore-node','no-fetch','unstable','stale-copy','stale-registry'] as const) {
  test('selected saved Scene node affects actual Canvas: '+mode, async () => {
    const root = await mkdtemp(join(tmpdir(),'bgs-scene-causality-'))
    try {
      await mkdir(join(root,'content/scenes'),{recursive:true})
      const doc = sceneLayoutFixture(), source = JSON.stringify(doc)
      await writeFile(join(root,'content/scenes/level.json'),source)
      await writeFile(join(root,'content/index.json'),JSON.stringify({schema:'beegame-content-package.v2',id:'fixture',sceneModel:'game-object-v2',
        documentRevision:'0'.repeat(64),assetManifestRevision:'0'.repeat(64),dimension:'2d',entryScene:doc.id,
        files:['scenes/level.json'],documents:[{id:doc.id,kind:'scene-2d',path:'scenes/level.json',loadPhase:'startup'}]}))
      await mkdir(join(root,'dist'))
      await cp(join(root,'content'),join(root,'dist/content'),{recursive:true})
      if (mode === 'stale-copy') await writeFile(join(root,'dist/content/scenes/level.json'),JSON.stringify({...doc,id:'other'}))
      if (mode === 'stale-registry') await writeFile(join(root,'dist/content/index.json'),'{}')
      const fetchScene = mode === 'no-fetch' ? '' : 'const scene=await fetch("./content/scenes/level.json").then(r=>r.json());'
      const condition = mode === 'consume' || mode === 'stale-copy' ? 'scene.data.nodes.find(n=>n.id==="board").enabled!==false' : 'true'
      const draw = mode === 'unstable' ? 'ctx.fillStyle=`rgb(${Math.floor(Math.random()*256)},0,0)`;ctx.fillRect(10,10,50,40);' :
        `if(${condition}){ctx.fillStyle="#ee9933";ctx.fillRect(10,10,50,40);}`
      await writeFile(join(root,'dist/index.html'),`<canvas width="100" height="100"></canvas><script type="module">${fetchScene}const ctx=document.querySelector('canvas').getContext('2d');${draw}</script>`)
      const task:TaskSpec = {id:'scene',kind:'game.verify',goal:'Observe saved Scene node',dependsOn:[],requirementIds:['req.scene'],
        inputs:[],writablePaths:[],expectedOutputs:['dist/index.html'],runtimeArtifact:'dist',checks:['scene-data-consumption'],
        sceneProbes:[{document:'content/scenes/level.json',nodeId:'board',selector:'canvas',viewport:[800,600]}]}
      const result = (await runChecks(root,task,[])).checks[0]!
      // This legacy fixture implements enabled only, not transform geometry.
      expect(result.status,result.observation).toBe('unverified')
      if(mode==='consume')expect(result.observation).toContain('enabled causality alone is not transform evidence')
      if (mode==='ignore-node') expect(result.observation).toContain('did not change')
      if (mode==='no-fetch') expect(result.observation).toContain('did not request')
      if (mode==='unstable') expect(result.observation).toContain('not stable')
      if (mode==='stale-copy') expect(result.observation).toContain('Packed Scene differs')
      if (mode==='stale-registry') expect(result.observation).toContain('Packed content registry differs')
      expect(await readFile(join(root,'content/scenes/level.json'),'utf8')).toBe(source)
    } finally { await rm(root,{recursive:true,force:true}) }
  },30000)
}

for(const mode of ['correct','ignore-local-rotation','ignore-parent-rotation','ignore-scale','ignore-parent'] as const)
  test('Scene transform proof compares real Sprite pixels to source-derived polygons: '+mode,async()=>{
    const root=await mkdtemp(join(tmpdir(),'bgs-scene-transforms-'))
    try {
      await mkdir(join(root,'content/scenes'),{recursive:true})
      const scene={schema:'beegame-content.v1',id:'level',kind:'scene-2d',assetRefs:[],data:{cameraNodeId:'camera',
        settings:{coordinateSystem:{origin:'top-left',units:'logical-pixels',width:200,height:160,pixelsPerUnit:100}},nodes:[
          {id:'camera',transform:{position:[100,80,0]},components:[{id:'camera',type:'camera',data:{orthographic:true,orthographicSize:.8,coordinateSpace:'logical-pixels',viewport:{width:200,height:160}}}]},
          {id:'group',transform:{position:[8,4,0]}},
          {id:'board',parentId:'group',transform:{position:[60,50,0]},components:[{id:'visual',type:'sprite-renderer',data:{size:[36,24],color:'#ee9933'}}]},
        ]}}
      const source=JSON.stringify(scene)
      await writeFile(join(root,'content/scenes/level.json'),source)
      await writeFile(join(root,'content/index.json'),JSON.stringify({schema:'beegame-content-package.v2',id:'fixture',dimension:'2d',entryScene:'level',
        files:['scenes/level.json'],documents:[{id:'level',kind:'scene-2d',path:'scenes/level.json',loadPhase:'startup'}]}))
      await mkdir(join(root,'dist'));await cp(join(root,'content'),join(root,'dist/content'),{recursive:true})
      // Independent small Canvas implementation, not the host geometry helper.
      await writeFile(join(root,'dist/index.html'),`<!doctype html><style>body{margin:0}</style><canvas width="200" height="160"></canvas><script type="module">
        const d=await fetch('./content/scenes/level.json').then(r=>r.json()),nodes=new Map(d.data.nodes.map(n=>[n.id,n])),mode=${JSON.stringify(mode)};
        const multiply=(p,n)=>[p[0]*n[0]+p[2]*n[1],p[1]*n[0]+p[3]*n[1],p[0]*n[2]+p[2]*n[3],p[1]*n[2]+p[3]*n[3],p[0]*n[4]+p[2]*n[5]+p[4],p[1]*n[4]+p[3]*n[5]+p[5]];
        const pose=n=>{const t=n.transform||{},p=t.position||[0,0,0],s=mode==='ignore-scale'?[1,1,1]:t.scale||[1,1,1];let r=(t.rotation||[0,0,0])[2];
          if(mode==='ignore-local-rotation'&&n.id==='board'||mode==='ignore-parent-rotation'&&n.id!=='board')r=0;
          const c=Math.cos(r),q=Math.sin(r),local=[c*s[0],q*s[0],-q*s[1],c*s[1],p[0],p[1]];
          return n.parentId&&mode!=='ignore-parent'?multiply(pose(nodes.get(n.parentId)),local):local;};
        const active=n=>n.enabled!==false&&(!n.parentId||active(nodes.get(n.parentId)));
        const ctx=document.querySelector('canvas').getContext('2d'),n=nodes.get('board'),v=n.components[0].data;
        if(active(n)){ctx.setTransform(...pose(n));ctx.fillStyle=v.color;ctx.fillRect(-v.size[0]/2,-v.size[1]/2,...v.size);}
      </script>`)
      const task:TaskSpec={id:'transform',kind:'game.verify',goal:'Fixture transforms',dependsOn:[],requirementIds:['scene'],inputs:[],writablePaths:[],
        expectedOutputs:['dist/index.html'],runtimeArtifact:'dist',checks:['scene-data-consumption'],sceneProbes:[{document:'content/scenes/level.json',nodeId:'board',selector:'canvas',viewport:[200,160]}]}
      const result=(await runChecks(root,task,[])).checks[0]!
      expect(result.status,result.observation).toBe(mode==='correct'?'passed':'failed')
      const transforms=JSON.parse(result.observation).probes[0].transforms
      expect(transforms.map((t:any)=>t.property)).toEqual(['baseline-geometry','local-position','local-rotation','local-scale','parent-position','parent-rotation','parent-scale'])
      if(mode!=='correct')expect(transforms.some((t:any)=>t.status==='failed')).toBe(true)
      expect(await readFile(join(root,'content/scenes/level.json'),'utf8')).toBe(source)
      expect(await readFile(join(root,'dist/content/scenes/level.json'),'utf8')).toBe(source)
    }finally{await rm(root,{recursive:true,force:true})}
  },30000)

test('autonomous measurement accepts Scene probes only with their selected check', () => {
  const sceneProbes = [{document:'content/scenes/level.json',nodeId:'board',selector:'canvas',viewport:[800,600]}]
  expect(consumptionRequest.safeParse({checks:['scene-data-consumption'],sceneProbes}).success).toBe(true)
  expect(consumptionRequest.safeParse({checks:['scene-data-consumption']}).success).toBe(false)
  expect(consumptionRequest.safeParse({checks:['ui-data-consumption'],sceneProbes}).success).toBe(false)
})
