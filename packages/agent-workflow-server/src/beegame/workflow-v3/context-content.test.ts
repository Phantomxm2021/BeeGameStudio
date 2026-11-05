import { test, expect } from 'bun:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRun } from './state'
import { skillEvidence, priorMainSkillLoads } from './context'
import { versionsMatch } from './checks'
import { runContentCheck } from './content-checks'
import { uiLayoutFixture, sceneLayoutFixture } from '../fixtures/layout-fixture'
import { auditAssetContract } from '../asset-contract-audit'
import { assetManifestAuthoringExamples } from '../asset-manifest-authoring-contract'
import { writeBeeGameAssetManifest } from '../asset-contracts'

test('historical Skill evidence preserves same-session successful loads without inventing current/child application',()=>{
  const run=createRun({projectId:'history',ownerId:'owner',workspacePath:'/unused',chatSessionId:'chat',requestKey:'goal',text:'Goal',constraints:{},ids:['goal']})
  const turn=(id:string,native:string|undefined,skills:any[])=>({attemptId:id,requestKey:id,sessionId:'chat',workerId:'worker',
    fence:1,status:'ended' as const,startedAt:'past',nativeSessionId:native,skillUses:skills})
  const load=(name:string,toolUseID:string)=>({name,toolUseID,eventId:1,status:'loaded' as const})
  run.agentTurns=[turn('first','native-a',[load('design','old'),{...load('child-method','child'),parentToolUseID:'delegate'},
    {...load('failed-method','failed'),status:'failed'}]),turn('other','native-b',[load('not-in-lineage','other')]),
    turn('recent','native-a',[load('design','recent')]),turn('current',undefined,[load('not-historical','current')]),
    turn('future','native-a',[load('future','future')])]
  const before=structuredClone(run),result=priorMainSkillLoads(run,'current')
  expect(result).toEqual({recordedMainLoads:[{name:'design',attemptId:'recent',toolUseID:'recent'}],
    contextPresence:'unverified',application:'unverified'})
  expect(priorMainSkillLoads(run,'first').recordedMainLoads).toEqual([])
  expect(priorMainSkillLoads(run,'unknown').recordedMainLoads).toEqual([])
  expect(run).toEqual(before)
})

const task = { expectedOutputs: ['content/ui/menu.json'] }

test('Skill evidence records completion without treating a failed load as success', () => {
  const started = { id: 1, type: 'tool.started', payload: { toolName: 'Skill', toolUseID: 'skill-1', parentToolUseID: 'child', input: { skill: 'bgs-builtins:game-ui-ux-designer' } } }
  const failed = skillEvidence([started, { id: 2, type: 'tool.failed', payload: { toolUseID: 'skill-1' } }])
  expect(failed[0]?.status).toBe('failed')
  const loaded = skillEvidence([started, { id: 3, type: 'tool.completed', payload: { toolUseID: 'skill-1' } }])
  expect(loaded[0]).toMatchObject({ status: 'loaded', parentToolUseID: 'child', eventId: 3 })
})

test('scoped content checks need no GDD, catch overflow, distinguish unbound drafts and preserve unrelated files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-v3-layout-'))
  try {
    await mkdir(join(root, 'content/ui'), { recursive: true })
    const save = async (ui: unknown) => writeFile(join(root, 'content/ui/menu.json'), JSON.stringify(ui))
    await save(uiLayoutFixture())
    await writeFile(join(root, 'content/ui/unrelated.json'), 'not a document')
    const checked = await Promise.all((['content-structure', 'content-layout', 'content-resources'] as const)
      .map(id => runContentCheck(root, id, task, [], { orientation: 'Landscape' })))
    expect(checked.map(check => check.status)).toEqual(['passed', 'passed', 'passed'])
    expect(checked[2]!.observation).toContain('empty declared resource closure')
    expect(checked[2]!.observation).toContain('final resource coverage and runtime use remain unverified')
    expect(checked[1]!.coverage?.files).toEqual(['content/ui/menu.json'])
    expect(checked[1]!.inputs.some(file => file.path.includes('unrelated'))).toBe(false)
    await save(uiLayoutFixture(2000))
    expect((await runContentCheck(root, 'content-layout', task, [], {})).status).toBe('failed')
    await save(uiLayoutFixture())
    expect((await runContentCheck(root, 'content-layout', task, [], { orientation: 'Portrait' })).observation).toContain('orientation differs')
    const wrong = uiLayoutFixture() as any; wrong.data.nodes[1].parentId = 'missing'
    await save(wrong)
    expect((await runContentCheck(root, 'content-structure', task, [], {})).status).toBe('failed')
    expect(auditAssetContract(root, []).valid).toBe(false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('actual linked Scene and underlay versions invalidate results; missing links never receive PASS', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-v3-layout-link-'))
  try {
    await mkdir(join(root, 'content/ui'), { recursive: true }); await mkdir(join(root, 'content/scenes'), { recursive: true })
    const ui = uiLayoutFixture() as any
    ui.data.nodes.push({ id: 'game-view', parentId: 'root', role: 'container', layout: { size: [300, 200] } })
    ui.data.nodes[0].data.layoutCamera = { nodeId: 'game-view', path: 'content/scenes/level.json' }
    await writeFile(join(root, 'content/ui/menu.json'), JSON.stringify(ui))
    const missing = await runContentCheck(root, 'content-layout', task, [], {})
    expect(missing.status).not.toBe('passed')
    await writeFile(join(root, 'content/scenes/level.json'), JSON.stringify(sceneLayoutFixture()))
    const checked = await runContentCheck(root, 'content-layout', task, [], {})
    expect(checked.status).toBe('passed')
    expect(checked.inputs.map(file => file.path)).toContain('content/scenes/level.json')
    await writeFile(join(root, 'content/scenes/level.json'), JSON.stringify({ ...sceneLayoutFixture(), id: 'changed' }))
    expect(await versionsMatch(root, checked.inputs)).toBe(false)
    ui.data.nodes[0].data.layoutUnderlay = { path: 'content/ui/below.json', clearance: 'allow-cover' }
    await writeFile(join(root, 'content/ui/menu.json'), JSON.stringify(ui))
    expect((await runContentCheck(root, 'content-layout', task, [], {})).status).not.toBe('passed')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('resource checks bind actual modules/members and retain required Manifest coverage beyond scoped bindings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-v3-resource-check-'))
  try {
    await mkdir(join(root, 'content/ui'), { recursive: true }); await mkdir(join(root, 'assets/runtime/example'), { recursive: true })
    const manifest = assetManifestAuthoringExamples().canonical
    // A required registered resource cannot disappear behind narrower bindings.
    manifest.requirements.push({ ...structuredClone(manifest.requirements[0]!), id: 'req-unrelated' })
    await writeBeeGameAssetManifest(root, manifest)
    await writeFile(join(root, 'assets/runtime/example/resource.json'), '{}')
    const ui = uiLayoutFixture() as any
    ui.assetRefs = [manifest.resources[0]!.id]
    ui.data.nodes[1].data = { image: { assetRef: manifest.resources[0]!.id } }
    await writeFile(join(root, 'content/ui/menu.json'), JSON.stringify(ui))
    const incomplete = await runContentCheck(root, 'content-resources', task, [], {})
    expect(incomplete.status).toBe('failed')
    expect(incomplete.observation).toContain('req-unrelated')
    manifest.requirements.pop()
    await writeBeeGameAssetManifest(root, manifest)
    const checked = await runContentCheck(root, 'content-resources', task, [], {})
    expect(checked.status, checked.observation).toBe('passed')
    expect(checked.inputs.map(file => file.path)).toContain('assets/runtime/example/resource.json')
    expect(checked.inputs.some(file => file.path.startsWith('assets/manifest/'))).toBe(true)
    expect(auditAssetContract(root).valid).toBe(true)
    await writeFile(join(root, 'assets/runtime/example/resource.json'), 'broken json')
    expect(await versionsMatch(root, checked.inputs)).toBe(false)
    expect((await runContentCheck(root, 'content-resources', task, [], {})).status).toBe('failed')
    await rm(join(root, 'assets/runtime/example/resource.json'))
    expect((await runContentCheck(root, 'content-resources', task, [], {})).status).toBe('failed')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('an embedded assetRef with an empty declaration is a resource error, not a resource-free draft', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-v3-undeclared-resource-'))
  try {
    await mkdir(join(root, 'content/ui'), { recursive: true })
    const ui = uiLayoutFixture() as any
    ui.assetRefs = []
    ui.data.nodes[1].data = { image: { assetRef: 'missing-art' } }
    await writeFile(join(root, 'content/ui/menu.json'), JSON.stringify(ui))
    const result = (await runContentCheck(root, 'content-resources', task, [], {}))
    expect(result.status).toBe('failed')
    expect(result.observation).toContain('uses undeclared assetRef missing-art')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('native command receipt records a load without pretending the model invoked the Skill tool', () => {
  const payload={type:'system',subtype:'status',skill:{name:'bgs-builtins:game-creative-director-expert',
    source:'command',messageId:'body-uuid',status:'loaded'}}
  expect(skillEvidence([{id:1,type:'system.status',payload}])).toEqual([
    {name:payload.skill.name,messageId:'body-uuid',source:'command',eventId:1,status:'loaded'},
  ])
  expect(skillEvidence([{id:1,type:'assistant.message',payload},
    {id:2,type:'system.status',payload:{...payload,skill:{...payload.skill,status:'pending'}}}])).toEqual([])
})


test('Shell Skill evidence links native events without generating a second outcome state',()=>{
  const skillReads=[{name:'method',path:'/catalog/method/SKILL.md'},
    {name:'method',path:'/catalog/method/references/detail.md'}]
  const started={id:1,type:'tool.started',payload:{toolName:'Shell',toolUseID:'read',skillReads,parentToolUseID:'child'}}
  const complete={id:3,type:'tool.completed',payload:{...started.payload,exitCode:0,output:'Selected or truncated content'}}
  const events=[started,{id:2,type:'tool.progress',payload:started.payload},complete,complete]
  const before=structuredClone(events),uses=skillEvidence(events)
  expect(uses).toHaveLength(2)
  expect(uses.map(use=>use.path)).toEqual(skillReads.map(read=>read.path))
  expect(uses.every(use=>use.source==='shell'&&use.eventId===complete.id&&use.parentToolUseID==='child')).toBe(true)
  for(const event of [started,complete,{...complete,id:4,type:'tool.failed',payload:{...complete.payload,exitCode:1}},
    {...complete,id:5,payload:{...complete.payload,exitCode:undefined}}]) {
    const links=skillEvidence([event])
    expect(links).toHaveLength(2)
    expect(links.every(link=>link.eventId===event.id&&link.toolUseID===event.payload.toolUseID)).toBe(true)
    expect(links.every(link=>!Object.hasOwn(link,'status'))).toBe(true)
  }
  expect(events).toEqual(before)
  // Metadata is not inferred from commands, output claims, progress or assistant prose.
  expect(skillEvidence([{...complete,type:'assistant.message'},
    {id:4,type:'tool.completed',payload:{toolName:'Shell',toolUseID:'unknown',exitCode:0,
      input:{command:'echo /catalog/method/SKILL.md'},output:'I applied method successfully'}}])).toEqual([])
})

test('Shell read links and former read statuses never enter historical loader receipts',()=>{
  const run=createRun({projectId:'reads',ownerId:'owner',workspacePath:'/unused',chatSessionId:'chat',requestKey:'goal',text:'Goal',constraints:{},ids:['goal']})
  const reads=skillEvidence([{id:1,type:'tool.completed',payload:{toolName:'Shell',toolUseID:'read',exitCode:0,
    skillReads:[{name:'method',path:'/catalog/method/SKILL.md'}]}}])
  run.agentTurns=[{attemptId:'first',requestKey:'first',sessionId:'chat',workerId:'worker',fence:1,status:'ended',
    startedAt:'past',nativeSessionId:'same',skillUses:[...reads,{...reads[0]!,status:'read-command-completed'},
      {...reads[0]!,name:'child-method',parentToolUseID:'child'}]},
    {attemptId:'current',requestKey:'current',sessionId:'chat',workerId:'worker',fence:2,status:'running',startedAt:'now'}]
  const before=structuredClone(run)
  expect(priorMainSkillLoads(run,'current')).toEqual({recordedMainLoads:[],contextPresence:'unverified',application:'unverified'})
  expect(run).toEqual(before)
})
