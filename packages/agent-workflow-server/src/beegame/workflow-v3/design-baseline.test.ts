import { test, expect } from 'bun:test'
import { mkdtemp, realpath, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeDesignDocumentsFixture, uiLayoutFixture } from '../fixtures/layout-fixture'
import { createRun, digest, type AgentTurn, type SourceEdit } from './state'
import { createLocalWorkflowStore, assertCommit } from './store'
import { createAgentMeasurement } from './agent-measurement'
import { designBaselineIssue, baselineAfterSourceEdit, captureDesignBaseline } from './design-baseline'
import { openAgentTools } from './agent-tools'
import { readDesignImplementationChecklist } from '../design-handoff'
import { readVersion, versionsMatch } from './checks'
import { assetManifestAuthoringExamples } from '../asset-manifest-authoring-contract'
import { writeBeeGameAssetManifest } from '../asset-contracts'
import { checkResourcesAndBindings } from '../workflow-read-tools'
import { projectPreviewCapabilityPath } from '../project-preview-capability'

test('implementation baseline persists once, rejects overwrite/finalize and blocks design drift before building', async()=>{
  const temporary=await realpath(await mkdtemp(join(tmpdir(),'bgs-design-baseline-'))), root=join(temporary,'project')
  await mkdir(root)
  await writeDesignDocumentsFixture(root)
  await writeFile(join(root,'package.json'),JSON.stringify({scripts:{build:'touch SHOULD_NOT_BUILD'}}))
  const store=createLocalWorkflowStore(join(temporary,'store'))
  const run=createRun({projectId:'project',ownerId:'owner',workspacePath:root,chatSessionId:'chat',requestKey:'goal',text:'Fixture',constraints:{},ids:['goal']})
  const turn:AgentTurn={attemptId:'attempt',requestKey:'goal',sessionId:'chat',workerId:'worker',fence:1,status:'running',startedAt:new Date().toISOString()}
  run.agentTurns=[turn];run.writer={attemptId:turn.attemptId,workerId:turn.workerId,fence:1};run.fence=1
  await store.commit(run.projectId,run.ownerId,0,run,'fixture')
  let locks=0
  const measurement=createAgentMeasurement({run,turn,store,onDesignLocked:()=>{locks++}})
  const tools=await openAgentTools({workspacePath:root,sessionId:'chat',measurement,getAuthToken:()=>undefined})
  try {
    const child=Bun.spawn([process.execPath,join(root,tools.directory,'handoff.mjs'),'--design','implementation'],{cwd:root,
      env:{...process.env,BEEGAME_MEASUREMENT_CAPABILITY_FILE:projectPreviewCapabilityPath(root,'chat','measurement')},stdout:'pipe',stderr:'pipe'})
    const [stdout,stderr,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited])
    expect(code,stderr||stdout).toBe(0)
    expect(JSON.parse(stdout).designBaseline.scope).toContain('not user approval')
    const locked=(await store.read('project','owner'))!
    expect(locked.designBaseline?.protectedFiles).toHaveLength(16)
    expect(designBaselineIssue(locked)).toBeUndefined()
    await measurement.lockDesignBaseline()
    expect((await createLocalWorkflowStore(join(temporary,'store')).read('project','owner'))?.version).toBe(locked.version)
    expect(locks).toBe(2)
    await expect(measurement.assertActive(true)).rejects.toThrow('Planning records are locked')
    const forged=structuredClone(locked);forged.version++;forged.designBaseline!.revision='0'.repeat(64)
    expect(()=>assertCommit('project','owner',locked.version,forged,locked)).toThrow('cannot be replaced')
    const released=structuredClone(locked);released.version++;delete released.designBaseline;released.deliveryEligible=false
    expect(()=>assertCommit('project','owner',locked.version,released,locked)).toThrow('cannot be replaced')
    expect(()=>assertCommit('project','owner',locked.version,released,locked,'agent.design-change-authorized:question')).not.toThrow()
    const expanded=structuredClone(released);expanded.requirements.text='Unrelated overwrite'
    expect(()=>assertCommit('project','owner',locked.version,expanded,locked,'agent.design-change-authorized:question')).toThrow('cannot be replaced')
    const paused=structuredClone(locked);paused.paused={at:new Date().toISOString()}
    expect(()=>assertCommit('project','owner',locked.version,{...paused,version:paused.version+1,designBaseline:undefined},paused,'agent.design-change-authorized:question')).toThrow('cannot be replaced')

    await writeFile(join(root,'docs/GDD.md'),(await readFile(join(root,'docs/GDD.md'),'utf8'))+'\nUnauthorized new expectation.\n')
    await expect(measurement.lockDesignBaseline()).rejects.toThrow('locked implementation baseline')
    const result=await measurement.measure({requestKey:'must-not-build',runtimeArtifact:'dist',reportPaths:[]})
    expect(result.error).toContain('locked implementation baseline')
    expect(result.checks).toHaveLength(0)
    expect(await Bun.file(join(root,'SHOULD_NOT_BUILD')).exists()).toBe(false)
    expect((await store.read('project','owner'))?.designBaseline).toEqual(locked.designBaseline)
  }finally{await tools.close();await measurement.close();await rm(temporary,{recursive:true,force:true})}
})

test('exact user visual save advances only its own baseline input; unrelated planning drift stays blocked', async()=>{
  const temporary=await realpath(await mkdtemp(join(tmpdir(),'bgs-design-save-'))),root=join(temporary,'project')
  await mkdir(root);await writeDesignDocumentsFixture(root)
  const index={schema:'beegame-content-package.v2',id:'fixture',dimension:'2d',entryScene:'level',files:['ui/menu.json','scenes/level.json'],documents:[
    {id:'menu',path:'ui/menu.json',kind:'ui-screen',loadPhase:'startup'}, {id:'level',path:'scenes/level.json',kind:'scene-2d',loadPhase:'startup'}]}
  await writeFile(join(root,'content/index.json'),JSON.stringify(index))
  const store=createLocalWorkflowStore(join(temporary,'store'))
  const run=createRun({projectId:'project',ownerId:'owner',workspacePath:root,chatSessionId:'chat',requestKey:'goal',text:'Fixture',constraints:{},ids:['goal']})
  const turn:AgentTurn={attemptId:'attempt',requestKey:'goal',sessionId:'chat',workerId:'worker',fence:1,status:'running',startedAt:new Date().toISOString()}
  run.agentTurns=[turn];run.writer={attemptId:turn.attemptId,workerId:turn.workerId,fence:1};run.fence=1
  await store.commit('project','owner',0,run,'fixture')
  const measurement=createAgentMeasurement({run,turn,store})
  try {
    await measurement.lockDesignBaseline()
    const locked=(await store.read('project','owner'))!, path=join(root,'content/ui/menu.json')
    const before=await readFile(path,'utf8'),ui=JSON.parse(before)
    ui.data.nodes[1].layout.size[0]+=10
    const body=JSON.stringify(ui);await writeFile(path,body)
    const edit:SourceEdit={attemptId:'exact-save',fence:2,workerId:'host',sessionId:'host-save',requestKey:'save',requestHash:'fixture',startedAt:new Date().toISOString(),status:'blocked',
      requirementsRevision:run.requirements.revision,sourceEdit:{path:'content/ui/menu.json',before:digest(before),after:digest(body),archive:'fixture',status:'saved'}}
    const updated=await baselineAfterSourceEdit(locked,edit)
    expect(updated?.revision).not.toBe(locked.designBaseline!.revision)
    expect(updated?.protectedFiles).toEqual(locked.designBaseline!.protectedFiles)
    expect(designBaselineIssue({...locked,designBaseline:updated})).toBeUndefined()
    await writeFile(join(root,'content/index.json'),JSON.stringify({...index,documentRevision:'a'.repeat(64)}))
    expect(designBaselineIssue({...locked,designBaseline:updated})).toBeUndefined()
    await writeFile(join(root,'content/index.json'),JSON.stringify({...index,entryScene:'menu'}))
    expect(designBaselineIssue({...locked,designBaseline:updated})).toContain('registry routing differs')
    await writeFile(join(root,'content/index.json'),JSON.stringify(index))
    await writeFile(join(root,'docs/GDD.md'),(await readFile(join(root,'docs/GDD.md'),'utf8'))+'\nUnrelated change.\n')
    expect(await baselineAfterSourceEdit(locked,edit)).toEqual(locked.designBaseline)
    expect(designBaselineIssue(locked)).toContain('locked implementation baseline')
  }finally{await measurement.close();await rm(temporary,{recursive:true,force:true})}
})


test.each([false,true])('design lock permits content registration while preserving decisions, config and bindings; indexed=%s', async indexed => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-incremental-content-')))
  try {
    await writeDesignDocumentsFixture(root)
    if (!indexed) await rm(join(root, '.beegame/design-handoffs'), { recursive: true })
    const index = { schema: 'beegame-content-package.v2', id: 'fixture', dimension: '2d', entryScene: 'level',
      files: ['ui/menu.json', 'scenes/level.json'], documents: [
        { id: 'menu', path: 'ui/menu.json', kind: 'ui-screen', loadPhase: 'startup' },
        { id: 'level', path: 'scenes/level.json', kind: 'scene-2d', loadPhase: 'startup' }] }
    const saveIndex = (value: unknown) => writeFile(join(root, 'content/index.json'), JSON.stringify(value))
    await saveIndex(index)
    const run = createRun({projectId:'project',ownerId:'owner',workspacePath:root,chatSessionId:'chat',requestKey:'goal',text:'Fixture',constraints:{},ids:['goal']})
    run.writer = { attemptId: 'fixture', workerId: 'fixture', fence: 1 }
    run.designBaseline = await captureDesignBaseline(run)
    const before = await readVersion(root, 'content/index.json')
    const added = uiLayoutFixture(); added.id = 'settings'
    await writeFile(join(root, 'content/ui/settings.json'), JSON.stringify(added))
    const expanded = { ...index, files: [...index.files, 'ui/settings.json'], documents: [...index.documents,
      { id: 'settings', path: 'ui/settings.json', kind: 'ui-screen', loadPhase: 'on-demand' }] }
    await saveIndex(expanded)
    expect(designBaselineIssue(run)).toBeUndefined()
    expect(() => readDesignImplementationChecklist(root)).not.toThrow()
    expect(await versionsMatch(root, [before])).toBe(false)
    const manifest = assetManifestAuthoringExamples().canonical
    manifest.resources = []; manifest.requirements = []
    await writeBeeGameAssetManifest(root, manifest)
    const bindings = await checkResourcesAndBindings(root, {})
    expect(bindings.valid, bindings.issues.join('; ')).toBe(true)
    expect(bindings.files.map(file => file.file)).toContain('content/ui/settings.json')
    const originalHash = bindings.files.find(file => file.file === 'content/ui/settings.json')!.sha256
    added.data.nodes[1]!.layout!.size![0] += 10
    await writeFile(join(root, 'content/ui/settings.json'), JSON.stringify(added))
    expect((await checkResourcesAndBindings(root, {})).files.find(file => file.file === 'content/ui/settings.json')!.sha256).not.toBe(originalHash)
    expect(designBaselineIssue(run)).toBeUndefined()
    for (const change of [{ entryScene: 'menu' }, { dimension: '3d' }, { id: 'another' }]) {
      await saveIndex({ ...expanded, ...change })
      expect(designBaselineIssue(run)).toContain('registry routing differs')
    }
    await saveIndex(expanded)
    await rm(join(root, 'content/ui/menu.json'))
    expect(designBaselineIssue(run)).toContain('locked implementation baseline')
    await writeFile(join(root, 'content/ui/menu.json'), JSON.stringify(uiLayoutFixture()))
    await writeFile(join(root, 'docs/GDD.md'), '# Changed decision')
    expect(designBaselineIssue(run)).toContain('locked implementation baseline')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('a design-only baseline freezes no absent content configuration and still rejects an invalid later registry', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-first-content-')))
  try {
    await writeDesignDocumentsFixture(root)
    await rm(join(root, '.beegame/design-handoffs'), { recursive: true })
    const run = createRun({projectId:'project',ownerId:'owner',workspacePath:root,chatSessionId:'chat',requestKey:'goal',text:'Fixture',constraints:{},ids:['goal']})
    run.writer = { attemptId: 'fixture', workerId: 'fixture', fence: 1 }
    run.designBaseline = await captureDesignBaseline(run)
    expect(designBaselineIssue(run)).toBeUndefined()
    expect(run.designBaseline.registryRevision).toBeUndefined()
    await writeFile(join(root, 'content/index.json'), JSON.stringify({schema:'beegame-content-package.v2',id:'fixture',dimension:'2d',entryScene:'level',files:['ui/menu.json','scenes/level.json']}))
    expect(designBaselineIssue(run)).toBeUndefined()
    await writeFile(join(root, 'content/index.json'), JSON.stringify({schema:'beegame-content-package.v2',id:'fixture',dimension:'2d',entryScene:'menu',files:['ui/menu.json','scenes/level.json']}))
    expect(designBaselineIssue(run)).toBeUndefined()
    await writeFile(join(root, 'content/index.json'), '{}')
    expect(designBaselineIssue(run)).toContain('unreadable')
  } finally { await rm(root, { recursive: true, force: true }) }
})
