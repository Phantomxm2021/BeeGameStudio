import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BeeGameSessionManager, type DashboardPermissionDecision } from './session-manager'
import { MANAGED_WEB_BOOT_PATHS } from './workflow-v3/managed-web-boot'

test('new-project managed entry rejects native mutations and aliases, without reserving old projects or game implementation',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-boot-permissions-'))),workspace=join(root,'project')
  await mkdir(join(workspace,'src'),{recursive:true});await writeFile(join(workspace,'index.html'),'Host entry')
  await writeFile(join(workspace,'src/bgs-entry.mjs'),'Host adapter')
  await symlink(join(workspace,'src/bgs-entry.mjs'),join(workspace,'entry-alias.html'))
  const decisions:DashboardPermissionDecision[]=[]
  let id=''
  const manager=new BeeGameSessionManager({async start(start){
    expect(start.managedWebBoot).toBe(true)
    return {stop(){},async submit(turn){
      for(const toolName of ['Write','Edit','MultiEdit','NotebookEdit']) {
        const key=toolName==='NotebookEdit'?'notebook_path':'file_path'
        for(const path of [...MANAGED_WEB_BOOT_PATHS,'entry-alias.html','index.html','src/game.jsx'])
          decisions.push(await turn.requestPermission({toolName,toolUseID:crypto.randomUUID(),input:{[key]:join(workspace,path)},message:'Fixture decision'}))
      }
      manager.setProjectManagedWebBoot(id,false)
      decisions.push(await turn.requestPermission({toolName:'Write',toolUseID:'old-project',input:{file_path:join(workspace,'index.html')},message:'Existing entry remains editable'}))
      await turn.onMessage({type:'result',subtype:'success',result:'Fixture complete'})
    }}
  }},root)
  try {
    id=manager.start({workspacePath:workspace,userId:'owner',projectId:'fixture'}).id
    manager.setProjectManagedWebBoot(id,true)
    await manager.sendWithDisplay(id,'Fixture checks');await manager.waitForSessionIdle(id)
    expect(decisions.map(d=>d.behavior)).toEqual([...Array(4).fill(['deny','deny','deny','allow','allow']).flat(),'allow'])
    expect(manager.pendingPermissionsForProject('owner','fixture',workspace)).toHaveLength(0)
  }finally{await manager.dispose();await rm(root,{recursive:true,force:true})}
})

test('implementation baseline locks native planning writes without blocking code or requiring another approval flow', async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(),'bgs-plan-permission-'))), workspace=join(base,'project')
  await mkdir(workspace)
  await mkdir(join(workspace,'docs'))
  await writeFile(join(workspace,'docs/GDD.md'),'Fixture plan')
  await symlink(join(workspace,'docs/GDD.md'),join(workspace,'plan-alias.md'))
  const decisions: DashboardPermissionDecision[]=[]
  let sessionId=''
  const manager=new BeeGameSessionManager({start:async()=>({stop(){},async submit(turn){
    const write=async(path:string)=>decisions.push(await turn.requestPermission({toolName:'Write',toolUseID:crypto.randomUUID(),input:{file_path:join(workspace,path)},message:'Fixture path decision'}))
    await write('docs/GDD.md')
    manager.setProjectDesignLocked(sessionId,true)
    for(const path of ['docs/GDD.md','plan-alias.md','.beegame/design-handoffs/GDD.json','src/game.js'])await write(path)
    manager.setProjectDesignLocked(sessionId,false)
    await write('docs/GDD.md')
    await turn.onMessage({type:'result',subtype:'success',result:'Fixture complete'})
  }})},base)
  try {
    sessionId=manager.start({workspacePath:workspace,userId:'owner',projectId:'project'}).id
    await manager.sendWithDisplay(sessionId,'Offline permissions only')
    await manager.waitForSessionIdle(sessionId)
    expect(decisions.map(d=>d.behavior)).toEqual(['allow','deny','deny','deny','allow','allow'])
    expect(manager.pendingPermissionsForProject('owner','project',workspace)).toHaveLength(0)
  }finally{await manager.dispose();await rm(base,{recursive:true,force:true})}
})

test.each(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])('root AGENTS.md requires existing explicit approval for %s, including aliases', async toolName => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'bgs-guide-permission-'))), workspace = join(base, 'project')
  await mkdir(workspace)
  await writeFile(join(workspace, 'AGENTS.md'), 'UNCHANGED_INSTRUCTIONS')
  await symlink(join(workspace, 'AGENTS.md'), join(workspace, 'guide-alias.md'))
  const decisions: DashboardPermissionDecision[] = []
  const key = toolName === 'NotebookEdit' ? 'notebook_path' : 'file_path'
  const manager = new BeeGameSessionManager({ start: async () => ({ stop() {}, async submit(turn) {
    for (const path of ['AGENTS.md', 'guide-alias.md'])
      decisions.push(await turn.requestPermission({ toolName, toolUseID: path, input: { [key]: join(workspace, path) }, message: 'Change root instructions' }))
    decisions.push(await turn.requestPermission({ toolName, toolUseID: 'ordinary', input: { [key]: join(workspace, 'src/game.txt') }, message: 'Ordinary output' }))
    await turn.onMessage({ type: 'result', subtype: 'success', result: 'Fixture complete' })
  } }) }, base)
  try {
    const session = manager.start({ workspacePath: workspace, userId: 'owner', projectId: 'project' })
    await manager.sendWithDisplay(session.id, 'Offline permission decisions only')
    for (const path of ['AGENTS.md', 'guide-alias.md']) {
      for (let i = 0; i < 200 && !manager.pendingPermissionsForProject('owner', 'project', workspace).length; i++) await Bun.sleep(5)
      const [pending] = manager.pendingPermissionsForProject('owner', 'project', workspace)
      expect(pending?.toolUseID).toBe(path)
      // Exercise the same user decision route used by existing native safety prompts.
      manager.resolvePermission(session.id, pending!.toolUseID, { behavior: 'deny', source: 'user' })
    }
    await manager.waitForSessionIdle(session.id)
    expect(decisions.map(value => value.behavior)).toEqual(['deny', 'deny', 'allow'])
    expect(await Bun.file(join(workspace, 'AGENTS.md')).text()).toBe('UNCHANGED_INSTRUCTIONS')
  } finally { await manager.dispose(); await rm(base, { recursive: true, force: true }) }
})

test.each(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])('project boundary applies to native %s, including nonexistent and linked destinations', async toolName => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'bgs-file-boundary-')))
  const workspace = join(base, 'project'), outside = join(base, 'outside')
  await mkdir(workspace); await mkdir(outside)
  await symlink(outside, join(workspace, 'escape'))
  const decisions: DashboardPermissionDecision[] = []
  const key = toolName === 'NotebookEdit' ? 'notebook_path' : 'file_path'
  const manager = new BeeGameSessionManager({ start: async () => ({ stop() {}, async submit(turn) {
    for (const [id, path] of [
      ['inside', join(workspace, 'new/file.txt')],
      ['outside', join(outside, 'new/file.txt')],
      ['linked', join(workspace, 'escape/new/file.txt')],
      ['invalid', ''],
    ]) decisions.push(await turn.requestPermission({ toolName, toolUseID: id!, input: {
      [key]: path, ...(toolName === 'Write' ? { content: 'DO_NOT_DUPLICATE_AUTOMATIC_PERMISSION_PAYLOAD' } : {}),
    }, message: 'Offline path decision only' }))
    decisions.push(await turn.requestPermission({ toolName, toolUseID: 'wrong-key',
      input: { [key]: join(outside, 'new/file.txt'), [toolName === 'NotebookEdit' ? 'file_path' : 'path']: join(workspace, 'allowed.txt') },
      message: 'An unrelated input key cannot substitute the actual mutation target' }))
    await turn.onMessage({ type: 'result', subtype: 'success', result: 'Fixture complete' })
  } }) }, base)
  try {
    const session = manager.start({ workspacePath: workspace, userId: 'owner', projectId: 'project' })
    await manager.sendWithDisplay(session.id, 'Check permission decisions without executing a file tool')
    for (let i = 0; i < 200 && decisions.length < 5; i++) await Bun.sleep(5)
    expect(decisions.map(value => value.behavior)).toEqual(['allow', 'deny', 'deny', 'deny', 'deny'])
    expect(manager.pendingPermissionsForProject('owner', 'project', workspace)).toHaveLength(0)
    expect(JSON.stringify(manager.events(session.id).filter(event => event.type === 'permission.resolved')))
      .not.toContain('DO_NOT_DUPLICATE_AUTOMATIC_PERMISSION_PAYLOAD')
    expect(await Bun.file(join(outside, 'new/file.txt')).exists()).toBe(false)
  } finally { await manager.dispose(); await rm(base, { recursive: true, force: true }) }
})

test('Glob cannot replace a checked project directory with an absolute or parent-traversing pattern', async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'bgs-glob-boundary-')))
  const workspace = join(base, 'project'), outside = join(base, 'outside')
  await mkdir(workspace); await mkdir(outside)
  const inputs = [
    { pattern: '**/*.json' },
    { pattern: '*.json', path: workspace },
    { pattern: join(outside, '*.json') },
    { pattern: join(outside, '*.json'), path: workspace },
    { pattern: join(workspace, '*.json') },
    { pattern: '../outside/*.json' },
    { pattern: '..\\outside\\*.json', path: workspace },
    { pattern: '*.json', path: outside },
    { pattern: '*.json', path: '~' },
    { pattern: '*.json', path: ' ~/bgs-boundary-probe ' },
    { pattern: '*.json', path: ' '+outside+' ' },
    { pattern: '' },
    {},
  ]
  const decisions: DashboardPermissionDecision[] = []
  const manager = new BeeGameSessionManager({ start: async () => ({ stop() {}, async submit(turn) {
    for (const [index, input] of inputs.entries())
      decisions.push(await turn.requestPermission({ toolName: 'Glob', toolUseID: String(index), input, message: 'Path decisions only; never enumerate outside files' }))
    await turn.onMessage({ type: 'result', subtype: 'success', result: 'Fixture complete' })
  } }) }, base)
  try {
    const session = manager.start({ workspacePath: workspace, userId: 'owner', projectId: 'project' })
    await manager.sendWithDisplay(session.id, 'Offline Glob boundary fixture')
    for (let i = 0; i < 200 && decisions.length < inputs.length; i++) await Bun.sleep(5)
    expect(decisions.map(value => value.behavior)).toEqual(['allow', 'allow', ...Array(11).fill('deny')])
  } finally { await manager.dispose(); await rm(base, { recursive: true, force: true }) }
})

test.each(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])('native %s safety prompts survive project auto-approval, but cannot authorize outside writes', async toolName => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'bgs-sensitive-write-')))
  const workspace = join(base, 'project')
  await mkdir(workspace)
  const key = toolName === 'NotebookEdit' ? 'notebook_path' : 'file_path'
  const decisions: DashboardPermissionDecision[] = []
  const reason = 'Native safety check requires explicit sensitive-file approval'
  const manager = new BeeGameSessionManager({ start: async () => ({ stop() {}, async submit(turn) {
    decisions.push(await turn.requestPermission({ toolName, toolUseID: 'outside',
      input: { [key]: join(base, 'outside/settings.json') }, message: reason, decisionReason: reason }))
    decisions.push(await turn.requestPermission({ toolName, toolUseID: 'sensitive',
      input: { [key]: join(workspace, '.claude/settings.json') }, message: reason, decisionReason: reason }))
    decisions.push(await turn.requestPermission({ toolName, toolUseID: 'ordinary',
      input: { [key]: join(workspace, 'src/game.txt') }, message: 'Ordinary BGS ask rule' }))
    await turn.onMessage({ type: 'result', subtype: 'success', result: 'Fixture complete' })
  } }) }, base)
  try {
    const session = manager.start({ workspacePath: workspace, userId: 'owner', projectId: 'project' })
    await manager.sendWithDisplay(session.id, 'Offline safety prompt fixture')
    for (let i = 0; i < 200 && !manager.pendingPermissionsForProject('owner', 'project', workspace).length; i++) await Bun.sleep(5)
    expect(decisions.map(value => value.behavior)).toEqual(['deny'])
    expect(manager.pendingPermissionsForProject('owner', 'project', workspace)).toMatchObject([{ toolUseID: 'sensitive' }])
    expect(manager.events(session.id).find(event => event.type === 'permission.requested')?.payload).toMatchObject({ decisionReason: reason })
    manager.resolvePermission(session.id, 'sensitive', { behavior: 'deny', source: 'user' })
    for (let i = 0; i < 200 && decisions.length < 3; i++) await Bun.sleep(5)
    expect(decisions.map(value => value.behavior)).toEqual(['deny', 'deny', 'allow'])
    expect(await Bun.file(join(workspace, '.claude/settings.json')).exists()).toBe(false)
  } finally { await manager.dispose(); await rm(base, { recursive: true, force: true }) }
})
