import { appendFileSync } from 'node:fs'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
// Offline runtime metadata export uses the same configured executable as stdio.
if (process.argv.slice(-3).join(' ') === 'debug models --bundled') {
  process.stdout.write(JSON.stringify({models:[{slug:'fixture-known-model',display_name:'Fixture',context_window:272000}]}))
  process.exit(0)
}
const send = (value: unknown) => process.stdout.write(JSON.stringify(value) + '\n')
const threadId = '019a0000-0000-7000-8000-000000000001'
let skillRoots: string[] = []
const serverResponses: any[] = []
let turn = 0
let resumed = false
let startedThreads = 0
let injectedItems: any[] = []
let nativeGoal: any = process.env.BGS_FIXTURE_SAVED_GOAL ? JSON.parse(process.env.BGS_FIXTURE_SAVED_GOAL) : undefined
let nativeGoalRunning = false
let awaiting: ((value: any) => void) | undefined
let finalizationRelease: (() => void) | undefined
let finalizationDone: Promise<void> | undefined
let finalizationDoneResolve: (() => void) | undefined

// Replay an idle native child receiving another assignment.
function reusedChild(event: (method: string, params: any) => void, outcome: string) {
  event('item/completed', { item: { id: 'spawn-reused', type: 'collabAgentToolCall', tool: 'spawnAgent',
    receiverThreadIds: ['reused-child'], agentsStates: { 'reused-child': { status: 'completed' } }, status: 'completed' } })
  event('item/completed', { item: { id: 'send-reused', type: 'collabAgentToolCall', tool: 'sendInput',
    receiverThreadIds: ['reused-child'], agentsStates: outcome === 'pending' ? {} :
      { 'reused-child': { status: outcome === 'turn-started' ? 'completed' : 'running' } }, status: 'completed' } })
  if (outcome === 'turn-started')
    event('turn/started', { threadId: 'reused-child', turnId: 'child-next', turn: { id: 'child-next', status: 'inProgress' } })
  if (outcome === 'turn-completed')
    event('turn/completed', { threadId: 'reused-child', turnId: 'child-next', turn: { id: 'child-next', status: 'completed' } })
  else if (['completed','errored','interrupted','shutdown','notFound'].includes(outcome))
    event('item/completed', { item: { id: 'wait-reused', type: 'collabAgentToolCall', tool: 'wait',
      receiverThreadIds: ['reused-child'], agentsStates: { 'reused-child': { status: outcome } }, status: 'completed' } })
}

async function runNativeGoal() {
  if (nativeGoalRunning || !nativeGoal || nativeGoal.status !== 'active') return
  nativeGoalRunning = true
  const turnId = 'goal-turn-' + ++turn
  const event = (method: string, params: any) => send({ method, params: { threadId, turnId, ...params } })
  event('turn/started', { turn: { id: turnId, status: 'inProgress' } })
  if (process.env.BGS_FIXTURE_REUSED_CHILD === '1') reusedChild(event, 'running')
  if (process.env.BGS_FIXTURE_NATIVE_GOAL_FINALIZE === '1') {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    const childPidFile = process.env.BGS_FIXTURE_NATIVE_GOAL_CHILD_PID_FILE
    if (childPidFile && child.pid) await writeFile(childPidFile, String(child.pid))
    event('item/started', { item: { id: 'submission-command', type: 'commandExecution', command: 'finish-delivery', status: 'inProgress' } })
    finalizationDone = new Promise<void>(resolve => { finalizationDoneResolve = resolve })
    await new Promise<void>(resolve => { finalizationRelease = resolve })
    finalizationRelease = undefined
    event('item/completed', { item: { id: 'submission-command', type: 'commandExecution', command: 'finish-delivery', status: 'completed', aggregatedOutput: 'done', exitCode: 0, durationMs: 1 } })
    const usage = { inputTokens: 100, outputTokens: 30, cachedInputTokens: 20, cacheWriteInputTokens: 0 }
    if (process.env.BGS_FIXTURE_NATIVE_GOAL_FINALIZE_NO_UPDATED !== '1')
      event('thread/goal/updated', { goal: nativeGoal })
    event('thread/tokenUsage/updated', { tokenUsage: { total: usage, last: usage } })
    finalizationDoneResolve?.()
    finalizationDoneResolve = undefined
    finalizationDone = undefined
    nativeGoalRunning = false
    return
  }
  if (process.env.BGS_FIXTURE_NATIVE_GOAL_WRITE === '1') {
    const result = await new Promise<any>(resolve => {
      awaiting = resolve
      send({ id: 'native-goal-write', method: 'item/tool/call', params: { threadId, turnId,
        callId: 'native-goal-write', tool: 'WriteProjectFile',
        arguments: { file_path: 'docs/GDD.md', content: 'Native Goal protected write' } } })
    })
    awaiting = undefined
    if (!result.result?.success) {
      event('item/completed', { item: { id: 'native-write-failure', type: 'agentMessage',
        text: 'Native Goal write failed: ' + String(result.result?.contentItems?.[0]?.text || 'unknown') } })
    }
  }
  await new Promise(resolve => setTimeout(resolve, 5))
  const text = injectedItems.flatMap(item => item.content ?? []).find((item: any) => item.type === 'input_text')?.text
  const usage = { inputTokens: 100, outputTokens: 30, cachedInputTokens: 20, cacheWriteInputTokens: 0 }
  const targetTurns = Math.max(1, Number(process.env.BGS_FIXTURE_NATIVE_GOAL_TURNS || 1))
  const turnNumber = (nativeGoal.turnsCompleted || 0) + 1
  const terminal = turnNumber >= targetTurns
  nativeGoal = { ...nativeGoal, status: terminal ? 'complete' : 'active', turnsCompleted: turnNumber,
    tokensUsed: (nativeGoal.tokensUsed || 0) + usage.inputTokens + usage.outputTokens }
  if (terminal) send({ method: 'thread/goal/updated', params: { threadId, turnId, goal: nativeGoal } })
  event('item/completed', { item: { id: 'native-answer', type: 'agentMessage', text: text ? 'Native Goal: ' + text : 'Native Goal completed' } })
  event('thread/tokenUsage/updated', { tokenUsage: { total: usage, last: usage } })
  event('turn/completed', { turn: { id: turnId, status: 'completed' } })
  if (!terminal) {
    send({ method: 'thread/goal/updated', params: { threadId, turnId, goal: nativeGoal } })
    setTimeout(() => void runNativeGoal(), 0)
  }
  nativeGoalRunning = false
}

createInterface({ input: process.stdin }).on('line', async line => {
  const request = JSON.parse(line), p = request.params ?? {}
  if (!request.method) { serverResponses.push(request); awaiting?.(request); return }
  if (process.env.BGS_FIXTURE_RPC_TRACE) appendFileSync(process.env.BGS_FIXTURE_RPC_TRACE, JSON.stringify(request) + '\n')
  const reply = (result: unknown) => send({ id: request.id, result })
  if (request.method === 'fixture/events') { for (const event of p.events) send(event); reply({}) }
  else if (request.method === 'fixture/responses') reply({ responses: serverResponses })
  else if (request.method === 'thread/unsubscribe') reply({ status: 'unsubscribed' })
  else if (request.method === 'initialize') reply({ userAgent: 'fixture/0.163.0' })
  else if (request.method === 'thread/start' || request.method === 'thread/resume') {
    if (request.method === 'thread/resume' && process.env.BGS_FIXTURE_RESUME_ERROR) {
      send({id:request.id,error:{code:-32600,message:process.env.BGS_FIXTURE_RESUME_ERROR==='missing'
        ? 'no rollout found for thread id '+p.threadId : 'PRIVATE_OTHER_ERROR'}}); return
    }
    if (p.ephemeral) { reply({ thread: { id: 'discovery-context' } }); return }
    resumed = request.method === 'thread/resume'
    startedThreads++
    const resolvedThreadId = p.threadId ?? (startedThreads === 1 ? threadId : 'review-thread-' + startedThreads)
    reply({ thread: { id: resolvedThreadId } })
    if (request.method === 'thread/resume' && nativeGoal?.status === 'active') void runNativeGoal()
    // A real cold paginated resume can replay the last persisted cumulative
    // usage before the next turn starts. Keep this opt-in so ordinary fixture
    // tests retain their small, deterministic protocol transcript.
    if (resumed && !p.excludeTurns && process.env.BGS_FIXTURE_REPLAY_RESUME_USAGE === '1') {
      const historical = { inputTokens: 17, outputTokens: 5, cachedInputTokens: 2, cacheWriteInputTokens: 0 }
      send({ method: 'thread/tokenUsage/updated', params: {
        threadId: resolvedThreadId,
        turnId: 'historical-turn',
        tokenUsage: { total: historical, last: historical },
      } })
    }
  }
  else if (request.method === 'thread/inject_items') { injectedItems.push(...(p.items ?? [])); reply({}) }
  else if (request.method === 'thread/goal/get') reply({ goal: nativeGoal ?? null })
  else if (request.method === 'thread/goal/clear') { nativeGoal = undefined; injectedItems = []; reply({ cleared: true }); send({ method: 'thread/goal/cleared', params: { threadId: p.threadId } }) }
  else if (request.method === 'thread/goal/set') {
    nativeGoal = {
      threadId: p.threadId, objective: p.objective ?? nativeGoal?.objective ?? 'Native fixture Goal',
      tokenBudget: p.tokenBudget ?? nativeGoal?.tokenBudget ?? null, status: p.status ?? nativeGoal?.status ?? 'active',
      tokensUsed: nativeGoal?.tokensUsed ?? 0,
    }
    if (nativeGoal.status === 'complete') {
      const done = finalizationDone
      finalizationRelease?.()
      if (done) await done
      reply({ goal: nativeGoal })
      return
    }
    reply({ goal: nativeGoal })
    send({ method: 'thread/goal/updated', params: { threadId: p.threadId, goal: nativeGoal } })
    if (nativeGoal.status === 'active') void runNativeGoal()
  }
  else if (request.method === 'thread/backgroundTerminals/clean') reply({})
  else if (request.method === 'skills/extraRoots/set') { skillRoots = p.extraRoots; reply({}) }
  else if (request.method === 'skills/list') {
    const skills=[]
    for(const directory of skillRoots) for(const entry of await readdir(directory,{withFileTypes:true}).catch((error: NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return [];throw error})) {
      if(!entry.isDirectory())continue
      const path=join(directory,entry.name,'SKILL.md'),body=await readFile(path,'utf8').catch((error: NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return '';throw error})
      const skill=/^name: (.+)$/m.exec(body)?.[1]
      if(skill)skills.push({name:skill,path,enabled:true})
    }
    reply({data:[{skills,errors:process.env.BGS_FIXTURE_SKILL_CATALOG_ERROR === '1'
      ? [{path:'PRIVATE_BROKEN_SKILL_PATH',message:'PRIVATE_INVALID_SKILL_METADATA'}] : []}]})
  }
  else if (request.method === 'turn/start') {
    const turnId = 'turn-' + ++turn
    reply({ turn: { id: turnId, status: 'inProgress' } })
    const event = (method: string, params: any) => send({ method, params: { threadId: p.threadId, turnId, ...params } })
    event('turn/started', { turn: { id: turnId, status: 'inProgress' } })
    if (process.env.BGS_FIXTURE_DESIGN_REVIEW === 'manual') return
    const prompt = p.input?.findLast((i: any) => i.type === 'text')?.text ?? ''
    await new Promise(resolve => setTimeout(resolve, 5))
    if (prompt?.startsWith('$')) { event('item/completed',{item:{id:'skill-answer',type:'agentMessage',text:p.input.some((i:any)=>i.type==='skill')?'Native skill selected':'Skill input missing'}}) }
    if (prompt === 'native-retry') event('error', { error: { message: 'Temporary native failure' }, willRetry: true })
    if (prompt === 'hang') { setInterval(() => {}, 1000); return }
    if (prompt === 'crash') { process.exit(3) }
    if (prompt === 'failure-details' || prompt === 'failure-notification') {
      const error = { message: 'Connection error. fixture ECONNRESET', bgsErrorInfo: { httpConnectionFailed: { httpStatusCode: 502 } } }
      if (prompt === 'failure-notification') event('error', { error, willRetry: false })
      event('turn/completed', { turn: { id: turnId, status: 'failed', ...(prompt === 'failure-details' ? { error } : {}) } })
      return
    }
    if (prompt === 'compaction') {
      event('item/started', { item: { id: 'compact-1', type: 'contextCompaction' } })
      event('item/completed', { item: { id: 'compact-1', type: 'contextCompaction' } })
    } else if (prompt === 'provider-unknown-tool') {
      const url = new URL(process.env.OPENAI_BASE_URL + '/responses')
      if (url.hostname !== '127.0.0.1') throw Error('Fixture requires a local provider bridge')
      const response = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY },
        body: JSON.stringify({ input: 'Fixture', tools: [{ type: 'function', name: 'probe', parameters: { type: 'object' } }] }) })
      if (!response.ok) throw Error('Fixture bridge rejected request: ' + response.status)
      await response.json()
    } else if (prompt === 'write-design' || prompt === 'write-outside' || prompt?.startsWith('write-path:') || prompt?.startsWith('edit-design:')) {
      const file_path = prompt === 'write-design' ? 'docs/GDD.md' : prompt === 'write-outside' ? '../outside.md' : prompt.slice('write-path:'.length)
      const result = await new Promise<any>(resolve => {
        awaiting = resolve
        send({ id: 'host-write', method: 'item/tool/call', params: { threadId, turnId,
          callId: 'write-design', tool: prompt.startsWith('edit-design:') ? 'EditProjectFile' : 'WriteProjectFile',
          arguments: prompt.startsWith('edit-design:') ? { file_path: 'docs/GDD.md', ...JSON.parse(prompt.slice('edit-design:'.length)) } : { file_path, content: 'Authorized design' } } })
      })
      awaiting = undefined
      event('item/completed', { item: { id: 'write-result', type: 'agentMessage', text: (result.result?.success ? 'Saved design: ' : 'Write rejected: ') + JSON.stringify(result.result), phase: 'final_answer' } })
    } else if (prompt?.startsWith('native-denial:')) {
      const mode = prompt.slice('native-denial:'.length)
      event('item/started', { item: { id: 'denied-command', type: 'commandExecution', command: 'fixture command', status: 'inProgress' } })
      if (mode.startsWith('review-')) {
        event('item/autoApprovalReview/completed', {
          ...(mode === 'review-stale-turn' ? { turnId: 'old-turn' } : {}),
          targetItemId: mode === 'review-missing-target' ? null : mode === 'review-other-target' ? 'other-command' : 'denied-command',
          review: { status: mode === 'review-timeout' ? 'timedOut' : mode === 'review-aborted' ? 'aborted' : 'denied',
            riskLevel: mode === 'review-denied' ? 'high' : null, userAuthorization: mode === 'review-denied' ? 'low' : null,
            rationale: mode === 'review-denied' ? 'PRIVATE_ASSESSMENT' : 'Automatic approval review failed: PRIVATE_PROVIDER_BODY' },
        })
      } else if (mode !== 'unspecified') {
        const result = await new Promise<any>(resolve => {
          awaiting = resolve
          send({ id: 'host-approval', method: 'item/commandExecution/requestApproval', params: { threadId, turnId,
            itemId: 'denied-command', command: 'fixture command', cwd: process.cwd(),
            ...(mode === 'policy' ? { additionalPermissions: { fileSystem: { read: [process.cwd()] } } } : {}) } })
        })
        awaiting = undefined
        if (result.result?.decision !== 'decline') throw Error('Fixture expected a denied command')
      }
      event('item/completed', { item: { id: 'denied-command', type: 'commandExecution', command: 'fixture command',
        status: 'declined', aggregatedOutput: null, exitCode: null, durationMs: null } })
    } else if (prompt?.startsWith('mcp-error:')) {
      event('item/completed', { item: { id: 'mcp-error', type: 'mcpToolCall', tool: 'fixture', status: 'failed',
        result: prompt.endsWith('result') ? { content: [{ type: 'text', text: 'Partial output' }] } : null,
        error: { message: 'Fixture resource unavailable', internal: 'PRIVATE_INTERNAL_DATA' } } })
    } else if (prompt === 'file-diff') {
      const changes = [{ path: 'src/Example.ts', diff: '@@ -11 +11 @@\n-old\n+new\n' }]
      event('item/started', { item: { id: 'edit-1', type: 'fileChange', status: 'inProgress', changes } })
      event('item/completed', { item: { id: 'edit-1', type: 'fileChange', status: 'completed', changes } })
    } else if (prompt === 'command-missing-cwd') {
      event('item/started', { item: { id: 'missing-cwd', type: 'commandExecution', command: 'bun run build', status: 'inProgress' } })
      event('item/completed', { item: { id: 'missing-cwd', type: 'commandExecution', command: 'bun run build',
        cwd: join(process.cwd(), 'missing-workdir'), status: 'failed', error: { message: 'No such file or directory (os error 2)' } } })
    } else if (prompt === 'question') {
      const result = await new Promise<any>(resolve => {
        awaiting = resolve
        send({ id: 'host-question', method: 'item/tool/requestUserInput', params: { threadId, turnId, itemId: 'question-1',
          questions: [{ id: 'choice', header: 'Style', question: 'Choose style', options: [{ label: 'A', description: 'Style A' }] }] } })
      })
      awaiting = undefined
      event('item/completed', { item: { id: 'question-result', type: 'agentMessage', text: JSON.stringify(result.result), phase: 'final_answer' } })
    } else if (prompt.startsWith('reused-child:')) {
      const outcome = prompt.slice('reused-child:'.length)
      reusedChild(event, outcome)
      if (outcome === 'cancel') return
    } else if (prompt.startsWith('rg-receipt:')) {
      const receipt = JSON.parse(prompt.slice('rg-receipt:'.length))
      event('item/started', { item: { ...receipt, id: 'rg-1', type: 'commandExecution', status: 'inProgress', exitCode: undefined } })
      event('item/completed', { item: { ...receipt, id: 'rg-1', type: 'commandExecution' } })
    } else if (prompt === 'unfinished-child') {
      event('item/completed', { item: { id: 'spawn', type: 'collabAgentToolCall', tool: 'spawnAgent', receiverThreadIds: ['child'], agentsStates: { child: { status: 'running' } }, status: 'completed' } })
    } else {
      event('item/started', { item: { id: 'shell-1', type: 'commandExecution', command: 'bun run build', status: 'inProgress',
        ...(prompt === 'command-progress' ? { cwd: join(process.cwd(), 'command-workdir') } : {}) } })
      if (prompt === 'command-progress') {
        event('item/commandExecution/outputDelta', { itemId: 'shell-1', delta: 'Bu' })
        event('item/commandExecution/outputDelta', { itemId: 'shell-1', delta: 'ilt' })
      }
      const volume = prompt.startsWith('command-volume:') ? Number(prompt.split(':')[1]) : 0
      for (let i = 0; i < volume; i++) event('item/commandExecution/outputDelta', { itemId: 'shell-1', delta: 'x'.repeat(1024) })
      event('item/completed', { item: { id: 'shell-1', type: 'commandExecution', command: 'bun run build', status: 'completed', aggregatedOutput: volume ? 'x'.repeat(volume * 1024) : 'Built', exitCode: prompt === 'command-fail' ? 2 : 0, durationMs: 1200 } })
      event('item/agentMessage/delta', { itemId: 'answer', delta: 'Hello ' })
      event('item/agentMessage/delta', { itemId: 'answer', delta: 'Bgs' })
      event('item/completed', { item: { id: 'answer', type: 'agentMessage', text: 'Hello Bgs', phase: 'final_answer' } })
    }
    const usage = { inputTokens: resumed ? 200 : 100, outputTokens: resumed ? 60 : 30, cachedInputTokens: resumed ? 40 : 20, cacheWriteInputTokens: 0 }
    event('thread/tokenUsage/updated', { tokenUsage: { total: usage, last: usage } })
    event('thread/tokenUsage/updated', { tokenUsage: { total: usage, last: usage } })
    event('turn/completed', { turn: { id: turnId, status: prompt === 'fail' ? 'failed' : 'completed' } })
  }
})
