import { test, expect } from 'bun:test'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRun, publishPlan, V3_PROTOCOL, type TaskSpec } from './state'
import { runChecks } from './checks'
import { taskCapabilityNotes } from './capability-scope'

const task: TaskSpec = {id:'aux',kind:'game.develop',goal:'Check actual auxiliary sources',dependsOn:[],
  requirementIds:['goal'],inputs:[],writablePaths:['result.json'],expectedOutputs:['result.json'],checks:['artifact-json']}
test('engine label does not ban declared auxiliary scripts or require extra BGS formats',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bgs-v3-driver-operands-'))
  try {
    await writeFile(join(root,'result.json'),'{}')
    await writeFile(join(root,'package.json'),JSON.stringify({scripts:{build:'bun -e "process.exit(0)"'}}))
    for(const engine of ['Unity','Godot','React']) {
      const original=createRun({projectId:'scope',ownerId:'owner',workspacePath:root,chatSessionId:'chat',requestKey:'scope',
        text:'Use the actual project; auxiliary web checks do not certify engine builds',constraints:{engine},ids:['goal']})
      const spec={...task,checks:['build'] as TaskSpec['checks']}
      expect(()=>publishPlan(original,{protocol:V3_PROTOCOL,baseRevision:0,requirementsRevision:original.requirements.revision,tasks:[spec]})).not.toThrow()
      const checked=await runChecks(root,spec,[],undefined,{engine})
      expect(checked.checks[0]!.status).toBe('passed')
      expect(taskCapabilityNotes(spec,{engine}).join(' ')).toContain('does not prove engine build')
      expect(await readFile(join(root,'result.json'),'utf8')).toBe('{}')
    }
  } finally {await rm(root,{recursive:true,force:true})}
})
test('real missing operands remain unverified, independently of engine name',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bgs-v3-driver-missing-'))
  try {
    for(const engine of ['Unity','Godot','React']) {
      const checked=await runChecks(root,{...task,checks:['content-schema']},[],undefined,{engine})
      expect(checked.checks[0]!.status).toBe('unverified')
      expect(checked.checks[0]!.observation).toContain('Required output missing')
    }
  }finally{await rm(root,{recursive:true,force:true})}
})
