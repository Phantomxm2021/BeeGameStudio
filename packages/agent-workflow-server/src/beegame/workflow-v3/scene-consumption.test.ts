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
      expect(result.status,result.observation).toBe(mode==='consume'?'passed':'unverified')
      if (mode==='ignore-node') expect(result.observation).toContain('did not change')
      if (mode==='no-fetch') expect(result.observation).toContain('did not request')
      if (mode==='unstable') expect(result.observation).toContain('not stable')
      if (mode==='stale-copy') expect(result.observation).toContain('Packed Scene differs')
      if (mode==='stale-registry') expect(result.observation).toContain('Packed content registry differs')
      expect(await readFile(join(root,'content/scenes/level.json'),'utf8')).toBe(source)
    } finally { await rm(root,{recursive:true,force:true}) }
  },30000)
}

test('autonomous measurement accepts Scene probes only with their selected check', () => {
  const sceneProbes = [{document:'content/scenes/level.json',nodeId:'board',selector:'canvas',viewport:[800,600]}]
  expect(consumptionRequest.safeParse({checks:['scene-data-consumption'],sceneProbes}).success).toBe(true)
  expect(consumptionRequest.safeParse({checks:['scene-data-consumption']}).success).toBe(false)
  expect(consumptionRequest.safeParse({checks:['ui-data-consumption'],sceneProbes}).success).toBe(false)
})
