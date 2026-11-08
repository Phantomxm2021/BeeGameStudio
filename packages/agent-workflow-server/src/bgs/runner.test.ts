import { reasoningConnectionKey, saveReasoningPreference } from './preferences-store'
import { ProductionBlockedError } from '../beegame/production-blocked'
import { expect, test, spyOn } from 'bun:test'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { createBgsRunner, nativeRgNoMatch, nativeSkillReadTargets, bgsUsage, bgsProviderConfig, editProtectedFileText, bgsApplicationContext } from './runner'
import { BeeGameSessionManager, getLatestRuntimeUsage, type BeeGameEvent, type DashboardPermissionRequest } from '../beegame/session-manager'
import { appendChatTranscript } from '../beegame/project-records'
import * as browserCleanup from '../beegame/native-test-browser-cleanup'
import { BgsClient } from './client'
import { assertDesignReviewReady, DESIGN_REVIEW_INSTRUCTIONS, type DesignReviewReceipt, type DesignReviewDisposition } from '../beegame/workflow-v3/design-review'

import { createRun } from '../beegame/workflow-v3/state'
import { productionAssignmentBaseInstructions, productionWorkflowToolDescription, parseProductionResult, productionOutputSchema } from '../beegame/workflow-v3/production-workflow'

const resolveOutboundTarget: typeof import('@bee-game-studio/security-core').resolveApprovedOutboundTarget = async (value) => ({ url: new URL(value), addresses: ['93.184.216.34'],
  lookup: (_host, _options, callback) => callback(null, '93.184.216.34', 4) })
const command = [process.execPath, fileURLToPath(new URL('./fixtures/app-server.ts', import.meta.url))]

for (const mode of ['plain-result','failed-checks','repair','changed-scope','alternate-tool','stop','native-failure','cold-resume','missing-history'] as const)
test('implementation uses native completion without a BGS browser contract: '+mode,async()=>{
  const cleanup=spyOn(browserCleanup,'closeSessionTestBrowsers').mockResolvedValue(undefined)
  const original=BgsClient.prototype.request,trace:Array<{method:string;params:any}>=[]
  let authorized=0
  const rpc=spyOn(BgsClient.prototype,'request').mockImplementation(async function(this:BgsClient,method:string,params:any,timeout?:number):Promise<any>{
    trace.push({method,params})
    if(method==='turn/interrupt'){
      await original.call(this,'fixture/events',{events:[{method:'turn/completed',params:{threadId:params.threadId,turnId:params.turnId,turn:{id:params.turnId,status:'interrupted'}}}]})
      return {}
    }
    return original.call(this,method,params,timeout)
  })
  let f:Awaited<ReturnType<typeof fixture>>|undefined
  const abort=new AbortController()
  try{
    f=await fixture('allow',{OPENAI_AUTH_MODE:'chatgpt',BGS_FIXTURE_DESIGN_REVIEW:'manual',
      ...(mode==='missing-history'?{BGS_FIXTURE_RESUME_ERROR:'missing'}:{}),
      BEEGAME_NATIVE_MCP_SERVERS_JSON:JSON.stringify([{id:'browser',name:'Browser',enabled:true,autoStart:true,scope:'global',transport:'stdio',command:'/fixture/browser',
        enabledTools:['browser_run_code_unsafe','browser_evaluate'],disabledTools:['browser_click']}]),
    },resolveOutboundTarget,mode==='cold-resume'?'saved-browser-author':mode==='missing-history'?'019a0000-0000-7000-8000-000000000099':undefined,
      undefined,mode==='cold-resume'||mode==='missing-history',undefined,undefined,
      mode==='missing-history'?{restartFromDesign:{prompt:'Retained reviewed implementation assignment',authorize:async()=>{authorized++}}}:{})
    const runtime=f.runtime as any,client=runtime.client as BgsClient
    const emit=(...events:any[])=>client.request('fixture/events',{events})
    let ended=false
    const pending=f.submit('Implement the current scope',abort.signal).then(()=>{ended=true;return null},error=>{ended=true;return error as Error})
    await waitUntil(()=>runtime.active?.turnId==='turn-1')
    const call=async(id:string,result:any,tool='browser_run_code_unsafe')=>{
      const item={id,type:'mcpToolCall',server:'bgs-browser',tool,status:'inProgress',arguments:{code:"await import('./existing-checks.js')"}}
      await emit({method:'item/started',params:{threadId:f!.sessionId,turnId:'turn-1',item}},
        {method:'item/completed',params:{threadId:f!.sessionId,turnId:'turn-1',item:{...item,status:'completed',result}}})
      await waitUntil(()=>f!.events.some(event=>event.eventType==='tool.completed'&&event.toolUseID===id))
      expect(ended).toBe(false)
    }
    await call('first-check',{content:[{type:'text',text:'Browser diagnostic output'}],structuredContent:{checks:[{
      id:'first',status:mode==='failed-checks'||mode==='repair'?'failed':'passed',observed:'Actual fixture observation'}]}})
    if(mode==='repair'||mode==='changed-scope')await call('next-check',{content:[],structuredContent:{checks:[{id:'different-diagnostic',status:'passed',observed:'Affected input repaired'}]}})
    if(mode==='alternate-tool')await call('focused-observation',{content:[{type:'text',text:'Current browser state'}]},'browser_evaluate')
    // A passing tool result does not end implementation or replace the Agent's answer.
    expect(trace.some(entry=>entry.method==='turn/interrupt')).toBe(false)
    const answer=mode==='failed-checks'?'Implementation ended; one browser behavior remains unverified.':'Implementation and affected verification finished.'
    if(mode==='stop')abort.abort()
    else await emit({method:'item/completed',params:{threadId:f.sessionId,turnId:'turn-1',item:{id:'author-answer',type:'agentMessage',phase:'final_answer',text:answer}}},
      {method:'turn/completed',params:{threadId:f.sessionId,turnId:'turn-1',turn:{id:'turn-1',status:mode==='native-failure'?'failed':'completed',
        ...(mode==='native-failure'?{error:{message:'Native execution failed'}}:{})}}})
    const error=await pending
    if(mode==='stop'||mode==='native-failure')expect(error).toBeInstanceOf(Error)
    else{expect(error).toBeNull();expect(f.events.some(event=>event.eventType==='assistant.message'&&event.text===answer)).toBe(true)}
    expect(authorized).toBe(mode==='missing-history'?1:0)
    const author=trace.find(entry=>entry.method===(mode==='cold-resume'?'thread/resume':'thread/start')&&entry.params.permissions==='bgs-project')!
    expect(author.params).toMatchObject({approvalPolicy:'on-request',approvalsReviewer:'auto_review'})
    expect(author.params).not.toHaveProperty('baseInstructions')
    expect(author.params.config.mcp_servers['bgs-browser']).toMatchObject({enabled_tools:['browser_run_code_unsafe','browser_evaluate'],disabled_tools:['browser_click']})
    expect(trace.find(entry=>entry.method==='turn/start')!.params).not.toHaveProperty('outputSchema')
    expect(JSON.stringify(author.params.developerInstructions)).toContain('For ordinary task completion')
    expect(trace.some(entry=>entry.method==='mcpServerStatus/list'||entry.method==='mcpServer/tool/call')).toBe(false)
    expect(trace.filter(entry=>entry.method==='thread/start'&&entry.params.permissions==='bgs-project-review')).toHaveLength(0)
    expect(trace.filter(entry=>entry.method==='turn/start')).toHaveLength(1)
    if(mode==='cold-resume')expect(trace.find(entry=>entry.method==='turn/start')!.params.input).toEqual([])
  }finally{try{await f?.close()}finally{rpc.mockRestore();cleanup.mockRestore()}}
},30000)

for(const recovery of [false,true])
for(const stage of ['implementation','verification'] as const)
test('isolated '+stage+' role reaches native '+(recovery?'resume':'start')+' without restricting tools',async()=>{
  const run=createRun({projectId:'role',ownerId:'owner',workspacePath:'/synthetic',chatSessionId:'chat',requestKey:'role',text:'One current game',constraints:{},ids:['goal']})
  run.creation={initialDelivery:'complete-game',editableContent:false,verification:'isolated'}
  const baseInstructions=productionAssignmentBaseInstructions(run,{stage,originRequestKey:'role'})
  const f=await fixture('allow',{OPENAI_AUTH_MODE:'chatgpt',BGS_FIXTURE_DESIGN_REVIEW:'manual',
    BEEGAME_NATIVE_MCP_SERVERS_JSON:JSON.stringify([{id:'browser',name:'Browser',enabled:true,autoStart:true,scope:'global',transport:'stdio',command:'/fixture/browser'}]),
  },resolveOutboundTarget,recovery?'saved-phase-role':undefined,undefined,recovery,undefined,async()=>({}),{baseInstructions})
  const runtime=f.runtime as any
  try {
    const pending=f.submit('Current assignment source data')
    await waitUntil(()=>runtime.active?.turnId==='turn-1')
    const emit=(...events:any[])=>runtime.client.request('fixture/events',{events})
    await emit({method:'item/completed',params:{threadId:f.sessionId,turnId:'turn-1',item:{id:'done',type:'agentMessage',phase:'final_answer',text:'Current assignment handed off'}}},
      {method:'turn/completed',params:{threadId:f.sessionId,turnId:'turn-1',turn:{id:'turn-1',status:'completed'}}})
    await pending
    const trace=(await readFile(join(f.root,'rpc.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line))
    const thread=trace.find(item=>item.method===(recovery?'thread/resume':'thread/start'))!
    expect(thread.params).not.toHaveProperty('baseInstructions')
    expect(thread.params.developerInstructions.split(baseInstructions!)).toHaveLength(2)
    expect(thread.params).toMatchObject({permissions:'bgs-project',approvalPolicy:'on-request',approvalsReviewer:'auto_review'})
    expect(thread.params.config.mcp_servers['bgs-browser']).toMatchObject({command:'/fixture/browser'})
    expect(thread.params.config.mcp_servers['bgs-browser'].enabled).not.toBe(false)
    if(!recovery)expect(thread.params.dynamicTools.map((tool:any)=>tool.name)).toContain('BgsWorkflow')
    const start=trace.find(item=>item.method==='turn/start')!
    expect(start.params).not.toHaveProperty('outputSchema')
    if(recovery)expect(start.params.input).toEqual([])
  }finally{await f.close()}
})

for (const mode of ['live-command', 'pending-mcp', 'document-task',
  'receipt-exit', 'receipt-content-exit', 'receipt-running', 'receipt-malformed', 'receipt-wrong-thread', 'receipt-wrong-turn', 'receipt-spoofed-output', 'receipt-without-placeholder', 'receipt-unknown-call', 'receipt-no-context', 'receipt-no-identity', 'receipt-no-history'] as const)
test('preparation handoff retains genuine unfinished-tool checks: ' + mode, async () => {
  const cleanup = spyOn(browserCleanup, 'closeSessionTestBrowsers').mockResolvedValue(undefined)
  const original = BgsClient.prototype.request
  let cleaned = 0, accepted = 0
  let historyPath: string | undefined
  const succeeds = ['receipt-exit','receipt-content-exit'].includes(mode)
  const rpc = spyOn(BgsClient.prototype, 'request').mockImplementation(async function(this: BgsClient, method: string, params: any, timeout?: number): Promise<any> {
    if (method === 'thread/resume') throw Error('no rollout found for fresh thread')
    if (method === 'thread/read' && historyPath) return {thread:{id:params.threadId,path:mode==='receipt-no-history'?null:historyPath}}
    if (method === 'mcpServerStatus/list') return {data:[{name:'bgs-browser',tools:{
      browser_run_code_unsafe:{name:'browser_run_code_unsafe',inputSchema:{type:'object',properties:{code:{type:'string'}},required:['code']}}
    }}],nextCursor:null}
    if (method === 'thread/backgroundTerminals/clean') cleaned++
    if (method === 'turn/interrupt') {
      await original.call(this,'fixture/events',{events:[{method:'turn/completed',params:{threadId:params.threadId,turnId:params.turnId,
        turn:{id:params.turnId,status:'interrupted'}}}]})
      return {}
    }
    return original.call(this,method,params,timeout)
  })
  const finalOutput={schema:{type:'object'},accept:async()=>{accepted++;return 'Verified'}}
  const f=await fixture('allow',{OPENAI_AUTH_MODE:'chatgpt',BGS_FIXTURE_DESIGN_REVIEW:'manual',
    BEEGAME_NATIVE_MCP_SERVERS_JSON:JSON.stringify([{id:'browser',name:'Browser',enabled:true,autoStart:true,scope:'global',transport:'stdio',command:'/fixture/browser'}])
  },resolveOutboundTarget,undefined,undefined,false,undefined,undefined,{finalOutput})
  try {
    const runtime=f.runtime as any,client=runtime.client as BgsClient
    const emit=(...events:any[])=>client.request('fixture/events',{events})
    const pending=f.submit('Complete current assignment').then(()=>null,error=>error as Error)
    await waitUntil(()=>runtime.active?.turnId==='turn-1')
    const receiptMode=mode.startsWith('receipt-')
    const commandItem={id:'retained-terminal',type:mode === 'pending-mcp' ? 'mcpToolCall' : 'commandExecution',
      command:'custom-engine-start',cwd:f.workspace,status:'inProgress',
      source:receiptMode && mode !== 'receipt-without-placeholder' ? 'agent' : 'unifiedExecStartup',
      ...(receiptMode && mode !== 'receipt-without-placeholder' ? {} : {processId:'20469'})}
    await emit({method:'item/started',params:{threadId:f.sessionId,turnId:'turn-1',item:commandItem}})
    if(receiptMode) {
      const header='Chunk ID: 821203\nWall time: 0.0000 seconds\nProcess exited with code 134\nOriginal token count: 379\nOutput:\nOperation not permitted'
      const output=mode==='receipt-running' || mode==='receipt-spoofed-output'
        ? 'Chunk ID: fixture\nWall time: 1.0000 seconds\nProcess running with session ID 20469\nOriginal token count: 2\nOutput:\n'+(mode==='receipt-spoofed-output'?header:'Live output')
        : mode==='receipt-malformed' ? 'Process exited with code 134' : header
      historyPath=join(f.workspace,'fixture-native-history.jsonl')
      await writeFile(historyPath,[
        ...(mode==='receipt-no-identity'?[]:[{type:'session_meta',payload:{id:mode==='receipt-wrong-thread'?'unrelated-thread':f.sessionId}}]),
        ...(mode==='receipt-no-context'?[]:[{type:'turn_context',payload:{turn_id:mode==='receipt-wrong-turn'?'wrong-turn':'turn-1'}}]),
        {type:'response_item',payload:{type:'function_call_output',call_id:mode==='receipt-unknown-call'?'another-call':commandItem.id,
          output:mode==='receipt-content-exit'?[{type:'input_text',text:output}]:output}}
      ].map(item=>JSON.stringify(item)).join('\n')+'\n')
      expect(runtime.items.has(commandItem.id)).toBe(true)
    }
    await emit({method:'item/completed',params:{threadId:f.sessionId,turnId:'turn-1',item:{id:'ready',type:'agentMessage',phase:'final_answer',text:JSON.stringify({status:'ready'})}}},
      {method:'turn/completed',params:{threadId:f.sessionId,turnId:'turn-1',turn:{id:'turn-1',status:'completed'}}})
    const error=await pending
    expect(accepted).toBe(succeeds ? 1 : 0)
    if (succeeds) {
      expect(error).toBeNull()
      if(receiptMode) {
        const ended=f.events.filter(event=>event.toolUseID===commandItem.id&&event.eventType==='tool.failed')
        expect(ended).toHaveLength(1);expect(ended[0]).toMatchObject({exitCode:134,output:'Operation not permitted'})
      }
      expect(runtime.items.has('retained-terminal')).toBe(false)
      expect(f.events.some(event=>event.toolUseID==='retained-terminal' && event.eventType==='tool.completed')).toBe(false)
    } else expect(error?.message).toContain(mode === 'receipt-wrong-thread' ? 'another thread' : mode === 'receipt-no-identity' ? 'missing its thread identity' : 'unfinished tools')

    await f.runtime.dispose?.()
    expect(cleaned).toBe(1)
  } finally {await f.close();rpc.mockRestore();cleanup.mockRestore()}
},30000)

async function waitUntil(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw Error('Fixture condition did not become true')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

async function waitUntilAsync(predicate: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw Error('Fixture condition did not become true')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

test('application context preserves complete UTF-8 values within native field limits and ordering', () => {
  expect(bgsApplicationContext('fixture')).toEqual({})
  for (const value of ['', 'a'.repeat(3999), 'a'.repeat(4000), 'a'.repeat(4001),
    'a'.repeat(3999) + '中🎮' + 'b'.repeat(4000),
    ('编辑器契约 🎮\n' + '中'.repeat(1800) + '\r\n').repeat(12)]) {
    const entries = Object.entries(bgsApplicationContext('fixture', value)).sort(([a], [b]) => a.localeCompare(b))
    const data = entries.filter(([key]) => key !== 'fixture')
    expect(data.map(([, part]) => part.value).join('')).toBe(value)
    expect(entries.find(([key]) => key === 'fixture')?.[1].value).toStartWith('Current part count: '+data.length+'.')
    for (const [, part] of entries) {
      expect(Buffer.byteLength(part.value)).toBeLessThanOrEqual(4000)
      expect(part.kind).toBe('application')
    }
  }
  expect(bgsApplicationContext('fixture', 'short').fixture_part_000001?.value).toBe('short')
})

test('growing context reuses unchanged parts across count and digit boundaries', () => {
  for (const count of [1, 2, 9, 10]) {
    const value = Array.from({length: count}, (_, index) => String.fromCharCode(65 + index).repeat(4000)).join('')
    const before = bgsApplicationContext('fixture', value)
    const after = bgsApplicationContext('fixture', value + 'new-tail')
    for (const [key, part] of Object.entries(before).filter(([key]) => key !== 'fixture'))
      expect(after[key]).toEqual(part)
    const changed = Object.entries(after).filter(([key, part]) => part.value !== before[key]?.value)
    expect(changed.filter(([key]) => key !== 'fixture').map(([, part]) => part.value)).toEqual(['new-tail'])
  }
  const line = 'a'.repeat(2000) + '\n' + 'b'.repeat(1999)
  const before = bgsApplicationContext('fixture', line)
  const after = bgsApplicationContext('fixture', line + 'tail')
  expect(after.fixture_part_000001).toEqual(before.fixture_part_000001)
})

test('game Agent startup rejects a missing or empty catalog before starting native processes', async () => {
  const root = await mkdtemp('/private/tmp/bgs-missing-skills-')
  const workspace = join(root, 'game'), catalog = join(root, 'game-skills')
  await mkdir(workspace)
  try {
    for (const empty of [false, true]) {
      if (empty) await mkdir(catalog)
      await expect(createBgsRunner({ command: ['/must-not-start-bgs'], resolveOutboundTarget }).start({
        sessionId: 'missing-skills', cwd: workspace,
        env: { BEEGAME_CONFIG_DIR: join(root, 'config'), BEEGAME_NATIVE_BUILTIN_SKILLS_DIR: catalog },
      })).rejects.toThrow(`BeeGameStudio built-in Skills are unavailable: ${catalog}`)
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

async function fixture(permission: 'allow' | 'deny' = 'allow', env: Record<string, string> = {}, network = resolveOutboundTarget, resumeSessionId?: string,
  nativeGoal?: import('../beegame/session-manager').BeeGameNativeGoalInput, nativeRecovery = false,
  permissionHandler?: (request: DashboardPermissionRequest) => Promise<import('../beegame/session-manager').DashboardPermissionDecision>,
  workflow?: import('../beegame/session-manager').BeeGameHostToolCapability,
  hostTools: Pick<import('../beegame/session-manager').BeeGameTurnTools, 'finalOutput' | 'restartFromDesign' | 'implementationHandoff' | 'baseInstructions' | 'workflowDescription'> = {}) {
  const root = await mkdtemp('/private/tmp/bgs-bgs-runner-'), workspace = join(root, 'game')
  const childPidFile = join(root, 'owned-child.pid')
  const confirmedBriefContext = hostTools.finalOutput?.designReview ? 'Synthetic confirmed PC requirements' : undefined
  await mkdir(join(workspace, 'docs'), { recursive: true })
  const events: Record<string, any>[] = [], usage: BeeGameEvent[] = [], questions: unknown[] = []
  let sessionId = ''
  const runtime = await createBgsRunner({ command, resolveOutboundTarget: network }).start({ sessionId: 'fixture', cwd: workspace, confirmedBriefContext, ...hostTools,
    env: { BEEGAME_CONFIG_DIR: join(root, 'config'), OPENAI_API_KEY: 'fixture-only', BGS_FIXTURE_RPC_TRACE: join(root, 'rpc.jsonl'),
      ...(env.BGS_FIXTURE_NATIVE_GOAL_FINALIZE === '1' ? { BGS_FIXTURE_NATIVE_GOAL_CHILD_PID_FILE: childPidFile } : {}), ...env },
    ...(resumeSessionId ? { resumeSessionId } : {}),
    ...(nativeGoal ? { nativeGoal } : {}),
    ...(nativeRecovery ? { nativeRecovery } : {}),
    workflow, ...hostTools,
    onNativeSessionId: id => { sessionId = id },
    onNativeUsage: (value, epoch, accounting) => usage.push({ id: usage.length, type: 'usage', sessionId: 'fixture', text: '', createdAt: new Date(),
      payload: { type: 'usage', subtype: 'native_accounting', nativeAccountingEpoch: epoch, usage: value,
        ...(accounting?.baselineOnly ? { usageBaselineOnly: true } : {}),
        ...(accounting?.replayed ? { usageReplayed: true } : {}),
        ...(accounting?.nativeTurnId ? { nativeTurnId: accounting.nativeTurnId } : {}) } }),
    requestPermission: async request => {
      questions.push(request)
      if (permissionHandler) return permissionHandler(request)
      return { behavior: permission, source: 'policy', ...(permission === 'deny' ? { message: 'Fixture policy denied the operation' } : {}), updatedInput: { ...request.input, answers: { 'Choose style': 'A' } } }
    },
  })
  const submit = (prompt: Parameters<typeof runtime.submit>[0]['prompt'], signal = new AbortController().signal,
    submitNativeGoal?: import('../beegame/session-manager').BeeGameNativeGoalInput) => runtime.submit({ prompt, signal, confirmedBriefContext, ...hostTools,
    ...(submitNativeGoal ? { nativeGoal: submitNativeGoal } : {}),
    onMessage: message => { events.push(message) }, requestPermission: async () => ({ behavior: 'deny' }) })
  return { root, workspace, childPidFile, runtime, events, usage, questions, sessionId, submit,
    async close() { await runtime.dispose?.(); await rm(root, { recursive: true, force: true }) } }
}

test('streams text once, preserves tool lifecycle, and counts cached tokens once', async () => {
  const f = await fixture('allow', { OPENAI_AUTH_MODE: 'chatgpt' })
  try {
    await f.submit('hello')
    expect(f.events.filter(e => e.eventType.startsWith('assistant.')).map(e => e.text).join('')).toBe('Hello Bgs')
    expect(f.events.filter(e => e.eventType.startsWith('tool.')).map(e => e.eventType)).toEqual(['tool.started', 'tool.completed'])
    expect(f.events.find(e => e.eventType === 'tool.completed')).toMatchObject({ exitCode: 0, durationMs: 1200 })
    expect(f.events.filter(e => e.eventType.startsWith('tool.')).every(e => !('cwd' in e.input))).toBe(true)
    expect(getLatestRuntimeUsage(f.usage)).toEqual({ prompt_tokens: 80, completion_tokens: 30, cache_read_tokens: 20, cache_creation_tokens: 0, total_tokens: 130 })
    expect(f.sessionId).toBe('019a0000-0000-7000-8000-000000000001')
  } finally { await f.close() }
}, 30_000)

test('native Goal injects the current assignment before activation and owns continuation boundaries', async () => {
  const cleanup = spyOn(browserCleanup, 'closeSessionTestBrowsers').mockResolvedValue(undefined)
  const f = await fixture('allow', { OPENAI_AUTH_MODE: 'chatgpt' }, resolveOutboundTarget, undefined,
    { mode: 'start', objective: 'Finish the native fixture Goal' })
  try {
    await f.submit('native assignment')
    expect(f.events.filter(event => event.eventType === 'system.status' && event.subtype === 'native_goal')
      .map(event => event.nativeGoal?.status)).toEqual(['active', 'complete'])
    expect(f.events.filter(event => event.eventType === 'system.status' && event.subtype === 'native_goal_turn_started')).toHaveLength(1)
    expect(f.events.find(event => event.eventType === 'assistant.message')?.text).toBe('Native Goal: native assignment')
    expect(f.events.filter(event => event.eventType === 'system.status' && event.subtype === 'native_goal_turn_completed')).toHaveLength(1)
  } finally { await f.close(); cleanup.mockRestore() }
}, 30_000)

test('native Goal keeps one outer turn across multiple native continuations', async () => {
  const cleanup = spyOn(browserCleanup, 'closeSessionTestBrowsers').mockResolvedValue(undefined)
  const f = await fixture('allow', { OPENAI_AUTH_MODE: 'chatgpt', BGS_FIXTURE_NATIVE_GOAL_TURNS: '2' }, resolveOutboundTarget, undefined,
    { mode: 'start', objective: 'Run two native continuations' })
  try {
    await f.submit('two-turn assignment')
    expect(f.events.filter(event => event.eventType === 'system.status' && event.subtype === 'native_goal_turn_started')).toHaveLength(2)
    expect(f.events.filter(event => event.eventType === 'system.status' && event.subtype === 'native_goal_turn_completed')).toHaveLength(2)
    expect(f.events.filter(event => event.eventType === 'assistant.message').map(event => event.text)).toEqual([
      'Native Goal: two-turn assignment', 'Native Goal: two-turn assignment',
    ])
    expect(f.events.findLast(event => event.eventType === 'system.status' && event.subtype === 'native_goal')?.nativeGoal?.status).toBe('complete')
  } finally { await f.close(); cleanup.mockRestore() }
}, 30_000)

test('native Goal tool requests wait for ordered turn admission when a prior host event is slow', async () => {
  const cleanup = spyOn(browserCleanup, 'closeSessionTestBrowsers').mockResolvedValue(undefined)
  const f = await fixture('allow', {
    OPENAI_AUTH_MODE: 'chatgpt', BGS_FIXTURE_NATIVE_GOAL_WRITE: '1',
  }, resolveOutboundTarget, undefined, { mode: 'start', objective: 'Write the protected design record' })
  try {
    await f.runtime.submit({
      prompt: 'delayed native write', signal: AbortSignal.timeout(30_000),
      onMessage: async message => {
        f.events.push(message)
        if (message.eventType === 'system.status' && message.subtype === 'native_goal' &&
          (message.nativeGoal as { status?: unknown } | undefined)?.status === 'active')
          await new Promise(resolve => setTimeout(resolve, 50))
      },
      requestPermission: async () => ({ behavior: 'allow', source: 'policy' }),
    })
    expect(await readFile(join(f.workspace, 'docs/GDD.md'), 'utf8')).toBe('Native Goal protected write')
    expect(f.events.some(event => event.subtype === 'native_goal_turn_started')).toBe(true)
  } finally { await f.close(); cleanup.mockRestore() }
}, 30_000)

test('changed requirements cannot run with an obsolete native instruction baseline', async () => {
  const f = await fixture('allow', { OPENAI_AUTH_MODE: 'chatgpt' })
  try {
    await expect(f.runtime.submit({ prompt: 'Changed goal', confirmedBriefContext: 'new confirmed goal',
      signal: new AbortController().signal, onMessage() {}, requestPermission: async () => ({ behavior: 'deny' }),
    })).rejects.toThrow('Confirmed requirements changed after BGS runtime preparation')
    expect(f.events).toHaveLength(0)
    expect(f.usage).toHaveLength(0)
  } finally { await f.close() }
}, 30_000)

test('converted providers retain native counters as baselines without counting their usage twice', async () => {
  const f = await fixture('allow', { BEEGAME_API_PROTOCOL: 'chat-completions' })
  try {
    await f.submit('hello')
    expect(f.usage.length).toBeGreaterThan(0)
    expect(f.usage.every(event => event.payload?.usageBaselineOnly === true)).toBe(true)
    expect(f.usage.at(-1)?.payload?.usage).toMatchObject({ total_tokens: 130 })
    // This stdio fixture makes no provider request; only a native notification.
    expect(getLatestRuntimeUsage(f.usage).total_tokens).toBe(0)
  } finally { await f.close() }
}, 30_000)

test('resume token usage is marked as replay while the following live turn is not', async () => {
  const f = await fixture('allow', { OPENAI_AUTH_MODE: 'chatgpt', BGS_FIXTURE_REPLAY_RESUME_USAGE: '1' }, resolveOutboundTarget,
    '019a0000-0000-7000-8000-000000000001')
  try {
    const replayed = f.usage.filter(event => event.payload?.usageReplayed === true)
    expect(replayed.length).toBeGreaterThan(0)
    expect(replayed.every(event => event.payload?.nativeAccountingEpoch === 'bgs:019a0000-0000-7000-8000-000000000001')).toBe(true)
    expect(replayed.every(event => event.payload?.nativeTurnId === 'historical-turn')).toBe(true)

    await f.submit('hello')
    const live = f.usage.filter(event => event.payload?.usageReplayed !== true)
    expect(live.length).toBeGreaterThan(0)
    expect(live.every(event => event.payload?.usageReplayed !== true)).toBe(true)
    expect(live.every(event => event.payload?.nativeTurnId === 'turn-1')).toBe(true)
  } finally { await f.close() }
}, 30_000)

test('native compaction start and completion use the existing Chat projection contract', async () => {
  // This stdio fixture starts no browser. Keep OS process enumeration outside
  // this event-contract test; browser ownership/cleanup has its own regressions.
  const cleanup = spyOn(browserCleanup, 'closeSessionTestBrowsers').mockResolvedValue(undefined)
  try {
    const f = await fixture('allow', { OPENAI_AUTH_MODE: 'chatgpt' })
    try {
      await f.submit('compaction')
      expect(f.events.filter(event => event.eventType === 'system.status')).toEqual(expect.arrayContaining([
        expect.objectContaining({ subtype: 'status', status: 'compacting' }),
        expect.objectContaining({ subtype: 'compact_boundary', status: 'compacted' }),
      ]))
    } finally { await f.close() }
  } finally { cleanup.mockRestore() }
}, 10_000)

test('a nonzero native command exit is a failed tool receipt even when the item status is completed', async () => {
  const f = await fixture()
  try {
    await f.submit('command-fail')
    expect(f.events.find(e => e.eventType === 'tool.failed')).toMatchObject({ toolUseID: 'shell-1', exitCode: 2, durationMs: 1200, is_error: true })
    expect(f.events.some(e => e.eventType === 'tool.completed')).toBe(false)
  } finally { await f.close() }
}, 30_000)

test('native file change receipts retain the actual diff in a structured field', async () => {
  const f = await fixture()
  try {
    await f.submit('file-diff')
    expect(f.events.find(e => e.eventType === 'tool.completed')).toMatchObject({
      toolUseID: 'edit-1:src/Example.ts', toolName: 'Edit', input: { file_path: 'src/Example.ts' },
      diff: '@@ -11 +11 @@\n-old\n+new\n', output: '@@ -11 +11 @@\n-old\n+new\n',
    })
  } finally { await f.close() }
}, 30_000)

test('native command lifecycle retains cwd through progress and a completion that omits it', async () => {
  const f = await fixture()
  try {
    await f.submit('command-progress')
    const progress = f.events.filter(e => e.eventType === 'tool.progress')
    expect(progress.map(e => e.text)).toEqual(['Bu', 'ilt'])
    expect(progress.map(e => e.output)).toEqual(['Bu', 'ilt'])
    expect(f.events.find(e => e.eventType === 'tool.completed')?.output).toBe('Built')
    const tools = f.events.filter(e => e.eventType.startsWith('tool.'))
    expect(tools.map(e => e.eventType)).toEqual(['tool.started', 'tool.progress', 'tool.progress', 'tool.completed'])
    expect(tools.map(e => e.input)).toEqual(Array(4).fill({ command: 'bun run build', cwd: join(f.workspace, 'command-workdir') }))
  } finally { await f.close() }
}, 30_000)

test('failed command receipts retain the native nonexistent cwd and error', async () => {
  const f = await fixture()
  try {
    await f.submit('command-missing-cwd')
    expect(f.events.find(e => e.eventType === 'tool.failed')).toMatchObject({
      toolUseID: 'missing-cwd', toolName: 'Shell', is_error: true,
      input: { command: 'bun run build', cwd: join(f.workspace, 'missing-workdir') },
      output: 'No such file or directory (os error 2)',
    })
    expect(f.events.some(e => e.eventType === 'tool.completed')).toBe(false)
  } finally { await f.close() }
}, 30_000)

test('protected file writes use the live BGS authority', async () => {
  for (const permission of ['allow', 'deny'] as const) {
    const f = await fixture(permission)
    try {
      await f.submit('write-design')
      if (permission === 'allow') expect(await readFile(join(f.workspace, 'docs/GDD.md'), 'utf8')).toBe('Authorized design')
      else expect(await Bun.file(join(f.workspace, 'docs/GDD.md')).exists()).toBe(false)
      expect(f.questions.length).toBeGreaterThan(0)
    } finally { await f.close() }
  }
}, 30_000)

test('protected-file tool cannot write outside the game', async () => {
  const f = await fixture()
  try { await f.submit('write-outside'); expect(await Bun.file(join(f.root, 'outside.md')).exists()).toBe(false); expect(f.questions).toHaveLength(0) }
  finally { await f.close() }
}, 30_000)

test.each(['../outside.md', 'absolute-sibling', 'docs/GDD.mdd', 'src/example.js', 'docs/README.md'])(
  'protected-file path diagnostics reject without authorizing writes: %s', async input => {
  const f = await fixture()
  try {
    const path = input === 'absolute-sibling' ? join(f.root, 'game-sibling/docs/GDD.md') : input
    await f.submit('write-path:' + path)
    const text = f.events.at(-1)?.text ?? ''
    if (input === '../outside.md' || input === 'absolute-sibling') {
      expect(text).toContain('Path is outside the project workspace')
      expect(text).not.toContain('Use native BGS file tools')
    } else {
      expect(text).toContain('Path is not a BGS protected design record or AGENTS.md')
      expect(text).toContain('Check file_path')
      expect(text).toContain('use exec_command with project-local file operations')
      expect(text).toContain('does not deny ordinary workspace writes')
    }
    expect(await Bun.file(resolve(f.workspace, path)).exists()).toBe(false)
    expect(f.questions).toHaveLength(0)
  } finally { await f.close() }
}, 30_000)

test('questions return actual user answers to the requesting item', async () => {
  const f = await fixture()
  try {
    const trace=(await readFile(join(f.root,'rpc.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line))
    const start=trace.find(call=>call.method==='thread/start')
    expect(start.params.config['features.default_mode_request_user_input']).toBe(true)
    expect(start.params.dynamicTools.some((tool:any)=>tool.name==='AskUserQuestion')).toBe(false)
    await f.submit('question'); expect(f.events.some(e => e.text.includes('"answers":["A"]'))).toBe(true) }
  finally { await f.close() }
}, 30_000)

test('failure, process loss and unfinished child work never resolve as success', async () => {
  for (const prompt of ['fail', 'crash', 'unfinished-child']) {
    const f = await fixture()
    try { await expect(f.submit(prompt)).rejects.toThrow() } finally { await f.close() }
  }
}, 30_000)

test.each(['running', 'pending', 'turn-started'])(
  'reused child %s prevents premature parent completion', async outcome => {
    const f = await fixture()
    try { await expect(f.submit('reused-child:' + outcome)).rejects.toThrow('unfinished child work') }
    finally { await f.close() }
  })

test.each(['completed', 'turn-completed', 'errored', 'interrupted', 'shutdown', 'notFound'])(
  'reused child terminal state %s releases the running slot', async outcome => {
    const f = await fixture()
    try {
      await f.submit('reused-child:' + outcome)
      expect(f.events.findLast(event => event.childThreadId === 'reused-child')?.childStatus)
        .toBe(outcome === 'turn-completed' ? 'completed' : outcome)
    } finally { await f.close() }
  })

test('failed turns retain upstream error details from completion or the preceding error notification', async () => {
  for (const prompt of ['failure-details', 'failure-notification']) {
    const f = await fixture()
    try {
      await expect(f.submit(prompt)).rejects.toMatchObject({ message: 'Connection error. fixture ECONNRESET',
        bgsErrorInfo: { httpConnectionFailed: { httpStatusCode: 502 } } })
      if (prompt === 'failure-notification') expect(f.events.find(e => e.eventType === 'system.status'))
        .toMatchObject({ text: 'Connection error. fixture ECONNRESET', willRetry: false })
    } finally { await f.close() }
  }
}, 10000)

test.each(['hang', 'reused-child:cancel'])('cancellation closes waiting work before returning: %s', async prompt => {
  const f = await fixture(), abort = new AbortController()
  try {
    const result = f.submit(prompt, abort.signal)
    if (prompt !== 'hang') await waitUntil(() => f.events.some(event => event.childThreadId === 'reused-child' && event.childStatus === 'running'))
    setTimeout(() => abort.abort(), 30)
    await expect(result).rejects.toThrow()
    await expect(f.submit('hello')).rejects.toThrow('stopped')
  } finally { await f.close() }
}, 30_000)

test('cache is a subset of input; reasoning output is not counted twice', () => {
  expect(bgsUsage({ inputTokens: 100, cachedInputTokens: 20, cacheWriteInputTokens: 10, outputTokens: 30, reasoningOutputTokens: 15 }))
    .toEqual({ prompt_tokens: 70, completion_tokens: 30, cache_read_tokens: 20, cache_creation_tokens: 10, total_tokens: 130 })
  expect(() => bgsUsage({ inputTokens: 1, cachedInputTokens: 2, outputTokens: 0 })).toThrow()
  expect(() => bgsProviderConfig({ OPENAI_AUTH_MODE: 'chatgpt', OPENAI_BASE_URL: 'https://example.invalid' })).toThrow()
})


test('BGS resumes Bgs history without double charging and does not resume legacy agent UUIDs', async () => {
  const root=await mkdtemp('/private/tmp/bgs-bgs-resume-'), workspace=join(root,'game')
  const environment=()=>({BEEGAME_CONFIG_DIR:join(root,'config'),OPENAI_AUTH_MODE:'chatgpt'})
  const runner = createBgsRunner({command,resolveOutboundTarget}), originalStart = runner.start
  const retained: Array<import('../beegame/session-manager').BeeGameNativeContext | undefined> = []
  runner.start = input => { retained.push(input.nativeContext); return originalStart(input) }
  let manager=new BeeGameSessionManager(runner,root,environment)
  try {
    const session=manager.start({workspacePath:workspace,userId:'owner'})
    await manager.sendWithDisplay(session.id,'hello');await manager.waitForSessionIdle(session.id)
    expect(manager.runtimeSnapshot(session.id).runtime).toBe('bgs')
    expect(manager.runtimeSnapshot(session.id).usage.total_tokens).toBe(130)
    const nativeContext = manager.runtimeSnapshot(session.id).nativeContext!
    expect(manager.runtimeSnapshot(session.id).nativeSessionId).toBe(nativeContext.threadId)
    expect(nativeContext.runtimeSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(nativeContext.briefSha256).toMatch(/^[a-f0-9]{64}$/)
    await manager.dispose()
    manager=new BeeGameSessionManager(runner,root,environment)
    manager.start({workspacePath:workspace,userId:'owner',transcriptSessionId:session.id})
    await manager.sendWithDisplay(session.id,'hello');await manager.waitForSessionIdle(session.id)
    expect(manager.runtimeSnapshot(session.id).usage.total_tokens).toBe(260)
    expect(manager.runtimeSnapshot(session.id).nativeContext).toEqual(nativeContext)
    expect(retained).toEqual([undefined, nativeContext])
    await manager.restoreProjectEditCheckpoint(session.id, nativeContext.threadId)
    expect(manager.runtimeSnapshot(session.id).nativeContext).toBeUndefined()
    expect(manager.transcriptFacts(session.id).some(event=>event.type==='turn.completed')).toBe(true)
    await manager.dispose()
    const path=join(root,'snapshots',session.id+'.json')
    for (const nativeContext of [
      {threadId:'another-thread', runtimeSha256:'a'.repeat(64), briefSha256:'b'.repeat(64)},
      {threadId:retained[1]!.threadId, runtimeSha256:'invalid', briefSha256:'b'.repeat(64)},
    ]) {
      const snapshot=JSON.parse(await readFile(path,'utf8'))
      snapshot.nativeContext=nativeContext
      await writeFile(path,JSON.stringify(snapshot))
      manager=new BeeGameSessionManager(runner,root,environment)
      manager.start({workspacePath:workspace,userId:'owner',transcriptSessionId:session.id})
      await manager.sendWithDisplay(session.id,'hello');await manager.waitForSessionIdle(session.id)
      expect(retained.at(-1)).toBeUndefined()
      await manager.dispose()
    }
    const snapshot=JSON.parse(await readFile(path,'utf8'))
    delete snapshot.runtime
    await writeFile(path,JSON.stringify(snapshot))
    manager=new BeeGameSessionManager(runner,root,environment)
    manager.start({workspacePath:workspace,userId:'owner',transcriptSessionId:session.id})
    expect(manager.runtimeSnapshot(session.id).nativeSessionId).toBeUndefined()
  } finally {await manager.dispose();await rm(root,{recursive:true,force:true})}
},30_000)

test('historical Goal execution invalidates ordinary context fingerprints', async () => {
  const root=await mkdtemp('/private/tmp/bgs-bgs-resume-'), workspace=join(root,'game')
  const context={threadId:'native-fixture',runtimeSha256:'a'.repeat(64),briefSha256:'b'.repeat(64)}
  const starts: import('../beegame/session-manager').BeeGameSessionRunnerStartInput[]=[]
  const manager=new BeeGameSessionManager({async start(input){
    starts.push(input)
    input.onNativeSessionId?.(context.threadId)
    if (!input.nativeGoal) input.onNativeContext?.(context)
    return {reusable:false,stop(){},async submit(){}}
  }},root)
  try {
    const session=manager.start({workspacePath:workspace,userId:'owner'})
    await manager.sendWithDisplay(session.id,'Ordinary task');await manager.waitForSessionIdle(session.id)
    expect(manager.runtimeSnapshot(session.id).nativeContext).toEqual(context)
    await manager.sendWithDisplay(session.id,'Historical Goal continuation',{nativeGoal:{mode:'resume'}})
    await manager.waitForSessionIdle(session.id)
    expect(starts.at(-1)!.nativeGoal).toEqual({mode:'resume'})
    expect(starts.at(-1)!.nativeContext).toBeUndefined()
    expect(manager.runtimeSnapshot(session.id).nativeContext).toBeUndefined()
  } finally {await manager.dispose();await rm(root,{recursive:true,force:true})}
})

test.each(['write', 'edit', 'denied', 'revoked', 'cancelled', 'instructions'] as const)(
  'protected write rechecks preserve authority and audit results: %s', async mode => {
  // The local stdio fixture creates no browsers or model requests.
  const cleanup = spyOn(browserCleanup, 'closeSessionTestBrowsers').mockResolvedValue(undefined)
  const root = await mkdtemp('/private/tmp/bgs-write-recheck-'), workspace = join(root, 'game')
  const path = join(workspace, mode === 'instructions' ? 'AGENTS.md' : 'docs/GDD.md')
  await mkdir(join(workspace, 'docs'), { recursive: true })
  await writeFile(path, 'original')
  const requests: DashboardPermissionRequest[] = []
  let sessionId = ''
  const runner = createBgsRunner({ command, resolveOutboundTarget })
  const manager = new BeeGameSessionManager({ async start(input) {
    return runner.start({ ...input, requestPermission: async request => {
      requests.push(request)
      const deny = mode === 'denied' || mode === 'revoked' && request.phase === 'recheck'
      const pending = input.requestPermission!(deny ? { ...request, decisionReason: 'Fixture explicit authorization' } : request)
      if (deny) manager.resolvePermission(sessionId, request.toolUseID, { behavior: 'deny', source: 'user', message: 'Fixture write denied' })
      if (mode === 'instructions') manager.resolvePermission(sessionId, request.toolUseID, { behavior: 'allow', source: 'user' })
      const decision = await pending
      if (mode === 'cancelled' && request.phase === 'recheck') manager.stop(sessionId)
      return decision
    } })
  } }, root, () => ({ BEEGAME_CONFIG_DIR: join(root, 'config'), OPENAI_API_KEY: 'fixture-only' }))
  try {
    sessionId = manager.start({ workspacePath: workspace, userId: 'owner', projectId: 'project' }).id
    const allowed = ['write', 'edit', 'instructions'].includes(mode)
    // Reusing the fixture call ID in a later turn must not suppress its initial receipt.
    const turns = mode === 'write' || mode === 'edit' ? 2 : 1
    for (let turn = 0; turn < turns; turn++) {
      const prompt = mode === 'instructions' ? 'write-path:AGENTS.md' : mode === 'edit'
        ? 'edit-design:' + JSON.stringify({ old_string: turn ? 'edited-0' : 'original', new_string: 'edited-' + turn }) : 'write-design'
      await manager.sendWithDisplay(sessionId, prompt)
      await manager.waitForSessionIdle(sessionId)
    }
    expect(manager.transcriptFacts(sessionId).filter(event => event.type === 'turn.failed')).toEqual([])
    expect(requests.map(request => request.phase ?? 'initial')).toEqual(
      Array.from({ length: turns }, () => mode === 'denied' || mode === 'instructions' ? ['initial'] as const : ['initial', 'recheck'] as const).flat())
    expect(await readFile(path, 'utf8')).toBe(allowed ? mode === 'edit' ? 'edited-1' : 'Authorized design' : 'original')
    const events = manager.transcriptFacts(sessionId)
    const resolved = events.filter(event => event.type === 'permission.resolved')
    expect(resolved.map(event => event.payload?.decision)).toEqual(mode === 'revoked' ? ['allow', 'deny'] :
      Array(turns).fill(mode === 'denied' ? 'deny' : 'allow'))
    expect(resolved.every(event => event.payload?.toolUseID === 'write-design')).toBe(true)
    expect(events.filter(event => event.type === 'permission.requested')).toHaveLength(['instructions', 'denied', 'revoked'].includes(mode) ? 1 : 0)
    if (mode === 'revoked' || mode === 'denied') {
      expect(resolved.at(-1)?.payload).toMatchObject({ decision: 'deny' })
      const failure = events.find(event => event.type === 'assistant.message' && event.text.includes('Write rejected'))
      expect(failure?.text).toContain('Fixture write denied')
    }
    if (mode === 'cancelled') expect(events.some(event => event.type === 'session.stopped')).toBe(true)
  } finally {
    await manager.dispose()
    await rm(root, { recursive: true, force: true })
    cleanup.mockRestore()
  }
}, 30_000)

for (const mode of ['unknown','known','unconfigured','chatgpt'] as const)
test('native model prompts receive no other model Skill chapter: '+mode,async()=>{
  const original=BgsClient.prototype.request,trace:Array<{method:string;params:any}>=[]
  const rpc=spyOn(BgsClient.prototype,'request').mockImplementation(async function(this:BgsClient,method:string,params:any,timeout?:number):Promise<any>{
    trace.push({method,params})
    return original.call(this,method,params,timeout)
  })
  let f:Awaited<ReturnType<typeof fixture>>|undefined
  try {
    f=await fixture('allow',{
      ...(mode==='unconfigured'?{}:{BEEGAME_MODEL:mode==='known'?'fixture-known-model':'third-party-fixture'}),
      ...(mode==='chatgpt'?{OPENAI_AUTH_MODE:'chatgpt'}:{}),
    })
    await f.submit('Implement this fixture request')
    const start=trace.find(e=>e.method==='thread/start')!.params
    expect(start.baseInstructions).toBeUndefined()
    expect(start.developerInstructions).not.toContain('OFFICIAL_SKILL_USAGE_FIXTURE')
    expect(start.developerInstructions).not.toContain('OTHER_MODEL_SKILL_USAGE_FIXTURE')
    expect(start.developerInstructions).not.toContain('GPT-5.6 fixture identity.')
    expect(start.developerInstructions).not.toContain('Fixture identity.')
    expect(start.developerInstructions).not.toContain('Not part of the Skill chapter.')
    expect(trace.find(e=>e.method==='turn/start')!.params.input).toEqual([{type:'text',text:'Implement this fixture request'}])
    expect(trace.filter(e=>e.method==='config/read')).toHaveLength(1)
  }finally{try{await f?.close()}finally{rpc.mockRestore()}}
},30000)

test('Skill mentions in multiple text blocks pass to native without selection or rewriting', async () => {
  const original=BgsClient.prototype.request,trace:Array<{method:string;params:any}>=[]
  const rpc=spyOn(BgsClient.prototype,'request').mockImplementation(async function(this:BgsClient,method:string,params:any,timeout?:number):Promise<any>{
    trace.push({method,params});return original.call(this,method,params,timeout)
  })
  let f:Awaited<ReturnType<typeof fixture>>|undefined
  try {
    f=await fixture()
    const prompt=[{type:'text' as const,text:'Use $game-creative-director-expert for this task.'},
      {type:'text' as const,text:'$fixture:method and $missing-fixture-skill remain user text.'}]
    await f.submit(prompt)
    expect(trace.find(e=>e.method==='turn/start')!.params.input).toEqual(prompt)
  }finally{try{await f?.close()}finally{rpc.mockRestore()}}
},30000)

for (const mode of ['plain','enabled','disabled','missing','namespaced','inline','recovery'] as const)
test('native owns user Skill mention handling and recovery: '+mode,async()=>{
  const original=BgsClient.prototype.request,trace:Array<{method:string;params:any}>=[]
  const rpc=spyOn(BgsClient.prototype,'request').mockImplementation(async function(this:BgsClient,method:string,params:any,timeout?:number):Promise<any>{
    trace.push({method,params})
    const result=await original.call(this,method,params,timeout)
    if(method==='skills/list' && mode==='disabled') {
      const catalog=result as import('./native-protocol').BgsStableResult<'skills/list'>
      for(const entry of catalog.data)for(const skill of entry.skills)if(skill.name==='game-creative-director-expert')skill.enabled=false
    }
    return result
  })
  let f:Awaited<ReturnType<typeof fixture>>|undefined
  try {
    f=await fixture('allow',{},resolveOutboundTarget,mode==='recovery'?'saved-method-thread':undefined,undefined,mode==='recovery')
    const prompt=mode==='recovery'?[]:mode==='plain'?'Complete the current fixture task':
      mode==='inline'?'Use $game-creative-director-expert for this task.':
      '$'+(mode==='missing'?'not-installed-fixture':mode==='namespaced'?'fixture:method':'game-creative-director-expert')+' Complete the current fixture task'
    await f.submit(prompt)
    const inputs=trace.find(e=>e.method==='turn/start')!.params.input
    expect(inputs).toEqual(mode==='recovery'?[]:[{type:'text',text:prompt}])
    expect(inputs.some((item:any)=>item.type==='skill')).toBe(false)
    expect(f.events.some(e=>e.eventType.startsWith('assistant.'))).toBe(true)
  }finally{try{await f?.close()}finally{rpc.mockRestore()}}
},30000)

test('catalog warnings do not override native handling of user Skill mentions', async () => {
  const root = await mkdtemp('/private/tmp/bgs-skill-catalog-'), game = join(root, 'game')
  await mkdir(game)
  const warnings: unknown[][] = [], warn = console.warn
  console.warn = (...args) => { warnings.push(args) }
  let runtime: Awaited<ReturnType<ReturnType<typeof createBgsRunner>['start']>> | undefined
  try {
    for (const required of ['game-creative-director-expert', 'missing-fixture-skill']) {
      let submitted = false
      const events: Record<string, any>[] = []
      runtime = await createBgsRunner({ command, resolveOutboundTarget }).start({ sessionId: required, cwd: game,
        env: { BEEGAME_CONFIG_DIR: join(root, 'config'), OPENAI_API_KEY: 'fixture-only', BGS_FIXTURE_RPC_TRACE: join(root, 'rpc.jsonl'), BGS_FIXTURE_SKILL_CATALOG_ERROR: '1' },
        onNativeSubmission: () => { submitted = true } })
      const result = runtime.submit({ prompt: '$'+required+' Apply the method', signal: AbortSignal.timeout(5000),
        onMessage: value => { events.push(value) }, requestPermission: async () => ({ behavior: 'deny' }) })
      await result
      expect(submitted).toBe(true)
      const calls=(await readFile(join(root,'rpc.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line))
      expect(calls.filter(call=>call.method==='turn/start').at(-1).params.input).toEqual([{type:'text',text:'$'+required+' Apply the method'}])
      await runtime.dispose?.(); runtime = undefined
    }
    expect(warnings).toHaveLength(2)
    expect(JSON.stringify(warnings)).not.toContain('PRIVATE_')
  } finally { console.warn = warn; await runtime?.dispose?.(); await rm(root, { recursive: true, force: true }) }
}, 10000)


test('protected edits are literal, unique and non-overlapping against the original text', () => {
  expect(editProtectedFileText('alpha beta', { edits: [
    { old_string: 'beta', new_string: 'alpha' }, { old_string: 'alpha', new_string: '$& $1' },
  ] })).toBe('$& $1 alpha')
  expect(editProtectedFileText('alpha', { old_string: 'alpha', new_string: '$&' })).toBe('$&')
  for (const args of [
    { edits: [] },
    { edits: [{ old_string: '', new_string: 'x' }] },
    { edits: [{ old_string: 'absent', new_string: 'x' }] },
    { edits: [{ old_string: 'alpha', new_string: 'x' }, { old_string: 'pha', new_string: 'y' }] },
    { edits: [{ old_string: 'alpha', new_string: 'x' }], old_string: 'beta', new_string: 'y' },
  ]) expect(() => editProtectedFileText('alpha beta', args)).toThrow()
  expect(() => editProtectedFileText('aaa', { old_string: 'aa', new_string: 'x' })).toThrow('exactly once')
})

test('protected edit errors identify all failing original-file matches without echoing content', () => {
  const run = () => editProtectedFileText('alpha beta beta', { edits: [
    { old_string: 'alpha', new_string: 'saved only if all succeed' },
    { old_string: 'PRIVATE_ABSENT_CONTENT', new_string: 'x' },
    { old_string: 'beta', new_string: 'y' },
  ] })
  expect(run).toThrow('edits[1]: old_string matched 0 times')
  expect(run).toThrow('edits[2]: old_string matched 2 times')
  expect(run).toThrow('Nothing saved')
  try { run() } catch (error) { expect(String(error)).not.toContain('PRIVATE_ABSENT_CONTENT') }
})

test.each(['success', 'missing-match', 'denied'] as const)('protected batch edits preserve permissions and all-or-nothing writes: %s', async mode => {
  const f = await fixture(mode === 'denied' ? 'deny' : 'allow')
  try {
    const path = join(f.workspace, 'docs/GDD.md')
    await writeFile(path, 'alpha beta')
    await f.submit('edit-design:' + JSON.stringify({ edits: [
      { old_string: 'alpha', new_string: '$&' },
      { old_string: mode === 'missing-match' ? 'absent' : 'beta', new_string: 'gamma' },
    ] }))
    expect(await readFile(path, 'utf8')).toBe(mode === 'success' ? '$& gamma' : 'alpha beta')
    expect(f.questions.length).toBeGreaterThan(0)
    expect(f.events.some(e => e.text?.includes(mode === 'success' ? 'Saved design' : 'Write rejected'))).toBe(true)
  } finally { await f.close() }
}, 30_000)


test('provider unknown tools reach the active BGS event stream without executing or retrying them', async () => {
  let requests = 0
  const provider = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    if (request.method === 'GET' && /\/models(?:\/|$)/.test(new URL(request.url).pathname)) return new Response(null, { status: 404 })
    requests++
    return new Response('data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'unknown-call',
      function: { name: 'PRIVATE_UNSUPPORTED_NAME', arguments: '{"secret":"PRIVATE_ARGUMENT"}' } }] }, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 4, completion_tokens: 2 } }) + '\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
  } })
  let f: Awaited<ReturnType<typeof fixture>> | undefined
  try {
    f = await fixture('allow', { BEEGAME_API_PROTOCOL: 'chat-completions', BEEGAME_MODEL: 'fixture-model', OPENAI_BASE_URL: provider.url.toString().replace(/\/$/, '') },
      async value => ({ url: new URL(value), addresses: ['127.0.0.1'], lookup: (_host, _options, callback) => callback(null, '127.0.0.1', 4) }))
    await f.submit('provider-unknown-tool')
    const failures = f.events.filter(event => event.eventType === 'tool.failed')
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({ toolUseID: 'unknown-call', toolName: 'Unknown provider tool', is_error: true,
      output: expect.stringContaining('No action was executed') })
    expect(JSON.stringify(failures)).not.toContain('PRIVATE_')
    expect(f.questions).toHaveLength(0)
    expect(requests).toBe(1)
  } finally { await f?.close(); provider.stop(true) }
}, 10_000)


test.each(['boundary', 'policy', 'unspecified'])('native denial receipts retain the available reason: %s', async mode => {
  const f = await fixture(mode === 'policy' ? 'deny' : 'allow')
  try {
    await f.submit('native-denial:' + mode)
    const failed = f.events.filter(event => event.eventType === 'tool.failed')
    expect(failed).toHaveLength(1)
    expect(failed[0].output).toBe(mode === 'boundary'
      ? 'BGS denied the request because it cannot preserve the project permission boundary.'
      : mode === 'policy' ? 'Fixture policy denied the operation'
      : 'Native tool approval was declined; no detailed reason was supplied.')
    expect(f.questions).toHaveLength(mode === 'policy' ? 1 : 0)
  } finally { await f.close() }
}, 10000)

test.each([
  ['error', 'Automatic approval review failed before a decision; the action was not executed.'],
  ['denied', 'Automatic approval review denied this action; it was not executed.'],
  ['timeout', 'Automatic approval review timed out; the action was not executed.'],
  ['aborted', 'Automatic approval review was interrupted; the action was not executed.'],
  ['missing-target', 'Native tool approval was declined; no detailed reason was supplied.'],
  ['other-target', 'Native tool approval was declined; no detailed reason was supplied.'],
  ['stale-turn', 'Native tool approval was declined; no detailed reason was supplied.'],
])('native automatic review keeps its classification on the correct tool only: %s', async (mode, reason) => {
  const f = await fixture()
  try {
    await f.submit('native-denial:review-' + mode)
    const failures = f.events.filter(event => event.eventType === 'tool.failed')
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({ toolUseID: 'denied-command', output: reason })
    expect(JSON.stringify(f.events)).not.toContain('PRIVATE_')
    expect(f.questions).toHaveLength(0)
  } finally { await f.close() }
}, 10_000)

test.each(['empty', 'result'])('native MCP failures keep their message and any partial result: %s', async mode => {
  const f = await fixture()
  try {
    await f.submit('mcp-error:' + mode)
    const failure = f.events.find(event => event.eventType === 'tool.failed')
    if (mode === 'empty') expect(failure?.output).toBe('Fixture resource unavailable')
    else expect(failure?.output).toEqual({ result: { content: [{ type: 'text', text: 'Partial output' }] }, error: 'Fixture resource unavailable' })
    expect(JSON.stringify(failure)).not.toContain('PRIVATE_INTERNAL_DATA')
  } finally { await f.close() }
}, 10000)

test.each(['stale', 'success', 'denied'])('edit feedback preserves atomic writes and authorization: %s', async mode => {
  const f = await fixture(mode === 'denied' ? 'deny' : 'allow')
  try {
    const path = join(f.workspace, 'docs/GDD.md')
    const original = '# Rules\nSpeed: 4\n\n# Controls\nAction: turn\n'
    await writeFile(path, original)
    await f.submit('edit-design:' + JSON.stringify(mode === 'success' ? { edits: [
      { old_string: 'Speed: 4', new_string: 'Speed: 5\nNote: updated' },
      { old_string: 'Action: turn', new_string: 'Action: move' },
    ] } : { old_string: '# Rules\nSpeed: 3', new_string: '# Rules\nSpeed: 5' }))
    const receipt = f.events.at(-1)?.text
    if (mode === 'success') {
      expect(receipt).toContain('File saved: docs/GDD.md. Applied 2 replacement(s); original lines: 2, 5.')
      expect(await readFile(path, 'utf8')).toBe('# Rules\nSpeed: 5\nNote: updated\n\n# Controls\nAction: move\n')
    } else {
      expect(await readFile(path, 'utf8')).toBe(original)
      if (mode === 'stale') {
        expect(receipt).toContain('docs/GDD.md: edits[0]: old_string matched 0 times')
        expect(receipt).toContain('exact first-line anchor at original line 1')
        expect(receipt).toContain('2: Speed: 4')
      } else {
        expect(receipt).toContain('Fixture policy denied the operation')
        expect(receipt).not.toContain('Speed: 4')
        expect(receipt).not.toContain('current text')
      }
    }
  } finally { await f.close() }
}, 10000)

test('edit diagnostics bound source excerpts and distinguish ambiguous from absent anchors', () => {
  const error = (text: string, old_string: string) => {
    try { editProtectedFileText(text, { old_string, new_string: '' }); throw Error('Expected rejection') }
    catch (error) { return String(error) }
  }
  expect(error('alpha\nbeta\nalpha', 'alpha')).toContain('original match lines: 1, 3')
  expect(error('# Title\nold\n# Title\nnew', '# Title\nabsent')).not.toContain('current text')
  expect(error('# Title\n' + 'x'.repeat(10000), '# Title\nabsent').length).toBeLessThan(700)
})

test('a unique line-prefix helps locate stale text without applying fuzzy or partial edits', () => {
  const body = '# Design\n| Recovery action | Display "Try again" |\n'
  const stale = '| Recovery action | Display “Try again” |'
  let error = ''
  try { editProtectedFileText(body, {old_string:stale,new_string:'replacement'}) }
  catch (caught) { error = String(caught) }
  expect(error).toContain('matched 0 times')
  expect(error).toContain('line-prefix candidate (diagnostic only) at original line 2')
  expect(error).toContain('2: | Recovery action | Display "Try again" |')
  expect(error).toContain('Nothing saved')
  expect(() => editProtectedFileText(body + '| Recovery action | Another entry |\n',
    {old_string:stale,new_string:''})).toThrow('matched 0 times; must match exactly once. Nothing saved')
  expect(editProtectedFileText(body,{old_string:'| Recovery action | Display "Try again" |',new_string:'Updated'}))
    .toBe('# Design\nUpdated\n')
  expect(() => editProtectedFileText(body,{edits:[
    {old_string:'# Design',new_string:'# Changed'}, {old_string:stale,new_string:'replacement'},
  ]})).toThrow('Nothing saved')
})


test('BGS inherits native and user concurrency and plan-tool configuration', () => {
  for (const goals of [false, true]) {
    const config = bgsProviderConfig({ OPENAI_AUTH_MODE: 'chatgpt' }, { goals })
    expect(config).not.toHaveProperty('agents.max_concurrent_threads_per_session')
    expect(config).not.toHaveProperty('tools.update_plan.enabled')
    expect(config).not.toHaveProperty('agents.enabled')
    expect(config).not.toHaveProperty('agents.default_subagent_model')
    expect(config).not.toHaveProperty('agents.default_subagent_reasoning_effort')
  }
})


test('doubling streamed output doubles persisted bytes instead of replaying all prior chunks', async () => {
  const sizes: number[] = []
  for (const count of [64, 128]) {
    const f = await fixture()
    try {
      await f.submit(`command-volume:${count}`)
      const path = join(f.workspace, 'volume.jsonl')
      const events = f.events.filter(event => event.eventType.startsWith('tool.'))
      for (const [id, event] of events.entries()) appendChatTranscript(path, {
        id, sessionId: 'fixture', type: event.eventType, text: event.text, payload: event, createdAt: new Date(0),
      })
      sizes.push((await readFile(path)).byteLength)
      expect(events.filter(e => e.eventType === 'tool.progress').map(e => e.text).join('')).toBe('x'.repeat(count * 1024))
      expect(events.at(-1)?.output).toBe('x'.repeat(count * 1024))
    } finally { await f.close() }
  }
  expect(sizes[1]).toBeLessThan(sizes[0]! * 2.1)
  expect(sizes[1]).toBeLessThan(1024 * 1024)
}, 30_000)


test('provider retries, tool output budgets and system Skills retain native defaults for API and ChatGPT connections', () => {
  for (const auth of [{}, {OPENAI_AUTH_MODE:'chatgpt'}] as Record<string,string>[]) for (const model of [undefined,'known-model','unknown-model']) {
    const env={BGS_HOME:'/synthetic',...auth,...(model?{BEEGAME_MODEL:model}:{})}
    const config = bgsProviderConfig(env) as any
    expect(config).not.toHaveProperty('skills.config')
    expect(config).not.toHaveProperty('tool_output_token_limit')
    expect(config.model_providers?.bgs).not.toHaveProperty('request_max_retries')
    expect(config.model_providers?.bgs).not.toHaveProperty('stream_max_retries')
  }
})

test('native retry notifications remain progress within the original submission', async () => {
  const f = await fixture()
  try {
    await f.submit('native-retry')
    expect(f.events.find(event => event.eventType === 'system.status' && event.willRetry === true)).toMatchObject({ willRetry: true })
    expect(f.events.filter(event => event.eventType?.startsWith('assistant.')).map(event => event.text).join('')).toBe('Hello Bgs')
    const rpc = (await readFile(join(f.root, 'rpc.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(rpc.filter(call => call.method === 'turn/start')).toHaveLength(1)
  } finally { await f.close() }
})

for (const status of [undefined, 'active', 'paused', 'blocked', 'complete', 'budgetLimited', 'usageLimited'])
  test(`manual native recovery respects persisted Goal state: ${status ?? 'ordinary turn'}`, async () => {
    const cleanup = spyOn(browserCleanup, 'closeSessionTestBrowsers').mockResolvedValue(undefined)
    const savedGoal = { objective: 'Original objective', tokenBudget: 5000, tokensUsed: 123, status }
    const f = await fixture('allow', { OPENAI_AUTH_MODE: 'chatgpt',
      ...(status ? { BGS_FIXTURE_SAVED_GOAL: JSON.stringify(savedGoal) } : {}),
    }, resolveOutboundTarget, '019a0000-0000-7000-8000-000000000001', status ? { mode: 'resume' } : undefined, true)
    try {
      if (['complete', 'budgetLimited', 'usageLimited'].includes(status ?? '')) {
        await expect(f.submit('')).rejects.toThrow('already ' + status)
      } else await f.submit('')
      const rpc = (await readFile(join(f.root, 'rpc.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
      expect(rpc.some(call => call.method === 'thread/start' || call.method === 'thread/goal/clear')).toBe(false)
      for (const resume of rpc.filter(call => call.method === 'thread/resume')) {
        expect(resume.params.excludeTurns).toBe(false)
      }
      const starts = rpc.filter(call => call.method === 'turn/start')
      if (!status) {
        expect(starts).toHaveLength(1)
        expect(starts[0].params).toMatchObject({ threadId: '019a0000-0000-7000-8000-000000000001', input: [] })
        expect(rpc.findIndex(call => call.method === 'thread/resume')).toBeLessThan(rpc.indexOf(starts[0]))
      } else {
        expect(starts).toHaveLength(0)
        const activations = rpc.filter(call => call.method === 'thread/goal/set' && call.params.status === 'active')
        const terminal = ['complete', 'budgetLimited', 'usageLimited'].includes(status)
        expect(activations).toHaveLength(terminal ? 0 : 1)
        for (const call of activations) {
          expect(call.params).not.toHaveProperty('objective')
          expect(call.params).not.toHaveProperty('tokenBudget')
        }
        const injected = rpc.filter(call => call.method === 'thread/inject_items').flatMap(call => call.params.items)
        expect(injected.some(item => item.role === 'user')).toBe(false)
        if (!terminal) expect(f.events.find(event => event.subtype === 'native_goal' && event.nativeGoal?.status === 'active')?.nativeGoal)
          .toMatchObject({ objective: 'Original objective', tokenBudget: 5000, tokensUsed: 123 })
      }
    } finally { await f.close(); cleanup.mockRestore() }
  })


test('ordinary native recovery leaves an unrelated persisted Goal dormant', async () => {
  const f = await fixture('allow', { OPENAI_AUTH_MODE: 'chatgpt',
    BGS_FIXTURE_SAVED_GOAL: JSON.stringify({ objective: 'Earlier implementation', status: 'paused', tokenBudget: 5000, tokensUsed: 123 }),
  }, resolveOutboundTarget, '019a0000-0000-7000-8000-000000000001', undefined, true)
  try {
    await f.submit('')
    const rpc = (await readFile(join(f.root, 'rpc.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(rpc.some(call => call.method.startsWith('thread/goal/'))).toBe(false)
    expect(rpc.find(call => call.method === 'turn/start')?.params.input).toEqual([])
  } finally { await f.close() }
})


test.each(['resolved', 'turn-completed', 'collab-terminal'])(
  'child cancellation blocks late protected writes and permits a fresh reused turn: %s', async mode => {
    const waits: Array<{ request: DashboardPermissionRequest; allow(): void }> = []
    const cleanup = spyOn(browserCleanup, 'closeSessionTestBrowsers').mockResolvedValue(undefined)
    const f = await fixture('allow', { OPENAI_AUTH_MODE: 'chatgpt' }, resolveOutboundTarget, undefined, undefined, false,
      request => request.phase === 'recheck' ? Promise.resolve({ behavior: 'allow' }) : new Promise(resolve => {
        waits.push({ request, allow: () => resolve({ behavior: 'allow' }) })
      }))
    const client = (f.runtime as unknown as { client: BgsClient }).client
    const abort = new AbortController(), submitted = f.submit('hang', abort.signal).catch(error => error)
    const emit = (...events: unknown[]) => client.request('fixture/events', { events })
    const childStatus = (tool: string, status: string) => ({ method: 'item/completed', params: {
      threadId: f.sessionId, turnId: 'turn-1', item: { id: tool + '-' + status, type: 'collabAgentToolCall',
        tool, receiverThreadIds: ['child'], agentsStates: { child: { status } }, status: 'completed' },
    } })
    const write = (id: string, turnId: string, content: string) => ({ id, method: 'item/tool/call', params: {
      threadId: 'child', turnId, callId: id, tool: 'WriteProjectFile', arguments: { file_path: 'docs/GDD.md', content },
    } })
    const terminal = { method: 'turn/completed', params: { threadId: 'child', turn: { id: 'child-1', status: 'interrupted' } } }
    const responses = async () => (await client.request('fixture/responses', {})).responses as Array<any>
    try {
      await writeFile(join(f.workspace, 'docs/GDD.md'), 'original')
      // A child listener may attach after turn/started; the first live request supplies its turn ID.
      await emit(childStatus('spawnAgent', 'running'), write('old', 'child-1', 'late old write'))
      await waitUntil(() => waits.length === 1)
      const cancel = mode === 'resolved'
        ? { method: 'serverRequest/resolved', params: { threadId: 'child', requestId: 'old' } }
        : mode === 'turn-completed' ? terminal : childStatus('wait', 'interrupted')
      await emit(cancel)
      await waitUntil(() => waits[0]!.request.signal?.aborted === true)
      waits[0]!.allow()
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(await readFile(join(f.workspace, 'docs/GDD.md'), 'utf8')).toBe('original')
      expect((await responses()).some(response => response.id === 'old')).toBe(false)
      if (mode === 'resolved') await emit(terminal)
      await emit(childStatus('sendInput', 'running'), write('late', 'child-1', 'must not revive'))
      await waitUntil(() => f.questions.length === 1)
      await new Promise(resolve => setTimeout(resolve, 0))
      expect((await responses()).find(response => response.id === 'late')?.error).toBeDefined()
      expect(waits).toHaveLength(1)
      await emit(write('new', 'child-2', 'new authorized write'))
      await waitUntil(() => waits.length === 2)
      expect(waits[1]!.request.signal?.aborted).toBe(false)
      waits[1]!.allow()
      await waitUntil(() => f.questions.length === 3) // allow plus the live host authority recheck
      await new Promise(resolve => setTimeout(resolve, 0))
      expect((await responses()).find(response => response.id === 'new')?.result.success).toBe(true)
      expect(await readFile(join(f.workspace, 'docs/GDD.md'), 'utf8')).toBe('new authorized write')
      await emit({ method: 'turn/completed', params: { threadId: 'child', turn: { id: 'child-2', status: 'completed' } } },
        childStatus('sendInput', 'running'), write('older-late', 'child-1', 'must stay ended across multiple reuses'))
      await new Promise(resolve => setTimeout(resolve, 0))
      expect((await responses()).find(response => response.id === 'older-late')?.error).toBeDefined()
      expect(waits).toHaveLength(2)
    } finally {
      abort.abort(); for (const wait of waits) wait.allow()
      await submitted; await f.close(); cleanup.mockRestore()
    }
  }, 10_000)


test('native workflow registration respects new versus resumed thread capabilities', async () => {
  for (const mode of ['ordinary', 'new-workflow', 'resumed-workflow','read-only-workflow','design-workflow']) {
    const f = await fixture('allow', { OPENAI_AUTH_MODE: 'chatgpt' }, resolveOutboundTarget,
      mode === 'resumed-workflow' ? '019a0000-0000-7000-8000-000000000001' : undefined,
      undefined, false, undefined, mode === 'ordinary' ? undefined : async () => ({}),
      {workflowDescription:productionWorkflowToolDescription({stage:mode==='design-workflow'?'design':mode==='read-only-workflow'?'verification':'implementation',originRequestKey:'fixture'},true),
        ...(['read-only-workflow','design-workflow'].includes(mode)?{finalOutput:{readOnly:true,schema:{type:'object'},accept:async()=>''}}:{})})
    try {
      const rpc = (await readFile(join(f.root, 'rpc.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
      const start = rpc.find(call => ['thread/start', 'thread/resume'].includes(call.method))
      expect(start.params.dynamicTools?.some((tool: any) => tool.name === 'BgsWorkflow') ?? false).toBe(mode === 'new-workflow' || mode === 'read-only-workflow' || mode === 'design-workflow')
      if (mode === 'new-workflow') {
        const tool=start.params.dynamicTools.find((tool: any) => tool.name === 'BgsWorkflow')
        expect(tool.inputSchema.properties.action.enum).toEqual(['status','advance','visual','resources','implement','select-visual','preview'])
        expect(tool.description).toBe(productionWorkflowToolDescription({stage:'implementation',originRequestKey:'fixture'},true))
        expect(tool.description).not.toContain('Return saved design results')
        expect(start.params.dynamicTools.map((tool:any)=>tool.name)).toEqual(['BgsWorkflow'])
      }
      if(['read-only-workflow','design-workflow'].includes(mode)) {
        expect(start.params.dynamicTools.map((tool:any)=>tool.name)).toEqual(['BgsWorkflow'])
        expect(start.params.dynamicTools.find((tool:any)=>tool.name==='BgsWorkflow').description)
          .toBe(productionWorkflowToolDescription({stage:mode==='design-workflow'?'design':'verification',originRequestKey:'fixture'},true))
      }
      if (mode === 'resumed-workflow') expect(start.params).not.toHaveProperty('dynamicTools')
      else expect(start.params.dynamicTools.every((tool: any) => tool.type === 'function')).toBe(true)
    } finally { await f.close() }
  }
})


test('new and resumed threads do not register retired measurement or submission tools',async()=>{
  for (const resumed of [false,true]) {
    const f=await fixture('allow',{OPENAI_AUTH_MODE:'chatgpt'},resolveOutboundTarget,
      resumed?'019a0000-0000-7000-8000-000000000001':undefined,
      undefined,false,undefined,undefined)
    try {
      const rpc=(await readFile(join(f.root,'rpc.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line))
      const start=rpc.find(call=>['thread/start','thread/resume'].includes(call.method))
      expect(start.params.config.mcp_servers).not.toHaveProperty('bgs-ui-layout')
      expect(start.params.dynamicTools?.some((tool:any)=>['BgsMeasurement','BgsFinishDelivery'].includes(tool.name))??false).toBe(false)

    } finally {await f.close()}
  }
})


test('native Skill read targets use catalog identity and structured read actions, never path mentions',()=>{
  const skills=[{name:'registered-name',path:'/catalog/folder/SKILL.md',enabled:true},
    {name:'disabled',path:'/catalog/disabled/SKILL.md',enabled:false}]
  const body={type:'read',path:'/catalog/folder/SKILL.md'},reference={type:'read',path:'/catalog/folder/references/production.md'}
  expect(nativeSkillReadTargets([body,body,reference],skills)).toEqual([
    {name:'registered-name',path:body.path},{name:'registered-name',path:reference.path}])
  expect(nativeSkillReadTargets([{type:'search',path:body.path},{type:'unknown',command:'cat '+body.path},
    {type:'read',path:'/catalog/other/SKILL.md'},{type:'read',path:'/catalog/disabled/SKILL.md'},
    {type:'read',path:'/catalog/folder/references/../../other/SKILL.md'},
    {type:'read',path:'relative/SKILL.md'},null],skills)).toEqual([])
  expect(nativeSkillReadTargets(undefined,skills)).toEqual([])
})

test('legacy Skill-tool count excludes Shell read evidence, including after transcript recovery',async()=>{
  const root=await mkdtemp('/private/tmp/bgs-skill-read-count-'),workspace=join(root,'game')
  await mkdir(workspace)
  const reads=[{name:'one',path:'/catalog/one/SKILL.md'},{name:'two',path:'/catalog/two/references/method.md'}]
  const manager=new BeeGameSessionManager({async start(){return {stop(){},async submit(input){
    for(const [eventType,payload] of [
      ['tool.started',{toolName:'Shell',toolUseID:'read',skillReads:reads}],
      ['tool.completed',{toolName:'Shell',toolUseID:'read',skillReads:reads,exitCode:0}],
      ['tool.completed',{toolName:'Shell',toolUseID:'read',skillReads:reads,exitCode:0}],
      ['tool.started',{toolName:'Shell',toolUseID:'failed-read',skillReads:reads}],
      ['tool.failed',{toolName:'Shell',toolUseID:'failed-read',skillReads:reads,exitCode:1}],
      ['tool.started',{toolName:'Skill',toolUseID:'native-skill',input:{skill:'three'}}],
      ['tool.completed',{toolName:'Skill',toolUseID:'native-skill'}],
      ['tool.completed',{toolName:'Shell',toolUseID:'unknown',input:{command:'echo SKILL.md'},exitCode:0}],
    ] as const)await input.onMessage({type:'runtime_event',eventType,...payload})
  }}}},root)
  let recovered:BeeGameSessionManager|undefined
  try {
    const session=manager.start({workspacePath:workspace,userId:'owner',projectId:'project'})
    await manager.sendWithDisplay(session.id,'Synthetic access telemetry')
    await manager.waitForSessionIdle(session.id)
    expect(manager.runtimeSnapshot(session.id).turnDiagnostics?.skillCalls).toBe(1)
    expect(manager.transcriptFacts(session.id).filter(event=>event.payload?.toolName==='Shell'&&event.payload?.skillReads).length).toBeGreaterThan(0)
    await manager.dispose()
    recovered=new BeeGameSessionManager({async start(){throw Error('Recovery must be read-only')}},root)
    expect(recovered.runtimeSnapshot(session.id,workspace).turnDiagnostics?.skillCalls).toBe(1)
  }finally{await manager.dispose();await recovered?.dispose();await rm(root,{recursive:true,force:true})}
})


for(const recovery of [false,true])
for(const result of ['ready','malformed','mixed','missing','rejected'] as const)test((recovery?'restored':'new')+' final JSON '+result+' is handled once without a new turn',async()=>{
  const accepted:unknown[]=[]
  const contract={schema:{type:'object',properties:{summary:{type:'string'}},required:['summary'],additionalProperties:false},
    accept:async(value:unknown)=>{accepted.push(value);if(result==='rejected')throw Error('Source changed');return 'Chapter handed off'}}
  const f=await fixture('allow',{BGS_FIXTURE_DESIGN_REVIEW:'manual'},resolveOutboundTarget,recovery?'restored-author':undefined,undefined,recovery,undefined,undefined,{finalOutput:contract})
  const client=(f.runtime as unknown as {client:BgsClient}).client
  const submitted=f.submit('hang').then(()=>null,error=>error as Error)
  try {
    await waitUntil(()=>(f.runtime as unknown as {active?:{turnId?:string}}).active?.turnId==='turn-1')
    const emit=(...events:unknown[])=>client.request('fixture/events',{events})
    const item=(text:string,phase:string='final_answer')=>({method:'item/completed',params:{threadId:f.sessionId,turnId:'turn-1',item:{id:'final',type:'agentMessage',text,phase}}})
    if(result!=='missing') {
      const text=result==='malformed'?'I am done':(result==='mixed'?'设计记录已完成。\n\n':'')+JSON.stringify({summary:'Source pointers'})
      await emit({method:'item/agentMessage/delta',params:{threadId:f.sessionId,turnId:'turn-1',itemId:'final',delta:text}},item(text))
    }
    await emit({method:'turn/completed',params:{threadId:f.sessionId,turnId:'turn-1',turn:{id:'turn-1',status:'completed'}}})
    const error=await submitted
    if(result==='ready')expect(error).toBeNull()
    else expect(error?.message).toContain(result==='rejected'?'Source changed':'final result is missing or invalid')
    expect(accepted).toHaveLength(['ready','rejected'].includes(result)?1:0)
    expect(f.events.filter(e=>e.eventType.startsWith('assistant.')).map(e=>e.text)).toEqual(result==='ready'?['Chapter handed off']:[])
    const trace=(await readFile(join(f.root,'rpc.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line))
    const starts=trace.filter(item=>item.method==='turn/start')
    expect(starts).toHaveLength(1)
    expect(starts[0].params).not.toHaveProperty('outputSchema')
    if(recovery) expect(starts[0].params.additionalContext.bgsRuntime_part_000001.value).toContain(JSON.stringify(contract.schema))
    else expect(starts[0].params.additionalContext).toBeUndefined()
    const instructions=trace.find(item=>item.method===(recovery?'thread/resume':'thread/start')).params.developerInstructions
    expect(instructions.split(JSON.stringify(contract.schema))).toHaveLength(2)
    expect(instructions).toContain('This format applies only to the final answer; use tools and progress messages normally')
    expect(instructions).not.toContain('For ordinary task completion')
    expect(instructions).toContain('Final JSON schema:')
  }finally{await f.close()}
})


for (const [text, phase, visible] of [
  ['正在读取设计文档。', undefined, true],
  ['Explicit progress', 'commentary', true],
  ['Not a progress message', 'final_answer', false],
  ['{"summary":"PRIVATE_CANDIDATE"}', undefined, false],
  ['{"summary":"PRIVATE_TRUNCATED', undefined, false],
  ['```json\n{"summary":"PRIVATE_FENCED"}\n```', undefined, false],
] as const) test('structured tasks publish only confirmed public progress: ' + text, async () => {
  const accepted: unknown[] = []
  const f = await fixture('allow', { BGS_FIXTURE_DESIGN_REVIEW: 'manual' }, resolveOutboundTarget,
    undefined, undefined, false, undefined, undefined, { finalOutput: {
      schema: { type: 'object' }, accept: async value => { accepted.push(value); return 'Validated handoff' },
    } })
  const client = (f.runtime as unknown as { client: BgsClient }).client
  const submitted = f.submit('Complete the saved design')
  try {
    await waitUntil(() => (f.runtime as unknown as { active?: { turnId?: string } }).active?.turnId === 'turn-1')
    const emit = (...events: unknown[]) => client.request('fixture/events', { events })
    const params = { threadId: f.sessionId, turnId: 'turn-1' }
    await emit(
      { method: 'item/agentMessage/delta', params: { ...params, itemId: 'progress', delta: text } },
      { method: 'item/completed', params: { ...params, item: { id: 'progress', type: 'agentMessage', text,
        ...(phase ? { phase } : {}) } } },
    )
    const tool = { id: 'read-design', type: 'commandExecution', command: 'cat docs/GDD.md' }
    await emit(
      { method: 'item/started', params: { ...params, item: { ...tool, status: 'inProgress' } } },
      { method: 'item/completed', params: { ...params, item: { ...tool, status: 'completed', exitCode: 0, aggregatedOutput: 'Saved design', durationMs: 1 } } },
      { method: 'item/completed', params: { ...params, item: { id: 'final', type: 'agentMessage',
        text: '{"summary":"PRIVATE_FINAL"}' } } },
      { method: 'turn/completed', params: { ...params, turn: { id: 'turn-1', status: 'completed' } } },
    )
    await submitted
    expect(accepted).toEqual([{ summary: 'PRIVATE_FINAL' }])
    const messages = f.events.filter(event => ['assistant.message', 'assistant.partial'].includes(event.eventType))
    expect(messages.map(event => event.text)).toEqual(visible ? [text, 'Validated handoff'] : ['Validated handoff'])
    expect(messages.some(event => event.text.includes('PRIVATE_'))).toBe(false)
  } finally { await f.close() }
})

for(const phase of [undefined,'final_answer'] as const)test('tool work invalidates an earlier JSON completion: '+String(phase),async()=>{
  const accepted:unknown[]=[]
  const f=await fixture('allow',{BGS_FIXTURE_DESIGN_REVIEW:'manual'},resolveOutboundTarget,
    undefined,undefined,false,undefined,undefined,{finalOutput:{schema:{type:'object'},accept:async value=>{accepted.push(value);return 'Must not accept'}}})
  const client=(f.runtime as unknown as {client:BgsClient}).client
  const submitted=f.submit('Complete the current work').then(()=>null,error=>error as Error)
  try{
    await waitUntil(()=>(f.runtime as unknown as {active?:{turnId?:string}}).active?.turnId==='turn-1')
    const params={threadId:f.sessionId,turnId:'turn-1'}
    const tool={id:'later-read',type:'commandExecution',command:'cat docs/GDD.md'}
    await client.request('fixture/events',{events:[
      {method:'item/completed',params:{...params,item:{id:'interim',type:'agentMessage',text:'{"summary":"PRIVATE_INTERIM"}',...(phase?{phase}:{})}}},
      {method:'item/started',params:{...params,item:{...tool,status:'inProgress'}}},
      {method:'item/completed',params:{...params,item:{...tool,status:'completed',exitCode:0,aggregatedOutput:'Read complete',durationMs:1}}},
      {method:'turn/completed',params:{...params,turn:{id:'turn-1',status:'completed'}}},
    ]})
    expect((await submitted)?.message).toContain('final result is missing or invalid')
    expect(accepted).toEqual([])
    expect(f.events.some(event=>event.text?.includes('PRIVATE_INTERIM'))).toBe(false)
  }finally{await f.close()}
})

test('rg no-result classification requires a literal whole command and an ordinary empty exit 1', () => {
  const receipt = {type:'commandExecution',status:'failed',exitCode:1,aggregatedOutput:''}
  for (const command of ["rg -n 'absent|other' docs", '/usr/bin/rg absent docs', `/bin/zsh -lc 'rg -n "absent|other" docs'`, `rg 'a;b' docs`])
    expect(nativeRgNoMatch({...receipt,command}),command).toBe(true)
  for (const command of ["cd missing && rg absent docs", "rg absent docs | head", "rg absent docs || true", 'rg absent docs; false',
    'rg absent docs > result.txt', 'rg "$QUERY" docs', 'rg $(cat query) docs', 'rg `cat query` docs', "rg 'unterminated", 'rg absent docs\nfalse',
    '/bin/zsh -lc \'cd missing && rg absent docs\'', 'echo rg absent', 'rg absent *.md'])
    expect(nativeRgNoMatch({...receipt,command,commandActions:[{type:'search',command:'rg absent docs'}]}),command).toBe(false)
  for (const change of [{exitCode:0},{exitCode:2},{exitCode:null},{status:'declined'},{status:'inProgress'},
    {aggregatedOutput:'Timed out'},{error:'cancelled'},{type:'mcpToolCall'}])
    expect(nativeRgNoMatch({...receipt,command:'rg absent docs',...change})).toBe(false)
})

test('rg receipts keep raw exit codes and distinguish no results from actual command errors', async () => {
  const cleanup = spyOn(browserCleanup, 'closeSessionTestBrowsers').mockResolvedValue(undefined)
  try {
    for (const [command,exitCode,output,noMatch] of [
      ['rg present docs',0,'present',false], ['rg absent docs',1,'',true],
      ["/bin/zsh -lc 'rg absent docs'",1,'',true], ['rg [ docs',2,'regex error',false],
      ['cd missing && rg absent docs',1,'',false], ['rg absent docs | head',1,'',false],
    ] as const) {
      const f = await fixture()
      try {
        await f.submit('rg-receipt:'+JSON.stringify({command,exitCode,aggregatedOutput:output,status:exitCode?'failed':'completed'}))
        const receipt=f.events.find(e=>e.eventType==='tool.completed'||e.eventType==='tool.failed')
        expect(receipt).toMatchObject({exitCode,is_error:exitCode!==0&&!noMatch,output,eventType:exitCode!==0&&!noMatch?'tool.failed':'tool.completed'})
        expect(receipt?.searchOutcome).toBe(noMatch?'no-match':undefined)
      } finally { await f.close() }
    }
  } finally { cleanup.mockRestore() }
},30_000)

test('provider catalog uses the native provider endpoint without file overrides or subscription changes',()=>{
  const url='http://127.0.0.1:1234/private/v1/models'
  const config=bgsProviderConfig({BEEGAME_MODEL:'fixture'}, {modelCatalogUrl:url}) as any
  expect(config.model_providers.bgs.model_catalog_url).toBe(url)
  expect(config.model_catalog_json).toBeUndefined()
  expect(config.model_context_window).toBeUndefined()
  expect(config.model_auto_compact_token_limit).toBeUndefined()
  expect(bgsProviderConfig({OPENAI_AUTH_MODE:'chatgpt'}, {modelCatalogUrl:url}).model_providers).toBeUndefined()
})


test.each(['write-design','edit-design:{"old_string":"Existing","new_string":"Changed"}'])(
  'document task stays read-only when host omits writeDocument: %s',async prompt=>{
    const f=await fixture('allow',{},resolveOutboundTarget,undefined,undefined,false,undefined,undefined,
      {finalOutput:{readOnly:true,schema:{type:'object'},accept:async()=>{throw Error('Must not accept tool result as a document')}}})
    try {
      await writeFile(join(f.workspace,'docs/GDD.md'),'Existing')
      await expect(f.submit(prompt)).rejects.toThrow('final result is missing or invalid')
      expect(await readFile(join(f.workspace,'docs/GDD.md'),'utf8')).toBe('Existing')
      expect(f.questions).toHaveLength(0)
      const trace=(await readFile(join(f.root,'rpc.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line))
      const start=trace.find(item=>item.method==='thread/start')
      expect(start.params.developerInstructions).toContain('Project files are read-only for this task')
      expect(start.params.dynamicTools.map((tool:any)=>tool.name)).toEqual([])
      expect(start.params.developerInstructions).not.toContain('Use WriteProjectFile or EditProjectFile')
    }finally{await f.close()}
  })


test('read-only native resume keeps the existing history and rejects historical write tools',async()=>{
  const f=await fixture('allow',{},resolveOutboundTarget,'019a0000-0000-7000-8000-000000000001',
    undefined,false,undefined,async()=>({assignment:'verification'}),{
      workflowDescription:productionWorkflowToolDescription({stage:'verification',originRequestKey:'fixture'}),
      finalOutput:{readOnly:true,schema:{type:'object'},accept:async()=>{throw Error('No valid verification result')}}})
  try {
    await writeFile(join(f.workspace,'docs/GDD.md'),'Existing')
    await expect(f.submit('write-design')).rejects.toThrow('final result is missing or invalid')
    expect(await readFile(join(f.workspace,'docs/GDD.md'),'utf8')).toBe('Existing')
    expect(f.questions).toHaveLength(0)
    const trace=(await readFile(join(f.root,'rpc.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line))
    const resume=trace.find(call=>call.method==='thread/resume')
    expect(resume.params).not.toHaveProperty('dynamicTools')
    expect(trace.some(call=>call.method==='thread/start')).toBe(false)
  }finally{await f.close()}
})

test('document write capability authorizes only the current parent turn after permission recheck', async () => {
  const order: string[] = []
  const f = await fixture('allow', { OPENAI_AUTH_MODE: 'chatgpt' }, resolveOutboundTarget, undefined, undefined, false,
    request => {
      order.push('permission:' + (request.phase ?? 'initial'))
      return Promise.resolve({ behavior: 'allow', source: 'policy' })
    }, undefined, {
      finalOutput: {
        readOnly: true,
        writeDocument: { path: 'docs/GDD.md', authorize: async () => { order.push('authorize') } },
        schema: { type: 'object' },
        accept: async () => 'unused',
      },
    })
  const startTrace=(await readFile(join(f.root,'rpc.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line))
  expect(startTrace.find(call=>call.method==='thread/start').params.dynamicTools.map((tool:any)=>tool.name))
    .toEqual([])
  const client = (f.runtime as unknown as { client: BgsClient }).client
  const abort = new AbortController()
  const submitted = f.submit('hang', abort.signal).catch(error => error)
  const write = (id: string, threadId = f.sessionId, turnId = 'turn-1', filePath = 'docs/GDD.md') => ({
    id, method: 'item/tool/call', params: { threadId, turnId, callId: id, tool: 'WriteProjectFile',
      arguments: { file_path: filePath, content: 'working GDD' } },
  })
  const edit = (id: string, threadId = f.sessionId, turnId = 'turn-1', filePath = 'docs/GDD.md') => ({
    id, method: 'item/tool/call', params: { threadId, turnId, callId: id, tool: 'EditProjectFile',
      arguments: { file_path: filePath, old_string: 'working GDD', new_string: 'edited GDD' } },
  })
  const emit = (...events: unknown[]) => client.request('fixture/events', { events })
  const responses = async () => (await client.request('fixture/responses', {})).responses as Array<any>
  try {
    await waitUntil(() => (f.runtime as unknown as { active?: { turnId?: string } }).active?.turnId === 'turn-1')
    await emit(write('parent-write'))
    await waitUntilAsync(async () => (await responses()).some(response => response.id === 'parent-write'))
    expect((await responses()).find(response => response.id === 'parent-write')?.result?.success).toBe(true)
    expect(order).toEqual(['authorize', 'permission:initial', 'permission:recheck', 'authorize'])
    expect(await readFile(join(f.workspace, 'docs/GDD.md'), 'utf8')).toBe('working GDD')

    await emit(edit('parent-edit'))
    await waitUntilAsync(async () => (await responses()).some(response => response.id === 'parent-edit'))
    expect((await responses()).find(response => response.id === 'parent-edit')?.result?.success).toBe(true)
    expect(order).toEqual(['authorize', 'permission:initial', 'permission:recheck', 'authorize',
      'permission:initial', 'permission:recheck', 'authorize'])
    expect(await readFile(join(f.workspace, 'docs/GDD.md'), 'utf8')).toBe('edited GDD')

    await emit(write('stale-parent', f.sessionId, 'stale-turn'))
    await waitUntilAsync(async () => (await responses()).some(response => response.id === 'stale-parent'))
    expect((await responses()).find(response => response.id === 'stale-parent')?.error).toBeDefined()

    await emit(write('wrong-path', f.sessionId, 'turn-1', 'docs/other.md'))
    await waitUntilAsync(async () => (await responses()).some(response => response.id === 'wrong-path'))
    expect((await responses()).find(response => response.id === 'wrong-path')?.result?.success).toBe(false)
    expect(order).toEqual(['authorize', 'permission:initial', 'permission:recheck', 'authorize',
      'permission:initial', 'permission:recheck', 'authorize'])
    expect(await Bun.file(join(f.workspace, 'docs/other.md')).exists()).toBe(false)

    for (const [id, filePath] of [['other-protected', 'AGENTS.md'], ['ordinary', 'src/other.js']] as const) {
      await emit(write(id, f.sessionId, 'turn-1', filePath))
      await waitUntilAsync(async () => (await responses()).some(response => response.id === id))
      expect((await responses()).find(response => response.id === id)?.result?.success).toBe(false)
    }
    expect(order).toEqual(['authorize', 'permission:initial', 'permission:recheck', 'authorize',
      'permission:initial', 'permission:recheck', 'authorize'])

    await emit({ method: 'item/completed', params: { threadId: f.sessionId, turnId: 'turn-1', item: {
      id: 'spawn-child', type: 'collabAgentToolCall', tool: 'spawnAgent', receiverThreadIds: ['child'],
      agentsStates: { child: { status: 'running' } }, status: 'completed',
    } } }, write('child-write', 'child', 'child-1'))
    await waitUntilAsync(async () => (await responses()).some(response => response.id === 'child-write'))
    expect((await responses()).find(response => response.id === 'child-write')?.result?.success).toBe(false)
    expect(order).toEqual(['authorize', 'permission:initial', 'permission:recheck', 'authorize',
      'permission:initial', 'permission:recheck', 'authorize'])
    expect(await readFile(join(f.workspace, 'docs/GDD.md'), 'utf8')).toBe('edited GDD')
  } finally {
    abort.abort()
    await submitted
    await f.close()
  }
}, 10_000)


test.each(['request', 'task', 'revoked'] as const)('document authorization blocks a %s cancellation during its final wait', async cancellation => {
  let entered = false, authorizations = 0
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const f = await fixture('allow', { OPENAI_AUTH_MODE: 'chatgpt' }, resolveOutboundTarget, undefined, undefined, false,
    () => Promise.resolve({ behavior: 'allow', source: 'policy' }), undefined, {
      finalOutput: {
        readOnly: true,
        writeDocument: { path: 'docs/GDD.md', authorize: async () => { if(++authorizations===1)return; entered = true; await gate; if (cancellation === 'revoked') throw Error('Writer changed or paused') } },
        schema: { type: 'object' },
        accept: async () => 'unused',
      },
    })
  const client = (f.runtime as unknown as { client: BgsClient }).client
  const abort = new AbortController()
  const submitted = f.submit('hang', abort.signal).catch(error => error)
  const emit = (...events: unknown[]) => client.request('fixture/events', { events })
  try {
    await writeFile(join(f.workspace, 'docs/GDD.md'), 'original')
    await waitUntil(() => (f.runtime as unknown as { active?: { turnId?: string } }).active?.turnId === 'turn-1')
    await emit({ id: 'cancelled-write', method: 'item/tool/call', params: { threadId: f.sessionId, turnId: 'turn-1',
      callId: 'cancelled-write', tool: 'WriteProjectFile', arguments: { file_path: 'docs/GDD.md', content: 'must not save' } } })
    await waitUntil(() => entered)
    if (cancellation === 'request')
      await emit({ method: 'serverRequest/resolved', params: { threadId: f.sessionId, requestId: 'cancelled-write' } })
    else if (cancellation === 'task') abort.abort()
    release()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(await readFile(join(f.workspace, 'docs/GDD.md'), 'utf8')).toBe('original')
    abort.abort()
    const result = await submitted
    expect(result).toBeInstanceOf(Error)
  } finally {
    release()
    abort.abort()
    await submitted
    await f.close()
  }
}, 10_000)

for (const outcome of ['pass', 'revise', 'rejected', 'unresolved', 'new-defect', 'missing-response', 'missing-resolution', 'advisory-label', 'invalid', 'schema-echo', 'interim-report', 'failed', 'source-changed', 'snapshot-changed', 'exhausted', 'cancel', 'blocked'] as const)
  for (const readOnly of ['pass','revise','cancel','source-changed','snapshot-changed'].includes(outcome) ? [true,false] : [true])
  test('independent GDD review: ' + outcome + ', authorReadOnly=' + readOnly, async () => {
    const receipts: DesignReviewReceipt[] = [], accepted: unknown[] = []
    const needsRevision = ['revise', 'rejected', 'unresolved', 'new-defect', 'missing-response', 'missing-resolution'].includes(outcome)
    const candidateText = outcome === 'revise'
      ? '# Rules\nRequired: a player can confirm or cancel a choice.\nAuthor proposal: confirmation is immediate.\nAuthor proposal: confirmation requires a second action.\nSOURCE_END\n'
      : 'candidate-1\n完整设计 🎮\r\nSOURCE_END\n'
    let sourceHash = createHash('sha256').update(candidateText).digest('hex')
    const source = () => ({ path: 'docs/GDD.md', sha256: sourceHash })
    const contract = { readOnly, ...(!readOnly ? {writeDocument:{path:'docs/GDD.md',authorize:async()=>{}}} : {}), schema: { type: 'object' },
      designReview: {
        context: 'Current GDD handoff: visual design with the approved target library.',
        candidate: async (value: unknown) => {
          const result = value as { status: string; summary: string; reviewResponses?: DesignReviewDisposition[] }
          if (result.status !== 'ready') throw Error('Draft blocked')
          return { source: source(), summary: result.summary, reviewResponses: result.reviewResponses }
        },
        record: async (receipt: DesignReviewReceipt) => { receipts.push(receipt) },
      },
      accept: async (value: unknown) => { assertDesignReviewReady(source(), receipts); accepted.push(value); return 'GDD handed off' },
    }
    const f = await fixture('allow', { BGS_FIXTURE_DESIGN_REVIEW: 'manual', BEEGAME_MODEL: 'chosen-model' },
      resolveOutboundTarget, undefined, undefined, false, undefined, undefined, { finalOutput: contract })
    await writeFile(join(f.workspace, 'docs/GDD.md'), outcome === 'snapshot-changed' ? 'Changed before snapshot' : candidateText)
    const client = (f.runtime as unknown as { client: BgsClient }).client
    const trace = async () => (await readFile(join(f.root, 'rpc.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    const emit = (...events: unknown[]) => client.request('fixture/events', { events })
    const finish = (threadId: string, turnId: string, text: string, status = 'completed', error?: { message: string; codexErrorInfo: string }) => emit(
      { method: 'item/completed', params: { threadId, turnId, item: { type: 'agentMessage', id: turnId + '-final', text, phase: 'final_answer' } } },
      { method: 'thread/tokenUsage/updated', params: { threadId, turnId, tokenUsage: { total: { inputTokens: 100, cachedInputTokens: 20, outputTokens: 30 } } } },
      { method: 'turn/completed', params: { threadId, turnId, turn: { id: turnId, status, ...(error ? { error } : {}) } } },
    )
    const finding = { location: 'GDD §Rules', issue: 'Contradictory transition',
      evidence: 'The same event has two mutually exclusive results.', impact: 'The implementation must invent a rule.' }
    const disposition = { finding: 1, status: outcome === 'rejected' ? 'rejected' as const : 'corrected' as const,
      evidence: outcome === 'revise'
        ? 'Rules retains player confirmation and cancellation; the unconfirmed second-action proposal was withdrawn, leaving immediate confirmation.'
        : 'Saved Rules defines the event condition and outcome; the original condition excludes the reported counterexample.' }
    const report = (hasFindings = false, followup = false) => JSON.stringify({
      summary: hasFindings ? 'Transition needs resolution' : 'No material issue found; runtime remains unverified',
      findings: hasFindings && !(followup && outcome === 'unresolved') ? [finding] : outcome === 'advisory-label' ? [{ ...finding, severity: 'advisory' }] : [],
      ...(followup && outcome !== 'missing-resolution' ? { resolutions: [{ ...disposition,
        status: outcome === 'unresolved' ? 'unresolved' : disposition.status }] } : {}),
    })
    const controller = new AbortController()
    try {
      const submitted = f.submit('Author-only history marker', controller.signal).then(() => null, error => error as Error)
      await waitUntilAsync(async () => (await trace()).some(row => row.method === 'turn/start'))
      await finish(f.sessionId, 'turn-1', JSON.stringify({ status: outcome === 'blocked' ? 'blocked' : 'ready', summary: 'Author-only summary marker' }))
      if (outcome === 'blocked' || outcome === 'snapshot-changed') {
        expect((await submitted)?.message).toContain(outcome === 'blocked' ? 'Draft blocked' : 'changed before independent review')
        expect((await trace()).filter(row => row.method === 'thread/start')).toHaveLength(1)
        expect(receipts).toHaveLength(0)
        return
      }
      await waitUntilAsync(async () => (await trace()).filter(row => row.method === 'turn/start').length === 2)
      const starts = (await trace()).filter(row => row.method === 'thread/start')
      expect(starts).toHaveLength(2)
      const reviewer = starts[1].params
      expect(reviewer.model).toBe('chosen-model')
      expect(starts[0].params.permissions).toBe('bgs-project')
      expect(reviewer.permissions).toBe('bgs-project-review')
      expect(reviewer.config.shell_environment_policy.include_only).toEqual(expect.arrayContaining(['PATH', 'TMPDIR', 'BUN_INSTALL_CACHE_DIR']))
      expect(reviewer.config.shell_environment_policy.include_only.some((key: string) => /^(BEEGAME_|PLAYWRIGHT_)/.test(key))).toBe(false)
      expect(reviewer.dynamicTools).toEqual([])
      expect(reviewer.baseInstructions).toContain('independent game-design document reviewer')
      expect(reviewer.config.project_doc_max_bytes).toBe(0)
      expect(reviewer.config).not.toHaveProperty('tools.update_plan.enabled')
      expect(reviewer.config['features.multi_agent']).toBe(false)
      expect(reviewer.config['features.multi_agent_v2']).toBe(false)
      expect(reviewer.config['features.goals']).toBe(false)
      expect(reviewer.config['features.image_generation']).toBe(false)
      expect(reviewer.config['features.view_image']).toBe(false)
      expect(reviewer.config['features.default_mode_request_user_input']).toBe(false)
      expect(starts[0].params.developerInstructions).not.toContain('OFFICIAL_SKILL_USAGE_FIXTURE')
      expect(reviewer.developerInstructions).not.toContain('OFFICIAL_SKILL_USAGE_FIXTURE')
      expect(reviewer.developerInstructions).toContain(DESIGN_REVIEW_INSTRUCTIONS)
      expect(reviewer.developerInstructions).not.toContain('Author-only')
      expect(reviewer.developerInstructions).not.toContain('Return only the required status and summary')
      const initialReview = (await trace()).filter(row => row.method === 'turn/start')[1].params
      expect(initialReview.threadId).toBe('review-thread-2')
      expect(initialReview.parentTurnId).toBe('turn-1')
      expect(initialReview.input[0].text).toContain('Synthetic confirmed PC requirements')
      expect(initialReview.input[0].text).toContain(contract.designReview.context)
      expect(f.events.find(event => event.eventType === 'tool.started' && event.text === 'Independent GDD review')!.input.prompt).not.toContain(contract.designReview.context)
      expect(initialReview.input[0].text).toContain(JSON.stringify(candidateText))
      expect(initialReview.input[0].text).toContain(sourceHash)
      expect(f.events.find(event => event.eventType === 'tool.started' && event.text === 'Independent GDD review')!.input.prompt).not.toContain('SOURCE_END')
      expect(reviewer.config['skills.config'].every((skill: {enabled: boolean}) => !skill.enabled)).toBe(true)
      expect(initialReview.input[0].text).not.toContain('Author-only')
      expect(initialReview.input[0].text).not.toContain('Final JSON schema:')
      const reviewSchema=initialReview.outputSchema
      expect(reviewSchema).toMatchObject({ required: ['summary', 'findings'], additionalProperties: false })
      expect(reviewSchema.properties).not.toHaveProperty('resolutions')
      if (outcome === 'cancel') {
        controller.abort()
        expect((await submitted)?.message).toContain('interrupted')
        expect(accepted).toHaveLength(0)
        expect(receipts).toHaveLength(0)
        return
      }
      if (outcome === 'pass') {
        await emit({ id: 'late-author-write', method: 'item/tool/call', params: { threadId: f.sessionId, turnId: 'turn-1',
          callId: 'late-author-write', tool: 'WriteProjectFile', arguments: { file_path: 'docs/GDD.md', content: 'Late author write during review' } } })
        await waitUntilAsync(async () => (await client.request('fixture/responses', {})).responses.some((r: any) => r.id === 'late-author-write'))
        expect((await client.request('fixture/responses', {})).responses.find((r: any) => r.id === 'late-author-write').error.code).toBe(-32603)
        await emit({ id: 'review-write', method: 'item/tool/call', params: { threadId: 'review-thread-2', turnId: 'turn-2',
          callId: 'review-write', tool: 'WriteProjectFile', arguments: { file_path: 'docs/GDD.md', content: 'Forbidden reviewer change' } } })
        await waitUntilAsync(async () => (await client.request('fixture/responses', {})).responses.some((r: any) => r.id === 'review-write'))
        const denied = (await client.request('fixture/responses', {})).responses.find((r: any) => r.id === 'review-write')
        expect(denied.result.success).toBe(false)
      }
      if (outcome === 'source-changed') {
        await writeFile(join(f.workspace, 'docs/GDD.md'), 'external-change')
        sourceHash = createHash('sha256').update('external-change').digest('hex')
      }
      if(outcome==='interim-report'){
        const params={threadId:'review-thread-2',turnId:'turn-2'}
        const tool={id:'review-calculation',type:'commandExecution',command:'node -e "console.log(1+1)"'}
        await emit(
          {method:'item/completed',params:{...params,item:{id:'interim-report',type:'agentMessage',phase:'final_answer',text:report()}}},
          {method:'item/started',params:{...params,item:{...tool,status:'inProgress'}}},
          {method:'item/completed',params:{...params,item:{...tool,status:'completed',exitCode:0,aggregatedOutput:'2',durationMs:1}}},
          {method:'turn/completed',params:{...params,turn:{id:'turn-2',status:'completed'}}},
        )
        expect((await submitted)?.message).toContain('ended without a report')
        expect(receipts).toHaveLength(0)
        expect(accepted).toHaveLength(0)
        expect((await trace()).filter(row=>row.method==='turn/start')).toHaveLength(2)
        return
      }
      await finish('review-thread-2', 'turn-2', outcome === 'invalid' ? 'not a report' : outcome === 'schema-echo' ? JSON.stringify(reviewSchema) + ',' + report() + '}' : report(needsRevision),
        outcome === 'failed' || outcome === 'exhausted' ? 'failed' : 'completed',
        outcome === 'exhausted' ? { message: 'Incomplete response returned, reason: max_output_tokens PRIVATE_UPSTREAM_DATA', codexErrorInfo: 'other' } : undefined)
      if (needsRevision) {
        await waitUntilAsync(async () => (await trace()).filter(row => row.method === 'turn/start').length === 3)
        const revision = (await trace()).filter(row => row.method === 'turn/start')[2].params.input[0].text
        expect(revision).toContain('Verify this current numbered revision list before editing')
        expect(revision).toContain('reject the finding with those supporting clauses')
        expect(revision).toContain('revise or withdraw an unconfirmed author proposal')
        expect(revision).toContain('preserve explicit user requirements and selected designs')
        expect(reviewer.developerInstructions).toContain('A real contradiction remains a finding even when its clauses are author proposals')
        expect(receipts).toHaveLength(1)
        expect(accepted).toHaveLength(0)
        if (outcome !== 'rejected') {
          const revisedText = outcome === 'revise'
            ? '# Rules\nRequired: a player can confirm or cancel a choice.\nAuthor proposal: confirmation is immediate.\n'
            : 'candidate-2'
          await writeFile(join(f.workspace, 'docs/GDD.md'), revisedText)
          sourceHash = createHash('sha256').update(revisedText).digest('hex')
        }
        await finish(f.sessionId, 'turn-3', JSON.stringify({ status: 'ready', summary: 'AUTHOR_BLANKET_SUMMARY_NOT_EVIDENCE',
          ...(outcome !== 'missing-response' ? { reviewResponses: [disposition] } : {}) }))
        await waitUntilAsync(async () => (await trace()).filter(row => row.method === 'turn/start').length === 4)
        const followup = (await trace()).filter(row => row.method === 'turn/start')[3].params
        expect(followup.threadId).toBe('review-thread-3')
        expect(followup.parentTurnId).toBe('turn-3')
        expect(followup.input[0].text).not.toContain('Final JSON schema:')
        const followupSchema=followup.outputSchema
        expect(followupSchema.required).toEqual(['summary', 'findings', 'resolutions'])
        expect(followupSchema.properties.resolutions).toMatchObject({ minItems: 1, maxItems: 1,
          items: { properties: { finding: { minimum: 1, maximum: 1 } } } })
        expect(followup.input[0].text).toContain('Synthetic confirmed PC requirements')
        expect(followup.input[0].text).toContain(contract.designReview.context)
        const followupStart = (await trace()).filter(row => row.method === 'thread/start')[2].params
        expect(followupStart.permissions).toBe('bgs-project-review')
        expect(followupStart.dynamicTools).toEqual([])
        expect(followupStart.config).toEqual(reviewer.config)
        expect(followup.input[0].text).toContain('Targeted follow-up only')
        expect(followup.input[0].text).toContain(sourceHash)
        expect(followup.input[0].text).toContain(finding.evidence)
        if (outcome === 'missing-response') expect(followup.input[0].text).not.toContain(disposition.evidence)
        else expect(followup.input[0].text).toContain(disposition.evidence)
        if (outcome === 'revise') {
          expect(followup.input[0].text).toContain('Required: a player can confirm or cancel a choice.')
          expect(followup.input[0].text).toContain('Author proposal: confirmation is immediate.')
          expect(await readFile(join(f.workspace, 'docs/GDD.md'), 'utf8')).not.toContain('confirmation requires a second action')
        }
        expect(followup.input[0].text).toContain('Author revision summary:')
        expect(followup.input[0].text).toContain('AUTHOR_BLANKET_SUMMARY_NOT_EVIDENCE')
        await emit({ method: 'item/completed', params: { threadId: 'review-thread-2', turnId: 'turn-2',
          item: { type: 'agentMessage', id: 'stale-review', text: 'stale malformed report', phase: 'final_answer' } } })
        await finish('review-thread-3', 'turn-4', report(outcome === 'unresolved' || outcome === 'new-defect', true))
        expect(f.events.filter(event => event.eventType === 'assistant.message' || event.eventType === 'assistant.partial')
          .some(event => event.text.includes('stale malformed report'))).toBe(false)
      }
      if (outcome === 'unresolved' || outcome === 'new-defect') {
        await waitUntilAsync(async () => (await trace()).filter(row => row.method === 'turn/start').length === 5)
        const revision = (await trace()).filter(row => row.method === 'turn/start')[4].params
        expect(revision.threadId).toBe(f.sessionId)
        expect(revision.additionalContext.bgsRuntime_part_000001.value).toContain(finding.issue)
        expect(revision).not.toHaveProperty('outputSchema')
        expect(revision.additionalContext.bgsRuntime_part_000001.value).toContain(JSON.stringify(contract.schema))
        await writeFile(join(f.workspace, 'docs/GDD.md'), 'candidate-3')
        sourceHash = createHash('sha256').update('candidate-3').digest('hex')
        await finish(f.sessionId, 'turn-5', JSON.stringify({ status: 'ready', summary: 'Second revision', reviewResponses: [disposition] }))
        await waitUntilAsync(async () => (await trace()).filter(row => row.method === 'turn/start').length === 6)
        const finalReview = (await trace()).filter(row => row.method === 'turn/start')[5].params
        expect(finalReview.threadId).toBe('review-thread-4')
        await finish('review-thread-4', 'turn-6', report(outcome === 'unresolved', true))
      }
      const error = await submitted
      if (outcome === 'pass' || outcome === 'revise' || outcome === 'rejected' || outcome === 'new-defect' || outcome === 'missing-response') {
        expect(error).toBeNull()
        expect(accepted).toHaveLength(1)
        expect(receipts.at(-1)?.source.sha256).toBe(sourceHash)
        expect(receipts.at(-1)?.nativeThreadId).toBe(outcome === 'pass' ? 'review-thread-2' : outcome === 'new-defect' ? 'review-thread-4' : 'review-thread-3')
        expect(receipts.at(-1)?.nativeTurnId).toBe(outcome === 'pass' ? 'turn-2' : outcome === 'new-defect' ? 'turn-6' : 'turn-4')
        if (needsRevision) expect(receipts.at(-1)?.authorResponses).toEqual(outcome === 'missing-response' ? [] : [disposition])
        expect(f.events.filter(e => e.eventType === 'assistant.message').map(e => e.text).join('')).toContain('GDD handed off')
      } else {
        expect(error?.message).toContain({ unresolved: 'did not reduce outstanding', 'missing-resolution': 'exactly one evidence-backed disposition', 'missing-response': 'exactly one evidence-backed disposition', 'advisory-label': 'invalid report', invalid: 'invalid JSON', 'schema-echo': 'invalid JSON', failed: 'review failed', exhausted: 'max_output_tokens', 'source-changed': 'changed during' }[outcome])
        expect(accepted).toHaveLength(0)
        if (outcome === 'exhausted') {
          expect(error).toMatchObject({ bgsErrorInfo: 'other' })
          expect(error!.message).not.toContain('PRIVATE_UPSTREAM_DATA')
          const failed = f.events.find(event => event.eventType === 'tool.failed' && event.text === 'Independent GDD review')!
          expect(failed.output).toContain('max_output_tokens')
          expect(failed.output).not.toContain('PRIVATE_UPSTREAM_DATA')
        }
        if (outcome === 'unresolved') {
          expect(error).toBeInstanceOf(ProductionBlockedError)
          expect(error?.message).not.toContain(finding.issue)
          expect(error?.message).not.toContain(disposition.evidence)
          expect(receipts.at(-1)?.report.resolutions?.[0]?.status).toBe('unresolved')
        }
      }
      const rounds = outcome === 'unresolved' || outcome === 'new-defect' ? 3 : needsRevision ? 2 : 1
      expect(receipts).toHaveLength(['invalid', 'schema-echo', 'failed', 'exhausted', 'source-changed', 'advisory-label'].includes(outcome) ? 0 : outcome === 'missing-resolution' ? 1 : rounds)
      const calls = await trace()
      const reviewThreads = calls.filter(row => row.method === 'thread/start').slice(1)
      expect(reviewThreads).toHaveLength(rounds)
      expect(new Set(receipts.map(receipt => receipt.nativeThreadId)).size).toBe(receipts.length)
      expect(calls.some(row => row.method === 'thread/resume' || row.method === 'thread/fork')).toBe(false)
      expect(calls.filter(row => row.method === 'turn/start')).toHaveLength(rounds * 2)
      expect(calls.some(row => row.method === 'thread/goal/set')).toBe(false)
    } finally { controller.abort(); await f.close() }
  })

for (const counts of [[3, 2, 1, 0], [1, 2, 1]]) test('GDD progress tracks best outstanding count: ' + counts.join(' → '), async () => {
  const receipts: DesignReviewReceipt[] = []
  let hash = createHash('sha256').update('candidate-0').digest('hex'), accepted = false
  const source = () => ({ path: 'docs/GDD.md', sha256: hash })
  const contract = { readOnly: true, schema: { type: 'object' }, designReview: {
    context: 'Current GDD handoff: visual design.',
    candidate: async (value: unknown) => ({ source: source(), ...(value as { summary: string; reviewResponses?: DesignReviewDisposition[] }) }),
    record: async (receipt: DesignReviewReceipt) => { receipts.push(receipt) },
  }, accept: async () => { assertDesignReviewReady(source(), receipts); accepted = true; return 'Handed off' } }
  const f = await fixture('allow', { BGS_FIXTURE_DESIGN_REVIEW: 'manual' }, resolveOutboundTarget,
    undefined, undefined, false, undefined, undefined, { finalOutput: contract })
  const client = (f.runtime as unknown as { client: BgsClient }).client
  const trace = async () => (await readFile(join(f.root, 'rpc.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  const finish = (threadId: string, n: number, value: unknown) => client.request('fixture/events', { events: [
    { method: 'item/completed', params: { threadId, turnId: 'turn-' + n, item: { type: 'agentMessage', id: 'final-' + n, text: JSON.stringify(value), phase: 'final_answer' } } },
    { method: 'turn/completed', params: { threadId, turnId: 'turn-' + n, turn: { id: 'turn-' + n, status: 'completed' } } },
  ] })
  const controller = new AbortController()
  const submitted = f.submit('Synthetic progress test', controller.signal).then(() => null, error => error as Error)
  try {
    let previousCount = 0
    for (const [index, count] of counts.entries()) {
      const n = index * 2 + 1
      await waitUntilAsync(async () => (await trace()).filter(row => row.method === 'turn/start').length === n)
      const responses = Array.from({ length: previousCount }, (_, i) => ({ finding: i + 1, status: 'corrected' as const, evidence: 'Saved owning definition and dependent uses updated.' }))
      const text = 'candidate-' + index
      await writeFile(join(f.workspace, 'docs/GDD.md'), text)
      hash = createHash('sha256').update(text).digest('hex')
      await finish(f.sessionId, n, { status: 'ready', summary: 'Candidate saved', ...(index ? { reviewResponses: responses } : {}) })
      await waitUntilAsync(async () => (await trace()).filter(row => row.method === 'turn/start').length === n + 1)
      await finish('review-thread-' + (index + 2), n + 1, { summary: 'Current findings',
        findings: Array.from({ length: count }, (_, i) => ({ location: 'Rules ' + i, issue: 'Current defect ' + index + '-' + i,
          evidence: 'The same condition gives incompatible results.', impact: 'Implementation needs a decision.' })),
        ...(index ? { resolutions: responses } : {}),
      })
      previousCount = count
    }
    const error = await submitted
    if (counts.at(-1) === 0) { expect(error).toBeNull(); expect(accepted).toBe(true) }
    else { expect(error).toBeInstanceOf(ProductionBlockedError); expect(accepted).toBe(false) }
    expect(receipts).toHaveLength(counts.length)
    const calls = await trace()
    expect(calls.filter(row => row.method === 'thread/start')).toHaveLength(counts.length + 1)
    expect(new Set(receipts.map(receipt => receipt.nativeThreadId)).size).toBe(counts.length)
    expect(calls.filter(row => row.method === 'turn/start')).toHaveLength(counts.length * 2)
  } finally { controller.abort(); await submitted; await f.close() }
})

test.each([null, 'high'] as const)('GDD author and reviewer retain the original reasoning preference: %s', async effort => {
  const configRoot = await mkdtemp('/private/tmp/bgs-design-effort-')
  const env = { BEEGAME_CONFIG_DIR: configRoot, BGS_FIXTURE_DESIGN_REVIEW: 'manual', BEEGAME_API_PROTOCOL: 'chat-completions',
    OPENAI_BASE_URL: 'https://opencode.ai/zen/go/v1', BEEGAME_MODEL: 'deepseek-v4.1-flash' }
  if (effort) saveReasoningPreference(env, reasoningConnectionKey(env, env.BEEGAME_MODEL), effort)
  const f = await fixture('allow', env, async value => ({ url: new URL(value), addresses: ['127.0.0.1'],
    lookup: (_host, _options, callback) => callback(Error('No external requests allowed in this fixture'), '', 4) }),
    undefined, undefined, false, undefined, undefined, { finalOutput: { readOnly: true, schema: { type: 'object' },
      designReview: { context: 'Current GDD handoff: visual design.', candidate: async () => ({ source: { path: 'docs/GDD.md', sha256: createHash('sha256').update('Fixture GDD').digest('hex') }, summary: 'Draft' }), record: async () => {} },
      accept: async () => { throw Error('Fixture must stop during review') },
    } })
  await writeFile(join(f.workspace, 'docs/GDD.md'), 'Fixture GDD')
  const controller = new AbortController()
  const submitted = f.submit('Draft', controller.signal).catch(error => error)
  const trace = async () => (await readFile(join(f.root, 'rpc.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  try {
    await waitUntilAsync(async () => (await trace()).some(row => row.method === 'turn/start'))
    await (f.runtime as unknown as { client: BgsClient }).client.request('fixture/events', { events: [
      { method: 'item/completed', params: { threadId: f.sessionId, turnId: 'turn-1', item: { type: 'agentMessage', id: 'final-1', text: '{}', phase: 'final_answer' } } },
      { method: 'turn/completed', params: { threadId: f.sessionId, turnId: 'turn-1', turn: { id: 'turn-1', status: 'completed' } } },
    ] })
    await waitUntilAsync(async () => (await trace()).filter(row => row.method === 'turn/start').length === 2)
    const starts = (await trace()).filter(row => row.method === 'thread/start')
    expect(starts).toHaveLength(2)
    for (const row of starts) expect(row.params.config.model_reasoning_effort).toBe(effort ?? undefined)
  } finally { controller.abort(); await submitted; await f.close(); await rm(configRoot, { recursive: true, force: true }) }
})

for(const rejected of [false,true])test('design Chat answer does not invoke review or handoff: '+rejected,async()=>{
  let reviews=0,accepted=0
  const contract={readOnly:true,schema:{type:'object'},
    answer:async(value:unknown)=>{
      expect(value).toEqual({status:'answered',summary:'Current draft status'})
      if(rejected)throw Error('Changed design cannot be an answer-only result')
      return 'Current draft status'
    },
    designReview:{context:'Current GDD document assignment: answer the current message.',candidate:async()=>{reviews++;throw Error('An answer has no candidate')},record:async()=>{}},
    accept:async()=>{accepted++;throw Error('An answer cannot hand off a design')},
  }
  const f=await fixture('allow',{BGS_FIXTURE_DESIGN_REVIEW:'manual'},resolveOutboundTarget,undefined,undefined,false,undefined,undefined,{finalOutput:contract})
  const client=(f.runtime as unknown as {client:BgsClient}).client
  const controller=new AbortController()
  try {
    const submitted=f.submit('Only explain the draft status.',controller.signal).then(()=>null,error=>error as Error)
    await waitUntil(()=>Boolean((f.runtime as unknown as {active?:{turnId?:string}}).active?.turnId))
    await client.request('fixture/events',{events:[
      {method:'item/completed',params:{threadId:f.sessionId,turnId:'turn-1',item:{type:'agentMessage',id:'answer-final',
        text:JSON.stringify({status:'answered',summary:'Current draft status'}),phase:'final_answer'}}},
      {method:'turn/completed',params:{threadId:f.sessionId,turnId:'turn-1',turn:{id:'turn-1',status:'completed'}}},
    ]})
    const error=await submitted
    if(rejected)expect(error?.message).toContain('Changed design')
    else {
      expect(error).toBeNull()
      expect(f.events.filter(e=>e.eventType==='assistant.message').map(e=>e.text)).toContain('Current draft status')
    }
    expect(reviews).toBe(0);expect(accepted).toBe(0)
    const trace=(await readFile(join(f.root,'rpc.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line))
    expect(trace.filter(row=>row.method==='thread/start')).toHaveLength(1)
    expect(trace.filter(row=>row.method==='turn/start')).toHaveLength(1)
  }finally{controller.abort();await f.close()}
},10000)

for (const resumed of [false, true])
  test('visual final result uses normal handoff without an image-review thread: ' + resumed, async () => {
    const accepted: unknown[] = []
    const assignment = { stage: 'visual' as const, originRequestKey: 'original-assignment' }
    const contract = { schema: productionOutputSchema(assignment), accept: async (value: unknown) => {
      accepted.push(parseProductionResult(assignment, value)); return 'Selected visual sources retained'
    } }
    const f = await fixture('allow', { BGS_FIXTURE_DESIGN_REVIEW: 'manual' }, resolveOutboundTarget,
      resumed ? '019a0000-0000-7000-8000-000000000001' : undefined,
      undefined, false, undefined, undefined, { finalOutput: contract })
    const client = (f.runtime as unknown as { client: BgsClient }).client
    const trace = async () => (await readFile(join(f.root, 'rpc.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    const controller = new AbortController()
    const submitted = f.submit('Current visual assignment', controller.signal).then(() => null, error => error as Error)
    try {
      await waitUntilAsync(async () => (await trace()).some(row => row.method === 'turn/start'))
      const result = { status: 'ready', summary: 'Saved concepts', sections: ['UI'], files: ['assets/concept.png'],
        ...(resumed ? { reviewResponses: [{ finding: 1, status: 'unresolved', evidence: 'Historical author text' }] } : {}) }
      await client.request('fixture/events', { events: [
        { method: 'item/completed', params: { threadId: f.sessionId, turnId: 'turn-1', item: {
          type: 'agentMessage', id: 'final-1', text: JSON.stringify(result), phase: 'final_answer' } } },
        { method: 'turn/completed', params: { threadId: f.sessionId, turnId: 'turn-1', turn: { id: 'turn-1', status: 'completed' } } },
      ] })
      expect(await submitted).toBeNull()
      expect(accepted).toEqual([{ action: 'advance', summary: 'Saved concepts', sections: ['UI'], files: ['assets/concept.png'] }])
      const calls = await trace()
      expect(calls.filter(row => row.method === 'turn/start')).toHaveLength(1)
      expect(calls.some(row => row.method === 'thread/start' &&
        String(row.params.baseInstructions).includes('visual coverage reviewer'))).toBe(false)
      expect(f.events.some(event => event.eventType === 'tool.started' && event.toolName === 'Agent')).toBe(false)
      expect(calls.some(row => row.method === 'thread/goal/set')).toBe(false)
    } finally { controller.abort(); await submitted; await f.close() }
  })

test('Responses per-request receipts and native cumulative updates are not counted twice', async () => {
  const provider = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    if (request.method === 'GET') return new Response(null, { status: 404 })
    return Response.json({ id: 'receipt', status: 'completed', output: [], usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } })
  } })
  let f: Awaited<ReturnType<typeof fixture>> | undefined
  try {
    f = await fixture('allow', { BEEGAME_API_PROTOCOL: 'responses', OPENAI_BASE_URL: provider.url.origin, BEEGAME_MODEL: 'fixture' },
      async value => ({ url: new URL(value), addresses: ['127.0.0.1'], lookup: (_h, _o, callback) => callback(null, '127.0.0.1', 4) }))
    await f.submit('provider-unknown-tool')
    expect(f.usage.some(event => event.payload?.usageBaselineOnly === true)).toBe(true)
    expect(getLatestRuntimeUsage(f.usage)).toMatchObject({ total_tokens: 12, prompt_tokens: 10, completion_tokens: 2 })
  } finally { await f?.close(); provider.stop(true) }
})


test('new and cold-resumed native threads retain the selected browser tool set and approval policy', async () => {
  const servers = [{ id: 'browser', name: 'Browser', enabled: true, autoStart: true, scope: 'global',
    transport: 'stdio', command: '/fixture/browser', enabledTools: ['browser_run_code_unsafe'], disabledTools: ['browser_click'] }]
  for (const resumed of [false, true]) {
    const f = await fixture('allow', { OPENAI_AUTH_MODE: 'chatgpt', BEEGAME_NATIVE_MCP_SERVERS_JSON: JSON.stringify(servers) },
      resolveOutboundTarget, resumed ? '019a0000-0000-7000-8000-000000000001' : undefined)
    try {
      const rpc = (await readFile(join(f.root, 'rpc.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
      const start = rpc.find(call => call.method === (resumed ? 'thread/resume' : 'thread/start'))
      expect(start.params.config.mcp_servers['bgs-browser']).toMatchObject({
        enabled_tools: ['browser_run_code_unsafe'], disabled_tools: ['browser_click'],
      })
      expect(start.params.approvalPolicy).toBe('on-request')
      expect(start.params.approvalsReviewer).toBe('auto_review')
    } finally { await f.close() }
  }
})


test('image tool display strips direct and JSON-wrapped previews without changing native results or ordinary text', async () => {
  const f = await fixture('allow', { BGS_FIXTURE_DESIGN_REVIEW: 'manual' })
  try {
    const runtime = f.runtime as any
    const submitted = f.submit('Inspect image results')
    await waitUntil(() => runtime.active?.turnId === 'turn-1')
    const facts = {path:'assets/source/sprites.png',width:1536,height:1024,sha256:'saved-source-hash',chargedCredits:6,requestId:'paid-request'}
    const data = 'private-preview-data-' + 'A'.repeat(128 * 1024)
    const original: any = {content:[{type:'text',text:JSON.stringify(facts)},
      {type:'text',text:'Transparency viewing preview on a checkerboard.'},
      {type:'image',mimeType:'image/png',data}],isError:false,_meta:{receipt:'retained'}}
    const wrapped = {content:[{type:'text',text:JSON.stringify(original)}]}
    const doubleWrapped = {content:[{type:'text',text:JSON.stringify(wrapped)}]}
    const ordinary = {content:[{type:'text',text:'Image saved; viewing preview unavailable: decoder error'},
      {type:'text',text:'{  "path": "assets/source/sprites.png", "width": 1536 }'},
      {type:'text',text:'{"content": not valid JSON'}]}
    const results = [original,wrapped,doubleWrapped,ordinary,wrapped]
    const before = JSON.stringify(results)
    await (runtime.client as BgsClient).request('fixture/events', {events: results.map((result,index) => ({
      method:'item/completed',params:{threadId:f.sessionId,turnId:'turn-1',item:{id:'image-'+index,type:'mcpToolCall',
        server:index === 4 ? 'other-images' : 'beegame-images',tool:'generate_image',status:'completed',result}},
    }))})
    await waitUntil(() => f.events.filter(e => e.eventType === 'tool.completed').length === results.length)
    const receipts = f.events.filter(e => e.eventType === 'tool.completed')
    for (let index = 0; index < 3; index++) {
      const output = receipts[index]!.output
      expect(JSON.stringify(output)).not.toContain('private-preview-data-')
      expect(JSON.stringify(output).length).toBeLessThan(2000)
      let nested = output
      for (let depth = 0; depth < index; depth++) nested = JSON.parse(nested.content[0].text)
      expect(JSON.parse(nested.content[0].text)).toEqual(facts)
      expect(nested._meta).toEqual(original._meta)
      expect(nested.isError).toBe(false)
      expect(nested.content[2]).toEqual({type:'text',text:'Viewing preview (image/png) retained in native tool history.'})
    }
    expect(receipts[3]!.output).toEqual(ordinary)
    expect(receipts[4]!.output).toEqual(wrapped)
    expect(JSON.stringify(results)).toBe(before)
    await (runtime.client as BgsClient).request('fixture/events', {events:[{method:'turn/completed',params:{
      threadId:f.sessionId,turnId:'turn-1',turn:{id:'turn-1',status:'completed'},
    }}]})
    await submitted
  } finally { await f.close() }
}, 30_000)

for(const mode of ['accepted','normal-finish','pending-tool','pending-command','pending-child','receipt-exit','cancel','denied','cleanup-failed','native-failed','restored-ready'] as const)
test('host implementation readiness preserves native lifecycle: '+mode,async()=>{
  const original=BgsClient.prototype.request,controller=new AbortController()
  let ready:string|undefined=mode==='restored-ready'?'Saved runnable handoff':undefined,interrupts=0,cleanupFailed=false
  let historyPath:string|undefined
  const rpc=spyOn(BgsClient.prototype,'request').mockImplementation(async function(this:BgsClient,method:string,params:any,timeout?:number):Promise<any>{
    if(method==='thread/read')return {thread:{id:params.threadId,path:historyPath??null}}
    if(method==='thread/backgroundTerminals/clean'&&ready&&mode==='cleanup-failed'&&!cleanupFailed){cleanupFailed=true;throw Error('Actual cleanup failure')}
    if(method==='turn/interrupt'){
      interrupts++
      const failed=mode==='native-failed'
      await original.call(this,'fixture/events',{events:[{method:'turn/completed',params:{threadId:params.threadId,turnId:params.turnId,
        turn:{id:params.turnId,status:failed?'failed':mode==='normal-finish'?'completed':'interrupted',...(failed?{error:{message:'Actual upstream failure'}}:{})}}}]})
      return {}
    }
    return original.call(this,method,params,timeout)
  })
  let f:Awaited<ReturnType<typeof fixture>>|undefined
  try{
    f=await fixture('allow',{OPENAI_AUTH_MODE:'chatgpt',BGS_FIXTURE_DESIGN_REVIEW:'manual'},resolveOutboundTarget,
      mode==='restored-ready'?'saved-ready-author':undefined,undefined,mode==='restored-ready',undefined,undefined,{implementationHandoff:()=>ready})
    const runtime=f.runtime as any,client=runtime.client as BgsClient
    const emit=(...events:any[])=>client.request('fixture/events',{events})
    let ended=false
    const submitted=f.submit('Deliver runnable work',controller.signal).then(()=>{ended=true;return null},e=>{ended=true;return e as Error})
    if(mode!=='restored-ready'){
      await waitUntil(()=>runtime.active?.turnId==='turn-1')
      const p={threadId:f.sessionId,turnId:'turn-1'}
      const handoff={id:'ready-tool',type:'dynamicToolCall',tool:'BgsWorkflow',arguments:{action:'advance'},status:'inProgress'}
      const pending=['pending-command','receipt-exit'].includes(mode)?{id:'pending-observation',type:'commandExecution',command:'synthetic build',status:'inProgress',source:'agent'}:{id:'pending-observation',type:'mcpToolCall',server:'browser',tool:'browser_evaluate',status:'inProgress'}
      if(mode==='receipt-exit'){
        historyPath=join(f.root,'saved-exit.jsonl')
        await writeFile(historyPath,[{type:'session_meta',payload:{id:f.sessionId}},{type:'turn_context',payload:{turn_id:'turn-1'}},
          {type:'response_item',payload:{type:'function_call_output',call_id:pending.id,
            output:'Chunk ID: fixture\nWall time: 0.1 seconds\nProcess exited with code 134\nOriginal token count: 2\nOutput:\nOperation not permitted'}}].map(x=>JSON.stringify(x)).join('\n')+'\n')
      }
      if(mode==='pending-child')await emit({method:'item/started',params:{...p,item:{id:'spawn',type:'collabAgentToolCall',tool:'spawnAgent',receiverThreadIds:['child']}}})
      await emit({method:'item/started',params:{...p,item:handoff}},...(['pending-tool','pending-command','receipt-exit'].includes(mode)?[{method:'item/started',params:{...p,item:pending}}]:[]))
      if(mode!=='denied')ready='Runnable handoff; independent checks remain'
      if(mode==='cancel')controller.abort()
      else{
        await emit({method:'item/completed',params:{...p,item:{...handoff,status:'completed',success:mode!=='denied',result:'Current task receipt'}}})
        if(['pending-tool','pending-command'].includes(mode)){
          await new Promise(resolve=>setTimeout(resolve,20))
          expect(ended).toBe(false);expect(interrupts).toBe(0)
          expect(runtime.items.has(pending.id)).toBe(true)
          await emit({method:'item/completed',params:{...p,item:{...pending,status:'completed',result:{content:[]},exitCode:0,aggregatedOutput:'Completed build'}}})
        }
        if(mode==='pending-child'){
          await new Promise(resolve=>setTimeout(resolve,20));expect(ended).toBe(false);expect(interrupts).toBe(0)
          await emit({method:'turn/completed',params:{threadId:'child',turnId:'child-1',turn:{id:'child-1',status:'completed'}}})
        }
        if(mode==='denied'){
          expect(interrupts).toBe(0)
          await emit({method:'turn/completed',params:{...p,turn:{id:'turn-1',status:'interrupted'}}})
        }
      }
    }
    const error=await submitted
    if(['accepted','normal-finish','pending-tool','pending-command','pending-child','receipt-exit','restored-ready'].includes(mode)){
      expect(error).toBeNull();expect(interrupts).toBe(1)
      expect(f.events.some(e=>e.eventType==='assistant.message'&&e.text===ready)).toBe(true)
    }else{
      expect(error?.message).toContain(mode==='cleanup-failed'?'Actual cleanup failure':mode==='native-failed'?'Actual upstream failure':'interrupted')
      expect(f.events.some(e=>e.eventType==='assistant.message'&&e.text===ready)).toBe(false)
    }
    const calls=(await readFile(join(f.root,'rpc.jsonl'),'utf8')).trim().split('\n').map(x=>JSON.parse(x))
    if(mode==='restored-ready')expect(calls.find(c=>c.method==='turn/start').params.input).toEqual([])
    expect(calls.some(c=>c.method==='thread/goal/set')).toBe(false)
  }finally{controller.abort();await f?.close();rpc.mockRestore()}
},10000)

test('an unavailable user HTTP MCP does not prevent a new or cold-resumed Agent from running', async () => {
  const servers = [
    { id: 'search', name: 'Search', enabled: true, autoStart: true, scope: 'global', transport: 'http', url: 'https://127.0.0.1/mcp?key=private' },
    { id: 'browser', name: 'Browser', enabled: true, autoStart: true, scope: 'global', transport: 'stdio', command: '/fixture/browser' },
  ]
  for (const resumed of [false, true]) {
    const f = await fixture('allow', { OPENAI_AUTH_MODE: 'chatgpt', BEEGAME_NATIVE_MCP_SERVERS_JSON: JSON.stringify(servers) },
      resolveOutboundTarget, resumed ? '019a0000-0000-7000-8000-000000000001' : undefined)
    try {
      await f.submit('hello')
      const rpc = (await readFile(join(f.root, 'rpc.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
      const start = rpc.find(call => call.method === (resumed ? 'thread/resume' : 'thread/start'))
      expect(start.params.config.mcp_servers).toHaveProperty('bgs-browser')
      expect(start.params.config.mcp_servers).not.toHaveProperty('bgs-search')
      expect(JSON.stringify(rpc)).toContain('bgs-search: address_not_public')
      expect(JSON.stringify(rpc)).not.toContain('key=private')
      expect(start.params.approvalPolicy).toBe('on-request')
      expect(f.events.filter(event => event.eventType.startsWith('assistant.')).map(event => event.text).join('')).toBe('Hello Bgs')
    } finally { await f.close() }
  }
})


test.each([{config:{features:{default_mode_request_user_input:false}},native:false},{config:{tools:{experimental_request_user_input:{enabled:false}}},native:false},{config:{tools:{experimental_request_user_input:{}}},native:true}])(
  'native question settings honor explicit opt-outs and the official empty-table default: %j',async({config,native})=>{
    const original=BgsClient.prototype.request
    const spy=spyOn(BgsClient.prototype,'request').mockImplementation(async function(this:BgsClient,method:string,params:any):Promise<any>{
      if(method==='config/read')return {config,origins:{},layers:[{name:{type:'user',file:'/fixture/config.toml'},version:'fixture',config}]}
      return original.call(this,method,params)
    })
    let f:Awaited<ReturnType<typeof fixture>>|undefined
    try {
      f=await fixture('allow',{OPENAI_AUTH_MODE:'chatgpt'})
      const trace=(await readFile(join(f.root,'rpc.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line))
      const start=trace.find(call=>call.method==='thread/start')
      if(native)expect(start.params.config['features.default_mode_request_user_input']).toBe(true)
      else expect(start.params.config).not.toHaveProperty('features.default_mode_request_user_input')
      expect(start.params.dynamicTools.map((tool:any)=>tool.name)).toEqual(native?[]:['AskUserQuestion'])
    }finally{await f?.close();spy.mockRestore()}
  })
