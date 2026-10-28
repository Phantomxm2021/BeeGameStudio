import {test,expect} from 'bun:test'
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createRun,type AgentTurn} from './state'
import {initialProductionAssignment,prepareProductionHandoff,prepareDesignDocumentHandoff,verifyProductionHandoff,productionAssignmentPrompt,productionAssignmentFacts,DESIGN_ASSIGNMENTS,productionOutputSchema,parseProductionResult} from './production-workflow'

async function fixture(wholeDesign=false) {
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-design-coverage-')))
  await mkdir(join(root,'docs'))
  const source='# Synthetic\n## Rules\nSynthetic decisions.\n## Space\nSynthetic space needs.\n## Duplicate\nFirst.\n## Duplicate\nSecond.\n'
  await writeFile(join(root,'docs/GDD.md'),source)
  const run=createRun({projectId:'synthetic',ownerId:'owner',workspacePath:root,chatSessionId:'chat',requestKey:'start',text:'Confirmed synthetic scope',constraints:{},ids:['goal']})
  run.productionWorkflow=1
  const turn:AgentTurn={attemptId:'turn',requestKey:'start',sessionId:'chat',workerId:'worker',fence:1,status:'running',startedAt:new Date().toISOString(),production:initialProductionAssignment(run)}
  if(wholeDesign)turn.production={stage:'design',originRequestKey:'start'}
  const request={action:'advance',summary:'Author-declared decisions',sections:['Rules'],files:[]}
  return {root,run,turn,request,source,close:()=>rm(root,{recursive:true,force:true})}
}

test('ordinary messages can explicitly enter implementation without advancing preparatory stages',async()=>{
  const f=await fixture()
  try {
    f.turn.production=undefined
    f.turn.requestKey='current-message'
    f.turn.message={requestKey:f.turn.requestKey,runId:f.run.id,chatSessionId:'chat',expectedVersion:f.run.version,
      requirementsRevision:f.run.requirements.revision,intent:'message',text:'Implement the current authorized correction'}
    const handoff=prepareProductionHandoff(f.run,f.turn,{action:'implement',summary:'Current request only',sections:[],files:['docs/GDD.md']})
    expect(handoff.next).toEqual({stage:'implementation',originRequestKey:'current-message'})
    expect(handoff.sources.map(source=>source.path)).toEqual(['docs/GDD.md'])
    expect(f.turn.production).toBeUndefined()
    expect(f.turn.productionHandoff).toBeUndefined()
    expect(()=>prepareProductionHandoff(f.run,f.turn,f.request)).toThrow('Discussion cannot advance')
    f.turn.message.intent='discuss'
    expect(()=>prepareProductionHandoff(f.run,f.turn,{...f.request,action:'implement'})).toThrow('Discussion cannot advance')
  }finally{await f.close()}
})


test('historical chapter navigation never borrows later handoff sources',async()=>{
  const f=await fixture()
  try {
    const assignment={stage:'design' as const,discipline:'ui' as const,originRequestKey:'start'}
    const handoff=(heading:string)=>({request:{action:'advance' as const,summary:'Synthetic pointer',sections:[heading],files:[]},
      next:assignment,sources:[{path:'docs/GDD.md',sha256:'synthetic'}]})
    f.run.agentTurns=[
      {...f.turn,attemptId:'prior',productionHandoff:handoff('Earlier')},
      {...f.turn,attemptId:'historical',production:assignment},
      {...f.turn,attemptId:'later',productionHandoff:handoff('Later')},
      {...f.turn,attemptId:'current',production:assignment},
    ]
    expect(productionAssignmentFacts(f.run,assignment,'historical').precedingSources?.sections).toEqual(['Earlier'])
    expect(productionAssignmentFacts(f.run,assignment,'current').precedingSources?.sections).toEqual(['Later'])
    expect(productionAssignmentFacts(f.run,assignment,'missing').precedingSources).toBeUndefined()
  }finally{await f.close()}
})


test('saved resource assignments still hand off to implementation',async()=>{
  const f=await fixture()
  try {
    f.turn.production={stage:'resources',originRequestKey:'start'}
    const result={status:'ready',summary:'Saved resources ready',sections:['Rules'],files:[]}
    const handoff=prepareProductionHandoff(f.run,f.turn,parseProductionResult(f.turn.production,result))
    expect(handoff.next).toEqual({stage:'implementation',originRequestKey:'start'})
    verifyProductionHandoff(f.root,handoff)
  }finally{await f.close()}
})


test('one document assignment covers all responsibilities without forcing Skill invocation',async()=>{
  const f=await fixture()
  try {
    expect(f.turn.production).toEqual({stage:'design',originRequestKey:'start'})
    const prompt=productionAssignmentPrompt(f.run,f.turn.production!)
    for(const design of Object.values(DESIGN_ASSIGNMENTS)) {
      expect(prompt).toContain(design.question)
    }
    expect(prompt).not.toMatch(/\$[A-Za-z][A-Za-z0-9_-]*/)
    expect(productionAssignmentFacts(f.run,f.turn.production!)).not.toHaveProperty('requiredSkills')
    expect(prompt).toContain('WriteProjectFile/EditProjectFile')
    expect(prompt).toContain('ready or blocked status')
    expect(prompt).not.toContain('complete Markdown document in document')
    expect(prompt).not.toContain('nextDesign')
    f.run.requirements.constraints.platform='VR/AR'
    const spatial=productionAssignmentPrompt(f.run,f.turn.production!)
    expect(spatial).toContain('confirmed target')
    expect(spatial).not.toMatch(/\$[A-Za-z][A-Za-z0-9_-]*/)
    expect(f.run.requirements.constraints.platform).toBe('VR/AR')
  }finally{await f.close()}
})

test('design handoff binds the existing document once and has no next assignment',async()=>{
  const f=await fixture()
  try {
    const schema=productionOutputSchema(f.turn.production!)
    expect(schema).toMatchObject({required:['status','summary']})
    expect(schema.required).not.toContain('document')
    const result=parseProductionResult(f.turn.production!,{status:'ready',summary:'Document saved'})
    const handoff=prepareDesignDocumentHandoff(f.root,result.summary)
    expect(handoff.next).toBeUndefined()
    expect(await readFile(join(f.root,'docs/GDD.md'),'utf8')).toBe(f.source)
    verifyProductionHandoff(f.root,handoff)
    await writeFile(join(f.root,'docs/GDD.md'),'Changed')
    expect(()=>verifyProductionHandoff(f.root,handoff)).toThrow('changed after submission')
  }finally{await f.close()}
})

test('blocked and malformed finals cannot replace existing GDD',async()=>{
  const f=await fixture()
  try {
    for(const value of [{status:'blocked',summary:'Missing input'},
      {status:'ready',summary:'Old chapter format',document:'# not accepted'}]) {
      expect(()=>parseProductionResult(f.turn.production!,value)).toThrow()
      expect(await readFile(join(f.root,'docs/GDD.md'),'utf8')).toBe(f.source)
    }
    expect(()=>prepareProductionHandoff(f.run,f.turn,f.request)).toThrow('saved docs/GDD.md source and ready/blocked metadata')
    await rm(join(f.root,'docs/GDD.md'))
    expect(()=>prepareDesignDocumentHandoff(f.root,'Missing')).toThrow()
    await writeFile(join(f.root,'docs/GDD.md'),' \n\t\n')
    expect(()=>prepareDesignDocumentHandoff(f.root,'Whitespace')).toThrow('whitespace-only')
    await writeFile(join(f.root,'docs/GDD.md'),Buffer.from([0xff,0xfe,0xfd]))
    expect(()=>prepareDesignDocumentHandoff(f.root,'Invalid UTF-8')).toThrow('valid UTF-8 text')
    await writeFile(join(f.root,'docs/GDD.md'),Buffer.from('# GDD\0\n','utf8'))
    expect(()=>prepareDesignDocumentHandoff(f.root,'NUL')).toThrow('text, not binary')
  }finally{await f.close()}
})

test('binary resource sources are hashed without the GDD text restriction',async()=>{
  const f=await fixture()
  try {
    await mkdir(join(f.root,'assets'))
    await writeFile(join(f.root,'assets/resource.bin'),Buffer.from([0xff,0x00,0x01]))
    f.turn.production={stage:'resources',originRequestKey:'start'}
    const handoff=prepareProductionHandoff(f.run,f.turn,{action:'advance',summary:'Binary resource ready',sections:['Rules'],files:['assets/resource.bin']})
    expect(handoff.sources.map(source=>source.path)).toEqual(['docs/GDD.md','assets/resource.bin'])
    verifyProductionHandoff(f.root,handoff)
  }finally{await f.close()}
})

test('GDD handoff rejects linked files and directories without touching their targets',async()=>{
  const {symlink}=await import('node:fs/promises')
  const f=await fixture(), outside=await fixture()
  try {
    await rm(join(f.root,'docs/GDD.md'))
    await symlink(join(outside.root,'docs/GDD.md'),join(f.root,'docs/GDD.md'))
    expect(()=>prepareDesignDocumentHandoff(f.root,'Summary')).toThrow('symlink')
    await rm(join(f.root,'docs'),{recursive:true})
    await symlink(join(outside.root,'docs'),join(f.root,'docs'))
    expect(()=>prepareDesignDocumentHandoff(f.root,'Summary')).toThrow('symlink')
    expect(await readFile(join(outside.root,'docs/GDD.md'),'utf8')).toBe(outside.source)
  }finally{await f.close();await outside.close()}
})
