import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
const send = (value: unknown) => process.stdout.write(JSON.stringify(value) + '\n')
const threadId = '019a0000-0000-7000-8000-000000000001'
let skillRoots: string[] = []
let turn = 0
let resumed = false
let awaiting: ((value: any) => void) | undefined
createInterface({ input: process.stdin }).on('line', async line => {
  const request = JSON.parse(line), p = request.params ?? {}
  if (!request.method) { awaiting?.(request); return }
  const reply = (result: unknown) => send({ id: request.id, result })
  if (request.method === 'initialize') reply({ userAgent: 'fixture/0.163.0' })
  else if (request.method === 'thread/start' || request.method === 'thread/resume') { resumed = request.method === 'thread/resume'; reply({ thread: { id: p.threadId ?? threadId } }) }
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
    const event = (method: string, params: any) => send({ method, params: { threadId, turnId, ...params } })
    const prompt = p.input?.findLast((i: any) => i.type === 'text')?.text
    await new Promise(resolve => setTimeout(resolve, 5))
    if (prompt?.startsWith('$')) { event('item/completed',{item:{id:'skill-answer',type:'agentMessage',text:p.input.some((i:any)=>i.type==='skill')?'Native skill selected':'Skill input missing'}}) }
    if (prompt === 'hang') { setInterval(() => {}, 1000); return }
    if (prompt === 'crash') { process.exit(3) }
    if (prompt === 'failure-details' || prompt === 'failure-notification') {
      const error = { message: 'Connection error. fixture ECONNRESET', bgsErrorInfo: { httpConnectionFailed: { httpStatusCode: 502 } } }
      if (prompt === 'failure-notification') event('error', { error, willRetry: false })
      event('turn/completed', { turn: { id: turnId, status: 'failed', ...(prompt === 'failure-details' ? { error } : {}) } })
      return
    }
    if (prompt === 'provider-unknown-tool') {
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
      event('item/completed', { item: { id: 'write-result', type: 'agentMessage', text: result.result?.success ? 'Saved design' : 'Write rejected: ' + JSON.stringify(result.result), phase: 'final_answer' } })
    } else if (prompt === 'file-diff') {
      const changes = [{ path: 'src/Example.ts', diff: '@@ -11 +11 @@\n-old\n+new\n' }]
      event('item/started', { item: { id: 'edit-1', type: 'fileChange', status: 'inProgress', changes } })
      event('item/completed', { item: { id: 'edit-1', type: 'fileChange', status: 'completed', changes } })
    } else if (prompt === 'question') {
      const result = await new Promise<any>(resolve => {
        awaiting = resolve
        send({ id: 'host-question', method: 'item/tool/requestUserInput', params: { threadId, turnId, itemId: 'question-1',
          questions: [{ id: 'choice', header: 'Style', question: 'Choose style', options: [{ label: 'A', description: 'Style A' }] }] } })
      })
      awaiting = undefined
      event('item/completed', { item: { id: 'question-result', type: 'agentMessage', text: JSON.stringify(result.result), phase: 'final_answer' } })
    } else if (prompt === 'unfinished-child') {
      event('item/completed', { item: { id: 'spawn', type: 'collabAgentToolCall', tool: 'spawnAgent', receiverThreadIds: ['child'], agentsStates: { child: { status: 'running' } }, status: 'completed' } })
    } else {
      event('item/started', { item: { id: 'shell-1', type: 'commandExecution', command: 'bun run build', status: 'inProgress' } })
      if (prompt === 'command-progress') {
        event('item/commandExecution/outputDelta', { itemId: 'shell-1', delta: 'Bu' })
        event('item/commandExecution/outputDelta', { itemId: 'shell-1', delta: 'ilt' })
      }
      event('item/completed', { item: { id: 'shell-1', type: 'commandExecution', command: 'bun run build', status: 'completed', aggregatedOutput: 'Built', exitCode: prompt === 'command-fail' ? 2 : 0, durationMs: 1200 } })
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
