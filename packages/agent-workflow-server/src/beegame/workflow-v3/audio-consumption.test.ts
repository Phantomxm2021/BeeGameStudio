import { test, expect } from 'bun:test'
import { mkdtemp, mkdir, writeFile, readFile, cp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { audioProbeWav } from './audio-consumption'
import { checkIsCurrent } from './checks'
import { runChecks } from './checker-test-driver'
import { taskSchema, type TaskSpec } from './state'
import { sceneLayoutFixture } from '../fixtures/layout-fixture'
import { assetManifestAuthoringExamples } from '../asset-manifest-authoring-contract'
import { writeBeeGameAssetManifest } from '../asset-contracts'

for (const mode of ['consume', 'music', 'legacy-audio', 'loop-true', 'member', 'ignore-volume', 'ignore-loop', 'ignore-stop', 'fetch-only', 'wrong-member',
  'missing-probe', 'missing-properties', 'stale-audio', 'silent-original', 'muted', 'not-audio', 'unrelated-error', 'decode-error', 'lazy-play', 'legacy-gap'] as const) {
  test('actual HTML audio consumes registered Scene binding: ' + mode, async () => {
    const root = await mkdtemp(join(tmpdir(), 'bgs-v3-audio-'))
    try {
      const manifest = assetManifestAuthoringExamples().canonical, resource = manifest.resources[0]!
      const file = 'assets/runtime/example/clip.wav', member = 'assets/runtime/example/member.wav'
      manifest.project_target!.asset_format_capabilities = ['wav']
      resource.root_path = file; resource.file_paths = [file, member]; resource.asset_kind = 'audio-clip'
      if(mode==='music')resource.asset_kind='music'
      if(mode==='legacy-audio')resource.asset_kind='audio'
      await mkdir(join(root, 'assets/runtime/example'), {recursive:true})
      await writeFile(join(root, file), audioProbeWav(mode === 'silent-original'))
      await writeFile(join(root, member), audioProbeWav(false))
      await writeBeeGameAssetManifest(root, manifest)
      const indexBefore = await readFile(join(root, 'assets/asset-manifest.json'), 'utf8')
      const resourcePath = join(root, JSON.parse(indexBefore).modules.resources[0])
      const resourceBefore = await readFile(resourcePath, 'utf8')
      const scene = sceneLayoutFixture() as any
      scene.assetRefs = [resource.id]
      scene.data.nodes[1].components = [{id:'sound', type:'audio-source', assetRef:resource.id,
        data:{volume:.6, loop:mode === 'loop-true', ...(mode === 'member' || mode === 'wrong-member' ? {member} : {})}}]
      if (mode === 'missing-probe') scene.data.nodes[1].components.push({id:'uncovered',type:'audio-source',assetRef:resource.id,data:{volume:.6,loop:false}})
      if (mode === 'missing-properties') delete scene.data.nodes[1].components[0].data.volume
      const source = 'content/scenes/level.json', body = JSON.stringify(scene), selected = mode === 'member' || mode === 'wrong-member' ? member : file
      await mkdir(join(root, 'content/scenes'), {recursive:true}); await writeFile(join(root, source), body)
      await writeFile(join(root, 'content/index.json'), JSON.stringify({schema:'beegame-content-package.v2',id:'fixture',sceneModel:'game-object-v2',
        documentRevision:'0'.repeat(64),assetManifestRevision:'0'.repeat(64),dimension:'2d',entryScene:'level',
        files:['scenes/level.json'],documents:[{id:'level',kind:'scene-2d',path:'scenes/level.json',loadPhase:'startup'}]}))
      await mkdir(join(root, 'dist')); await cp(join(root,'content'),join(root,'dist/content'),{recursive:true}); await cp(join(root,'assets'),join(root,'dist/assets'),{recursive:true})
      if (mode === 'stale-audio') await writeFile(join(root, 'dist', selected), 'stale')
      // Independent game HTML, no BGS renderer or application test-PASS hook.
      const script = `const scene=await fetch('/${source}').then(r=>r.json()),c=scene.data.nodes[1].components[0],a=document.querySelector('#clip');
        ${mode === 'lazy-play' ? '' : `a.src='/'+${mode === 'wrong-member' ? JSON.stringify(file) : `(c.data.member||'${file}')`};`}
        a.volume=${mode === 'ignore-volume' ? '.6' : 'c.data.volume'};a.loop=${mode === 'ignore-loop' ? 'false' : 'c.data.loop'};
        ${mode === 'muted' ? 'a.muted=true;' : ''}
        ${mode === 'fetch-only' || mode === 'wrong-member' ? `await fetch('/${selected}').then(r=>r.arrayBuffer());` : ''}
        ${mode === 'decode-error' ? "a.src='/broken.wav';" : ''}
        document.querySelector('#start').onclick=()=>{${mode === 'lazy-play' ? `setTimeout(()=>{a.src='/${file}';a.play().catch(()=>{});},100);` : mode === 'fetch-only' || mode === 'legacy-gap' ? '' : 'a.play().catch(()=>{});'}};
        document.querySelector('#stop').onclick=()=>{${mode === 'ignore-stop' ? '' : 'a.pause();'}};
        ${mode === 'unrelated-error' ? "console.error('Independent game failure');" : ''}`
      if (mode === 'decode-error') await writeFile(join(root, 'dist/broken.wav'), 'not encoded audio')
      await writeFile(join(root, 'dist/index.html'), '<button id="start">Play</button><button id="stop">Stop</button><audio id="clip" preload="auto"></audio><canvas></canvas><script type="module">'+script+'</script>')
      const task:TaskSpec = {id:'audio',kind:'game.verify',goal:'Observe saved audio consumption',dependsOn:[],requirementIds:['req.audio'],inputs:[],writablePaths:[],
        expectedOutputs:['dist/index.html'],runtimeArtifact:'dist',checks:[mode === 'legacy-gap' ? 'runtime-smoke' : 'audio-data-consumption'],audioProbes:[
          {document:source,nodeId:'board',componentId:'sound',selector:mode === 'not-audio' ? 'canvas' : '#clip',viewport:[960,540],
            playSteps:[{click:'#start'}],stopSteps:[{click:'#stop'}]},
        ]}
      const original = await readFile(join(root, selected))
      const result = (await runChecks(root, task, [])).checks[0]!
      const expected = ['consume','music','legacy-audio','loop-true','member','lazy-play','legacy-gap'].includes(mode) ? 'passed'
        : ['ignore-volume','ignore-loop','ignore-stop','fetch-only','muted','unrelated-error','decode-error'].includes(mode) ? 'failed' : 'unverified'
      expect(result.status, result.observation).toBe(expected)
      expect(await readFile(join(root, source), 'utf8')).toBe(body)
      expect(await readFile(join(root, selected))).toEqual(original)
      expect(await readFile(join(root, 'assets/asset-manifest.json'), 'utf8')).toBe(indexBefore)
      expect(await readFile(resourcePath, 'utf8')).toBe(resourceBefore)
      if (result.status === 'passed' && mode !== 'legacy-gap') {
        const observed = JSON.parse(result.observation).probes[0]
        expect(observed.before.signal.peak).toBeGreaterThan(.00001)
        expect(observed.silent.signal.peak).toBeLessThanOrEqual(.00001)
        expect(observed.changed.map((v:any)=>v.property)).toEqual(['volume','loop'])
        expect(observed.restored.playing.volume).toBe(scene.data.nodes[1].components[0].data.volume)
        expect(observed.restored.stopped.paused).toBe(true)
        expect(await checkIsCurrent(root,result)).toBe(true)
        await writeFile(join(root,selected),'changed')
        expect(await checkIsCurrent(root,result)).toBe(false)
      }
    } finally { await rm(root, {recursive:true,force:true}) }
  }, 60000)
}


test('audio probe schema requires actual play/stop operands', () => {
  const task = {id:'audio',kind:'game.develop',goal:'Check actual audio',dependsOn:[],requirementIds:['req.audio'],inputs:[],writablePaths:['dist/**'],
    expectedOutputs:['dist/index.html'],checks:['audio-data-consumption'],runtimeArtifact:'dist',
    audioProbes:[{document:'content/scenes/level.json',nodeId:'board',componentId:'sound',selector:'#clip',viewport:[960,540],playSteps:[{click:'#start'}],stopSteps:[{click:'#stop'}]}]}
  expect(taskSchema.parse(task).audioProbes).toHaveLength(1)
  expect(taskSchema.safeParse({...task,audioProbes:[{...task.audioProbes[0],stopSteps:[]}]}).success).toBe(false)
})
