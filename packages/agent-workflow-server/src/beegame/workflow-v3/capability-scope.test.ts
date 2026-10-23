import { test, expect } from 'bun:test'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { type TaskSpec } from './state'
import { runChecks } from './checker-test-driver'

const task: TaskSpec = {id:'aux',kind:'game.develop',goal:'Check actual auxiliary sources',dependsOn:[],
  requirementIds:['goal'],inputs:[],writablePaths:['result.json'],expectedOutputs:['result.json'],checks:['artifact-json']}
test('engine label does not ban declared auxiliary scripts or require extra BGS formats',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bgs-v3-driver-operands-'))
  try {
    await writeFile(join(root,'result.json'),'{}')
    await writeFile(join(root,'package.json'),JSON.stringify({scripts:{build:'bun -e "process.exit(0)"'}}))
    for(const engine of ['Unity','Godot','React']) {
      const spec={...task,checks:['build'] as TaskSpec['checks']}
      const checked=await runChecks(root,spec,[],undefined,{engine})
      expect(checked.checks[0]!.status).toBe('passed')
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
