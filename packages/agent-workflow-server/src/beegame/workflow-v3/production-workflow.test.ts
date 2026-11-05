import {test,expect} from 'bun:test'
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath,symlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createRun,type AgentTurn} from './state'
import {DESIGN_DECISION_SCOPE,designDocumentSnapshot,initialProductionAssignment,prepareProductionHandoff,prepareDesignDocumentHandoff,verifyProductionHandoff,productionAssignmentPrompt,productionAssignmentFacts,nextProductionStage,messageProductionAssignment,selectedProductionVisualSources,productionOutputSchema,parseProductionResult} from './production-workflow'

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

test('existing-project messages can explicitly enter implementation without imposing new-project stages',async()=>{
  const f=await fixture()
  try {
    delete f.run.productionWorkflow
    f.turn.production=undefined
    f.turn.requestKey='current-message'
    f.turn.message={requestKey:f.turn.requestKey,runId:f.run.id,chatSessionId:'chat',expectedVersion:f.run.version,
      requirementsRevision:f.run.requirements.revision,intent:'message',text:'Implement the current correction and test whether the provisional input timing is usable'}
    f.run.agentTurns=[f.turn]
    const handoff=prepareProductionHandoff(f.run,f.turn,{action:'implement',summary:'Current request only',sections:[],files:['docs/GDD.md']})
    expect(handoff.next).toEqual({stage:'implementation',originRequestKey:'current-message'})
    const current=productionAssignmentPrompt(f.run,handoff.next!)
    expect(current).toContain('Original authorized assignment:\n'+f.turn.message.text)
    expect(DESIGN_DECISION_SCOPE).toContain('open experience questions remain provisional rather than acceptance obligations')
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
    const assignment={stage:'design' as const,discipline:'ui' as const,completedDesigns:['gameplay' as const],originRequestKey:'start'}
    const handoff=(heading:string)=>({request:{action:'advance' as const,summary:'Synthetic pointer',sections:[heading],files:[]},
      next:assignment,sources:[{path:'docs/GDD.md',sha256:'synthetic'}]})
    f.run.agentTurns=[
      {...f.turn,attemptId:'prior',productionHandoff:handoff('Earlier')},
      {...f.turn,attemptId:'historical',production:assignment},
      {...f.turn,attemptId:'later',productionHandoff:handoff('Later')},
      {...f.turn,attemptId:'current',production:assignment},
    ]
    expect(productionAssignmentFacts(f.run,assignment,'historical')).toMatchObject({discipline:'ui',completedDesigns:['gameplay']})
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
    f.turn.production.stopAfter='resources'
    expect(prepareProductionHandoff(f.run,f.turn,parseProductionResult(f.turn.production,result)).next).toBeUndefined()
  }finally{await f.close()}
})


test('design guidance leaves content choices within scope without forcing a Skill list',async()=>{
  const f=await fixture()
  try {
    expect(f.turn.production).toEqual({stage:'design',originRequestKey:'start'})
    const prompt=productionAssignmentPrompt(f.run,f.turn.production!)
    const facts=productionAssignmentFacts(f.run,f.turn.production!)
    expect(facts).not.toHaveProperty('directions')
    expect(prompt).toContain('Choose the content, structure and depth')
    expect(prompt).not.toContain('usable initial tuning')
    expect(prompt).not.toContain('identified current feasibility question')
    expect(prompt).not.toContain('Resolve resource families and the platform/engine approach')
    expect(prompt).toContain('BGS current production stage: design')
    expect(prompt).toContain('Determine the product decisions still needed to begin the current authorized work')
    expect(prompt).toContain('For document-only work, answer the requested design questions')
    expect(prompt).toContain('Implementation tuning and resource production belong to implementation')
    expect(prompt).not.toContain('Record governing gameplay quantities')
    expect(prompt).toContain('preserving unrelated confirmed decisions in existing work')
    expect(prompt).toContain('Use the confirmed brief as source data')
    expect(prompt).not.toContain('Select artwork sources and representations')
    expect(prompt).toContain('if it already supplies those decisions, record that conclusion directly')
    expect(prompt).toContain('not game code or assets')
    expect(prompt).not.toContain('After necessary self-checks')
    expect(prompt).not.toContain('numerical tuning, spatial layout and presentation belong to their owning chapters')
    expect(prompt).not.toMatch(/\$[A-Za-z][A-Za-z0-9_-]*/)
    expect(productionAssignmentFacts(f.run,f.turn.production!)).not.toHaveProperty('requiredSkills')
    expect(prompt).toContain('WriteProjectFile/EditProjectFile')
    expect(prompt).toContain('ready or blocked result')
    expect(prompt).not.toContain('complete Markdown document in document')
    expect(prompt).not.toContain('nextDesign')
    f.run.requirements.constraints.platform='VR/AR'
    const spatial=productionAssignmentPrompt(f.run,f.turn.production!)
    expect(spatial).toBe(prompt)
    expect(spatial).not.toMatch(/\$[A-Za-z][A-Za-z0-9_-]*/)
    expect(f.run.requirements.constraints.platform).toBe('VR/AR')
    const visual=productionAssignmentPrompt(f.run,{...f.turn.production!,stage:'visual'})
    expect(visual).toContain('requested player-visible screens/states')
    expect(visual).toContain('necessary subjects, information, actions, trigger conditions and confirmed visual direction')
    expect(visual).toContain('Use applicable visual-design guidance for production methods')
    expect(visual).toContain('through the final ready/blocked JSON result')
    expect(visual).toContain('Keep usable concepts despite ratio deviation')
    expect(visual).toContain('text-only check of the final compiled prompt')
    expect(visual).toContain('There is no separate image-acceptance Agent after generation')
    expect(visual).not.toContain('Independent visual review')
    expect(visual).not.toContain('reviewResponses')
    expect(visual).toContain('Coverage is not a panel count')
    expect(visual).toContain('copy, values, control visibility and triggers')
    expect(visual).toContain('a distinct composition or an unrepresented key element/action needs its own visual representation')
    expect(visual).not.toContain('report claims that present a target as a verified output fact')
    expect(visual).toContain('This stage does not implement the game or establish runtime behavior')
    const implementation=productionAssignmentPrompt(f.run,{stage:'implementation',originRequestKey:'start'})
    expect(implementation).toContain('Choose task organization from the current scope and dependencies')
    expect(implementation).toContain('Reuse a usable existing plan')
    expect(implementation).not.toContain('game-implementation-planning')
    expect(implementation).not.toContain('game-plan-execution')
    expect(implementation).not.toContain('evidence-before-completion')
    expect(implementation).not.toContain("For a new game's first implementation")
    expect(implementation).not.toContain('If no usable plan exists')
    expect(implementation).toContain('preserve completed work')
    expect(implementation).not.toContain('explicit delivery submission')
    expect(implementation).toContain('checks actually performed')
    expect(implementation).not.toContain('Ending a native turn alone is not delivery')
    expect(implementation).toContain('Use applicable professional guidance for implementation methods')
    expect(implementation).not.toMatch(/\$[A-Za-z][A-Za-z0-9_-]*/)
    expect(implementation).toContain('required result and explicit constraints')
    const resources=productionAssignmentPrompt(f.run,{stage:'resources',stopAfter:'resources',originRequestKey:'start'})
    expect(resources).toContain('$game-content-pipeline-engineer')
    for (const context of [visual, resources, implementation]) {
      expect(context).not.toContain('authorized cost')
      expect(context).not.toContain('charge authorization')
      expect(context).not.toContain('For paid generation')
    }
    expect(resources).not.toContain('provisional resource choices in the GDD')
    expect(implementation).not.toContain('at each meaningful checkpoint')
    expect(implementation).not.toContain('existing progress record')
    expect(implementation).not.toContain('Diagnose product, environment and driver failures')
    expect(implementation).not.toContain('whole-game driver')
    expect(implementation).toContain('Choose implementation and verification methods for the required behavior, adopted visual treatment and affected risks')
    expect(implementation).toContain('Implement the confirmed scope and the design decisions needed to realize it')
    expect(implementation).toContain('Adjust provisional tuning to realize the required behavior')
    expect(implementation).not.toContain('settled product decisions')
    expect(implementation).toContain('Alternative cosmetic preferences within an already satisfied treatment remain follow-up suggestions unless refinement is requested.')
    expect(implementation).toContain('Judge remaining work against those requirements and repair observed deviations')
    expect(implementation).toContain('current inputs')
    expect(implementation).toContain('any remaining defects, unverified behavior or external blockers')
    expect(implementation).not.toContain('game-quality acceptance')
    expect(implementation).not.toContain('not certification')
    expect(implementation).toContain('Reuse relevant sources and observations still valid for the current inputs')
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


test('separate stage requests retain settled source pointers without carrying old execution summaries',async()=>{
  const f=await fixture()
  try {
    const finished={...f.turn,status:'ended' as const,quiescedAt:'2026-01-01T00:00:00.000Z'}
    const design=prepareDesignDocumentHandoff(f.root,'Document ready')
    await mkdir(join(f.root,'reports/visual'),{recursive:true})
    await writeFile(join(f.root,'docs/selected.svg'),'<svg/>')
    await writeFile(join(f.root,'docs/selected.png'),Buffer.from([137,80,78,71,13,10,26,10,1]))
    await writeFile(join(f.root,'reports/visual/inspection.md'),'Author observations, not an independent review')
    const visual=prepareProductionHandoff(f.run,{...f.turn,production:{stage:'visual',originRequestKey:'visual-only',stopAfter:'visual'}},
      {action:'advance',summary:'Old assistant execution interpretation',sections:['Space'],
        files:['docs/selected.svg','docs/selected.png','reports/visual/inspection.md']})
    verifyProductionHandoff(f.root,visual)
    const task={stage:'resources' as const,originRequestKey:'new-resource-request'}
    f.run.agentTurns=[
      {...finished,attemptId:'design',production:{stage:'design',originRequestKey:'initial'},productionHandoff:design},
      {...finished,attemptId:'visual',production:{stage:'visual',originRequestKey:'visual-only',stopAfter:'visual'},productionHandoff:visual},
      {...f.turn,attemptId:'current',production:task},
    ]
    const saved=JSON.stringify(f.run)
    expect(productionAssignmentFacts(f.run,task,'current').precedingSources?.files).toEqual(['docs/GDD.md','docs/selected.svg','docs/selected.png'])
    const prompt=productionAssignmentPrompt(f.run,task)
    expect(prompt).toContain('docs/selected.svg')
    expect(prompt).not.toContain('reports/visual/inspection.md')
    expect(prompt).not.toContain('Old assistant execution interpretation')
    expect(JSON.stringify(f.run)).toBe(saved)
    const restored=JSON.parse(saved) as typeof f.run
    expect(productionAssignmentFacts(restored,task,'current')).toEqual(productionAssignmentFacts(f.run,task,'current'))
    expect(restored.agentTurns?.[1]?.productionHandoff).toEqual(visual)
    expect(selectedProductionVisualSources(restored)?.map(s=>s.path)).toEqual(['docs/selected.svg','docs/selected.png'])

    await writeFile(join(f.root,'reports/resource-license.md'),'Required resource provenance')
    const resources=prepareProductionHandoff(f.run,{...f.turn,production:{stage:'resources',originRequestKey:'resource-only'}},
      {...f.request,files:['reports/resource-license.md']})
    const implementation={stage:'implementation' as const,originRequestKey:'implement'}
    restored.agentTurns=[...restored.agentTurns!.slice(0,2),
      {...finished,attemptId:'resources',production:{stage:'resources',originRequestKey:'resource-only'},productionHandoff:resources},
      {...f.turn,attemptId:'current',production:implementation}]
    expect(productionAssignmentFacts(restored,implementation,'current').precedingSources?.files).toEqual([
      'docs/GDD.md','docs/selected.svg','docs/selected.png','reports/resource-license.md'])
    await writeFile(join(f.root,'reports/visual/inspection.md'),'Changed historical report')
    expect(()=>verifyProductionHandoff(f.root,visual)).toThrow('source changed')
  }finally{await f.close()}
})

test('visual ready result accepts formatted GDD headings through the real handoff boundary without weakening source checks', async () => {
  const f = await fixture()
  try {
    const body = f.source + '\n## 9.2 状态一：开始画面 `Ready`\nExisting player entry design.\n'
    await writeFile(join(f.root, 'docs/GDD.md'), body)
    await writeFile(join(f.root, 'docs/selected.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1/8AAAAASUVORK5CYII=', 'base64'))
    const assignment = { stage: 'visual' as const, originRequestKey: 'start', stopAfter: 'implementation' as const }
    const ready = { status: 'ready', summary: 'Selected the existing design image',
      sections: ['9.2 状态一：开始画面 `Ready`'], files: ['docs/selected.png'] }
    const request = parseProductionResult(assignment, ready)
    const handoff = prepareProductionHandoff(f.run, { ...f.turn, production: assignment }, request)
    expect(handoff.next).toEqual({ ...assignment, stage: 'implementation' })
    expect(handoff.request.sections).toEqual(ready.sections)
    expect(handoff.sources.map(source => source.path)).toEqual(['docs/GDD.md', 'docs/selected.png'])
    verifyProductionHandoff(f.root, handoff)
    expect(await readFile(join(f.root, 'docs/GDD.md'), 'utf8')).toBe(body)
    for (const heading of ['Missing', 'Duplicate', '**Duplicate**', '9.2 状态一：开始画面 Readyy']) {
      expect(() => prepareProductionHandoff(f.run, { ...f.turn, production: assignment },
        { ...request, sections: [heading] })).toThrow('missing/ambiguous heading')
    }
    await writeFile(join(f.root, 'docs/selected.png'), 'changed image')
    expect(() => verifyProductionHandoff(f.root, handoff)).toThrow('source changed after submission')
  } finally { await f.close() }
})

test.each(['visual','resources','implementation'] as const)('visual handoff preserves the authorized endpoint: %s',async endpoint=>{
  const f=await fixture()
  try {
    await writeFile(join(f.root,'docs/selected.svg'),'<svg/>')
    f.turn.production={stage:'visual',originRequestKey:'start',stopAfter:endpoint}
    const handoff=prepareProductionHandoff(f.run,f.turn,{...f.request,files:['docs/selected.svg']})
    expect(handoff.next?.stage).toBe(endpoint==='visual'?undefined:endpoint)
    verifyProductionHandoff(f.root,handoff)
    const design={...f.turn,attemptId:'design',status:'ended' as const,quiescedAt:'2026-01-01T00:00:00.000Z',
      production:{stage:'design' as const,originRequestKey:'start'},productionHandoff:prepareDesignDocumentHandoff(f.root,'GDD ready')}
    f.run.agentTurns=[design,{...f.turn,status:'ended',quiescedAt:'2026-01-01T00:00:01.000Z',productionHandoff:handoff}]
    if(endpoint==='implementation') {
      expect(nextProductionStage(f.run)).toBe('implementation')
      expect(messageProductionAssignment(f.run,'resume')?.stage).toBe('implementation')
      expect(f.run.agentTurns.some(turn=>turn.production?.stage==='resources')).toBe(false)
    }
  }finally{await f.close()}
})

test('a later implementation request uses the selected visual without requiring a resource-only task',async()=>{
  const f=await fixture()
  try {
    await writeFile(join(f.root,'docs/selected.svg'),'<svg/>')
    const completed={...f.turn,status:'ended' as const,quiescedAt:'2026-01-01T00:00:00.000Z'}
    const visual={...completed,attemptId:'visual',production:{stage:'visual' as const,originRequestKey:'old',stopAfter:'visual' as const}}
    f.run.agentTurns=[{...completed,productionHandoff:prepareDesignDocumentHandoff(f.root,'GDD')},
      {...visual,productionHandoff:prepareProductionHandoff(f.run,visual,{...f.request,files:['docs/selected.svg']})}]
    f.turn.production=undefined
    f.turn.message={requestKey:'implement',runId:f.run.id,chatSessionId:'chat',expectedVersion:f.run.version,
      requirementsRevision:f.run.requirements.revision,intent:'work',text:'Implement the confirmed game'}
    f.turn.requestKey='implement'
    const next=prepareProductionHandoff(f.run,f.turn,{action:'implement',summary:'Implement selected design',sections:[],files:[]})
    expect(next.next).toEqual({stage:'implementation',originRequestKey:'implement'})
    expect(next.sources.map(source=>source.path)).toEqual(['docs/GDD.md'])
    await writeFile(join(f.root,'docs/GDD.md'),'Changed after implementation handoff')
    expect(()=>verifyProductionHandoff(f.root,next)).toThrow('source changed')
  }finally{await f.close()}
})

test('historical pending resource work resumes without rewriting its scope or handoff',async()=>{
  const f=await fixture()
  try {
    const assignment={stage:'resources' as const,originRequestKey:'old',stopAfter:'implementation' as const}
    const finished={...f.turn,status:'ended' as const,quiescedAt:'2026-01-01T00:00:00.000Z'}
    f.run.agentTurns=[{...finished,productionHandoff:prepareDesignDocumentHandoff(f.root,'GDD')},
      {...finished,attemptId:'visual',production:{stage:'visual',originRequestKey:'old'},productionHandoff:{
        request:{...f.request,action:'advance' as const,files:[]},next:assignment,sources:[]}},
      {...f.turn,attemptId:'interrupted-resource',status:'interrupted',production:assignment}]
    const before=JSON.stringify(f.run)
    expect(messageProductionAssignment(f.run,'resume')).toEqual(assignment)
    expect(productionAssignmentPrompt(f.run,assignment)).toContain('one coherent player situation')
    expect(productionAssignmentPrompt(f.run,{...assignment,stopAfter:'resources'})).toContain('standalone resource set')
    expect(JSON.stringify(f.run)).toBe(before)
  }finally{await f.close()}
})

test('visual acceptance uses settled selected designs across recovery and user-authorized revision',async()=>{
  const f=await fixture()
  try {
    f.run.requirements.constraints={platform:'Native',engine:'Godot'}
    const selected={path:'docs/chosen.png',sha256:'a'.repeat(64)}
    const visual:AgentTurn={...f.turn,attemptId:'selected-visual',status:'ended',quiescedAt:new Date().toISOString(),
      requirementsRevision:f.run.requirements.revision,
      production:{stage:'visual',originRequestKey:'start',stopAfter:'implementation'},
      productionHandoff:{request:{action:'advance',summary:'Selected design',sections:['Space'],files:[selected.path]},
        next:{stage:'implementation',originRequestKey:'start'},sources:[{path:'docs/GDD.md',sha256:'b'.repeat(64)},selected]}}
    f.run.agentTurns=[visual,f.turn]
    expect(selectedProductionVisualSources(f.run)).toEqual([selected])
    const resumed=JSON.parse(JSON.stringify(f.run))
    expect(selectedProductionVisualSources(resumed)).toEqual(selectedProductionVisualSources(f.run))

    // Neither a requirements revision nor an uncommitted replacement selects
    // new artwork. The existing visual task must settle its actual handoff.
    const before=structuredClone(f.run.requirements)
    f.run.requirements={...before,revision:'confirmed-user-change',text:'Use the revised selected design'}
    f.run.requirementChanges=[{requestKey:'user-change',actorId:'owner',at:new Date().toISOString(),before,after:f.run.requirements}]
    const replacement={path:'docs/revised.png',sha256:'c'.repeat(64)}
    const pending:AgentTurn={...visual,attemptId:'revised-visual',status:'running',quiescedAt:undefined,
      requirementsRevision:f.run.requirements.revision,production:{stage:'visual',originRequestKey:'user-change'},
      productionHandoff:{request:{action:'advance',summary:'Revised design',sections:['Space'],files:[replacement.path]},sources:[replacement]}}
    f.run.agentTurns.push(pending)
    expect(selectedProductionVisualSources(f.run)).toEqual([selected])
    pending.status='ended';pending.quiescedAt=new Date().toISOString()
    expect(selectedProductionVisualSources(f.run)).toEqual([replacement])
    f.run.agentTurns=[]
    expect(selectedProductionVisualSources(f.run)).toEqual([])
  }finally{await f.close()}
})


test('implementation follow-up binds the current work without another stage or frozen GDD',async()=>{
  const f=await fixture()
  try {
    delete f.run.productionWorkflow
    f.turn.production={stage:'implementation',originRequestKey:'original-game'}
    f.turn.requestKey='current-repair'
    f.turn.message={requestKey:f.turn.requestKey,runId:f.run.id,chatSessionId:'chat',expectedVersion:f.run.version,
      requirementsRevision:f.run.requirements.revision,intent:'message',text:'Only the current authorized correction'}
    const handoff=prepareProductionHandoff(f.run,f.turn,{action:'implement',summary:'Current correction',sections:[],files:[]})
    expect(handoff.next).toBeUndefined()
    expect(handoff.sources).toEqual([])
    expect(handoff.request.action).toBe('implement')
    await writeFile(join(f.root,'docs/GDD.md'),f.source+'\nSupported design adaptation.\n')
    expect(()=>verifyProductionHandoff(f.root,handoff)).not.toThrow()
    expect(productionAssignmentFacts(f.run,f.turn.production)).not.toHaveProperty('requiredSkills')
  }finally{await f.close()}
})


test('in-task visual selection retains immutable reference bytes without advancing production or freezing the GDD', async () => {
  const f = await fixture()
  try {
    await writeFile(join(f.root, 'docs/look.png'), 'reference bytes')
    await writeFile(join(f.root, 'docs/ui.png'), 'UI reference bytes')
    const turn = { ...f.turn, production: {stage:'implementation' as const, originRequestKey:'start'} }
    const selected = prepareProductionHandoff(f.run, turn, {action:'select-visual',summary:'Adopt the existing look',sections:['Rules'],files:['docs/look.png']})
    expect(selected.next).toBeUndefined()
    expect(selected.sources.map(source => source.path)).toEqual(['docs/look.png'])
    turn.visualSelection = selected
    f.run.agentTurns = [turn]
    const evidence = selectedProductionVisualSources(f.run)
    expect(evidence).toEqual(selected.sources)
    expect(selectedProductionVisualSources(JSON.parse(JSON.stringify(f.run)))).toEqual(evidence)
    const added = prepareProductionHandoff(f.run, turn, {action:'select-visual',summary:'Add the UI treatment',sections:['Space'],files:['docs/ui.png']})
    expect(added.sources.slice(0, selected.sources.length)).toEqual(selected.sources)
    expect(added.sources.map(source => source.path)).toEqual(['docs/look.png','docs/ui.png'])
    await writeFile(join(f.root, 'docs/GDD.md'), '# Updated design decisions\n')
    verifyProductionHandoff(f.root, selected)
    await writeFile(join(f.root, 'docs/look.png'), 'replaced target bytes')
    expect(() => prepareProductionHandoff(f.run, turn, {action:'select-visual',summary:'Attempt replacement',sections:[],files:['docs/look.png']})).toThrow('source bytes changed')
    expect(() => prepareProductionHandoff(f.run, turn, {action:'select-visual',summary:'Not an image target',sections:[],files:['docs/GDD.md']})).toThrow('design images')
    expect(() => prepareProductionHandoff(f.run, f.turn, {action:'select-visual',summary:'Outside production',sections:[],files:['docs/ui.png']})).toThrow('current implementation/resource task')
  } finally { await f.close() }
})


test('complete games start with GDD and hand off directly to implementation; saved implementation tasks still resume',async()=>{
  const f=await fixture()
  try {
    f.run.creation={initialDelivery:'complete-game',editableContent:false}
    await rm(join(f.root,'docs/GDD.md'))
    const initial=initialProductionAssignment(f.run)!
    expect(initial).toEqual({stage:'design',originRequestKey:'start',stopAfter:'implementation'})
    expect(nextProductionStage(f.run)).toBe('design')
    const prompt=productionAssignmentPrompt(f.run,initial)
    expect(prompt).toContain('Choose the content, structure and depth')
    expect(prompt).toContain('not game code or assets')
    f.run.agentTurns=[{...f.turn,production:initial,status:'interrupted',quiescedAt:new Date().toISOString()}]
    expect(messageProductionAssignment(f.run,'resume')).toEqual(initial)
    expect(()=>prepareProductionHandoff(f.run,f.turn,{action:'implement',summary:'Too early',sections:[],files:[]})).toThrow('production stages use advance')
    await writeFile(join(f.root,'docs/GDD.md'),f.source)
    const handoff={...prepareDesignDocumentHandoff(f.root,'Reviewed GDD'),next:{...initial,stage:'implementation' as const}}
    f.run.agentTurns=[{...f.turn,production:initial,status:'ended',quiescedAt:new Date().toISOString(),productionHandoff:handoff}]
    expect(nextProductionStage(f.run)).toBe('implementation')
    expect(messageProductionAssignment(f.run,'implement')).toEqual(handoff.next)
    verifyProductionHandoff(f.root,handoff)
    await writeFile(join(f.root,'docs/GDD.md'),f.source+'Changed decision.\n')
    expect(()=>verifyProductionHandoff(f.root,handoff)).toThrow('source changed')
    await rm(join(f.root,'docs/GDD.md'))
    const retained={stage:'implementation' as const,originRequestKey:'start',stopAfter:'implementation' as const}
    for(const status of ['running','interrupted','failed','ended'] as const) {
      f.run.agentTurns=[{...f.turn,production:retained,status,quiescedAt:new Date().toISOString()}]
      expect(nextProductionStage(JSON.parse(JSON.stringify(f.run)))).toBe('implementation')
      expect(messageProductionAssignment(f.run,'resume',true)).toEqual(retained)
    }
    expect(productionAssignmentPrompt(f.run,retained)).not.toContain('a separate GDD document and review are not prerequisites')
    f.run.creation.initialDelivery='design-led-first-version'
    f.run.agentTurns=[{...f.turn,production:initial,status:'interrupted'}]
    expect(messageProductionAssignment(f.run,'resume')).toEqual(initial)
    delete f.run.creation
    f.run.agentTurns=[]
    expect(initialProductionAssignment(f.run)).toEqual({stage:'design',originRequestKey:'start'})
  }finally{await f.close()}
})

test('new and archived implementations leave verification and completion to the Agent',async()=>{
  const f=await fixture()
  try{
    const legacy={stage:'implementation' as const,originRequestKey:'start',browserVerification:1 as const}
    const before=JSON.stringify(legacy)
    const prompt=productionAssignmentPrompt(f.run,legacy)
    expect(prompt).toContain('Choose implementation and verification methods')
    expect(prompt).toContain('Finish this native turn with the result')
    expect(prompt).not.toMatch(/verification:\{|top-level checks|frozen check|host browser|status:\"ready\"|script source must match/i)
    expect(productionAssignmentFacts(f.run,legacy)).not.toHaveProperty('browserVerification')
    expect(JSON.stringify(legacy)).toBe(before)
    expect(initialProductionAssignment({...f.run,productionWorkflow:1,creation:{initialDelivery:'complete-game',editableContent:false}}))
      .toEqual({stage:'design',originRequestKey:f.run.requestKey,stopAfter:'implementation'})
  }finally{await f.close()}
})

test('design input binds complete UTF-8 bytes and identity without relaxing source validation',async()=>{
  const f=await fixture()
  try {
    const text='# Source\n'+('完整设计内容\n'.repeat(3000))
    await writeFile(join(f.root,'docs/GDD.md'),text)
    const snapshot=designDocumentSnapshot(f.root)
    expect(snapshot.text).toBe(text)
    expect(snapshot.source).toEqual(prepareDesignDocumentHandoff(f.root,'Ready').sources[0]!)
    await writeFile(join(f.root,'docs/GDD.md'),text+'Changed source\n')
    expect(designDocumentSnapshot(f.root).source.sha256).not.toBe(snapshot.source.sha256)
    for(const data of [Buffer.from([0xff]),Buffer.from(' \n'),Buffer.from('Binary\u0000source')]) {
      await writeFile(join(f.root,'docs/GDD.md'),data)
      expect(()=>designDocumentSnapshot(f.root)).toThrow()
    }
    await rm(join(f.root,'docs/GDD.md'))
    expect(()=>designDocumentSnapshot(f.root)).toThrow()
    await writeFile(join(f.root,'outside.md'),'Other source')
    await symlink('../outside.md',join(f.root,'docs/GDD.md'))
    expect(()=>designDocumentSnapshot(f.root)).toThrow('symlink')
  }finally{await f.close()}
})
