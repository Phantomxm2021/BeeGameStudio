import { constants } from 'node:fs'
import { mkdir, open, readFile, readdir, realpath, rename, stat, unlink } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { getBuiltinSkillsDirectory } from '@bee-game-studio/beegame-skills-core/store'
import { nativeWritingAuthors, parseNativeDirectionAuthors } from '@bee-game-studio/agent-workflow/native-direction-authors'
import { sanitizePath } from '../../../../src/utils/sessionStoragePortable'
import { checkAuthorDraft } from './author-draft-check'
import { checkSavedMilestoneResult } from './milestone-handoff-check'
import { ReviewSourceExposure, type ReviewReadState } from './review-source-exposure'
import { designReviewReference, reviewToolPolicy, type ReviewPolicyState } from './review-tool-policy'
import { reviewSystemPrompt } from './review-task-prompt'
import { nativeSessionTemporaryPath } from './native-runtime-process-path'
import type { BeeGameSessionRunnerStartInput, BeeGameSessionRuntime, BeeGameSessionSubmitInput, DashboardSDKMessage } from './session-manager'

export type WorkflowStart = (input: BeeGameSessionRunnerStartInput) => Promise<BeeGameSessionRuntime>
export type WorkflowJob = { session: string; submitted: boolean; result?: string; revision?: string; checkpoint?: unknown }
type Usage = Parameters<NonNullable<BeeGameSessionRunnerStartInput['onNativeUsage']>>[0]
const usageKeys = ['prompt_tokens', 'completion_tokens', 'cache_read_tokens', 'cache_creation_tokens', 'total_tokens'] as const
const emptyUsage = (): Usage => ({ prompt_tokens: 0, completion_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 0 })
const within = (root: string, target: string) => {
  const part = relative(root, target)
  return !isAbsolute(part) && part !== '..' && !part.startsWith('../')
}

/** Business scheduling around ordinary --print CLI sessions. No fabricated
 * Agent calls, private stdin fields, native role types or native Stop hooks.
 * The existing session manager serializes turns for a project. */
export class WritingWorkflowRuntime implements BeeGameSessionRuntime {
  private ordinary?: Promise<BeeGameSessionRuntime>
  private workers = new Set<BeeGameSessionRuntime>()
  private usage = new Map<string, Usage>()
  private closed = false
  private busy = false
  private active?: AbortController
  private disposal?: Promise<void>

  constructor(private readonly input: BeeGameSessionRunnerStartInput, private readonly start: WorkflowStart) {}

  private account(epoch: string, usage: Usage) {
    const previous = this.usage.get(epoch) ?? emptyUsage()
    // stdout result and passive stderr accounting can arrive in either order.
    for (const key of usageKeys) previous[key] = Math.max(previous[key], usage[key] ?? 0)
    this.usage.set(epoch, previous)
    const total = emptyUsage()
    for (const row of this.usage.values()) for (const key of usageKeys) total[key] += row[key]
    this.input.onNativeUsage?.(total)
  }

  private accountResult(epoch: string, message: DashboardSDKMessage) {
    const models = message.modelUsage
    if (!models || typeof models !== 'object' || Array.isArray(models)) return
    const usage = emptyUsage()
    for (const row of Object.values(models)) {
      if (!row || typeof row !== 'object') continue
      const fields = row as Record<string, unknown>
      for (const [key, native] of [['prompt_tokens', 'inputTokens'], ['completion_tokens', 'outputTokens'],
        ['cache_read_tokens', 'cacheReadInputTokens'], ['cache_creation_tokens', 'cacheCreationInputTokens']] as const) {
        const count = fields[native]
        if (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0) usage[key] += count
      }
    }
    usage.total_tokens = usage.prompt_tokens + usage.completion_tokens + usage.cache_read_tokens + usage.cache_creation_tokens
    this.account(epoch, usage)
  }

  async submit(turn: BeeGameSessionSubmitInput): Promise<void> {
    if (this.closed) throw Error('BGS workflow runtime is closed')
    if (this.busy) throw Error('BGS workflow runtime already has an active turn')
    if (turn.signal.aborted) return
    this.busy = true
    const controller = this.active = new AbortController()
    const abort = () => controller.abort(turn.signal.reason)
    turn.signal.addEventListener('abort', abort, { once: true })
    try {
      const assignment = parseNativeDirectionAuthors(turn.directionAuthors)
      if (turn.projectTurn?.reviewDocuments) {
        await this.review(turn, controller.signal)
        return
      }
      if (turn.projectTurn?.production) {
        await this.produce(turn, controller.signal)
        return
      }
      if (!assignment) {
        this.ordinary ??= this.start({ ...this.input, onNativeUsage: usage => this.account('ordinary', usage) })
        const runtime = await this.ordinary
        if (controller.signal.aborted) throw Error('BGS workflow interrupted')
        let prompt = turn.prompt, previousFailure: string | undefined
        for (;;) {
          let result: DashboardSDKMessage | undefined
          await runtime.submit({ ...turn, prompt, signal: controller.signal, onMessage: async message => {
            if (message.type === 'result' && message.parent_tool_use_id == null) {
              this.accountResult('ordinary', message)
              if (message.is_error === true) await turn.onMessage(message)
              else result = message
            } else await turn.onMessage(message)
          } })
          const receipt = await checkSavedMilestoneResult(this.input.cwd, turn.projectTurn?.milestoneResult)
          if (!receipt?.issues.length) {
            if (result) await turn.onMessage(result)
            return
          }
          if (previousFailure === receipt.key)
            throw Error('BGS current-turn milestone receipt remains invalid at ' + turn.projectTurn!.milestoneResult!.path + ': ' + receipt.issues.join('; '))
          previousFailure = receipt.key
          prompt = 'BGS saved milestone handoff check failed:\n' + receipt.issues.join('\n') +
            '\nRepair the affected saved sources within the current assignment; preserve valid work and ownership. The exact receipt path is ' +
            JSON.stringify(turn.projectTurn!.milestoneResult!.path) + '. Use complete only when the assigned work finishes; otherwise blocked with the actual reason. This is saved-source/transport feedback, not semantic quality approval.'
        }
      }
      const root = await realpath(this.input.cwd)
      if (!this.input.deliveryEvidenceDataRoot) throw Error('BGS writing workflow requires the host evidence directory')
      const store = join(await realpath(this.input.deliveryEvidenceDataRoot), 'writing-cli-sessions',
        createHash('sha256').update(root + '\0' + this.input.sessionId + '\0' + (assignment.inputRevision ?? JSON.stringify([assignment.batch ?? 1, assignment.responsibilities]))).digest('hex'))
      if (within(root, store)) throw Error('BGS task association must be outside the agent workspace')
      await mkdir(store, { recursive: true, mode: 0o700 })
      if (await realpath(store) !== store) throw Error('BGS task association directory must not be a symlink')
      const authors = nativeWritingAuthors(assignment.batch)
      // Only the three independent direction owners run in parallel. Scene
      // precedes Balance; Asset Plan precedes final technical integration.
      const groups = (assignment.batch ?? 1) === 1 ? [authors] : authors.map(author => [author])
      const handoffs: string[] = []
      for (const group of groups) {
        let firstFailure: unknown
        const settled = await Promise.allSettled(group.map(async author => {
          try { return await this.write(turn, controller.signal, root, store, assignment, author) }
          catch (error) { firstFailure ??= error; controller.abort('writing_owner_failed'); throw error }
        }))
        const failure = settled.find((row): row is PromiseRejectedResult => row.status === 'rejected')
        if (failure) throw firstFailure ?? failure.reason
        for (const row of settled) if (row.status === 'fulfilled') handoffs.push(row.value)
      }
      await turn.onMessage({ type: 'result', subtype: 'success', is_error: false,
        origin: 'workflow_host', result: handoffs.join('\n\n'),
        // This is a host transport conclusion, not another model response and
        // not semantic approval. Actual worker SDK results stay in task events.
        workflow: { kind: 'writing', documents: authors.map(author => author.document) } })
    } finally {
      turn.signal.removeEventListener('abort', abort)
      this.active = undefined
      this.busy = false
    }
  }

  private async write(turn: BeeGameSessionSubmitInput, signal: AbortSignal, root: string, store: string,
    assignment: NonNullable<BeeGameSessionSubmitInput['directionAuthors']>,
    author: ReturnType<typeof nativeWritingAuthors>[number]): Promise<string> {
    const context = assignment.contextPaths?.[author.document] ?? assignment.contextPath
    if (!isAbsolute(context) || !within(root, await realpath(context))) throw Error('BGS author context must remain inside its workspace')
    const path = join(store, author.agentType + '.json')
    let job = await readWorkflowJob(path)
    const checked = checkAuthorDraft(root, author.document, assignment.batch ?? 1)
    if (job?.result !== undefined && !checked.issues.length && job.revision === checked.revision) return job.result
    const resume = Boolean(job?.submitted)
    if (resume) {
      const config = this.input.env.BEEGAME_CONFIG_DIR
      const transcript = config && join(config, 'projects', sanitizePath(root), job!.session + '.jsonl')
      if (!transcript || !(await stat(transcript).catch(error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw error
      }))?.isFile()) throw Error('BGS writing owner has a submitted session but no saved native transcript; refusing to silently start duplicate work: ' + author.document)
    }
    job ??= { session: randomUUID(), submitted: false }
    await saveWorkflowJob(path, job)
    const task = 'bgs-writing-' + job.session
    // A resumed actor is the same native session, but a new live activation.
    // Reusing its old completed UI key hides running tools as stale updates.
    const activation = 'bgs-writing-call-' + randomUUID()
    const notify = async (subtype: string, fields: Record<string, unknown>) => {
      const message: DashboardSDKMessage = { type: 'system', subtype, task_id: task, tool_use_id: activation,
        task_type: 'local_workflow', origin: 'workflow_host', description: 'Write ' + author.document,
        input: { description: 'Write ' + author.document }, ...fields }
      this.input.onNativeTaskNotification?.({ value: JSON.stringify(message), message })
      await turn.onMessage(message)
    }
    let runtime: BeeGameSessionRuntime | undefined
    let outcome = 'failed'
    try {
      if (signal.aborted) throw Error('BGS writing workflow interrupted')
      const methods = await workflowMethods(this.input.env, author.skills)
      const epoch = randomUUID()
      runtime = await this.start({ ...this.input, sessionId: task,
        resumeSessionId: resume ? job.session : undefined,
        nativeSessionId: resume ? undefined : job.session,
        onNativeSessionId: id => { if (id !== job!.session) throw Error('Native writing session identity changed unexpectedly') },
        onNativeUsage: usage => this.account(epoch, usage),
        systemContext: [this.input.systemContext, 'BGS writing assignment: you own docs/' + author.document + '. ' +
          (assignment.contextPaths ? '' : assignment.responsibilities[author.document]) +
          '\nUse the supplied Skills as methods, not authority to expand this assignment. Preserve other owners and valid saved work. ' +
          'The full requirements, saved-source pointers, format and handoff contract are in ' + JSON.stringify(relative(root, context)) + '. ' +
          'Save the assigned draft/index and linked Scene/UI files, if assigned. No author semantic PASS: the independent Review follows all eight drafts. ' +
          'Use normal native tools and actual saved evidence; do not inspect system internals to guess a contract.\n' + methods].filter(Boolean).join('\n\n'),
        requestPermission: request => (this.input.requestPermission ?? turn.requestPermission)({ ...request, agentId: request.agentId ?? task }),
        onNativeTaskNotification: notification => this.input.onNativeTaskNotification?.({ ...notification,
          ...(notification.message ? { message: { ...notification.message, parent_tool_use_id: notification.message.parent_tool_use_id ?? activation, workflow_task_id: task } } : {}),
          ...(notification.backgroundMessage ? { backgroundMessage: { ...notification.backgroundMessage, parent_tool_use_id: notification.backgroundMessage.parent_tool_use_id ?? activation, workflow_task_id: task } } : {}) }),
      })
      this.workers.add(runtime)
      if (signal.aborted) { runtime.stop(); throw Error('BGS writing workflow interrupted') }
      await notify('task_started', { status: 'running' })
      let prompt = `Read ${JSON.stringify(relative(root, context))} and complete your assigned docs/${author.document} using the original brief and saved sources. ` +
        (resume ? 'Continue this same assignment; keep still-valid saved work, repair unfinished owned outputs only. ' : '') +
        'Return the actual saved paths and remaining dependencies/limits, not a repeated document body or a quality PASS. If the assignment itself cannot finish, begin blocked and explain the actual obstacle.'
      let previousFailure: string | undefined
      for (;;) {
        let result: DashboardSDKMessage | undefined
        job.submitted = true
        await saveWorkflowJob(path, job)
        await runtime.submit({ ...turn, directionAuthors: undefined, projectTurn: undefined, prompt, signal,
          onMessage: async message => {
            if (message.type === 'result' && message.parent_tool_use_id == null) {
              result = message
              this.accountResult(epoch, message)
              await turn.onMessage({ type: 'system', subtype: 'workflow_task_result', origin: 'workflow_host',
                parent_tool_use_id: activation, task_id: task, native_result: message })
            } else await turn.onMessage({ ...message, parent_tool_use_id: message.parent_tool_use_id ?? activation, workflow_task_id: task })
          },
          requestPermission: request => (this.input.requestPermission ?? turn.requestPermission)({ ...request, agentId: request.agentId ?? task }),
        })
        if (!result || result.is_error === true) throw Error('Writing owner did not return a successful native terminal result: ' + author.document)
        if (typeof result.result === 'string' && /^blocked(?:\s|$)/i.test(result.result.trimStart()))
          throw Error('BGS writing assignment is blocked: ' + author.document + ': ' + result.result)
        const current = checkAuthorDraft(root, author.document, assignment.batch ?? 1)
        if (!current.issues.length) {
          job.result = typeof result.result === 'string' ? result.result : 'Saved docs/' + author.document
          job.revision = current.revision
          await saveWorkflowJob(path, job)
          outcome = 'completed'
          return job.result
        }
        if (previousFailure === current.key) throw Error('BGS owned draft remains structurally invalid with no saved-source progress: ' + current.issues.join('; '))
        previousFailure = current.key
        // Ordinary host continuation in this owner's actual history, not a
        // native Stop hook, semantic self-review, new author, or hard turn cap.
        prompt = 'BGS saved-file handoff check failed:\n' + current.issues.join('\n') +
          (current.availableRequirements?.length ? '\nAvailable requirement sources: ' + JSON.stringify(current.availableRequirements) : '') +
          '\nRepair the affected owned files using the supplied contract. Preserve correct saved work and siblings. This is deterministic format/reference feedback, not semantic Review.'
      }
    } finally {
      if (runtime) {
        await runtime.dispose?.()
        this.workers.delete(runtime)
      }
      await notify('task_notification', { status: outcome === 'failed' && (turn.signal.aborted || signal.reason === 'user_stop') ? 'stopped' : outcome,
        summary: outcome === 'completed' ? 'Saved ' + author.document : 'Writing assignment unfinished; saved work retained.' })
    }
  }

  private async produce(turn: BeeGameSessionSubmitInput, signal: AbortSignal) {
    const assignment = turn.projectTurn!.production!, root = await realpath(this.input.cwd)
    const receipt = turn.projectTurn!.milestoneResult
    if (!receipt || receipt.phase !== assignment.phase || !isAbsolute(assignment.contextPath) ||
        !within(root, await realpath(assignment.contextPath)))
      throw Error('BGS production requires its current original assignment and exact phase handoff')
    const groups = Object.entries(assignment.resourceContextPaths ?? {})
    for (const [, path] of groups) if (!isAbsolute(path) || !within(root, await realpath(path)))
      throw Error('Resource group context must stay inside its workspace')
    if (!this.input.deliveryEvidenceDataRoot) throw Error('BGS production requires the host evidence directory')
    const store = join(await realpath(this.input.deliveryEvidenceDataRoot), 'production-cli-sessions',
      createHash('sha256').update(JSON.stringify([root, this.input.sessionId, assignment.phase])).digest('hex'))
    if (within(root, store)) throw Error('Production association must be outside the agent workspace')
    await mkdir(store, { recursive: true, mode: 0o700 })
    if (await realpath(store) !== store) throw Error('Production association directory must not be a symlink')
    const path = join(store, 'owner.json'), job = await readWorkflowJob(path) ?? { session: randomUUID(), submitted: false }
    // Existing private native Agent IDs cannot be silently replaced with a new
    // primary CLI identity. Old binaries/transcripts remain recoverable.
    if (!job.submitted && this.input.resumeSessionId) {
      const old = join(nativeSessionTemporaryPath(root, this.input.sessionId),
        process.platform === 'win32' ? 'claude' : 'claude-' + (process.getuid?.() ?? 0),
        sanitizePath(root), this.input.resumeSessionId, 'tasks')
      const names = await readdir(old).catch(error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw error
      })
      if (names.some(name => name.startsWith('bgs-' + assignment.phase + '-') &&
          /^bgs-(?:resources|content)(?:-(?:visual|audio))?-[a-f0-9]{64}\.json$/.test(name)))
        throw Error('Legacy native production associations exist; preserve and reconcile their saved workers before switching to primary CLI tasks. No automatic duplicate.')
    }
    const check = async () => {
      const saved = await checkSavedMilestoneResult(root, receipt)
      if (!saved) throw Error('Production requires the assigned saved receipt check')
      return { ...saved, revision: createHash('sha256').update(JSON.stringify([assignment.inputRevision, saved.sourceRevision])).digest('hex') }
    }
    const initial = await check()
    if (job.result !== undefined && initial.status === 'complete' && !initial.issues.length && job.revision === initial.revision) {
      await turn.onMessage({ type: 'result', subtype: 'success', is_error: false, origin: 'workflow_host', result: job.result })
      return
    }
    if (job.submitted) {
      const config = this.input.env.BEEGAME_CONFIG_DIR
      const transcript = config && join(config, 'projects', sanitizePath(root), job.session + '.jsonl')
      if (!transcript || !(await stat(transcript).catch(error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw error
      }))?.isFile()) throw Error('Production has a submitted session but no saved native transcript; no automatic duplicate')
    }
    await saveWorkflowJob(path, job)
    const task = 'bgs-production-' + job.session, activation = 'bgs-production-call-' + randomUUID(), epoch = randomUUID()
    const broker = (request: Parameters<NonNullable<BeeGameSessionRunnerStartInput['requestPermission']>>[0]) =>
      (this.input.requestPermission ?? turn.requestPermission)({ ...request, agentId: request.agentId ?? task })
    const runtime = await this.start({ ...this.input, sessionId: task,
      nativeSessionId: job.submitted ? undefined : job.session, resumeSessionId: job.submitted ? job.session : undefined,
      // No custom native role, tool deny-list or recursive workflow protocol.
      // The ordinary agent chooses tools and delegation within real permissions.
      systemContext: [this.input.systemContext,
        'You own only the current ' + assignment.phase + ' milestone. Read the original assignment at ' +
        JSON.stringify(relative(root, assignment.contextPath)) + ' for confirmed requirements, source versions, capabilities and the exact handoff. ' +
        'Preserve reviewed design and valid saved work. Report source-backed owner decisions instead of silently changing another stage. ' +
        'Choose normal native tools and delegation; avoid concurrent writes to shared files. Check actual outputs and report remaining limitations honestly. ' +
        'A successful task or format check is not a quality PASS. Use the supplied production Skill as a method, not additional authority.' +
        (groups.length ? '\nOptional disjoint production task inputs: ' + JSON.stringify(Object.fromEntries(groups.map(([name, path]) => [name, relative(root, path)]))) +
          '. Choose whether to delegate those groups. The main resources owner alone performs shared registration and writes the milestone receipt; no group job was automatically launched.' : ''),
        await workflowMethods(this.input.env, ['game-content-pipeline-engineer'])].filter(Boolean).join('\n\n'),
      onNativeSessionId: id => { if (id !== job.session) throw Error('Production native identity changed unexpectedly') },
      onNativeUsage: usage => this.account(epoch, usage), requestPermission: broker,
      onNativeTaskNotification: notification => this.input.onNativeTaskNotification?.({ ...notification,
        ...(notification.message ? { message: { ...notification.message, parent_tool_use_id: notification.message.parent_tool_use_id ?? activation } } : {}),
        ...(notification.backgroundMessage ? { backgroundMessage: { ...notification.backgroundMessage, parent_tool_use_id: notification.backgroundMessage.parent_tool_use_id ?? activation } } : {}) }),
    })
    this.workers.add(runtime)
    const notify = async (subtype: string, status: string) => {
      const message: DashboardSDKMessage = { type: 'system', subtype, status, origin: 'workflow_host',
        task_id: task, tool_use_id: activation, task_type: 'local_workflow', description: 'Produce ' + assignment.phase }
      this.input.onNativeTaskNotification?.({ value: JSON.stringify(message), message }); await turn.onMessage(message)
    }
    let outcome = 'failed'
    try {
      if (signal.aborted) throw Error('BGS production interrupted')
      await notify('task_started', 'running')
      let prompt = 'Read the current assignment at ' + JSON.stringify(relative(root, assignment.contextPath)) + '. ' +
        (job.submitted ? 'Continue this same saved task; inspect current outputs and repair only unfinished or invalid work. ' : 'Execute only this production milestone. ') +
        'Use applicable production Skills; choose tools and delegation yourself. Save the exact assigned complete/blocked receipt and return actual paths and remaining limits.'
      let previousFailure: string | undefined
      for (;;) {
        job.submitted = true; await saveWorkflowJob(path, job)
        let result: DashboardSDKMessage | undefined
        await runtime.submit({ ...turn, directionAuthors: undefined, projectTurn: undefined, prompt, signal, requestPermission: broker,
          onMessage: async message => {
            if (message.type === 'result' && message.parent_tool_use_id == null) {
              result = message; this.accountResult(epoch, message)
              await turn.onMessage({ type: 'system', subtype: 'workflow_task_result', origin: 'workflow_host',
                parent_tool_use_id: activation, task_id: task, native_result: message })
            } else await turn.onMessage({ ...message, parent_tool_use_id: message.parent_tool_use_id ?? activation, workflow_task_id: task })
          } })
        if (!result || result.is_error) throw Error('Production did not return a successful native terminal result')
        const checked = await check()
        if (!checked.issues.length) {
          job.result = typeof result.result === 'string' ? result.result : 'Saved ' + receipt.path
          job.revision = checked.revision; await saveWorkflowJob(path, job)
          outcome = checked.status === 'blocked' ? 'blocked' : 'completed'
          await turn.onMessage({ type: 'result', subtype: 'success', is_error: false, origin: 'workflow_host', result: job.result })
          return
        }
        if (previousFailure === checked.key) throw Error('BGS production handoff remains invalid without saved-source progress: ' + checked.issues.join('; '))
        previousFailure = checked.key
        prompt = 'BGS saved production handoff diagnostics:\n' + checked.issues.join('\n') +
          '\nContinue this same owner assignment. Repair affected saved work within the current scope; reuse valid files and evidence. ' +
          'Save the exact receipt at ' + JSON.stringify(relative(root, receipt.path)) +
          '. Use blocked with the actual obstacle when necessary owner decisions/evidence are unavailable. This is not semantic quality approval.'
      }
    } finally {
      await runtime.dispose?.(); this.workers.delete(runtime)
      await notify('task_notification', signal.aborted ? 'stopped' : outcome)
    }
  }


  private async review(turn: BeeGameSessionSubmitInput, signal: AbortSignal) {
    const scope = turn.projectTurn!, root = await realpath(this.input.cwd)
    if (!scope.reviewContextPath || !scope.reviewResultPath || !scope.reviewWorkspace ||
        !scope.reviewStep || !scope.reviewReceiptContext || await realpath(scope.reviewWorkspace) !== root)
      throw Error('BGS Review requires its original bounded workspace, step and receipt')
    if (!isAbsolute(scope.reviewContextPath) || !within(root, await realpath(scope.reviewContextPath)))
      throw Error('Review task context must remain inside its workspace')
    const receipt = join(await realpath(dirname(scope.reviewResultPath)), scope.reviewResultPath.slice(scope.reviewResultPath.lastIndexOf('/') + 1))
    if (!relative(root, receipt).startsWith('.beegame/tmp/') || !receipt.endsWith('.txt'))
      throw Error('Review receipt must use its assigned workspace temporary file')
    if (!this.input.deliveryEvidenceDataRoot) throw Error('BGS Review requires the host evidence directory')
    const store = join(await realpath(this.input.deliveryEvidenceDataRoot), 'review-cli-sessions',
      createHash('sha256').update(JSON.stringify([root, this.input.sessionId, scope.reviewStep, scope.reviewDocuments,
        scope.reviewRevision])).digest('hex'))
    if (within(root, store)) throw Error('BGS Review association must be outside the agent workspace')
    await mkdir(store, { recursive: true, mode: 0o700 })
    if (await realpath(store) !== store) throw Error('Review association directory must not be a symlink')
    const path = join(store, 'owner.json')
    const job = await readWorkflowJob(path) ?? { session: randomUUID(), submitted: false }
    const saved = job.checkpoint as { reads: ReviewReadState; policy?: ReviewPolicyState } | undefined
    if (saved && (!saved.reads || !saved.reads.initial || !saved.reads.files ||
        Object.entries(saved.reads.files).some(([name, row]) => !scope.reviewDocuments!.includes(name) &&
          !Object.hasOwn(scope.reviewReadScope ?? {}, name) || !row || !Array.isArray(row.ranges) ||
          row.ranges.some(r => !Number.isSafeInteger(r.start) || !Number.isSafeInteger(r.end) || r.start < 1 ||
            r.end < r.start || !/^[a-f0-9]{64}$/.test(r.hash)) || row.full !== undefined && !/^[a-f0-9]{64}$/.test(row.full))))
      throw Error('Invalid saved Review source-exposure state')
    const exposure = await ReviewSourceExposure.create(root, scope, saved?.reads)
    const checkpoint = { reads: exposure.state, policy: saved?.policy }
    job.checkpoint = checkpoint
    let persistence = Promise.resolve()
    const persist = () => persistence = persistence.then(() => saveWorkflowJob(path, job))
    const task = 'bgs-review-' + job.session, activation = 'bgs-review-call-' + randomUUID()
    const broker = (request: Parameters<NonNullable<BeeGameSessionRunnerStartInput['requestPermission']>>[0]) =>
      (this.input.requestPermission ?? turn.requestPermission)({ ...request, agentId: request.agentId ?? task })
    const policy = reviewToolPolicy(scope, broker, checkpoint.policy, async state => { checkpoint.policy = state; await persist() })
    const check = async () => {
      const reads = await exposure.check()
      let content = ''
      try {
        if (await realpath(scope.reviewResultPath!) !== receipt) throw Error('Review receipt must be the exact assigned file')
        const file = await open(receipt, constants.O_RDONLY | constants.O_NOFOLLOW)
        try { if (!(await file.stat()).isFile()) throw Error('Review receipt is not a file'); content = await file.readFile('utf8') }
        finally { await file.close() }
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      const verdict = content ? await policy({ toolName: 'Write', toolUseID: 'host-saved-receipt-check',
        input: { file_path: receipt, content }, message: 'Host saved receipt check' }) : undefined
      const issues = [...(content ? verdict?.behavior === 'deny' ? [verdict.message ?? 'Review receipt invalid'] : []
        : ['Current-turn Review receipt is missing.']),
        ...(reads.missing.length ? ['Inspect actual remaining saved-source ranges: ' + reads.missing.join(', ')] : [])]
      return { issues, revision: reads.revision, status: content.trim().split(/\r?\n/)[0],
        key: JSON.stringify([issues, reads.revision, createHash('sha256').update(content).digest('hex')]) }
    }
    const initial = await check()
    if (job.result !== undefined && initial.status === 'complete' && !initial.issues.length && initial.revision === job.revision) {
      await turn.onMessage({ type: 'result', subtype: 'success', is_error: false, origin: 'workflow_host', result: job.result })
      return
    }
    if (job.submitted) {
      const config = this.input.env.BEEGAME_CONFIG_DIR
      const transcript = config && join(config, 'projects', sanitizePath(root), job.session + '.jsonl')
      if (!transcript || !(await stat(transcript).catch(error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw error
      }))?.isFile()) throw Error('Review has a submitted session but no saved native transcript; no automatic duplicate')
    }
    await persist()
    const catalog = await realpath(this.input.env.BEEGAME_NATIVE_BUILTIN_SKILLS_DIR ?? getBuiltinSkillsDirectory())
    const methodDocuments = [...new Set([...scope.reviewDocuments!.filter(name =>
      !scope.reviewReadScope || scope.reviewReadScope[name] == null || scope.reviewReadScope[name]!.length),
      ...scope.reviewReceiptContext.findings.filter(f => f.documents.some(name => scope.reviewDocuments!.includes(name)))
        .flatMap(f => f.sources.map(source => source.document))])]
    const methods = await workflowMethods(this.input.env, ['game-design-check']) + '\n\n' +
      await designReviewReference(join(catalog, 'game-design-check'), methodDocuments)
    const epoch = randomUUID()
    const runtime = await this.start({ ...this.input, sessionId: task,
      nativeSessionId: job.submitted ? undefined : job.session, resumeSessionId: job.submitted ? job.session : undefined,
      nativeTools: ['Read', 'Glob', 'Grep', 'Bash', 'WebFetch', 'WebSearch', 'Write',
        ...(scope.reviewStep === 'revise' ? ['Edit', 'AskUserQuestion'] : [])],
      toolPolicy: policy, requestPermission: broker,
      systemContext: [this.input.systemContext, reviewSystemPrompt(scope, relative(root, scope.reviewContextPath),
        relative(root, receipt), methods)].filter(Boolean).join('\n\n'),
      onNativeUsage: usage => this.account(epoch, usage),
      onNativeSessionId: id => { if (id !== job.session) throw Error('Review native session identity changed unexpectedly') },
      onNativeTaskNotification: notification => this.input.onNativeTaskNotification?.({ ...notification,
        ...(notification.message ? { message: { ...notification.message, parent_tool_use_id: notification.message.parent_tool_use_id ?? activation } } : {}) }),
    })
    this.workers.add(runtime)
    const notify = async (subtype: string, status: string) => {
      const message: DashboardSDKMessage = { type: 'system', subtype, status, origin: 'workflow_host',
        task_id: task, tool_use_id: activation, task_type: 'local_workflow',
        description: scope.reviewStep + ' ' + scope.reviewDocuments!.join(', ') }
      this.input.onNativeTaskNotification?.({ value: JSON.stringify(message), message })
      await turn.onMessage(message)
    }
    let outcome = 'failed'
    try {
      if (signal.aborted) throw Error('BGS Review interrupted')
      await notify('task_started', 'running')
      let prompt = 'Perform only the assigned ' + scope.reviewStep + ' using the original task at ' +
        JSON.stringify(relative(root, scope.reviewContextPath)) + '. ' +
        (job.submitted ? 'Continue the same saved assignment; reuse current inspected sources and valid corrections. ' : '') +
        'Save the exact assigned receipt; return its path and actual remaining limitations, not another Review or a quality PASS.'
      let previousFailure: string | undefined
      for (;;) {
        job.submitted = true; await persist()
        let result: DashboardSDKMessage | undefined
        await runtime.submit({ ...turn, directionAuthors: undefined, projectTurn: undefined, prompt, signal,
          requestPermission: broker, onMessage: async message => {
            await exposure.observe(message)
            if (message.type === 'user') await persist()
            if (message.type === 'result' && message.parent_tool_use_id == null) {
              result = message; this.accountResult(epoch, message)
              await turn.onMessage({ type: 'system', subtype: 'workflow_task_result', origin: 'workflow_host',
                parent_tool_use_id: activation, task_id: task, native_result: message })
            } else await turn.onMessage({ ...message, parent_tool_use_id: message.parent_tool_use_id ?? activation, workflow_task_id: task })
          } })
        if (!result || result.is_error) throw Error('Review did not return a successful native terminal result')
        const checked = await check()
        if (!checked.issues.length) {
          job.result = typeof result.result === 'string' ? result.result : 'Saved ' + relative(root, receipt)
          job.revision = checked.revision; await persist()
          outcome = checked.status === 'blocked' ? 'blocked' : 'completed'
          await turn.onMessage({ type: 'result', subtype: 'success', is_error: false, origin: 'workflow_host', result: job.result })
          return
        }
        if (previousFailure === checked.key) throw Error('BGS saved-document Review incomplete; no saved-source progress: ' + checked.issues.join('; '))
        previousFailure = checked.key
        prompt = 'BGS saved Review handoff diagnostics:\n' + checked.issues.join('\n') +
          '\nContinue this same ' + scope.reviewStep + ' assignment at the same receipt path ' + JSON.stringify(relative(root, receipt)) +
          '. Read only the remaining ranges/dependencies, preserve valid corrections and original findings. Correct transport fields without repeating unchanged checks. This does not certify semantic quality.'
      }
    } finally {
      await persistence
      await runtime.dispose?.(); this.workers.delete(runtime)
      await notify('task_notification', signal.aborted ? 'stopped' : outcome)
    }
  }


  stop() {
    this.active?.abort('user_stop')
    for (const runtime of this.workers) runtime.stop()
    void this.ordinary?.then(runtime => runtime.stop(), () => {})
  }

  dispose(): Promise<void> {
    return this.disposal ??= (async () => {
      this.closed = true
      this.stop()
      await Promise.all([...this.workers].map(runtime => runtime.dispose?.()))
      await (await this.ordinary)?.dispose?.()
    })()
  }
}

export async function readWorkflowJob(path: string): Promise<WorkflowJob | undefined> {
  try {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const info = await file.stat()
      if (!info.isFile() || info.size > 1024 * 1024) throw Error('Invalid BGS writing session association')
      const value = JSON.parse(await file.readFile('utf8')) as WorkflowJob
      if (!value || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value.session) || typeof value.submitted !== 'boolean' ||
          value.result !== undefined && typeof value.result !== 'string' || value.revision !== undefined && !/^[a-f0-9]{64}$/.test(value.revision))
        throw Error('Invalid BGS writing session association')
      return value
    } finally { await file.close() }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

export async function saveWorkflowJob(path: string, job: WorkflowJob) {
  const temporary = path + '.' + randomUUID()
  const file = await open(temporary, 'wx', 0o600)
  try { await file.writeFile(JSON.stringify(job)); await file.sync(); await file.close(); await rename(temporary, path) }
  finally { await file.close().catch(() => {}); await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error }) }
}

export async function workflowMethods(env: Record<string, string>, skills: readonly string[]) {
  const root = await realpath(env.BEEGAME_NATIVE_BUILTIN_SKILLS_DIR ?? getBuiltinSkillsDirectory())
  return (await Promise.all(skills.map(async name => {
    const path = await realpath(join(root, name, 'SKILL.md'))
    if (!within(root, path)) throw Error('BGS writing Skill escaped its catalog')
    const file = await open(path, 'r')
    try {
      if (!(await file.stat()).isFile()) throw Error('BGS writing Skill is not a file')
      const body = await file.readFile('utf8')
      if (!body.trim()) throw Error('Required BGS writing Skill is empty: ' + name)
      return '# BGS-supplied method: ' + name + '\nSource directory: ' + dirname(path) + '\n' + body
    } finally { await file.close() }
  }))).join('\n\n')
}
