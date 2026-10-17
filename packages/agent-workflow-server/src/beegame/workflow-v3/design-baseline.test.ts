import { test, expect } from 'bun:test'
import { mkdtemp, realpath, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeDesignDocumentsFixture } from '../fixtures/layout-fixture'
import { createRun, digest, type AgentTurn, type SourceEdit } from './state'
import { createLocalWorkflowStore, assertCommit } from './store'
import { createAgentMeasurement } from './agent-measurement'
import { designBaselineIssue, baselineAfterSourceEdit } from './design-baseline'
import { openAgentTools } from './agent-tools'
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
