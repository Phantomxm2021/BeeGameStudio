import {test,expect} from 'bun:test'
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createRun,type AgentTurn} from './state'
import {initialProductionAssignment,prepareProductionHandoff,verifyProductionHandoff,DESIGN_ASSIGNMENTS} from './production-workflow'

async function fixture() {
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-design-coverage-')))
  await mkdir(join(root,'docs'))
  const source='# Synthetic\n## Rules\nSynthetic decisions.\n## Space\nSynthetic space needs.\n## Duplicate\nFirst.\n## Duplicate\nSecond.\n'
  await writeFile(join(root,'docs/GDD.md'),source)
  const run=createRun({projectId:'synthetic',ownerId:'owner',workspacePath:root,chatSessionId:'chat',requestKey:'start',text:'Confirmed synthetic scope',constraints:{},ids:['goal']})
  run.productionWorkflow=1
  const turn:AgentTurn={attemptId:'turn',requestKey:'start',sessionId:'chat',workerId:'worker',fence:1,status:'running',startedAt:new Date().toISOString(),production:initialProductionAssignment(run)}
  const request={action:'advance',summary:'Author-declared decisions',sections:['Rules'],files:[]}
  return {root,run,turn,request,source,close:()=>rm(root,{recursive:true,force:true})}
}

test('coverage references existing source, retains remaining directions and remains bound to the source version',async()=>{
  const f=await fixture()
  try {
    const handoff=prepareProductionHandoff(f.run,f.turn,{...f.request,coveredDesigns:{levels:['Space'],balance:['Rules']}})
    expect(handoff.next).toMatchObject({stage:'design',discipline:'art',completedDesigns:['gameplay','levels','balance']})
    expect(handoff.sources.map(s=>s.path)).toEqual(['docs/GDD.md'])
    expect(await readFile(join(f.root,'docs/GDD.md'),'utf8')).toBe(f.source)
    verifyProductionHandoff(f.root,handoff)
    await writeFile(join(f.root,'docs/GDD.md'),f.source.replace('Synthetic space needs.','Changed space needs.'))
    expect(()=>verifyProductionHandoff(f.root,handoff)).toThrow('changed after submission')
  }finally{await f.close()}
})

test('missing or empty coverage cannot silently finish a direction; legacy handoffs preserve single-direction scheduling',async()=>{
  const f=await fixture()
  try {
    for(const coveredDesigns of [undefined,{}]) {
      const handoff=prepareProductionHandoff(f.run,f.turn,{...f.request,...(coveredDesigns?{coveredDesigns}:{})})
      expect(handoff.next).toMatchObject({stage:'design',discipline:'levels',completedDesigns:['gameplay']})
    }
    for(const coveredDesigns of [{levels:[]},{levels:[' ']},{levels:['Missing']},{levels:['Duplicate']},{unknown:['Rules']},{levels:'Rules'}]) {
      expect(()=>prepareProductionHandoff(f.run,f.turn,{...f.request,coveredDesigns})).toThrow()
    }
    expect(f.turn.production?.completedDesigns).toEqual([])
  }finally{await f.close()}
})

test('only complete coverage advances to visual; covered directions cannot be selected again',async()=>{
  const f=await fixture()
  try {
    const coveredDesigns=Object.fromEntries(Object.keys(DESIGN_ASSIGNMENTS).map(name=>[name,['Rules']]))
    expect(prepareProductionHandoff(f.run,f.turn,{...f.request,coveredDesigns}).next).toEqual({stage:'visual',originRequestKey:'start'})
    expect(()=>prepareProductionHandoff(f.run,f.turn,{...f.request,coveredDesigns,nextDesign:'technical'})).toThrow('unfinished')
    expect(()=>prepareProductionHandoff(f.run,f.turn,{...f.request,coveredDesigns:{levels:['Space']},nextDesign:'levels'})).toThrow('unfinished')
    expect(prepareProductionHandoff(f.run,f.turn,{...f.request,coveredDesigns:{levels:['Space']},nextDesign:'audio'}).next.discipline).toBe('audio')
  }finally{await f.close()}
})

test('design coverage is rejected outside design and cannot grant discussion or implementation authority',async()=>{
  const f=await fixture()
  try {
    for(const stage of ['visual','resources'] as const) {
      f.turn.production={stage,originRequestKey:'start'}
      expect(()=>prepareProductionHandoff(f.run,f.turn,{...f.request,coveredDesigns:{levels:['Space']}})).toThrow('Only professional design')
    }
    f.turn.production=undefined
    f.turn.message={requestKey:'work',runId:f.run.id,chatSessionId:'chat',expectedVersion:f.run.version,requirementsRevision:f.run.requirements.revision,intent:'work',text:'Only the authorized implementation'}
    expect(()=>prepareProductionHandoff(f.run,f.turn,{...f.request,action:'implement',coveredDesigns:{levels:['Space']}})).toThrow('no design coverage')
    f.turn.production=initialProductionAssignment(f.run)
    f.turn.message={...f.turn.message,requestKey:'discuss',intent:'discuss',text:'Discuss only'}
    expect(()=>prepareProductionHandoff(f.run,f.turn,{...f.request,coveredDesigns:{levels:['Space']}})).toThrow('Discussion cannot advance')
  }finally{await f.close()}
})


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
