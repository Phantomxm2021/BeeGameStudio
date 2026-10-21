import { test, expect } from 'bun:test'
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRun, type AgentTurn } from './state'
import { createLocalWorkflowStore, assertCommit } from './store'
import { observeProjectCreation } from './web-project-start'
import { createAgentMeasurement } from './agent-measurement'
import { assertManagedWebBoot, installManagedWebBoot, MANAGED_WEB_BOOT_PATHS } from './managed-web-boot'
import { writeDesignDocumentsFixture } from '../fixtures/layout-fixture'

async function fixture() {
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-thin-boot-'))),workspace=join(root,'project')
  await mkdir(workspace)
  const brief={creation_mode:'creative',game_user_visible_language:'en',settings:{platform:'Web',engine:'React',dimension:'2D',orientation:'Landscape'}}
  const run=createRun({projectId:'project',ownerId:'owner',workspacePath:workspace,chatSessionId:'chat',requestKey:'new',text:JSON.stringify(brief),constraints:brief.settings,ids:['goal']})
  run.creation=await observeProjectCreation(workspace,brief)
  const turn:AgentTurn={attemptId:'writer',requestKey:'new',sessionId:'chat',workerId:'host',fence:1,status:'running',startedAt:new Date().toISOString()}
  run.agentTurns=[turn];run.writer={attemptId:turn.attemptId,workerId:turn.workerId,fence:1};run.fence=1
  const store=createLocalWorkflowStore(join(root,'store'))
  await store.commit('project','owner',0,run,'fixture')
  const measurement=createAgentMeasurement({run,turn,store})
  return {root,workspace,run,turn,store,measurement,async close(){await measurement.close();await rm(root,{recursive:true,force:true})}}
}

test('existing implementation handoff installs only the thin entry after valid planning and keeps its pinned snapshot immutable',async()=>{
  const f=await fixture()
  try {
    await expect(f.measurement.lockDesignBaseline()).rejects.toThrow()
    for(const path of MANAGED_WEB_BOOT_PATHS)expect(await Bun.file(join(f.workspace,path)).exists()).toBe(false)
    await writeDesignDocumentsFixture(f.workspace)
    const result=await f.measurement.lockDesignBaseline()
    expect(result.webBoot?.factory).toBe('export async function createGame({root, storage})')
    const locked=(await f.store.read('project','owner'))!
    expect(locked.webBoot?.files.map(file=>file.path)).toEqual([...MANAGED_WEB_BOOT_PATHS])
    expect(await Bun.file(join(f.workspace,'src/game.jsx')).exists()).toBe(false)
    expect(await Bun.file(join(f.workspace,'package.json')).exists()).toBe(false)
    expect(await readFile(join(f.workspace,'index.html'),'utf8')).not.toContain('<style>')
    const entry=await readFile(join(f.workspace,'src/bgs-entry.mjs'),'utf8')
    expect(entry.indexOf('await createGameStorage')).toBeLessThan(entry.indexOf("await import('./game.jsx')"))
    expect(entry).toContain('await createGame({ root, storage })')
    await f.measurement.lockDesignBaseline()
    expect((await f.store.read('project','owner'))!.version).toBe(locked.version)
    const changed=structuredClone(locked);changed.version++;delete changed.webBoot
    expect(()=>assertCommit('project','owner',locked.version,changed,locked)).toThrow('cannot be replaced')
    // Validate against the installed snapshot, not today's helper/template.
    await assertManagedWebBoot(locked,true)
    await writeFile(join(f.workspace,'src/bgs-entry.mjs'),entry+'\n// external change\n')
    await expect(assertManagedWebBoot(locked,true)).rejects.toThrow('silently overwrite')
    await expect(f.measurement.lockDesignBaseline()).rejects.toThrow('silently overwrite')
    const measured=await f.measurement.measure({requestKey:'changed-entry',runtimeArtifact:'dist',reportPaths:[]})
    expect(measured.error).toContain('startup/storage wiring')
    expect(measured.checks).toHaveLength(0)
  }finally{await f.close()}
})

test('imports, old Runs and unsupported engines are not migrated; conflicts, aliases and cancellation never overwrite an entry',async()=>{
  const f=await fixture()
  try {
    const old={...f.run,creation:{initialDelivery:'design-led-first-version' as const,editableContent:true,webStarter:'react-canvas-2d-v1' as const}}
    expect(await installManagedWebBoot(old,new AbortController().signal)).toBeUndefined()
    await mkdir(join(f.workspace,'src'))
    await writeFile(join(f.workspace,'src/bgs-entry.mjs'),'Existing application')
    await expect(installManagedWebBoot(f.run,new AbortController().signal)).rejects.toThrow('existing source preserved')
    expect(await readFile(join(f.workspace,'src/bgs-entry.mjs'),'utf8')).toBe('Existing application')
    expect(await Bun.file(join(f.workspace,'index.html')).exists()).toBe(false)
    await rm(join(f.workspace,'src'),{recursive:true})
    await mkdir(join(f.root,'other'));await symlink(join(f.root,'other'),join(f.workspace,'src'))
    await expect(installManagedWebBoot(f.run,new AbortController().signal)).rejects.toThrow('existing source preserved')
    expect(await Bun.file(join(f.workspace,'index.html')).exists()).toBe(false)
    expect(await Bun.file(join(f.root,'other/bgs-entry.mjs')).exists()).toBe(false)
    await rm(join(f.workspace,'src'))
    const cancelled=new AbortController();cancelled.abort()
    await expect(installManagedWebBoot(f.run,cancelled.signal)).rejects.toThrow('cancelled')
    expect(await Bun.file(join(f.workspace,'index.html')).exists()).toBe(false)
    for(const settings of [{platform:'Web',engine:'Unity'},{platform:'Native',engine:'React'}]) {
      expect((await observeProjectCreation(f.workspace,{creation_mode:'creative',settings}))?.webBoot).toBeUndefined()
    }
    expect((await observeProjectCreation(f.workspace,{creation_mode:'creative',build_source:{kind:'import'},settings:{platform:'Web',engine:'React'}}))).toBeUndefined()
  }finally{await f.close()}
})

test('a generated game missing the factory does not become a passing runtime just because the host entry and storage API exist',async()=>{
  const f=await fixture()
  try {
    await writeDesignDocumentsFixture(f.workspace)
    await f.measurement.lockDesignBaseline()
    await writeFile(join(f.workspace,'package.json'),JSON.stringify({type:'module',scripts:{build:'bun build index.html --target=browser --outdir=dist'}}))
    await writeFile(join(f.workspace,'src/game.jsx'),'export const unrelated = 1;\n')
    const result=await f.measurement.measure({requestKey:'missing-factory',runtimeArtifact:'dist',reportPaths:[]})
    expect(result.checks.find(check=>check.id==='build')?.status,JSON.stringify(result)).toBe('passed')
    const smoke=result.checks.find(check=>check.id==='runtime-smoke')!
    expect(smoke.status,smoke.observation).toBe('failed')
    expect(JSON.parse(smoke.observation).errors.join(' ')).toContain('must export createGame')
  }finally{await f.close()}
},15000)


test('project HTML remains editable in new and legacy snapshots while adapters stay protected',async()=>{
  const f=await fixture()
  try {
    await writeFile(join(f.workspace,'index.html'),'<!doctype html><title>My project</title><div id="root"></div><script type="module" src="./src/bgs-entry.mjs"></script>')
    const webBoot=await installManagedWebBoot(f.run,new AbortController().signal)
    const run={...f.run,webBoot}
    expect(await readFile(join(f.workspace,'index.html'),'utf8')).toContain('My project')
    const legacy={...run,webBoot:{...webBoot!,files:[{path:'index.html',sha256:'0'.repeat(64)},...webBoot!.files]}}
    await writeFile(join(f.workspace,'index.html'),'<!doctype html><title>Updated title</title>')
    await assertManagedWebBoot(run,true)
    await assertManagedWebBoot(legacy,true)
    await installManagedWebBoot(legacy,new AbortController().signal)
    expect(await readFile(join(f.workspace,'index.html'),'utf8')).toContain('Updated title')
    await writeFile(join(f.workspace,'src/bgs-storage.mjs'),'Changed adapter')
    await expect(assertManagedWebBoot(legacy,true)).rejects.toThrow('startup/storage wiring')
  } finally {await f.close()}
})
