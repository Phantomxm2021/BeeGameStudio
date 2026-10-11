import { test, expect } from 'bun:test'
import { mkdtemp, mkdir, writeFile, readFile, cp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { audioProbeWav } from './audio-consumption'
import { runChecks, checkIsCurrent, bindInputs, readVersion, settlementInputs } from './checks'
import { createRun, publishPlan, claimTask, finishTask, type TaskSpec } from './state'
import { sceneLayoutFixture } from '../fixtures/layout-fixture'
import { assetManifestAuthoringExamples } from '../asset-manifest-authoring-contract'
import { writeBeeGameAssetManifest } from '../asset-contracts'

for (const mode of ['consume', 'loop-true', 'member', 'ignore-volume', 'ignore-loop', 'ignore-stop', 'fetch-only', 'wrong-member',
  'missing-probe', 'missing-properties', 'stale-audio', 'silent-original', 'muted', 'not-audio', 'unrelated-error', 'decode-error', 'lazy-play', 'legacy-gap', 'review-repair'] as const) {
  test('actual HTML audio consumes registered Scene binding: ' + mode, async () => {
    const root = await mkdtemp(join(tmpdir(), 'bgs-v3-audio-'))
    try {
      const manifest = assetManifestAuthoringExamples().canonical, resource = manifest.resources[0]!
      const file = 'assets/runtime/example/clip.wav', member = 'assets/runtime/example/member.wav'
      manifest.project_target!.asset_format_capabilities = ['wav']
      resource.root_path = file; resource.file_paths = [file, member]; resource.asset_kind = 'audio-clip'
      await mkdir(join(root, 'assets/runtime/example'), {recursive:true})
      await writeFile(join(root, file), audioProbeWav(mode === 'silent-original'))
      await writeFile(join(root, member), audioProbeWav(false))
      await writeBeeGameAssetManifest(root, manifest)
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
        a.volume=${mode === 'ignore-volume' || mode === 'review-repair' ? '.6' : 'c.data.volume'};a.loop=${mode === 'ignore-loop' ? 'false' : 'c.data.loop'};
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
      const expected = ['consume','loop-true','member','lazy-play','legacy-gap'].includes(mode) ? 'passed'
        : ['ignore-volume','ignore-loop','ignore-stop','fetch-only','muted','unrelated-error','decode-error','review-repair'].includes(mode) ? 'failed' : 'unverified'
      expect(result.status, result.observation).toBe(expected)
      expect(await readFile(join(root, source), 'utf8')).toBe(body)
      expect(await readFile(join(root, selected))).toEqual(original)
      if (mode === 'review-repair') await audioReviewRepair(root, task)
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

async function audioReviewRepair(root: string, measured: TaskSpec) {
  const original = createRun({projectId:'fixture',ownerId:'owner',workspacePath:root,chatSessionId:'chat',requestKey:'audio-review',
    text:'The actual game consumes saved Scene audio volume and loop and can stop playback.',constraints:{},ids:['req.audio']})
  const owner:TaskSpec = {...measured,id:'owner',kind:'game.develop',writablePaths:['dist/**'],checks:['runtime-smoke'],audioProbes:undefined}
  const review:TaskSpec = {id:'review',kind:'game.verify',goal:'Review actual audio input use',dependsOn:['owner'],requirementIds:['req.audio'],
    inputs:['output:owner/dist/index.html'],writablePaths:['reviews/**'],expectedOutputs:['reviews/first.json'],checks:['review-findings'],reviewReport:'reviews/first.json'}
  let run = publishPlan(original,{protocol:original.protocol,baseRevision:0,requirementsRevision:original.requirements.revision,tasks:[owner,review]})
  const complete = async (spec:TaskSpec, key:string) => {
    const claimed = claimTask(run,{taskId:spec.id,requestKey:key,workerId:'worker',sessionId:key,inputVersions:await bindInputs(run,spec)})
    run = finishTask(claimed,claimed.writer!.attemptId,claimed.fence,await runChecks(root,spec,claimed.attempts.at(-1)!.inputVersions,undefined,{},
      {run:claimed,attempt:claimed.attempts.at(-1)!}),true)
  }
  await complete(owner,'owner')
  expect(run.tasks.owner!.status).toBe('succeeded')
  await mkdir(join(root,'reviews'))
  const source = await readVersion(root,'dist/index.html')
  const finding = {id:'F1',requirementId:'req.audio',ownerTaskId:'owner',severity:'blocker',sources:[{...source,quote:'a.volume=.6'}],
    impact:'Saved volume changes are ignored by the actual audio player',close:'Consume saved volume; verify current game playback',verifyWith:['audio-data-consumption']}
  await writeFile(join(root,'reviews/first.json'),JSON.stringify({requirementsRevision:run.requirements.revision,planRevision:run.planRevision,findings:[finding],closed:[],
    limitations:['Synthetic reviewer judgement; actual browser evidence required']}))
  await complete(review,'review')
  expect(run.tasks.review!.status).toBe('failed')
  const prior = run.attempts.at(-1)!, history = structuredClone(run.attempts)
  const repair:TaskSpec = {...owner,audioProbes:measured.audioProbes,inputs:['dist/index.html'],checks:['audio-data-consumption','repair-verification'],repairOf:{attemptId:prior.attemptId,findingIds:['F1']}}
  const follow:TaskSpec = {...review,reviewOf:prior.attemptId,expectedOutputs:['reviews/second.json'],reviewReport:'reviews/second.json'}
  run = publishPlan(run,{protocol:run.protocol,baseRevision:run.planRevision,requirementsRevision:run.requirements.revision,tasks:[repair,follow]})
  const claimed = claimTask(run,{taskId:'owner',requestKey:'repair',workerId:'worker',sessionId:'repair',inputVersions:await bindInputs(run,repair)})
  const failed = await runChecks(root,repair,claimed.attempts.at(-1)!.inputVersions,undefined,{}, {run:claimed,attempt:claimed.attempts.at(-1)!})
  expect(failed.checks.find(c=>c.id==='audio-data-consumption')!.status).toBe('failed')
  expect(failed.checks.find(c=>c.id==='repair-verification')!.status).toBe('unverified')
  // Only a synthetic authorized writer is emulated here; never modify real
  // project outputs. No source or decoded-audio PASS is supplied by the writer.
  await writeFile(join(root,'dist/index.html'),(await readFile(join(root,'dist/index.html'),'utf8')).replace('a.volume=.6','a.volume=c.data.volume'))
  const input = await settlementInputs(root,repair,claimed.attempts.at(-1)!.inputVersions)
  run = finishTask(claimed,claimed.writer!.attemptId,claimed.fence,await runChecks(root,repair,input,undefined,{}, {run:claimed,attempt:claimed.attempts.at(-1)!}),true)
  expect(run.tasks.owner!.status).toBe('succeeded')
  const repaired = run.attempts.at(-1)!, current = await readVersion(root,'dist/index.html')
  await writeFile(join(root,'reviews/second.json'),JSON.stringify({requirementsRevision:run.requirements.revision,planRevision:run.planRevision,findings:[],
    closed:[{id:'F1',repairAttemptId:repaired.attemptId,sources:[{...current,quote:'a.volume=c.data.volume'}],observed:'Actual HTML playback, volume/loop changes and silence restoration passed'}],
    limitations:['Not physical listening or final mix']}))
  await complete(follow,'follow')
  expect(run.tasks.review!.status).toBe('succeeded')
  expect(run.attempts.slice(0,history.length)).toEqual(history)
  expect(run.deliveryEligible).toBe(false)
  const check = run.attempts.find(a=>a.attemptId===repaired.attemptId)!.checks!.find(c=>c.id==='audio-data-consumption')!
  check.version = 'obsolete-audio.0'
  const stale = await runChecks(root,follow,[current],undefined,{}, {run,attempt:run.attempts.at(-1)!})
  expect(stale.checks[0]!.status).toBe('failed')
}

test('audio probe plan requires runtime/check and actual play/stop operands', () => {
  const run = createRun({projectId:'fixture',ownerId:'owner',workspacePath:'/synthetic',chatSessionId:'chat',requestKey:'audio',text:'Audio',constraints:{},ids:['req.audio']})
  const task = {id:'audio',kind:'game.develop',goal:'Check actual audio',dependsOn:[],requirementIds:['req.audio'],inputs:[],writablePaths:['dist/**'],
    expectedOutputs:['dist/index.html'],checks:['audio-data-consumption'],runtimeArtifact:'dist',
    audioProbes:[{document:'content/scenes/level.json',nodeId:'board',componentId:'sound',selector:'#clip',viewport:[960,540],playSteps:[{click:'#start'}],stopSteps:[{click:'#stop'}]}]}
  const plan = {protocol:run.protocol,baseRevision:0,requirementsRevision:run.requirements.revision,tasks:[task]}
  expect(publishPlan(run, plan).tasks.audio!.spec.checks).toContain('audio-data-consumption')
  expect(()=>publishPlan(run,{...plan,tasks:[{...task,audioProbes:undefined}]})).toThrow('audio-data-consumption requires')
  expect(()=>publishPlan(run,{...plan,tasks:[{...task,runtimeArtifact:undefined}]})).toThrow('runtimeArtifact')
  expect(()=>publishPlan(run,{...plan,tasks:[{...task,audioProbes:[{...task.audioProbes[0],stopSteps:[]}]}]})).toThrow()
})
