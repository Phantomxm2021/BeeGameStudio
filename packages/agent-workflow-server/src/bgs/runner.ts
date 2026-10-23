import { bgsHomeDirectory } from './home'
import { mkdir, realpath } from 'node:fs/promises'
import { mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, join, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import {startProviderBridge,type ProviderNetworkOptions} from '../model-providers/bridge'
import { BgsClient, type RpcObject } from './client'
import { bgsApproval, elicitationAnswer, webSearchTool } from './interactions'
import { bgsReasoningConfig } from './preferences'
import { configureBgsSkills } from './skills'
import type { BeeGameSessionRunner, BeeGameSessionRunnerStartInput, BeeGameSessionRuntime,
  BeeGameSessionSubmitInput, BeeGameEventType, DashboardPermissionRequest } from '../beegame/session-manager'
import { getSafeRuntimeProcessEnvironment } from '../beegame/runtime-process-environment'
import { projectExecutionAccess } from '../beegame/project-execution-access'
import { prepareNativeMcpConfig } from '../beegame/native-mcp-config'
import { closeSessionTestBrowsers } from '../beegame/native-test-browser-cleanup'
import { responseLanguageInstruction } from '../beegame/response-language'
import { BEEGAME_USER_RESPONSE_SCOPE } from '../beegame/user-response-scope'
import { getBuiltinSkillsDirectory } from '@bee-game-studio/beegame-skills-core/store'

const protectedWriteTools: RpcObject[] = ['WriteProjectFile', 'EditProjectFile'].map(name => ({ type: 'function', name,
  description: name === 'WriteProjectFile'
    ? 'Write a BGS protected design record or AGENTS.md through the host permission authority. Ordinary project files use exec_command with project-local file operations.'
    : 'Edit a BGS protected design record or AGENTS.md through host permission. Use old_string/new_string for one replacement, or edits for multiple non-overlapping replacements against the same original file. All must match uniquely; one failure saves nothing.',
  inputSchema: { type: 'object', properties: { file_path: { type: 'string' },
    ...(name === 'WriteProjectFile' ? { content: { type: 'string' } }
      : { old_string: { type: 'string' }, new_string: { type: 'string' }, edits: { type: 'array', minItems: 1,
        items: { type: 'object', properties: { old_string: { type: 'string', minLength: 1 }, new_string: { type: 'string' } },
          required: ['old_string', 'new_string'], additionalProperties: false } } }) },
    required: name === 'WriteProjectFile' ? ['file_path', 'content'] : ['file_path'],
    ...(name === 'EditProjectFile' ? { oneOf: [{ required: ['old_string', 'new_string'] }, { required: ['edits'] }] } : {}),
    additionalProperties: false },
}))

protectedWriteTools.push({ type: 'function', name: 'AskUserQuestion', description: 'Ask the user for missing information or an explicit decision through BGS. Preserve their actual answers.',
  inputSchema: { type: 'object', properties: { questions: { type: 'array', minItems: 1, maxItems: 3,
    items: { type: 'object', properties: { question: { type: 'string' }, header: { type: 'string' },
      options: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, description: { type: 'string' } }, required: ['label','description'], additionalProperties: false } },
      multiSelect: { type: 'boolean' } }, required: ['question','header','options'], additionalProperties: false } } }, required: ['questions'], additionalProperties: false } })

export function editProtectedFileText(text: string, args: Record<string, unknown>): string {
  return prepareProtectedFileEdit(text, args).content
}

/** Resolve every edit against the original bytes before the single authorized write. */
function prepareProtectedFileEdit(text: string, args: Record<string, unknown>) {
  if ('edits' in args && ('old_string' in args || 'new_string' in args))
    throw Error('Use either edits or old_string/new_string, not both')
  const edits = 'edits' in args ? args.edits : [{ old_string: args.old_string, new_string: args.new_string }]
  if (!Array.isArray(edits) || !edits.length) throw Error('edits must be a nonempty array')
  const issues: string[] = []
  let excerpts = 0
  const lineAt = (offset: number) => text.slice(0, offset).split('\n').length
  const replacements = edits.flatMap((edit, index) => {
    if (!edit || typeof edit.old_string !== 'string' || !edit.old_string || typeof edit.new_string !== 'string') {
      issues.push(`edits[${index}]: requires an exact nonempty old_string and a string new_string`)
      return []
    }
    const start = text.indexOf(edit.old_string)
    let matches = 0
    const lines: number[] = []
    for (let at = start; at !== -1; at = text.indexOf(edit.old_string, at + 1)) {
      matches++
      if (lines.length < 5) lines.push(lineAt(at))
    }
    if (matches !== 1) {
      let hint = lines.length ? `; original match lines: ${lines.join(', ')}${matches > lines.length ? ', …' : ''}` : ''
      // Locate stale text for diagnostics only. A prefix candidate must never
      // become a replacement span or relax exact/unique matching.
      if (!matches && excerpts < 3) {
        const anchor = edit.old_string.split('\n').find((line: string) => line.trim())
        const sourceLines = text.split('\n')
        let candidates = anchor ? sourceLines.flatMap((value, line) => value === anchor ? [line] : []) : []
        let locator = 'exact first-line anchor'
        if (!candidates.length && anchor && anchor.trim().length >= 12) {
          const prefix = [...anchor].slice(0, 12).join('')
          candidates = sourceLines.flatMap((value, line) => value.startsWith(prefix) ? [line] : [])
          locator = 'exact 12-character line-prefix candidate (diagnostic only)'
        }
        if (candidates.length === 1) {
          const line = candidates[0]!
          excerpts++
          hint = `; ${locator} at original line ${line + 1}; current text (up to 3 lines/400 characters):\n` +
            sourceLines.slice(line, line + 3).map((value, offset) => `${line + offset + 1}: ${value}`).join('\n').slice(0, 400)
        }
      }
      issues.push(`edits[${index}]: old_string matched ${matches} times; must match exactly once${hint}`)
      return []
    }
    return [{ index, start, end: start + edit.old_string.length, value: edit.new_string }]
  }).sort((a, b) => a.start - b.start)
  if (issues.length) throw Error(issues.join('; ') + '. Nothing saved. Indices are zero-based; matches use the original file.')
  for (let i = 1; i < replacements.length; i++) if (replacements[i]!.start < replacements[i - 1]!.end)
    throw Error(`edits[${replacements[i - 1]!.index}] and edits[${replacements[i]!.index}] overlap in the original file. Nothing saved.`)
  // Slice concatenation keeps replacement text literal, including $&, $1 and $`.
  let result = '', cursor = 0
  for (const edit of replacements) { result += text.slice(cursor, edit.start) + edit.value; cursor = edit.end }
  return { content: result + text.slice(cursor),
    summary: `Applied ${replacements.length} replacement(s); original lines: ${replacements.slice(0, 20).map(edit => lineAt(edit.start)).join(', ')}${replacements.length > 20 ? ', …' : ''}.` }
}

function toolFailureOutput(output: unknown, reason: string | undefined): unknown {
  if (!reason) return output
  if (output == null || output === '' || (Array.isArray(output) && !output.length)) return reason
  if (typeof output === 'string') return output.includes(reason) ? output : `${output}\n${reason}`
  return { result: output, error: reason }
}

function commandInput(item: RpcObject, prior?: RpcObject) {
  const cwd = item.cwd ?? prior?.cwd
  return { command: item.command ?? prior?.command, ...(typeof cwd === 'string' ? { cwd } : {}) }
}

export function createBgsRunner(options: ProviderNetworkOptions & { command?: readonly string[] } = {}): BeeGameSessionRunner {
  return { start: input => BgsRuntime.start(input, options) }
}

/** The native additionalContext renderer caps each value at 1,000 estimated
 * tokens (4,000 UTF-8 bytes). Frame long values here instead of losing their
 * middle. Keep line boundaries where possible and never split a code point. */
export function bgsApplicationContext(key: string, value?: string): Record<string, { value: string; kind: 'application' }> {
  if (!value) return {}
  const bytes = Buffer.from(value, 'utf8'), parts: string[] = []
  for (let start = 0; start < bytes.length;) {
    let end = Math.min(start + 4000, bytes.length)
    if (end < bytes.length) {
      while ((bytes[end]! & 0xc0) === 0x80) end--
      const newline = bytes.subarray(start, end).lastIndexOf(10)
      if (newline >= 0) end = start + newline + 1
    }
    parts.push(bytes.subarray(start, end).toString('utf8'))
    start = end
  }
  const width = String(parts.length).length
  return Object.fromEntries(parts.map((part, index) => [
    parts.length === 1 ? key : `${key}_part_${String(index + 1).padStart(width, '0')}_of_${parts.length}`,
    { value: part, kind: 'application' as const },
  ]))
}

export function bgsProviderConfig(env: Record<string, string>): Record<string, unknown> {
  if (env.BEEGAME_MODEL_TYPE && env.BEEGAME_MODEL_TYPE !== 'openai')
    throw Error('BGS requires an OpenAI Responses-compatible model connection')
  const model = env.BEEGAME_MODEL
  const custom = env.OPENAI_BASE_URL
  if (env.OPENAI_AUTH_MODE === 'chatgpt' && custom && !/^https:\/\/api\.openai\.com\/?(?:v1\/?)?$/.test(custom))
    throw Error('ChatGPT credentials cannot be sent to a custom model endpoint')
  return {
    ...(model ? { model } : {}),
    // BGS owns task scope and usage reporting. A second native goal
    // lifecycle would expose a different budget/time window to the Agent.
    'features.goals': false,
    // Unknown model slugs default to only 10,000 bytes. Use the native exec
    // token budget so ordinary Skill/contract reads survive that fallback;
    // oversized output and smaller per-call requests remain bounded by CLI.
    tool_output_token_limit: 10_000,
    ...(env.OPENAI_AUTH_MODE === 'chatgpt' ? {} : {
      // This provider has no native image_gen, and its shell has no API key for
      // the system skill's CLI fallback. Match by path to preserve user imports.
      ...(env.BGS_HOME ? { 'skills.config': [{
        path: join(env.BGS_HOME, 'skills', '.system', 'imagegen', 'SKILL.md'), enabled: false,
      }] } : {}),
      model_provider: 'bgs', model_providers: { bgs: { name: 'BGS model connection',
        base_url: custom || 'https://api.openai.com/v1', env_key: 'OPENAI_API_KEY',
        wire_api: 'responses', requires_openai_auth: false, supports_websockets: false, request_max_retries:0,stream_max_retries:0 } },
    }),
    shell_environment_policy: { inherit: 'none', set: Object.fromEntries(Object.entries(env)
      .filter(([key]) => !/KEY|TOKEN|SECRET|AUTH|BGS_HOME|CONFIG_DIR|MCP_SERVERS/.test(key))) },
  }
}

class BgsRuntime implements BeeGameSessionRuntime {
  readonly reusable = false
  private client!: BgsClient
  private threadId = ''
  private active?: { input: BeeGameSessionSubmitInput; turnId?: string; error?: RpcObject; resolve(): void; reject(error: Error): void }
  private stopped = false
  private messages = new Map<string, string>()
  private items = new Map<string, RpcObject>()
  private skills: RpcObject[] = []
  private childOwners = new Map<string, string>()
  private liveChildren = new Set<string>()
  private closing?: Promise<void>
  private bridge?: Awaited<ReturnType<typeof startProviderBridge>>
  private mcpClose?: () => Promise<void>

  private constructor(private input: BeeGameSessionRunnerStartInput,
    private access: Awaited<ReturnType<typeof projectExecutionAccess>>) {}

  static async start(input: BeeGameSessionRunnerStartInput, options:ProviderNetworkOptions & {command?:readonly string[]}) {
    if (!input.env.BEEGAME_CONFIG_DIR) throw Error('An owner-scoped BGS configuration directory is required')
    const access = await projectExecutionAccess({ workspacePath: input.cwd, sessionId: input.sessionId,
      environment: input.env })
    const runtime = new BgsRuntime(input, access)
    const home = resolve(bgsHomeDirectory(input.env.BEEGAME_CONFIG_DIR, input.env.BGS_HOME))
    await mkdir(home, { recursive: true, mode: 0o700 })
    const env: Record<string,string> = { ...getSafeRuntimeProcessEnvironment(), ...input.env, ...access.environment, BGS_HOME: home }
    try {
      const builtinSkills = await realpath(getBuiltinSkillsDirectory(input.env.BEEGAME_NATIVE_BUILTIN_SKILLS_DIR || undefined))
      const mcp = await prepareNativeMcpConfig(env, input.cwd, input.uiLayoutConstraints, input.sessionId, options)
      runtime.mcpClose = mcp.close
      delete env.BEEGAME_NATIVE_MCP_SERVERS_JSON
      const userSkills = join(input.env.BEEGAME_CONFIG_DIR, 'skills')
      const profile = access.config.permissions['bgs-project'].filesystem
      profile[builtinSkills] = 'read'
      profile[userSkills] = 'read'
      profile[join(home, 'skills')] = 'read'
      const instructions = [BEEGAME_USER_RESPONSE_SCOPE, input.language && responseLanguageInstruction(input.language),
        'Use WriteProjectFile or EditProjectFile for these host-protected paths relative to the project root: ' + JSON.stringify(access.protectedPaths.map(path => relative(access.root, path))) +
        '. Shell cannot modify these protected paths. For ordinary project files, use exec_command with project-local file operations. Only use apply_patch if it is listed as an available tool; do not assume a shell executable exists. Preserve the current user requirements and authorization when updating design records.', mcp.context,
        access.unavailable.length ? 'BGS host components unavailable: ' + access.unavailable.join('; ') +
          '. Unrelated work can continue; dependent inspections remain unavailable and unverified.' : '',
      ].filter(Boolean).join('\n\n')
      if(env.OPENAI_AUTH_MODE!=='chatgpt') {
        let incomplete = false
        const epoch='provider:'+randomUUID(),total={prompt_tokens:0,completion_tokens:0,cache_read_tokens:0,cache_creation_tokens:0,total_tokens:0}
        runtime.bridge=await startProviderBridge(env,{...options,sessionId:input.sessionId,onUsage:usage=>{
          total.prompt_tokens+=usage.input_tokens;total.completion_tokens+=usage.output_tokens
          total.cache_read_tokens+=usage.cache_read_tokens;total.cache_creation_tokens+=usage.cache_creation_tokens;total.total_tokens+=usage.total_tokens
          incomplete ||= usage.incomplete === true
          input.onNativeUsage?.({...total},epoch, { incomplete })
        }, onToolError: (callId, diagnostic) => runtime.emit('tool.failed', 'Unknown provider tool', {
          toolUseID: callId, toolName: 'Unknown provider tool', output: diagnostic, is_error: true,
        })})
        if(runtime.bridge) {
          // Provider secrets stay in the host, never in Bgs argv or its shell.
          for(const key of ['OPENAI_API_KEY','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','GEMINI_API_KEY','GROK_API_KEY'])delete env[key]
          Object.assign(env,{BEEGAME_MODEL_TYPE:'openai',BEEGAME_API_PROTOCOL:'responses',OPENAI_API_KEY:runtime.bridge.apiKey,OPENAI_BASE_URL:runtime.bridge.baseUrl})
        }
      }
      runtime.client = await BgsClient.connect({ command:options.command, cwd: access.root, env,
        config: { ...bgsProviderConfig(env), ...access.config, approval_policy: 'on-request',
          cli_auth_credentials_store: 'file',...(runtime.bridge && runtime.bridge.protocol !== 'responses'?{web_search:'disabled'}:{}) },
        onNotification: (method, params) => runtime.notification(method, params),
        onRequest: (method, params, requestId) => runtime.serverRequest(method, params, requestId),
        onExit: error => runtime.active?.reject(error),
      })
      await configureBgsSkills(runtime.client, home, builtinSkills, userSkills)
      const shared = { config: { ...mcp.config, ...await bgsReasoningConfig(input.env, runtime.client) }, cwd: access.root, permissions: 'bgs-project', approvalPolicy: 'on-request',
        developerInstructions: instructions, ...(env.BEEGAME_MODEL ? { model: env.BEEGAME_MODEL } : {}) }
      const result = input.resumeSessionId
        ? await runtime.client.request('thread/resume', { ...shared, threadId: input.resumeSessionId, excludeTurns: true })
        : await runtime.client.request('thread/start', { ...shared, dynamicTools: protectedWriteTools })
      if (typeof result.thread?.id !== 'string' || !result.thread.id) throw Error('BGS did not return a thread identity')
      runtime.threadId = result.thread.id
      input.onNativeSessionId?.(runtime.threadId)
      // Discover BGS catalogs without copying plugin metadata into game output.
      const skills = await runtime.client.request('skills/list', { cwds: [access.root], forceReload: true })
      runtime.skills = (skills.data ?? []).flatMap((entry:RpcObject) => entry.skills ?? [])
      if (skills.data?.some((entry:RpcObject) => entry.errors?.length))
        console.warn('[BGS skills] Some catalog entries are unavailable; required skills are checked on selection')
      return runtime
    } catch (error) {
      try { await runtime.client?.close() }
      finally { try { await runtime.bridge?.close() } finally { await runtime.mcpClose?.() } }
      throw error
    }
  }

  async submit(input: BeeGameSessionSubmitInput): Promise<void> {
    if (this.stopped) throw Error('BGS session is stopped')
    if (this.active) throw Error('BGS session already has an active turn')
    input.signal.throwIfAborted()
    let abort = () => {}
    try {
      await new Promise<void>((resolveTurn, reject) => {
        const turn = { input, turnId: undefined as string | undefined, resolve: resolveTurn, reject }
        this.active = turn
        abort = () => {
          if (this.active !== turn) return
          // Closing the isolated process group stops commands and child agents;
          // interruption acknowledgement alone is not process-cleanup evidence.
          this.stopped = true
          void this.client.close().then(() => reject(Error('BGS turn interrupted')), reject)
        }
        input.signal.addEventListener('abort', abort, { once: true })
        const prompt: RpcObject[] = typeof input.prompt === 'string' ? [{ type: 'text', text: input.prompt }]
          : input.prompt.map(block => block.type === 'text' ? block : { type: 'image',
            url: `data:${block.source.media_type};base64,${block.source.data}` })
        const text = prompt.findLast(block => block.type === 'text')?.text
        const name = typeof text === 'string' ? /^\$([A-Za-z0-9_-]+)\b/.exec(text)?.[1] : undefined
        if (name) {
          const skill = this.skills.find(skill => skill.name === name && skill.enabled && typeof skill.path === 'string')
          if (!skill) { reject(Error('Required BGS skill is unavailable: ' + name)); return }
          prompt.unshift({type:'skill',name,path:skill.path})
        }
        // thread/resume does not replace instructions already in model history.
        // Workflow context contains current bridge paths, authorization and host
        // evidence, so deliver it in the existing per-turn application slot.
        const additionalContext = {
          ...bgsApplicationContext('bgsRuntime', this.input.systemContext),
          ...bgsApplicationContext('bgsConfirmedBrief', input.confirmedBriefContext),
        }
        void this.client.request('turn/start', { threadId: this.threadId, input: prompt,
          ...(Object.keys(additionalContext).length ? { additionalContext } : {}) })
          .then(result => {
            if (this.active !== turn) return
            if (typeof result.turn?.id !== 'string') throw Error('BGS did not acknowledge a turn identity')
            turn.turnId = result.turn.id
            this.input.onNativeSubmission?.(this.threadId)
            if (input.signal.aborted) abort()
          }).catch(reject)
      })
    } finally {
      input.signal.removeEventListener('abort', abort)
      this.active = undefined
      await this.dispose()
    }
  }

  stop(): void { this.stopped = true; void this.dispose() }
  dispose(): Promise<void> {
    return this.closing ??= (async () => {
      this.stopped = true
      try {
        if (this.client.connected) await this.client.request('thread/backgroundTerminals/clean', { threadId: this.threadId }, 5000)
      } finally {
        try { await this.client.close() }
        finally {
          try { await this.bridge?.close() }
          finally { try { await this.mcpClose?.() } finally { await closeSessionTestBrowsers(this.access.temporary) } }
        }
      }
    })()
  }

  private async emit(eventType: BeeGameEventType, text = '', payload: RpcObject = {}) {
    await this.active?.input.onMessage({ type: 'runtime_event', eventType, text,
      ...payload, runtime: 'bgs', threadId: this.threadId })
  }

  private async notification(method: string, p: RpcObject) {
    if (method === 'thread/tokenUsage/updated') {
      if(this.bridge && this.bridge.protocol !== 'responses')return // Converted provider usage includes cache writes Bgs does not expose.
      const total = p.tokenUsage?.total
      if (total && typeof p.threadId === 'string') this.input.onNativeUsage?.(bgsUsage(total), 'bgs:' + p.threadId)
      return
    }
    if (p.threadId && p.threadId !== this.threadId && !this.childOwners.has(p.threadId)) return
    const turn = this.active
    if (!turn || turn.input.signal.aborted || (turn.turnId && p.turnId && p.turnId !== turn.turnId && p.threadId === this.threadId)) return
    const owner = this.childOwners.get(p.threadId)
    const identity = (id: string) => ({ messageId: id, assistantBlockId: id, ...(owner ? { parentToolUseID: owner } : {}) })
    if (method === 'item/agentMessage/delta') {
      this.messages.set(p.itemId, (this.messages.get(p.itemId) || '') + p.delta)
      await this.emit('assistant.partial', p.delta, identity(p.itemId))
    } else if (method === 'item/reasoning/summaryTextDelta') {
      await this.emit('assistant.thinking', p.delta, identity(p.itemId))
    } else if (method === 'item/started' || method === 'item/completed') {
      const item = p.item as RpcObject
      if (!item || typeof item.id !== 'string') throw Error('Invalid BGS item')
      const complete = method === 'item/completed'
      const prior = this.items.get(item.id)
      if (['commandExecution', 'fileChange'].includes(item.type) && !complete) this.items.set(item.id, item)
      else if (complete) this.items.delete(item.id)
      if (item.type === 'agentMessage' && complete) {
        const streamed = this.messages.get(item.id) || ''
        const remaining = item.text.startsWith(streamed) ? item.text.slice(streamed.length) : item.text
        if (remaining) await this.emit('assistant.message', remaining, identity(item.id))
        this.messages.delete(item.id)
      } else if (item.type === 'contextCompaction') {
        await this.emit('system.status', complete ? 'Context compacted' : 'Compacting context', {
          subtype: complete ? 'compact_boundary' : 'status', status: complete ? 'compacted' : 'compacting',
        })
      } else if (item.type === 'collabAgentToolCall') {
        for (const child of item.receiverThreadIds ?? []) {
          if (item.tool === 'spawnAgent' || !this.childOwners.has(child)) this.childOwners.set(child, item.id)
          const status = item.agentsStates?.[child]?.status
          if (status && ['completed','errored','shutdown','interrupted','notFound'].includes(status)) this.liveChildren.delete(child)
          else if (item.tool === 'spawnAgent' || item.tool === 'resumeAgent') this.liveChildren.add(child)
          await this.emit('system.status', 'BGS child ' + (status || 'pendingInit'), {childThreadId:child,childStatus:status || 'pendingInit',parentToolUseID:this.childOwners.get(child)})
        }
        await this.emit(complete ? 'tool.completed' : 'tool.started', item.tool, {
          toolUseID: item.id, toolName: 'Agent', input: { prompt: item.prompt, model: item.model },
          output: complete ? item.agentsStates : undefined, is_error: item.status === 'failed',
          ...(owner ? { parentToolUseID: owner } : {}) })
      } else if (['commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall', 'webSearch', 'imageView'].includes(item.type)) {
        const reason = typeof item.error === 'string' ? item.error : item.error?.message ?? prior?.bgsDenialReason ??
          (item.status === 'declined' ? 'Native tool approval was declined; no detailed reason was supplied.' : undefined)
        const tools = item.type === 'webSearch' ? [webSearchTool(item, complete)] : item.type === 'fileChange' ? item.changes.map((change: RpcObject, i: number) => ({
          toolUseID: item.id + ':' + i, toolName: 'Edit', input: { file_path: change.path }, diff: change.diff, output: toolFailureOutput(change.diff, reason) })) : [{
          toolUseID: item.id, toolName: item.type === 'commandExecution' ? 'Shell' : item.tool || item.type,
          input: item.type === 'commandExecution' ? commandInput(item, prior) : item.arguments || { command: item.command, path: item.path },
          output: toolFailureOutput(item.aggregatedOutput ?? item.result ?? item.contentItems ?? prior?.aggregatedOutput, reason),
          ...(item.type === 'commandExecution' ? {
            ...(Number.isInteger(item.exitCode) ? { exitCode: item.exitCode } : {}),
            ...(typeof item.durationMs === 'number' && Number.isFinite(item.durationMs) && item.durationMs >= 0 ? { durationMs: item.durationMs } : {}),
          } : {}),
          ...(item.type === 'imageView' ? { imagePath: item.path } : {}) }]
        const failed = ['failed', 'declined'].includes(item.status) || Boolean(item.error) ||
          (item.type === 'commandExecution' && Number.isInteger(item.exitCode) && item.exitCode !== 0)
        for (const tool of tools) await this.emit(complete ? failed ? 'tool.failed' : 'tool.completed' : 'tool.started', tool.toolName, {
          ...tool, ...(owner ? { parentToolUseID: owner } : {}), is_error: failed })
      }
    } else if (method === 'item/commandExecution/outputDelta') {
      const item = this.items.get(p.itemId)
      const output = item?.type === 'commandExecution' && typeof p.delta === 'string'
        ? (item.aggregatedOutput || '') + p.delta : p.delta
      if (item?.type === 'commandExecution') this.items.set(p.itemId, { ...item, aggregatedOutput: output })
      await this.emit('tool.progress', p.delta, { toolUseID: p.itemId, toolName: 'Shell', output,
        ...(item?.type === 'commandExecution' ? { input: commandInput(item) } : {}),
        ...(owner ? { parentToolUseID: owner } : {}) })
    } else if (method === 'error') {
      // Retryable upstream events are observations; only turn/completed is terminal.
      if (!owner) turn.error = p.error
      await this.emit('system.status', typeof p.error?.message === 'string' ? p.error.message : 'BGS reported an upstream error', {
        willRetry: p.willRetry === true, bgsErrorInfo: p.error?.bgsErrorInfo,
        ...(owner ? { parentToolUseID: owner } : {}) })
    } else if (method === 'turn/completed' && p.threadId !== this.threadId) {
      this.liveChildren.delete(p.threadId)
      await this.emit('system.status', 'BGS child finished', {childThreadId:p.threadId,childStatus:p.turn?.status === 'completed' ? 'completed' : 'errored',parentToolUseID:owner})
    } else if (method === 'turn/completed' && p.threadId === this.threadId) {
      if (this.liveChildren.size) turn.reject(Error('BGS ended the parent turn with unfinished child work'))
      else if (p.turn?.status === 'completed') turn.resolve()
      else {
        const error = p.turn?.error ?? turn.error
        const message = p.turn?.status === 'interrupted' ? 'BGS turn interrupted'
          : typeof error?.message === 'string' && error.message.trim() ? error.message : 'BGS turn failed'
        turn.reject(Object.assign(Error(message), { bgsErrorInfo: error?.bgsErrorInfo }))
      }
    }
  }

  private async permission(request: DashboardPermissionRequest) {
    return await this.input.toolPolicy?.(request) ?? await (this.input.requestPermission ?? this.active?.input.requestPermission)?.(request)
      ?? { behavior: 'deny' as const, message: 'Permission authority is unavailable' }
  }

  private async serverRequest(method: string, p: RpcObject, requestId?: string | number): Promise<unknown> {
    const active = this.active
    const current = () => active !== undefined && this.active === active && !active.input.signal.aborted && !this.stopped &&
      (!p.threadId || p.threadId === this.threadId || this.childOwners.has(p.threadId)) &&
      (!p.turnId || !active.turnId || p.threadId !== this.threadId || p.turnId === active.turnId)
    if (!current()) throw Error('No active BGS turn')
    if (method === 'item/tool/call' && ['WriteProjectFile', 'EditProjectFile'].includes(p.tool)) {
      try {
        const args = p.arguments
        if (!args || typeof args.file_path !== 'string') throw Error('file_path is required')
        const path = resolve(this.access.root, args.file_path)
        if (!inside(this.access.root, path)) throw Error('Path is outside the project workspace. Check file_path; use a project-relative path inside the current project.')
        if (!this.access.protectedPaths.includes(path)) throw Error('Path is not a BGS protected design record or AGENTS.md. Check file_path for typos. For an intentional ordinary project file, use exec_command with project-local file operations. This rejection does not deny ordinary workspace writes.')
        const request = { toolUseID: p.callId, toolName: p.tool === 'WriteProjectFile' ? 'Write' : 'Edit', input: args,
          message: 'Change a BGS protected project file' }
        const decision = await this.permission(request)
        if (!current()) throw Error('Turn ended before file authorization')
        if (decision.behavior !== 'allow') throw Error(decision.message || 'BGS rejected this file change')
        // Finish the file operation synchronously after the last live authority
        // check so cancellation cannot release the writer mid-write.
        const recheck = path === resolve(this.access.root, 'AGENTS.md') ? decision : await this.permission({ ...request, phase: 'recheck' })
        if (recheck.behavior !== 'allow') throw Error(recheck.message || 'File authorization changed')
        if (!current()) throw Error('File authorization changed')
        let ancestor = dirname(path)
        while (true) {
          let canonical: string | undefined
          try { canonical = realpathSync(ancestor) }
          catch (error) { if((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
          if (canonical) {
            if (canonical !== ancestor || !inside(this.access.root, canonical)) throw Error('Protected path contains an alias')
            break
          }
          ancestor = dirname(ancestor)
        }
        mkdirSync(dirname(path), {recursive:true})
        if (realpathSync(dirname(path)) !== dirname(path)) throw Error('Protected path contains an alias')
        try { if (realpathSync(path) !== path) throw Error('Protected file must not be a symlink') }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
        let content: string, summary: string
        if (p.tool === 'WriteProjectFile') {
          if (typeof args.content !== 'string') throw Error('content is required')
          content = args.content
          summary = `Wrote ${content.length} characters.`
        } else {
          const edit = prepareProtectedFileEdit(readFileSync(path, 'utf8'), args)
          content = edit.content
          summary = edit.summary
        }
        const temporary = path + '.' + randomUUID() + '.tmp'
        try { writeFileSync(temporary, content, {flag:'wx',mode:0o600}); renameSync(temporary, path) }
        finally { rmSync(temporary, {force:true}) }
        return { contentItems: [{ type: 'inputText', text: `File saved: ${relative(this.access.root, path)}. ${summary}` }], success: true }
      } catch (error) {
        return { contentItems: [{ type: 'inputText', text: `${typeof p.arguments?.file_path === 'string' ? p.arguments.file_path + ': ' : ''}${error instanceof Error ? error.message : 'File change failed'}` }], success: false }
      }
    }
    if (method === 'item/tool/call' && p.tool === 'AskUserQuestion') {
      const decision = await this.permission({ toolUseID: p.callId, toolName: 'AskUserQuestion', input: p.arguments, message: 'BGS needs your answer' })
      if (!current() || decision.behavior !== 'allow') return { contentItems: [{type:'inputText',text:'Question cancelled'}], success:false }
      return { contentItems: [{type:'inputText',text:JSON.stringify(decision.updatedInput?.answers ?? {})}], success:true }
    }
    if (method === 'item/tool/requestUserInput') {
      const questions = p.questions.map((q: RpcObject) => ({ question: q.question, header: q.header,
        options: q.options ?? [], multiSelect: false }))
      const decision = await this.permission({ toolUseID: p.itemId, toolName: 'AskUserQuestion',
        input: { questions }, message: 'BGS needs your answer' })
      if (!current() || decision.behavior !== 'allow') throw Error('Question cancelled')
      const answers = decision.updatedInput?.answers as Record<string, string> | undefined
      if (!answers || p.questions.some((q: RpcObject) => typeof answers[q.question] !== 'string')) throw Error('Question has no complete answer')
      return { answers: Object.fromEntries(p.questions.map((q: RpcObject) => [q.id, { answers: [answers[q.question]] }])) }
    }
    if (['item/commandExecution/requestApproval', 'item/permissions/requestApproval', 'item/fileChange/requestApproval'].includes(method))
      return bgsApproval(method, p, { root: this.access.root,
        networkEnabled: this.access.config.permissions['bgs-project'].network.enabled,
        filesystem: this.access.config.permissions['bgs-project'].filesystem, items: this.items, current,
        onDenied: reason => {
          const item = this.items.get(p.itemId)
          if (item) this.items.set(p.itemId, { ...item, bgsDenialReason: reason })
        },
        permission: request => this.permission(request) })
    if (method === 'mcpServer/elicitation/request') {
      if (!['form', 'url'].includes(p.mode)) return { action: 'cancel', content: null }
      if (p.mode === 'url') {
        let url: URL
        try { url = new URL(p.url) } catch { return { action: 'cancel', content: null } }
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return { action: 'cancel', content: null }
      }
      const decision = await this.permission({ toolUseID: 'mcp:' + this.threadId + ':' + requestId,
        toolName: 'McpElicitation', message: p.message, input: { serverName: p.serverName, mode: p.mode,
          message: p.message, ...(p.mode === 'url' ? { url: p.url } : { requestedSchema: p.requestedSchema }) } })
      if (!current()) return { action: 'cancel', content: null }
      if (decision.behavior !== 'allow') return { action: 'decline', content: null }
      const response = elicitationAnswer(p, { content: JSON.stringify(decision.updatedInput?.content) })
      return { action: 'accept', content: response.content }
    }
    throw Error('Unsupported BGS server request')
  }
}

function inside(root: string, path: string) {
  const rel = relative(root, path)
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep)
}

export function bgsUsage(total: RpcObject) {
  for (const key of ['inputTokens', 'outputTokens', 'cachedInputTokens'])
    if (!Number.isSafeInteger(total[key]) || total[key] < 0) throw Error('Invalid BGS usage')
  const cacheWrite = total.cacheWriteInputTokens ?? 0
  if (!Number.isSafeInteger(cacheWrite) || cacheWrite < 0 || total.cachedInputTokens + cacheWrite > total.inputTokens) throw Error('Invalid BGS cache usage')
  return { prompt_tokens: total.inputTokens - total.cachedInputTokens - cacheWrite,
    completion_tokens: total.outputTokens, cache_read_tokens: total.cachedInputTokens,
    cache_creation_tokens: cacheWrite, total_tokens: total.inputTokens + total.outputTokens }
}
