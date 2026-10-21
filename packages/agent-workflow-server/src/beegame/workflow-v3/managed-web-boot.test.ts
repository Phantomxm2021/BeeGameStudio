import { test, expect } from 'bun:test'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRun, digest, type AgentTurn } from './state'
import { createLocalWorkflowStore, assertCommit } from './store'
import { observeProjectCreation } from './web-project-start'
import { createAgentMeasurement } from './agent-measurement'
import { MANAGED_WEB_BOOT_PATHS } from './managed-web-boot'
import { writeDesignDocumentsFixture } from '../fixtures/layout-fixture'

async function fixture(historicalFlag = false) {
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-boot-compat-'))),workspace=join(root,'project')
  await mkdir(workspace)
  const brief={creation_mode:'creative',game_user_visible_language:'en',settings:{platform:'Web',engine:'React'}}
  const run=createRun({projectId:'project',ownerId:'owner',workspacePath:workspace,chatSessionId:'chat',requestKey:'new',text:JSON.stringify(brief),constraints:brief.settings,ids:['goal']})
  run.creation=await observeProjectCreation(workspace,brief)
  if(historicalFlag)run.creation!.webBoot='react-web-storage-v1'
  const turn:AgentTurn={attemptId:'writer',requestKey:'new',sessionId:'chat',workerId:'host',fence:1,status:'running',startedAt:new Date().toISOString()}
  run.agentTurns=[turn];run.writer={attemptId:turn.attemptId,workerId:turn.workerId,fence:1};run.fence=1
  const store=createLocalWorkflowStore(join(root,'store'))
  await store.commit('project','owner',0,run,'fixture')
  const measurement=createAgentMeasurement({run,turn,store})
  return {root,workspace,run,store,measurement,async close(){await measurement.close();await rm(root,{recursive:true,force:true})}}
}

test.each([false,true])('implementation handoff never chooses or installs startup files, including old uninstalled flags: %s',async historicalFlag=>{
  const f=await fixture(historicalFlag)
  try {
    await writeDesignDocumentsFixture(f.workspace)
    await mkdir(join(f.workspace,'src'))
    const source='export const application = "Agent-owned startup";\n'
    await writeFile(join(f.workspace,'src/application.ts'),source)
    const result=await f.measurement.lockDesignBaseline()
    expect(result.valid).toBe(true)
    expect(result.designBaseline.revision).toBeString()
    expect(result).not.toHaveProperty('webBoot')
    expect(await f.measurement.context()).not.toHaveProperty('webBoot')
    const saved=(await f.store.read('project','owner'))!
    expect(saved.webBoot).toBeUndefined()
    for(const path of ['index.html','package.json','src/game.jsx',...MANAGED_WEB_BOOT_PATHS])
      expect(await Bun.file(join(f.workspace,path)).exists()).toBe(false)
    expect(await readFile(join(f.workspace,'src/application.ts'),'utf8')).toBe(source)
    await f.measurement.lockDesignBaseline()
    expect((await f.store.read('project','owner'))!.version).toBe(saved.version)
  }finally{await f.close()}
})

test('historical installation receipts are retained without constraining current startup sources',async()=>{
  const f=await fixture(true)
  try {
    await writeDesignDocumentsFixture(f.workspace)
    await f.measurement.lockDesignBaseline()
    const saved=(await f.store.read('project','owner'))!
    const next=structuredClone(saved); next.version++
    await mkdir(join(f.workspace,'src'))
    // Historical receipts remain evidence; current project source can change.
    next.webBoot={version:'react-web-storage-v1',files:[]}
    for(const path of MANAGED_WEB_BOOT_PATHS) {
      const body='// historical '+path+'\n'
      await writeFile(join(f.workspace,path),body)
      next.webBoot.files.push({path,sha256:digest(body)})
    }
    await f.store.commit('project','owner',saved.version,next,'fixture-historical-install')
    expect(await f.measurement.context()).not.toHaveProperty('webBoot')
    const result=await f.measurement.lockDesignBaseline()
    expect(result).not.toHaveProperty('webBoot')
    expect((await f.store.read('project','owner'))!.webBoot).toEqual(next.webBoot)
    const changed=structuredClone(next);changed.version++;delete changed.webBoot
    expect(()=>assertCommit('project','owner',next.version,changed,next)).toThrow('cannot be replaced')
    await writeFile(join(f.workspace,'index.html'),'<title>Project-owned metadata</title>')
    await writeFile(join(f.workspace,'src/bgs-entry.mjs'),'External modification')
    expect((await f.measurement.lockDesignBaseline()).valid).toBe(true)
    expect((await f.store.read('project','owner'))!.webBoot).toEqual(next.webBoot)
    expect(await readFile(join(f.workspace,'src/bgs-entry.mjs'),'utf8')).toBe('External modification')
  }finally{await f.close()}
})
