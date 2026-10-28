import { bgsHomeDirectory } from './home'
import { loadBgsModelCatalog } from './model-catalog'
import { mkdir, realpath } from 'node:fs/promises'
import { mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, join, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import {startProviderBridge,type ProviderNetworkOptions} from '../model-providers/bridge'
import { BgsClient, type RpcObject } from './client'
import type { DynamicToolSpec } from './native-protocol'
import { bgsApproval, elicitationAnswer, webSearchTool } from './interactions'
import { bgsReasoningConfig } from './preferences'
import { configureBgsSkills } from './skills'
import type { BeeGameSessionRunner, BeeGameSessionRunnerStartInput, BeeGameSessionRuntime,
  BeeGameSessionSubmitInput, BeeGameNativeGoalInput, BeeGameEventType, DashboardPermissionRequest } from '../beegame/session-manager'
import { getSafeRuntimeProcessEnvironment } from '../beegame/runtime-process-environment'
import { projectExecutionAccess } from '../beegame/project-execution-access'
import { prepareNativeMcpConfig } from '../beegame/native-mcp-config'
import { closeSessionTestBrowsers } from '../beegame/native-test-browser-cleanup'
import { responseLanguageInstruction } from '../beegame/response-language'
import { BEEGAME_USER_RESPONSE_SCOPE } from '../beegame/user-response-scope'
import { getBuiltinSkillsDirectory } from '@bee-game-studio/beegame-skills-core/store'
import { DESIGN_REVIEW_INSTRUCTIONS, assertDesignReviewCoverage, parseDesignReview } from '../beegame/workflow-v3/design-review'

const protectedWriteTools: DynamicToolSpec[] = ['WriteProjectFile', 'EditProjectFile'].map(name => ({ type: 'function', name,
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

const workflowTool: DynamicToolSpec = { type: 'function', name: 'BgsWorkflow',
  description: 'Read the current BGS assignment (status), hand off completed preparatory work (advance), or enter implementation authorized by the current user request (implement). For handoffs provide a summary, exact existing GDD headings in sections, and actual project-relative files. Follow the current assignment. GDD document tasks follow their current final-result contract and do not use this handoff. After a successful handoff, end this native turn; BGS checks source identity after cleanup and continues in the same conversation. This records author-declared readiness, not quality certification.',
  inputSchema: { type: 'object', properties: {
    action: { type: 'string', enum: ['status', 'advance', 'implement'] }, summary: { type: 'string' },
    sections: { type: 'array', items: { type: 'string' } }, files: { type: 'array', items: { type: 'string' } },
  }, required: ['action'], additionalProperties: false },
}

const measurementTool: DynamicToolSpec = { type: 'function', name: 'BgsMeasurement',
  description: 'Run the existing optional static-Web build and selected browser probes, or read saved evidence without rerunning. Choose one operation: requestKey + runtimeArtifact (+ finalized reportPaths, consumption); inspectRequestKey (+ details); handoffPaths (+ details); executionInputs:true; designAction (+ documents, details); or help:true for the full probe contract. Measurement is not a gameplay/visual acceptance verdict and does not submit delivery. Reusing a request key reads the same immutable receipt, never rebuilds.',
  inputSchema: { type: 'object', properties: {
    requestKey: { type: 'string' }, runtimeArtifact: { type: 'string' }, reportPaths: { type: 'array', items: { type: 'string' } },
    consumption: { type: 'object', description: 'Existing checks and per-check probes. Read help:true for field contracts.', additionalProperties: true },
    inspectRequestKey: { type: 'string' }, details: { type: 'boolean' },
    handoffPaths: { type: 'array', items: { type: 'string' } }, executionInputs: { type: 'boolean', enum: [true] },
    designAction: { type: 'string' }, documents: { type: 'array', items: { type: 'string' } }, help: { type: 'boolean', enum: [true] },
  }, oneOf: [{required:['requestKey','runtimeArtifact']}, {required:['inspectRequestKey']}, {required:['handoffPaths']},
    {required:['executionInputs']}, {required:['designAction']}, {required:['help']}], additionalProperties: false },
}
const finishDeliveryTool: DynamicToolSpec = { type: 'function', name: 'BgsFinishDelivery',
  description: 'Terminal submission of the existing finalized .beegame/delivery/acceptance.json for this authorized implementation task. All other tools and child work must have finished. Validates current requirements, source identity and saved measurement/execution evidence; runs no tests or model summary. A valid passed report completes the Goal. An explicit delivery-scoped blocked/failed report ends the Goal as blocked without requiring a successful build/test; retain the blocker, remaining work and needed external action in the report. Either accepted outcome closes this native connection, including this tool call. Host cleanup and source recheck decide delivery, not a normal tool response. Validation failures reject the submission.',
  inputSchema: { type: 'object', properties: { requirementsRevision: { type: 'string' }, measurementId: { type: 'string' } },
    required: ['requirementsRevision'], additionalProperties: false },
}

// Delivery may leave only its bound native submission tool, or the legacy
// helper command, in flight. Other unfinished tools still block completion.
const trackedNativeToolTypes = new Set(['commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall', 'webSearch', 'imageView'])

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

/** Recognize only literal simple commands, optionally inside a native sh/bash/zsh
 * -c/-lc wrapper. Unknown syntax stays an error; this is not a shell interpreter.
 * Native Search summaries alone are insufficient because they omit pipelines. */
export function nativeRgNoMatch(item: RpcObject): boolean {
  if (item.type !== 'commandExecution' || item.exitCode !== 1 || item.error ||
      !['completed', 'failed'].includes(item.status) ||
      (item.aggregatedOutput != null && item.aggregatedOutput !== '')) return false
  const words = (source: unknown): string[] | undefined => {
    if (typeof source !== 'string' || /[\r\n]/.test(source)) return
    const token = /(?:'[^']*'|"[^"$`\\]*"|[^\s'"\\$`;&|<>(){}\[\]*?!#~])+/y
    const result: string[] = []
    let at = 0
    while (at < source.length) {
      while (/[ \t]/.test(source[at] ?? '') && at < source.length) at++
      if (at === source.length) break
      token.lastIndex = at
      const match = token.exec(source)
      if (!match) return
      result.push(match[0].replace(/'([^']*)'|"([^"$`\\]*)"/g, (_all, single, double) => single ?? double))
      at = token.lastIndex
      if (at < source.length && !/[ \t]/.test(source[at]!)) return
    }
    return result
  }
  let argv = words(item.command)
  if (argv?.length === 3 && /^(?:.*\/)?(?:sh|bash|zsh)$/.test(argv[0]!) && ['-c', '-lc'].includes(argv[1]!))
    argv = words(argv[2])
  return Boolean(argv && argv.length > 1 && /^(?:.*\/)?rg$/.test(argv[0]!))
}

/** Reuse native read metadata and the discovered catalog; never parse shell text
 * or reread files to reconstruct past access. Unknown commands/aliases stay unknown. */
export function nativeSkillReadTargets(actions: unknown, skills: RpcObject[]): Array<{name:string;path:string}> {
  const reads = new Map<string, {name:string;path:string}>()
  for (const action of Array.isArray(actions) ? actions : []) {
    if (action?.type !== 'read' || typeof action.path !== 'string' || !isAbsolute(action.path)) continue
    const path = resolve(action.path)
    for (const skill of skills) {
      if (!skill.enabled || typeof skill.name !== 'string' || typeof skill.path !== 'string' || !isAbsolute(skill.path)) continue
      const entry = resolve(skill.path)
      if (path === entry || path.startsWith(join(dirname(entry), 'references') + sep))
        reads.set(skill.name + ':' + path, {name:skill.name,path})
    }
  }
  return [...reads.values()]
}

export function createBgsRunner(options: ProviderNetworkOptions & { command?: readonly string[] } = {}): BeeGameSessionRunner {
  return { start: input => BgsRuntime.start(input, options) }
}

/** The native additionalContext renderer caps each value at 1,000 estimated
 * tokens (4,000 UTF-8 bytes). Frame long values here instead of losing their
 * middle. Stable part keys let native deduplication reuse unchanged prefixes;
 * a separate count retires old tails when the value shrinks. Keep the complete
 * current frame in thread instructions too, so compaction needs no host cache. */
export function bgsApplicationContext(key: string, value?: string): Record<string, { value: string; kind: 'application' }> {
  if (value === undefined) return {}
  const bytes = Buffer.from(value, 'utf8'), parts: string[] = []
  for (let start = 0; start < bytes.length;) {
    let end = Math.min(start + 4000, bytes.length)
    if (end < bytes.length) while ((bytes[end]! & 0xc0) === 0x80) end--
    // A full last window uses the same line boundary after append.
    if (end < bytes.length || end - start === 4000) {
      const newline = bytes.subarray(start, end).lastIndexOf(10)
      if (newline >= 0) end = start + newline + 1
    }
    parts.push(bytes.subarray(start, end).toString('utf8'))
    start = end
  }
  const count = {
    value: `Current part count: ${parts.length}. Concatenate the latest ${key}_part_XXXXXX entries numbered 1 through this count in numeric order, without separators. Ignore extra parts and prior scalar/count-suffixed versions. Zero parts means an empty value.`,
    kind: 'application' as const,
  }
  return Object.fromEntries([
    [key, count],
    ...parts.map((part, index) => [
      `${key}_part_${String(index + 1).padStart(6, '0')}`,
      { value: part, kind: 'application' as const },
    ]),
  ])
}

// Preparation guidance belongs in the native instruction baseline. Cold
// resume also refreshes old history; fresh turns need no second copy.
function preparationContext(systemContext: string | undefined, finalOutput: BeeGameSessionSubmitInput['finalOutput']) {
  return finalOutput ? [systemContext,
    'For this preparation task, end with one JSON object matching the schema below, without Markdown fences or surrounding prose. BGS validates the final result locally before accepting it.\n' +
    JSON.stringify(finalOutput.schema),
  ].filter(Boolean).join('\n\n') : systemContext
}

export function bgsProviderConfig(env: Record<string, string>, options: { goals?: boolean; modelCatalogUrl?: string } = {}): Record<string, unknown> {
  if (env.BEEGAME_MODEL_TYPE && env.BEEGAME_MODEL_TYPE !== 'openai')
    throw Error('BGS requires an OpenAI Responses-compatible model connection')
  const model = env.BEEGAME_MODEL
  const custom = env.OPENAI_BASE_URL
  if (env.OPENAI_AUTH_MODE === 'chatgpt' && custom && !/^https:\/\/api\.openai\.com\/?(?:v1\/?)?$/.test(custom))
    throw Error('ChatGPT credentials cannot be sent to a custom model endpoint')
  return {
    ...(model ? { model } : {}),
    // Ordinary BGS messages keep persisted goals dormant. A native-goal
    // runtime opts into Codex's own continuation/accounting lifecycle.
    'features.goals': options.goals === true,
    // Reuse the native child budget: two spawned agents (V2 adds the parent).
    // This does not enable disabled agent tools or select a cheaper child model.
    'agents.max_concurrent_threads_per_session': 2,
    // Unknown model slugs default to only 10,000 bytes. Use the native exec
    // token budget so ordinary Skill/contract reads survive that fallback;
    // oversized output and smaller per-call requests remain bounded by CLI.
    tool_output_token_limit: 10_000,
    // The BGS ImageGen skill covers native ChatGPT and hosted API images.
    // Replace only system guidance; preserve the native tool and user imports.
    ...(env.BGS_HOME ? { 'skills.config': [{
      path: join(env.BGS_HOME, 'skills', '.system', 'imagegen', 'SKILL.md'), enabled: false,
    }] } : {}),
    ...(env.OPENAI_AUTH_MODE === 'chatgpt' ? {} : {
      model_provider: 'bgs', model_providers: { bgs: { name: 'BGS model connection',
        base_url: custom || 'https://api.openai.com/v1', env_key: 'OPENAI_API_KEY',
        ...(options.modelCatalogUrl ? { model_catalog_url: options.modelCatalogUrl } : {}),
        wire_api: 'responses', requires_openai_auth: false, supports_websockets: false } },
    }),
    shell_environment_policy: { inherit: 'none', set: Object.fromEntries(Object.entries(env)
      .filter(([key]) => !/KEY|TOKEN|SECRET|AUTH|BGS_HOME|CONFIG_DIR|MCP_SERVERS/.test(key))) },
  }
}

/** Convert the host assignment into a raw Responses user item. Native Goal
 * activation supplies the actual continuation turn; a turn/start request
 * would race that lifecycle and create a second logical turn. */
function nativeGoalInputItems(prompt: RpcObject[], refreshedContext?: Record<string, string>, recovery = false): RpcObject[] {
  const contextItems = Object.entries(refreshedContext ?? {}).flatMap(([key, value]): RpcObject[] => [
    { type: 'message', role: 'developer', content: [{ type: 'input_text', text: `<${key}>${value}</${key}>` }] },
  ])
  const content: RpcObject[] = prompt.flatMap((block): RpcObject[] => {
    if (block.type === 'text' && typeof block.text === 'string')
      return [{ type: 'input_text', text: block.text }]
    if (block.type === 'image' && typeof block.url === 'string')
      return [{ type: 'input_image', image_url: block.url }]
    // Structured skill inputs are not Responses history items. The literal
    // user text remains in this message, so native skill mention selection
    // still has the same source text to inspect.
    return []
  })
  if (!content.length) {
    if (recovery) return contextItems
    throw Error('BGS native Goal assignment has no user content')
  }
  return [...contextItems, { type: 'message', role: 'user', content }]
}

class BgsRuntime implements BeeGameSessionRuntime {
  readonly reusable = false
  private client!: BgsClient
  private threadId = ''
  private resumingThread = false
  private deferredResume = false
  private shared?: RpcObject
  private nativeGoal?: BeeGameNativeGoalInput
  private active?: { input: BeeGameSessionSubmitInput; turnId?: string; error?: RpcObject; nativeGoal?: BeeGameNativeGoalInput; goalArmed?: boolean; nativeSubmitted?: boolean; nativeGoalStatus?: string; nativeTurnStarted?: boolean; nativeTurnCompleted?: boolean; nativeLastTurnId?: string; controlledFinish?: boolean; finalOutputText?: string; finalOutputId?: string; resolve(): void; reject(error: Error): void }
  private deliveryTool?: { callId: string; turnId: string; signal: AbortSignal }
  private stopped = false
  private messages = new Map<string, string>()
  private items = new Map<string, RpcObject>()
  private skills: RpcObject[] = []
  private childOwners = new Map<string, string>()
  private liveChildren = new Set<string>()
  private childTurns = new Map<string, { id?: string; endedIds: Set<string> }>()
  private designReviewer?: { threadId: string; rounds: number; findingCount: number }
  private pendingDesignReview?: { text?: string; resolve(value: { text: string; turnId: string }): void; reject(error: Error): void }
  private closing?: Promise<void>
  private bridge?: Awaited<ReturnType<typeof startProviderBridge>>
  private mcpClose?: () => Promise<void>

  private constructor(private input: BeeGameSessionRunnerStartInput,
    private access: Awaited<ReturnType<typeof projectExecutionAccess>>) {}

  static async start(input: BeeGameSessionRunnerStartInput, options:ProviderNetworkOptions & {command?:readonly string[]}) {
    if (!input.env.BEEGAME_CONFIG_DIR) throw Error('An owner-scoped BGS configuration directory is required')
    if (input.finalOutput?.designReview && (!input.finalOutput.readOnly || !input.confirmedBriefContext))
      throw Error('Independent design review requires read-only project access and confirmed requirements')
    if (input.nativeGoal?.mode === 'resume' && !input.resumeSessionId)
      throw Error('BGS native Goal resume requires a saved native session')
    const access = await projectExecutionAccess({ workspacePath: input.cwd, sessionId: input.sessionId,
      environment: input.env, readOnly: input.finalOutput?.readOnly })
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
        input.finalOutput?.readOnly ? (input.finalOutput.writeDocument
          ? 'Shell cannot modify project files. The current parent may maintain only ' + input.finalOutput.writeDocument.path + ' with WriteProjectFile/EditProjectFile through current task authority. This working document may remain after interruption; final readiness is a separate source-bound handoff. Return only the required status and summary, not the document body.'
          : 'Project files are read-only for this document task.') : 'Use WriteProjectFile or EditProjectFile for these host-protected paths relative to the project root: ' + JSON.stringify(access.protectedPaths.map(path => relative(access.root, path))) +
        '. Shell cannot modify these protected paths. For ordinary project files, use exec_command with project-local file operations. Only use apply_patch if it is listed as an available tool; do not assume a shell executable exists. Preserve the current user requirements and authorization when updating design records.', mcp.context,
        access.unavailable.length ? 'BGS host components unavailable: ' + access.unavailable.join('; ') +
          '. Unrelated work can continue; dependent inspections remain unavailable and unverified.' : '',
        // Local compaction reconstructs thread instructions but drops the
        // per-turn additionalContext messages. Retain the same current host
        // facts here; no summary, extra rules or model request is needed.
        ...Object.entries({
          ...bgsApplicationContext('bgsRuntime', preparationContext(input.systemContext, input.finalOutput)),
          ...bgsApplicationContext('bgsConfirmedBrief', input.confirmedBriefContext),
        }).map(([key, { value }]) => `<${key}>${value}</${key}>`),
      ].filter(Boolean).join('\n\n')
      if(env.OPENAI_AUTH_MODE!=='chatgpt') {
        let incomplete = false
        const epoch='provider:'+randomUUID(),total={prompt_tokens:0,completion_tokens:0,cache_read_tokens:0,cache_creation_tokens:0,total_tokens:0}
        const modelCatalog = await loadBgsModelCatalog({cwd:access.root,env,command:options.command})
        runtime.bridge=await startProviderBridge(env,{...options,modelCatalog,sessionId:input.sessionId,onUsage:usage=>{
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
        config: { ...bgsProviderConfig(env, { goals: Boolean(input.nativeGoal), modelCatalogUrl: runtime.bridge?.modelCatalogUrl }), ...access.config, approval_policy: 'on-request',
          cli_auth_credentials_store: 'file',...(runtime.bridge && runtime.bridge.protocol !== 'responses'?{web_search:'disabled'}:{}) },
        onNotification: (method, params) => runtime.notification(method, params),
        onRequest: (method, params, requestId, signal) => runtime.serverRequest(method, params, requestId, signal),
        onExit: error => {
          const active = runtime.active
          runtime.pendingDesignReview?.reject(error)
          if (!active?.controlledFinish) active?.reject(error)
        },
      })
      await configureBgsSkills(runtime.client, home, builtinSkills, userSkills)
      const shared = { config: { ...mcp.config, ...await bgsReasoningConfig(input.env, runtime.client) }, cwd: access.root, permissions: 'bgs-project', approvalPolicy: 'on-request',
        developerInstructions: instructions, ...(env.BEEGAME_MODEL ? { model: env.BEEGAME_MODEL } : {}) }
      runtime.nativeGoal = input.nativeGoal
      runtime.shared = shared
      // Use native history hydration to receive restored usage on cold resume.
      // Metadata-only resume intentionally omits that replay for legacy histories.
      runtime.resumingThread = Boolean(input.resumeSessionId)
      // A native Goal on an existing thread resumes on thread/resume and may
      // immediately launch its idle continuation. Defer that resume until
      // submit() has paused the old Goal and can inject the current assignment.
      runtime.deferredResume = Boolean(input.nativeGoal && input.resumeSessionId)
      const result = runtime.deferredResume
        ? { thread: { id: input.resumeSessionId } }
        : input.resumeSessionId
          ? await runtime.client.request('thread/resume', { ...shared, threadId: input.resumeSessionId, excludeTurns: false })
          : await runtime.client.request('thread/start', { ...shared, dynamicTools: [...protectedWriteTools, ...(input.workflow ? [workflowTool] : []),
            ...(input.measurement ? [measurementTool] : []), ...(input.finishDelivery ? [finishDeliveryTool] : [])] })
      if (typeof result.thread?.id !== 'string' || !result.thread.id) throw Error('BGS did not return a thread identity')
      runtime.threadId = result.thread.id
      if (!runtime.deferredResume) input.onNativeSessionId?.(runtime.threadId)
      // Discover BGS catalogs without copying plugin metadata into game output.
      const skills = await runtime.client.requestNative('skills/list', { cwds: [access.root], forceReload: true })
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

  private async resumeDeferredThread(): Promise<void> {
    if (!this.deferredResume) return
    if (!this.shared || !this.threadId) throw Error('BGS native Goal resume was not prepared')
    const result = await this.client.request('thread/resume', {
      ...this.shared, threadId: this.threadId, excludeTurns: false,
    })
    if (typeof result.thread?.id !== 'string' || result.thread.id !== this.threadId)
      throw Error('BGS did not restore the native Goal thread')
    this.deferredResume = false
    this.input.onNativeSessionId?.(this.threadId)
  }

  private nativeGoalTerminal(status?: string): boolean {
    return ['paused', 'blocked', 'usageLimited', 'budgetLimited', 'complete'].includes(status ?? '')
  }

  /** A Goal status can be persisted before the final assistant item and
   * turn/completed notification arrive. Keep the outer BGS turn alive until
   * that native turn has actually quiesced. A terminal Goal may complete
   * without an assistant message (for example, a structured tool-only turn). */
  private maybeResolveNativeGoal(turn: NonNullable<BgsRuntime['active']>): void {
    if (turn.controlledFinish || !turn.nativeGoal || !turn.goalArmed || !this.nativeGoalTerminal(turn.nativeGoalStatus)) return
    if (turn.nativeTurnStarted && !turn.nativeTurnCompleted) return
    turn.resolve()
  }

  /** A cold resume may restore an active Goal before the current assignment is
   * available. Pause that persisted Goal while the thread remains unloaded. */
  private async pauseUnloadedGoalIfActive(): Promise<RpcObject | undefined> {
    const response = await this.client.requestNative('thread/goal/get', { threadId: this.threadId })
    const goal = response.goal as RpcObject | null | undefined
    if (goal?.status === 'active') {
      const paused = await this.client.requestNative('thread/goal/set', {
        threadId: this.threadId, status: 'paused', origin: 'automatic',
      })
      return paused.goal as RpcObject
    }
    return goal ?? undefined
  }

  /** Stop/abort must leave a persisted Goal quiescent before the process is
   * torn down. Terminal Goal states are preserved and never rewritten. */
  private async pauseActiveNativeGoal(): Promise<void> {
    if (!(this.active?.nativeGoal ?? this.nativeGoal) || !this.threadId || !this.client.connected) return
    try {
      const response = await this.client.requestNative('thread/goal/get', { threadId: this.threadId })
      let goal = (response.goal as RpcObject | null | undefined) ?? undefined
      const wasActive = goal?.status === 'active'
      if (wasActive) {
        const paused = await this.client.requestNative('thread/goal/set', {
          threadId: this.threadId, status: 'paused', origin: 'automatic',
        })
        goal = paused.goal as RpcObject | undefined
      }
      // Pausing accounts current-turn usage before returning. Cancellation
      // discards ordinary notifications, so retain this final usage snapshot.
      if (goal && (wasActive || this.active?.input.signal.aborted))
        await this.emit('system.status', 'Native Goal stopped', { subtype: 'native_goal', nativeGoal: goal })
    } catch {
      // The caller still force-closes the isolated process. The session manager
      // retains its writer until that confirmed process exit is observed.
      console.warn('[BGS] Native Goal could not be paused before closing; the isolated process will still be terminated')
    }
  }

  /** Finish a native Goal at the host's deliberate delivery boundary. This is
   * intentionally outside notification(): client.close() waits that ordered
   * notification queue, so awaiting disposal from a notification would
   * deadlock the connection. */
  async completeGoal(status: 'complete' | 'blocked' = 'complete'): Promise<void> {
    const turn = this.active
    if (!turn?.nativeGoal || !turn.goalArmed)
      throw Error('BGS native Goal completion requires an active armed Goal')
    if (turn.controlledFinish) {
      if (this.closing) return await this.closing
      throw Error('BGS native Goal completion is already in progress')
    }
    if (turn.input.signal.aborted)
      throw Error('BGS native Goal completion cannot start after interruption')
    if (turn.nativeGoalStatus !== 'active')
      throw Error('BGS native Goal completion requires an active Goal')
    if (this.liveChildren.size)
      throw Error('BGS native Goal completion requires all child agents to finish')
    const pending = [...this.items.values()]
    const submission = this.deliveryTool
    if (submission) {
      if (submission.signal.aborted || submission.turnId !== turn.turnId)
        throw Error('Native delivery request is no longer active')
      if (pending.length !== 1 || pending[0]?.id !== submission.callId ||
          pending[0]?.type !== 'dynamicToolCall' || pending[0]?.tool !== 'BgsFinishDelivery')
        throw Error('BGS native Goal completion has unfinished non-submission work')
    } else if (pending.some(item => item.type !== 'commandExecution') || pending.length > 1) {
      throw Error('BGS native Goal completion has unfinished non-submission work')
    }
    if (!this.client.connected) throw Error('BGS native Goal connection is closed')

    // Mark the controlled close before the RPC can cause the child to exit;
    // the expected close must not race the normal submit rejection path.
    turn.controlledFinish = true
    try {
      const result = await this.client.requestNative('thread/goal/set', {
        threadId: this.threadId, status,
      })
      const goal = result?.goal as RpcObject | undefined
      if (goal?.status !== status) throw Error('BGS did not persist native Goal terminal status')
      if (turn.input.signal.aborted || submission?.signal.aborted)
        throw Error('BGS native Goal completion was interrupted before cleanup')
      const hadTerminalStatus = String(turn.nativeGoalStatus) === status
      turn.nativeGoalStatus = status
      // The RPC response is authoritative. Do not make the host depend on a
      // later notification, which may be absent when disposal starts.
      if (!hadTerminalStatus) {
        await this.emit('system.status', 'Native Goal updated', {
          subtype: 'native_goal', nativeGoal: goal,
        })
      }
      // Dispose only after the terminal state is persisted. This closes the
      // native turn/process without asking the model for a final summary.
      await this.dispose()
    } catch (error) {
      turn.controlledFinish = false
      const failure = error instanceof Error ? error : Error(String(error))
      turn.reject(failure)
      throw failure
    }
    if (turn.input.signal.aborted) {
      const failure = Error('BGS native Goal completion was interrupted')
      turn.reject(failure)
      throw failure
    }
    turn.resolve()
  }

  async submit(input: BeeGameSessionSubmitInput): Promise<void> {
    if (this.stopped) throw Error('BGS session is stopped')
    if (this.active) throw Error('BGS session already has an active turn')
    if (input.confirmedBriefContext !== this.input.confirmedBriefContext)
      throw Error('Confirmed requirements changed after BGS runtime preparation; prepare a current runtime before submitting')
    input.signal.throwIfAborted()
    const recovery = input.nativeRecovery ?? this.input.nativeRecovery
    if (recovery && !this.input.resumeSessionId) throw Error('BGS native recovery requires a saved native session')
    const assignment = input.nativeGoal ?? this.input.nativeGoal
    const nativeGoal = recovery && assignment ? { mode: 'resume' as const } : assignment
    if (nativeGoal && input.finalOutput) throw Error('A preparation result cannot replace native Goal delivery')
    if (nativeGoal) this.nativeGoal = nativeGoal
    let abort = () => {}
    try {
      await new Promise<void>((resolveTurn, reject) => {
        const turn: NonNullable<BgsRuntime['active']> = { input, turnId: undefined, nativeGoal, goalArmed: false, nativeSubmitted: false, resolve: resolveTurn, reject }
        this.active = turn
        abort = () => {
          if (this.active !== turn) return
          // Closing the isolated process group stops commands and child agents;
          // interruption acknowledgement alone is not process-cleanup evidence.
          this.stopped = true
          const closing = this.dispose()
          if (turn.controlledFinish) return
          void closing.then(() => reject(Error('BGS turn interrupted')), reject)
        }
        input.signal.addEventListener('abort', abort, { once: true })
        const prompt: RpcObject[] = recovery ? [] : typeof input.prompt === 'string' ? [{ type: 'text', text: input.prompt }]
          : input.prompt.map(block => block.type === 'text' ? block : { type: 'image',
            url: `data:${block.source.media_type};base64,${block.source.data}` })
        const text = prompt.findLast(block => block.type === 'text')?.text
        const name = typeof text === 'string' ? /^\$([A-Za-z0-9_-]+)\b/.exec(text)?.[1] : undefined
        if (name) {
          const skill = this.skills.find(skill => skill.name === name && skill.enabled && typeof skill.path === 'string')
          if (!skill) { reject(Error('Required BGS skill is unavailable: ' + name)); return }
          prompt.unshift({type:'skill',name,path:skill.path})
        }
        // Resume does not replace old model history. Refresh it once through
        // the existing slot; the current thread instructions above survive
        // later compaction. New threads already contain these facts once.
        // The JSON contract is guidance; only the host enforces acceptance.
        const systemContext = preparationContext(this.input.systemContext, input.finalOutput)
        const additionalContext = this.input.resumeSessionId ? {
          ...bgsApplicationContext('bgsRuntime', systemContext),
          ...bgsApplicationContext('bgsConfirmedBrief', input.confirmedBriefContext),
        } : {}
        const setGoal = async () => {
          if (!nativeGoal) return
          const objective = nativeGoal.mode === 'start' && nativeGoal.objective.trim()
            ? nativeGoal.objective.trim() : undefined
          const requestedBudget = nativeGoal.mode === 'start' ? nativeGoal.tokenBudget : undefined
          if (requestedBudget !== undefined && (!Number.isSafeInteger(requestedBudget) || requestedBudget <= 0))
            throw Error('BGS native Goal token budget must be a positive safe integer')
          const tokenBudget = requestedBudget
          const result = await this.client.requestNative('thread/goal/set', {
            threadId: this.threadId,
            ...(objective ? { objective } : {}), status: 'active', origin: 'user',
            ...(tokenBudget !== undefined ? { tokenBudget } : {}),
          })
          if (!result?.goal) throw Error('BGS did not return the native Goal state')
          turn.nativeGoalStatus = typeof result.goal.status === 'string' ? result.goal.status : undefined
        }
        void (async () => {
          if (nativeGoal) {
            if (nativeGoal.mode === 'resume' && !this.input.resumeSessionId)
              throw Error('BGS native Goal resume requires a saved native session')
            // Cold resume leaves an active persisted Goal paused while the
            // thread is still unloaded. Load it while paused, then append the
            // current context and assignment before reactivating the Goal.
            const existing = this.deferredResume ? await this.pauseUnloadedGoalIfActive() :
              (await this.client.requestNative('thread/goal/get', { threadId: this.threadId })).goal as RpcObject | null | undefined
            if (nativeGoal.mode === 'resume') {
              if (!existing) throw Error('BGS native Goal resume found no stored Goal')
              const status = typeof existing.status === 'string' ? existing.status : undefined
              if (['complete', 'budgetLimited', 'usageLimited'].includes(status ?? '')) {
                turn.nativeGoalStatus = status
                await this.emit('system.status', 'Native Goal is not resumable', {
                  subtype: 'native_goal', nativeGoal: existing,
                })
                throw Error(`BGS native Goal is already ${status}`)
              }
            }
            if (nativeGoal.mode === 'start' && existing) {
              // `thread/goal/set` updates an existing Goal in place, retaining
              // its consumed budget and terminal scope. An explicit new Goal
              // assignment must clear that persisted scope before creating a
              // fresh one; resume never performs this reset.
              await this.client.requestNative('thread/goal/clear', { threadId: this.threadId })
            }
            if (this.deferredResume) await this.resumeDeferredThread()
            const refreshedContext = this.input.resumeSessionId
              ? Object.fromEntries(Object.entries({
                ...bgsApplicationContext('bgsRuntime', this.input.systemContext),
                ...bgsApplicationContext('bgsConfirmedBrief', input.confirmedBriefContext),
              }).map(([key, part]) => [key, part.value]))
              : undefined
            // A cold resume restores the old thread's developer history. Add
            // the current host facts and assignment before reactivating the
            // Goal so its first continuation cannot rely on stale context.
            await this.client.requestNative('thread/inject_items', {
              threadId: this.threadId, items: nativeGoalInputItems(prompt, refreshedContext, recovery),
            })
            if (this.active !== turn) return
            // Mark the request armed before the mutation, since the ordered
            // goal update can arrive before the RPC response is delivered.
            turn.goalArmed = true
            await setGoal()
          } else {
            const result = await this.client.request('turn/start', { threadId: this.threadId, input: prompt,
              ...(Object.keys(additionalContext).length ? { additionalContext } : {}) })
            if (this.active !== turn) return
            if (typeof result.turn?.id !== 'string') throw Error('BGS did not acknowledge a turn identity')
            turn.turnId = result.turn.id
            this.input.onNativeSubmission?.(this.threadId)
          }
          if (input.signal.aborted) abort()
        })().catch(reject)
      })
    } finally {
      input.signal.removeEventListener('abort', abort)
      this.active = undefined
      await this.dispose()
    }
  }

  /** Run outside the ordered notification handler: reviewer completion arrives
   * on that same stream. The author is idle while the source is being reviewed. */
  private async reviewDesignCandidate(turn: NonNullable<BgsRuntime['active']>, value: unknown) {
    const contract = turn.input.finalOutput!
    const review = contract.designReview!
    const candidate = await review.candidate(value)
    const source = candidate.source
    turn.input.signal.throwIfAborted()
    const startedAt = new Date().toISOString()
    if (!this.designReviewer) {
      const shared = this.shared!
      const mcpServers = Object.fromEntries(Object.entries(shared.config.mcp_servers ?? {}).map(([name, config]) =>
        [name, { ...config as RpcObject, enabled: false }]))
      const result = await this.client.request('thread/start', { ...shared,
        // Start, never fork/resume the author. Keep the selected model/effort
        // and read-only project permissions, without author instructions/tools.
        config: { ...shared.config, mcp_servers: mcpServers, web_search: 'disabled',
          'features.goals': false, 'features.multi_agent': false, 'features.multi_agent_v2': false },
        developerInstructions: [this.input.language && responseLanguageInstruction(this.input.language), DESIGN_REVIEW_INSTRUCTIONS].filter(Boolean).join('\n\n'),
        dynamicTools: [],
      })
      if (typeof result.thread?.id !== 'string' || !result.thread.id || result.thread.id === this.threadId)
        throw Error('BGS did not create an independent review thread')
      this.designReviewer = { threadId: result.thread.id, rounds: 0, findingCount: 0 }
    }
    turn.input.signal.throwIfAborted()
    const reviewer = this.designReviewer
    if (reviewer.rounds >= 2) throw Error('Independent GDD review already used its single follow-up')
    const followup = reviewer.rounds++ > 0
    const responses = candidate.reviewResponses ?? []
    assertDesignReviewCoverage(responses, reviewer.findingCount)
    if (responses.some(item => item.status === 'unresolved'))
      throw Error('Author left GDD review findings unresolved; preserve the draft')
    const authorResponses = followup ? responses : undefined
    const response = followup ? candidate.summary : undefined
    const prompt = [followup
      ? 'Targeted follow-up only. Independently verify the saved definitions and affected dependent claims for each of the ' + reviewer.findingCount + ' original findings (1-based indices in the initial report). Return an evidence-backed resolution for each; absence from findings does not mean resolved. Author responses: ' + JSON.stringify(authorResponses)
      : 'Review the complete GDD against these confirmed requirements:\n' + this.input.confirmedBriefContext,
      'Current saved source: ' + JSON.stringify(source),
    ].join('\n\n')
    const owner = 'design-review-' + randomUUID()
    this.childOwners.set(reviewer.threadId, owner)
    this.liveChildren.add(reviewer.threadId)
    await this.emit('tool.started', 'Independent GDD review', { toolName: 'Agent', toolUseID: owner,
      input: { prompt, model: this.shared!.model }, reviewRound: reviewer.rounds })
    let reviewCompleted = false
    try {
      const result = await new Promise<{ text: string; turnId: string }>((resolveReview, reject) => {
        this.pendingDesignReview = { resolve: resolveReview, reject }
        void this.client.request('turn/start', { threadId: reviewer.threadId,
          parentTurnId: turn.turnId, input: [{ type: 'text', text: prompt }] }).catch(reject)
      })
      this.pendingDesignReview = undefined
      turn.input.signal.throwIfAborted()
      const currentSource = (await review.candidate(value)).source
      if (currentSource.path !== source.path || currentSource.sha256 !== source.sha256)
        throw Error('GDD changed during independent review; no result can be accepted')
      const report = parseDesignReview(result.text, reviewer.findingCount)
      const receipt = { source, nativeThreadId: reviewer.threadId, nativeTurnId: result.turnId,
        startedAt, finishedAt: new Date().toISOString(), ...(response ? { response, authorResponses } : {}), report }
      await review.record(receipt)
      turn.input.signal.throwIfAborted()
      await this.emit('tool.completed', 'Independent GDD review', { toolName: 'Agent', toolUseID: owner, output: receipt })
      reviewCompleted = true
      const unresolved = report.findings.length > 0 || report.resolutions?.some(item => item.status === 'unresolved')
      if (unresolved && !followup) {
        // One concentrated author revision, then one targeted review. This is
        // still the same authorized design task, not a new production stage.
        reviewer.findingCount = report.findings.length
        turn.finalOutputText = undefined; turn.finalOutputId = undefined; turn.turnId = undefined
        const resumed = await this.client.request('turn/start', { threadId: this.threadId, input: [{ type: 'text', text:
          'The independent GDD review found material issues. Its claims are not authoritative answers. For each numbered finding, derive a disposition from the current saved definitions and affected entities/conditions; calculate disputed relations as needed. Correct supported defects and their dependencies, or reject unsupported findings with specific evidence. Make one concentrated revision using the existing working-document tools; batch related edits. Keep the original scope and recoverable draft. Do not regenerate, spawn reviewers or repeat a broad self-audit. Return ready/blocked with a short summary and reviewResponses: [{finding: <1-based index>, status: <corrected|rejected|unresolved>, evidence: <saved locations, definitions and derivation>}]. A blanket acceptance is not a response. Unresolved issues leave the task blocked. The host performs one targeted follow-up, not another revision loop.\n\n' + JSON.stringify({ findings: report.findings.map((finding, index) => ({ finding: index + 1, ...finding })) }) }] })
        if (typeof resumed.turn?.id !== 'string') throw Error('BGS did not acknowledge the GDD revision turn')
        if (this.active === turn) turn.turnId = resumed.turn.id
        return
      }
      if (unresolved) throw Error('Independent GDD review still has unresolved findings after the single revision: ' + report.summary)
      const summary = await contract.accept(value)
      turn.input.signal.throwIfAborted()
      await this.emit('assistant.message', summary + '\n\n' + report.summary, { messageId: turn.finalOutputId, assistantBlockId: turn.finalOutputId })
      turn.resolve()
    } catch (error) {
      this.pendingDesignReview = undefined
      if (!reviewCompleted) await this.emit('tool.failed', 'Independent GDD review', { toolName: 'Agent', toolUseID: owner,
        output: error instanceof Error ? error.message : String(error), is_error: true })
      throw error
    }
  }

  stop(): void { this.stopped = true; void this.dispose() }
  dispose(): Promise<void> {
    return this.closing ??= (async () => {
      this.stopped = true
      this.pendingDesignReview?.reject(Error('Independent GDD review interrupted'))
      try {
        await this.pauseActiveNativeGoal()
      } finally {
        try {
        if (this.client.connected) await this.client.request('thread/backgroundTerminals/clean', { threadId: this.threadId }, 5000)
        } finally {
        try { await this.client.close() }
        finally {
          try { await this.bridge?.close() }
          finally { try { await this.mcpClose?.() } finally { await closeSessionTestBrowsers(this.access.temporary) } }
        }
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
      const total = p.tokenUsage?.total
      if (total && typeof p.threadId === 'string') {
        // Converted provider receipts remain authoritative, including cache
        // writes. Keep the native counter only as a baseline so switching a
        // resumed thread to Responses cannot bill that earlier work again.
        const baselineOnly = Boolean(this.bridge && this.bridge.protocol !== 'responses')
        this.input.onNativeUsage?.(bgsUsage(total), 'bgs:' + p.threadId, { baselineOnly,
          replayed: this.resumingThread && p.threadId === this.input.resumeSessionId,
          ...(typeof p.turnId === 'string' && p.turnId ? { nativeTurnId: p.turnId } : {}) })
      }
      return
    }
    if (p.threadId && p.threadId !== this.threadId && !this.childOwners.has(p.threadId)) return
    // The first live native turn is the protocol's admission boundary after
    // resume replay. This runs before usage emitted by that turn is handled.
    if (method === 'turn/started' && p.threadId === this.threadId)
      this.resumingThread = false
    const turn = this.active
    if (!turn || turn.input.signal.aborted) return
    const notificationTurnId = typeof p.turnId === 'string' ? p.turnId
      : typeof p.turn?.id === 'string' ? p.turn.id : undefined
    // Goal continuations emit several native turns under one outer BGS turn.
    // Admit a new native turn only through turn/started, then reject all item,
    // tool and completion events from stale native turn IDs.
    if (p.threadId === this.threadId && turn.nativeGoal &&
      method !== 'thread/goal/updated' && method !== 'turn/started' &&
      (!notificationTurnId || notificationTurnId !== turn.turnId)) return
    if (p.threadId === this.threadId && !turn.nativeGoal && notificationTurnId &&
      (notificationTurnId === turn.nativeLastTurnId || turn.turnId && notificationTurnId !== turn.turnId)) return
    const owner = this.childOwners.get(p.threadId)
    if (p.threadId === this.designReviewer?.threadId && notificationTurnId && this.childTurns.get(p.threadId)?.endedIds.has(notificationTurnId)) return
    if (method === 'thread/goal/updated' && p.threadId === this.threadId) {
      if (turn.nativeGoal && notificationTurnId &&
        ((turn.turnId && notificationTurnId !== turn.turnId) ||
          (!turn.turnId && turn.nativeLastTurnId && notificationTurnId !== turn.nativeLastTurnId))) return
      const goal = p.goal as RpcObject | undefined
      const status = typeof goal?.status === 'string' ? goal.status : undefined
      // Once host-controlled completion has been acknowledged, stale Goal
      // notifications from the interrupted native turn must not reopen or
      // replace the persisted terminal state.
      if (turn.controlledFinish && this.nativeGoalTerminal(turn.nativeGoalStatus) && status !== turn.nativeGoalStatus) return
      if (turn.nativeGoal) turn.nativeGoalStatus = status
      const goalEvent = this.emit('system.status', 'Native Goal updated', {
        subtype: 'native_goal',
        nativeGoal: goal,
      })
      await goalEvent
      this.maybeResolveNativeGoal(turn)
      return
    }
    if (method === 'turn/started' && p.threadId === this.threadId) {
      const nativeTurnId = notificationTurnId
      if (!turn.nativeGoal) {
        turn.turnId = nativeTurnId
        turn.nativeTurnCompleted = false
      }
      if (turn.nativeGoal && nativeTurnId) {
        if (turn.nativeLastTurnId === nativeTurnId && turn.turnId !== nativeTurnId) return
        turn.turnId = nativeTurnId
        turn.error = undefined
        turn.nativeTurnStarted = true
        turn.nativeTurnCompleted = false
        if (!turn.nativeSubmitted) {
          turn.nativeSubmitted = true
          this.input.onNativeSubmission?.(this.threadId)
        }
        await this.emit('system.status', 'Native Goal turn started', {
          subtype: 'native_goal_turn_started', nativeTurnId,
        })
      }
      return
    }
    if (method === 'turn/started' && owner) {
      // An idle child can start another turn after send_input, without a spawn/resume.
      const childTurn = this.childTurns.get(p.threadId) ?? { endedIds: new Set<string>() }
      if (notificationTurnId && childTurn.endedIds.has(notificationTurnId)) return
      if (childTurn.id && childTurn.id !== notificationTurnId) childTurn.endedIds.add(childTurn.id)
      childTurn.id = notificationTurnId
      this.childTurns.set(p.threadId, childTurn)
      this.liveChildren.add(p.threadId)
      await this.emit('system.status', 'BGS child running', {childThreadId:p.threadId,childStatus:'running',parentToolUseID:owner})
      return
    }
    const identity = (id: string) => ({ messageId: id, assistantBlockId: id, ...(owner ? { parentToolUseID: owner } : {}) })
    if (method === 'item/agentMessage/delta') {
      this.messages.set(p.itemId, (this.messages.get(p.itemId) || '') + p.delta)
      // Structured preparation results are validated before displaying their summary.
      if ((!turn.input.finalOutput || owner) && p.threadId !== this.designReviewer?.threadId) await this.emit('assistant.partial', p.delta, identity(p.itemId))
    } else if (method === 'item/reasoning/summaryTextDelta') {
      await this.emit('assistant.thinking', p.delta, identity(p.itemId))
    } else if (method === 'item/started' || method === 'item/completed') {
      const item = p.item as RpcObject
      if (!item || typeof item.id !== 'string') throw Error('Invalid BGS item')
      const complete = method === 'item/completed'
      const prior = this.items.get(item.id)
      if (trackedNativeToolTypes.has(item.type) && !complete) this.items.set(item.id, { ...item, bgsThreadId: p.threadId })
      else if (complete) this.items.delete(item.id)
      if (item.type === 'agentMessage' && complete) {
        if (p.threadId === this.designReviewer?.threadId) {
          this.messages.delete(item.id)
          if (item.phase !== 'commentary' && this.pendingDesignReview) this.pendingDesignReview.text = item.text
          return
        }
        if (turn.input.finalOutput && !owner) {
          this.messages.delete(item.id)
          if (item.phase === 'commentary') await this.emit('assistant.message', item.text, identity(item.id))
          else { turn.finalOutputText = item.text; turn.finalOutputId = item.id }
          return
        }
        const streamed = this.messages.get(item.id) || ''
        const remaining = item.text.startsWith(streamed) ? item.text.slice(streamed.length) : item.text
        if (remaining) await this.emit('assistant.message', remaining, identity(item.id))
        this.messages.delete(item.id)
        this.maybeResolveNativeGoal(turn)
      } else if (item.type === 'contextCompaction') {
        await this.emit('system.status', complete ? 'Context compacted' : 'Compacting context', {
          subtype: complete ? 'compact_boundary' : 'status', status: complete ? 'compacted' : 'compacting',
        })
      } else if (item.type === 'collabAgentToolCall') {
        for (const child of item.receiverThreadIds ?? []) {
          if (item.tool === 'spawnAgent' || !this.childOwners.has(child)) this.childOwners.set(child, item.id)
          const status = item.agentsStates?.[child]?.status
          if (status && ['completed','errored','shutdown','interrupted','notFound'].includes(status)) {
            this.liveChildren.delete(child)
            const childTurn = this.childTurns.get(child)
            if (childTurn?.id) { childTurn.endedIds.add(childTurn.id); childTurn.id = undefined }
            this.client.cancelServerRequests(child)
          }
          else if (status === 'running' || status === 'pendingInit' ||
            ['spawnAgent','resumeAgent','sendInput'].includes(item.tool) && item.status !== 'failed') this.liveChildren.add(child)
          await this.emit('system.status', 'BGS child ' + (status || 'pendingInit'), {childThreadId:child,childStatus:status || 'pendingInit',parentToolUseID:this.childOwners.get(child)})
        }
        await this.emit(complete ? 'tool.completed' : 'tool.started', item.tool, {
          toolUseID: item.id, toolName: 'Agent', input: { prompt: item.prompt, model: item.model },
          output: complete ? item.agentsStates : undefined, is_error: item.status === 'failed',
          ...(owner ? { parentToolUseID: owner } : {}) })
      } else if (['commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall', 'webSearch', 'imageView'].includes(item.type)) {
        const reason = typeof item.error === 'string' ? item.error : item.error?.message ?? prior?.bgsDenialReason ??
          (item.status === 'declined' ? 'Native tool approval was declined; no detailed reason was supplied.' : undefined)
        const noMatch = complete && !reason && nativeRgNoMatch({ ...prior, ...item, aggregatedOutput: item.aggregatedOutput ?? prior?.aggregatedOutput })
        const skillReads = item.type === 'commandExecution' ? nativeSkillReadTargets(item.commandActions ?? prior?.commandActions, this.skills) : []
        const tools = item.type === 'webSearch' ? [webSearchTool(item, complete)] : item.type === 'fileChange' ? item.changes.map((change: RpcObject, i: number) => ({
          toolUseID: item.id + ':' + i, toolName: 'Edit', input: { file_path: change.path }, diff: change.diff, output: toolFailureOutput(change.diff, reason) })) : [{
          toolUseID: item.id, toolName: item.type === 'commandExecution' ? 'Shell' : item.tool || item.type,
          input: item.type === 'commandExecution' ? commandInput(item, prior) : item.arguments || { command: item.command, path: item.path },
          output: toolFailureOutput(item.aggregatedOutput ?? item.result ?? item.contentItems ?? prior?.aggregatedOutput, reason),
          ...(item.type === 'commandExecution' ? {
            ...(noMatch ? { searchOutcome: 'no-match' } : {}),
            ...(skillReads.length ? { skillReads } : {}),
            ...(Number.isInteger(item.exitCode) ? { exitCode: item.exitCode } : {}),
            ...(typeof item.durationMs === 'number' && Number.isFinite(item.durationMs) && item.durationMs >= 0 ? { durationMs: item.durationMs } : {}),
          } : {}),
          ...(item.type === 'imageView' ? { imagePath: item.path } : {}) }]
        const failed = !noMatch && (['failed', 'declined'].includes(item.status) || Boolean(item.error) ||
          (item.type === 'commandExecution' && Number.isInteger(item.exitCode) && item.exitCode !== 0))
        for (const tool of tools) await this.emit(complete ? failed ? 'tool.failed' : 'tool.completed' : 'tool.started', tool.toolName, {
          ...tool, ...(owner ? { parentToolUseID: owner } : {}), is_error: failed })
      }
    } else if (method === 'item/commandExecution/outputDelta') {
      const item = this.items.get(p.itemId)
      const output = item?.type === 'commandExecution' && typeof p.delta === 'string'
        ? (item.aggregatedOutput || '') + p.delta : p.delta
      if (item?.type === 'commandExecution') this.items.set(p.itemId, { ...item, aggregatedOutput: output })
      // Progress carries only this chunk. Repeating the cumulative output here
      // makes both durable Chat and live event retention quadratic in output size.
      await this.emit('tool.progress', p.delta, { toolUseID: p.itemId, toolName: 'Shell', output: p.delta,
        ...(item?.type === 'commandExecution' ? { input: commandInput(item) } : {}),
        ...(owner ? { parentToolUseID: owner } : {}) })
    } else if (method === 'error') {
      // Retryable upstream events are observations; only turn/completed is terminal.
      if (!owner) turn.error = p.error
      await this.emit('system.status', typeof p.error?.message === 'string' ? p.error.message : 'BGS reported an upstream error', {
        willRetry: p.willRetry === true, bgsErrorInfo: p.error?.bgsErrorInfo,
        ...(owner ? { parentToolUseID: owner } : {}) })
    } else if (method === 'turn/completed' && p.threadId !== this.threadId) {
      const childTurn = this.childTurns.get(p.threadId) ?? { endedIds: new Set<string>() }
      const endedId = notificationTurnId ?? childTurn.id
      if (endedId && childTurn.endedIds.has(endedId)) return
      if (endedId) childTurn.endedIds.add(endedId)
      this.childTurns.set(p.threadId, childTurn)
      if (notificationTurnId && childTurn.id && childTurn.id !== notificationTurnId) return
      childTurn.id = undefined
      this.liveChildren.delete(p.threadId)
      await this.emit('system.status', 'BGS child finished', {childThreadId:p.threadId,childStatus:p.turn?.status === 'completed' ? 'completed' : 'errored',parentToolUseID:owner})
      if (p.threadId === this.designReviewer?.threadId && this.pendingDesignReview) {
        const pending = this.pendingDesignReview
        if (p.turn?.status !== 'completed') pending.reject(Error('Independent GDD review ' + (p.turn?.status ?? 'failed') + '; no automatic retry'))
        else if ([...this.items.values()].some(item => item.bgsThreadId === p.threadId)) pending.reject(Error('Independent GDD review ended with unfinished tools'))
        else if (!pending.text || !endedId) pending.reject(Error('Independent GDD review ended without a report or turn identity'))
        else pending.resolve({ text: pending.text, turnId: endedId })
      }
    } else if (method === 'turn/completed' && p.threadId === this.threadId) {
      // turn/start's RPC response can arrive before its started notification.
      // Track the ended ID separately so a newly acknowledged revision is admitted.
      turn.nativeLastTurnId = notificationTurnId ?? turn.turnId
      turn.nativeTurnCompleted = true
      if (this.liveChildren.size) turn.reject(Error('BGS ended the parent turn with unfinished child work'))
      else if (p.turn?.status === 'completed') {
        if (turn.nativeGoal) {
          const nativeTurnId = notificationTurnId ?? turn.turnId
          if (nativeTurnId) turn.nativeLastTurnId = nativeTurnId
          turn.nativeTurnCompleted = true
          await this.emit('system.status', 'Native Goal turn completed', {
            subtype: 'native_goal_turn_completed', ...(nativeTurnId ? { nativeTurnId } : {}),
          })
          this.maybeResolveNativeGoal(turn)
          // The native Goal extension owns the next-turn decision. Keep the
          // terminal turn identity after completion; only a nonterminal Goal
          // may advance to another native turn under this outer submission.
          if (!this.nativeGoalTerminal(turn.nativeGoalStatus)) {
            turn.turnId = undefined
            turn.nativeTurnStarted = false
            turn.nativeTurnCompleted = false
          }
        } else {
          try {
            if (turn.input.finalOutput) {
              if (this.items.size) throw Error('BGS ended preparation with unfinished tools')
              let value: unknown
              try { value = JSON.parse(turn.finalOutputText ?? '') }
              catch { throw Error('BGS final result is missing or invalid; no stage was advanced.') }
              if (turn.input.finalOutput.designReview) {
                // Do not await on the notification queue that must deliver the
                // reviewer's events. Any failure ends this task, without retry.
                void this.reviewDesignCandidate(turn, value).catch(error => turn.reject(error instanceof Error ? error : Error(String(error))))
                return
              }
              const summary = await turn.input.finalOutput.accept(value)
              turn.input.signal.throwIfAborted()
              await this.emit('assistant.message', summary, identity(turn.finalOutputId!))
            }
            turn.resolve()
          } catch (error) { turn.reject(error instanceof Error ? error : Error(String(error))) }
        }
      }
      else {
        if (turn.controlledFinish) return
        const error = p.turn?.error ?? turn.error
        const message = p.turn?.status === 'interrupted' ? 'BGS turn interrupted'
          : typeof error?.message === 'string' && error.message.trim() ? error.message : 'BGS turn failed'
        turn.reject(Object.assign(Error(message), { bgsErrorInfo: error?.bgsErrorInfo }))
      }
    }
  }

  private async permission(request: DashboardPermissionRequest) {
    const cancelled = { behavior: 'deny' as const, source: 'policy' as const, message: 'Native request cancelled' }
    if (request.signal?.aborted) return cancelled
    const policy = await this.input.toolPolicy?.(request)
    if (request.signal?.aborted) return cancelled
    const decision = policy ?? await (this.input.requestPermission ?? this.active?.input.requestPermission)?.(request)
      ?? { behavior: 'deny' as const, message: 'Permission authority is unavailable' }
    return request.signal?.aborted ? cancelled : decision
  }

  private async serverRequest(method: string, p: RpcObject, requestId: string | number, signal: AbortSignal): Promise<unknown> {
    const active = this.active
    const child = p.threadId && p.threadId !== this.threadId ? p.threadId as string : undefined
    // Child admission can precede its listener's turn/started notification.
    // Bind its first live request, but never revive a turn already observed ending.
    if (child && this.childOwners.has(child) && this.liveChildren.has(child) && typeof p.turnId === 'string') {
      const childTurn = this.childTurns.get(child) ?? { endedIds: new Set<string>() }
      if (!childTurn.id && !childTurn.endedIds.has(p.turnId)) {
        childTurn.id = p.turnId
        this.childTurns.set(child, childTurn)
      }
    }
    const current = () => active !== undefined && this.active === active && !active.input.signal.aborted && !this.stopped && !signal.aborted &&
      (!child || this.childOwners.has(child) && this.liveChildren.has(child) &&
        (!p.turnId || this.childTurns.get(child)?.id === p.turnId && !this.childTurns.get(child)?.endedIds.has(p.turnId))) &&
      (child !== undefined || !active.nativeTurnCompleted && (!p.turnId ||
        (active.nativeGoal
          ? active.turnId !== undefined && p.turnId === active.turnId
          : !active.turnId || p.turnId === active.turnId)))
    if (!current()) throw Error('No active BGS turn')
    const permission = (request: DashboardPermissionRequest) => this.permission({ ...request, signal,
      ...(child ? { agentId: child } : {}) })
    if (method === 'item/tool/call' && ['BgsWorkflow', 'BgsMeasurement', 'BgsFinishDelivery'].includes(p.tool)) {
      let submission: typeof this.deliveryTool
      try {
        // Capabilities belong to the current parent turn, not the startup
        // callback or a child inheriting its parent's tool catalogue.
        const capability = p.tool === 'BgsWorkflow' ? active?.input.workflow :
          p.tool === 'BgsMeasurement' ? active?.input.measurement : active?.input.finishDelivery
        if (p.threadId !== this.threadId || !active || !capability) throw Error('Host capability unavailable for this turn')
        const requestSignal = AbortSignal.any([signal, active.input.signal])
        if (p.tool === 'BgsFinishDelivery') {
          if (this.deliveryTool || typeof p.callId !== 'string' || !active.turnId || p.turnId !== active.turnId)
            throw Error('Native delivery request is unavailable or already in progress')
          submission = { callId: p.callId, turnId: p.turnId, signal: requestSignal }
          this.deliveryTool = submission
        }
        const result = await capability(p.arguments, requestSignal)
        if (!current()) throw Error('Host request cancelled')
        return { contentItems: [{ type: 'inputText', text: JSON.stringify(result) }], success: true }
      } catch (error) {
        return { contentItems: [{ type: 'inputText', text: error instanceof Error ? error.message : 'Host request failed' }], success: false }
      } finally {
        if (submission && this.deliveryTool === submission) this.deliveryTool = undefined
      }
    }
    if (method === 'item/tool/call' && ['WriteProjectFile', 'EditProjectFile'].includes(p.tool)) {
      try {
        const finalOutput = active?.input.finalOutput
        const documentWrite = finalOutput?.readOnly ? finalOutput.writeDocument : undefined
        if (finalOutput?.readOnly && (!documentWrite || p.threadId !== this.threadId ||
            !active?.turnId || p.turnId !== active.turnId))
          throw Error('Project files are read-only outside the current parent document task')
        const args = p.arguments
        if (!args || typeof args.file_path !== 'string') throw Error('file_path is required')
        const path = resolve(this.access.root, args.file_path)
        if (documentWrite && path !== resolve(this.access.root, documentWrite.path))
          throw Error('This document task may write only ' + documentWrite.path)
        if (!inside(this.access.root, path)) throw Error('Path is outside the project workspace. Check file_path; use a project-relative path inside the current project.')
        if (!this.access.protectedPaths.includes(path)) throw Error('Path is not a BGS protected design record or AGENTS.md. Check file_path for typos. For an intentional ordinary project file, use exec_command with project-local file operations. This rejection does not deny ordinary workspace writes.')
        const request = { toolUseID: p.callId, toolName: p.tool === 'WriteProjectFile' ? 'Write' : 'Edit', input: args,
          message: 'Change a BGS protected project file' }
        const decision = await permission(request)
        if (!current()) throw Error('Turn ended before file authorization')
        if (decision.behavior !== 'allow') throw Error(decision.message || 'BGS rejected this file change')
        // Finish the file operation synchronously after the last live authority
        // check so cancellation cannot release the writer mid-write.
        const recheck = path === resolve(this.access.root, 'AGENTS.md') ? decision : await permission({ ...request, phase: 'recheck' })
        if (recheck.behavior !== 'allow') throw Error(recheck.message || 'File authorization changed')
        if (!current()) throw Error('File authorization changed')
        // Workspace approval is not workflow ownership. Refresh this turn's
        // document authority immediately before the synchronous file operation.
        if (documentWrite) {
          await documentWrite.authorize()
          if (!current()) throw Error('Document task ended before file authorization')
        }
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
      const decision = await permission({ toolUseID: p.callId, toolName: 'AskUserQuestion', input: p.arguments, message: 'BGS needs your answer' })
      if (!current() || decision.behavior !== 'allow') return { contentItems: [{type:'inputText',text:'Question cancelled'}], success:false }
      return { contentItems: [{type:'inputText',text:JSON.stringify(decision.updatedInput?.answers ?? {})}], success:true }
    }
    if (method === 'item/tool/requestUserInput') {
      const questions = p.questions.map((q: RpcObject) => ({ question: q.question, header: q.header,
        options: q.options ?? [], multiSelect: false }))
      const decision = await permission({ toolUseID: p.itemId, toolName: 'AskUserQuestion',
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
        permission })
    if (method === 'mcpServer/elicitation/request') {
      if (!['form', 'url'].includes(p.mode)) return { action: 'cancel', content: null }
      if (p.mode === 'url') {
        let url: URL
        try { url = new URL(p.url) } catch { return { action: 'cancel', content: null } }
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return { action: 'cancel', content: null }
      }
      const decision = await permission({ toolUseID: 'mcp:' + this.threadId + ':' + requestId,
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
