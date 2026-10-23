// Isolated eight-document BGS test. No alternative author/checker scheme,
// no known findings in prompts, no resource turn, no account-data writes.
import { mkdir, readFile, writeFile, copyFile, cp } from 'node:fs/promises'
import { join } from 'node:path'
import { createSupabaseDashboardStoreFromEnv } from '/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/claude-code-main/.worktrees/ir-workflow-integration/packages/agent-workflow-server/src/supabase-dashboard-store.ts'
import { BeeGameSessionManager } from '/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/claude-code-main/.worktrees/ir-workflow-integration/packages/agent-workflow-server/src/beegame/session-manager.ts'
import { createNativeCliProcessRunner } from '/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/claude-code-main/.worktrees/ir-workflow-integration/packages/agent-workflow-server/src/beegame/native-cli-process-runner.ts'
import { sendProjectConversation } from '/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/claude-code-main/.worktrees/ir-workflow-integration/packages/agent-workflow-server/src/beegame/project-conversation.ts'
import { beginProjectDelivery, projectDeliveryStatePath, PROJECT_DOCUMENTS } from '/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/claude-code-main/.worktrees/ir-workflow-integration/packages/agent-workflow-server/src/beegame/project-delivery.ts'
import { AUTHOR_BATCHES } from '/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/claude-code-main/.worktrees/ir-workflow-integration/packages/agent-workflow-server/src/beegame/project-author.ts'

const root = import.meta.dir
const repo = '/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/claude-code-main/.worktrees/ir-workflow-integration'
const projectId = 'priority-cli-breakout-20261001'
const workspace = join(root, 'projects/users/spatial-test', projectId)
const dataRoot = join(root, 'dashboard')
const modelConfigId = 'llm_ac40e5d1be394ffe925e3f2532dedd34'
const message = '我想做一个打砖块游戏。'
const brief = JSON.stringify({ kind: 'confirmed_build_brief', document_language: 'zh',
  game_user_visible_language: 'zh', agent_response_language: 'zh', idea: message,
  default_first_release_scope: { target: 'small complete playable version',
    content: 'one working core loop with only representative content; usually one or two levels if levels apply',
    defer: 'unrequested extra levels, modes, and polish' }, selected_option: null,
  settings: { platform: 'Web', engine: 'React', dimension: '2D', orientation: 'Landscape', genre: 'Arcade', visualStyle: 'Stylized', inputs: ['Keyboard/mouse', 'Touch'] },
  confirmed_gdd: null, build_source: null, analysis_id: null, creation_mode: 'creative',
  reference_files: [], resource_library_usage: 'optional' }, null, 2)
if (await Bun.file(join(root, 'inputs.json')).exists()) throw Error('Fresh test already exists; no automatic retry or overwrite')
await mkdir(join(workspace, 'docs'), { recursive: true })
await mkdir(join(workspace, '.beegame/config'), { recursive: true })
await writeFile(join(root, 'inputs.json'), JSON.stringify({ projectId, initialMessage: message,
  settings: JSON.parse(brief).settings, scope: 'Eight fresh design documents and one Review/Revision; stop before resources',
  budget: 'User authorized without credit limit; one fresh run, no automated extra repair turns',
  authorBatches: AUTHOR_BATCHES, mainSessions: 1, reusedDrafts: false, injectedFindings: false }, null, 2))

const login = await fetch(`${process.env.BEEGAME_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: process.env.BEEGAME_SUPABASE_ANON_KEY!, 'content-type': 'application/json' },
  body: JSON.stringify({ email: process.env.BEEGAME_SMOKE_EMAIL, password: process.env.BEEGAME_SMOKE_PASSWORD }),
  signal: AbortSignal.timeout(20000),
})
if (!login.ok) throw Error(`Test account authentication: ${login.status}`)
const auth = await login.json()
const selected = await createSupabaseDashboardStoreFromEnv()!.withAuthToken(auth.access_token).loadRlsVisibleModelRuntimeEnv(modelConfigId)
if (selected.ANTHROPIC_DEFAULT_SONNET_MODEL !== 'ark-code-latest') throw Error('Model mismatch')
const endpoint = selected.ANTHROPIC_BASE_URL!.replace(/\/$/, '')

// Observe provider usage while forwarding request bodies and stream bytes unchanged.
// This records tokens only, not an account Credit settlement or price estimate.
let requestCount = 0, currentStage = 'preflight', closing = false
const usageRows: any[] = [], pending = new Set<AbortController>()
const proxy = Bun.serve({ hostname: '127.0.0.1', port: 0, idleTimeout: 0, async fetch(req) {
  if (closing) return new Response('Test has ended', { status: 503 })
  const path = new URL(req.url).pathname
  const body = await req.text()
  const countOnly = path.endsWith('/count_tokens')
  const id = countOnly ? undefined : ++requestCount
  if (id) await writeFile(join(root, `request-${id}.json`), body, { mode: 0o600 })
  const stage = currentStage, started = Date.now(), abort = new AbortController()
  pending.add(abort)
  const headers = new Headers(req.headers)
  headers.delete('host'); headers.delete('content-length')
  let upstream: Response
  try { upstream = await fetch(endpoint + path, { method: req.method, headers,
    body, signal: AbortSignal.any([abort.signal, AbortSignal.timeout(600000)]) }) }
  catch (error) {
    pending.delete(abort)
    if (id) usageRows.push({ id, stage, error: error instanceof Error ? error.name : 'unknown', usageKnown: false })
    return Response.json({ type: 'error', error: { type: 'api_error', message: 'Upstream request failed' } }, { status: 502 })
  }
  if (countOnly) {
    pending.delete(abort)
    await writeFile(join(root, 'token-count-endpoint.json'), JSON.stringify({ forwarded: true, status: upstream.status }))
    return upstream
  }
  const reader = upstream.body!.getReader(), decoder = new TextDecoder()
  let buffer = '', usage: Record<string, number> = {}, finished = false
  async function finish(error?: string) {
    if (finished) return
    finished = true; pending.delete(abort)
    usageRows.push({ id, stage, status: upstream.status, usage,
      usageKnown: typeof usage.output_tokens === 'number', elapsedSeconds: (Date.now() - started) / 1000,
      ...(error ? { error } : {}) })
    await writeFile(join(root, 'usage.json'), JSON.stringify(usageRows, null, 2))
    console.log(JSON.stringify({ event: 'request_end', id, stage, status: upstream.status,
      outputTokens: usage.output_tokens ?? null }))
  }
  const stream = new ReadableStream({ async pull(controller) {
    try {
      const { done, value } = await reader.read()
      if (done) { await finish(); controller.close(); return }
      buffer += decoder.decode(value, { stream: true })
      let e: number
      while ((e = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, e).trim(); buffer = buffer.slice(e + 1)
        if (line.startsWith('data: ')) {
          try { const item = JSON.parse(line.slice(6)); Object.assign(usage, item.message?.usage ?? {}, item.usage ?? {}) } catch {}
        }
      }
      controller.enqueue(value)
    } catch (error) { await finish(error instanceof Error ? error.name : 'unknown'); controller.error(error) }
  }, async cancel() { abort.abort(); await finish('Client cancelled'); await reader.cancel() } })
  return new Response(stream, { status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'text/event-stream' } })
} })

const env = { ...selected, BEEGAME_MODEL_TYPE: 'anthropic', ANTHROPIC_BASE_URL: `http://127.0.0.1:${proxy.port}`,
  BEEGAME_CONFIG_DIR: join(workspace, '.beegame/config'),
  BEEGAME_NATIVE_BUILTIN_SKILLS_DIR: join(repo, '.beegame/skills/builtinskills'), SKILL_SEARCH_ENABLED: '1' }
const manager = new BeeGameSessionManager(createNativeCliProcessRunner(), dataRoot, () => env, {}, true)
await beginProjectDelivery(workspace, dataRoot, brief)
const session = manager.start({ workspacePath: workspace, userId: 'spatial-test', projectId, modelConfigId, language: 'zh' })
const stages: any[] = [], started = Date.now()
let stopped = false, failure: string | undefined
const stop = () => { stopped = true; manager.stop(session.id, 'user_stop') }
process.on('SIGTERM', stop); process.on('SIGINT', stop)
const seenPermissions = new Set<string>()
const permissionTimer = setInterval(async () => {
  for (const permission of manager.pendingPermissionsForProject('spatial-test', projectId, workspace)) {
    if (seenPermissions.has(permission.toolUseID)) continue
    seenPermissions.add(permission.toolUseID)
    await writeFile(join(root, 'pending-permission.json'), JSON.stringify({
      sessionId: permission.sessionId, toolUseID: permission.toolUseID, toolName: permission.toolName, input: permission.input,
    }, null, 2), { mode: 0o600 })
    console.log(JSON.stringify({ event: 'permission_pending', toolName: permission.toolName }))
  }
}, 1000)

async function executeStage(label: string, initial = false) {
  if (stopped) throw Error('Test was stopped')
  currentStage = label
  const from = manager.transcript(session.id).length, stageStarted = Date.now(), firstRequest = requestCount + 1
  console.log(JSON.stringify({ event: 'stage_start', label, sessionId: session.id }))
  await sendProjectConversation({ sessions: manager, deliveryDataRoot: dataRoot, sessionId: session.id,
    ownerId: 'spatial-test', message: initial ? message : '继续', options: { language: 'zh' },
    ...(initial ? { initialBrief: { displayText: message, confirmedBriefContext: brief } } : { autoContinuation: true }) })
  await manager.waitForSessionIdle(session.id)
  const events = manager.transcript(session.id).slice(from)
  const state = JSON.parse(await readFile(projectDeliveryStatePath(workspace, dataRoot), 'utf8'))
  const row = { label, elapsedSeconds: (Date.now() - stageStarted) / 1000,
    firstRequest, lastRequest: requestCount, sessionId: session.id, state,
    failed: events.some(event => event.type === 'turn.failed'), stopped }
  await cp(join(workspace, 'docs'), join(root, 'after-' + label, 'docs'), { recursive: true, errorOnExist: true, force: false })
  try { await cp(join(workspace, 'content/ui'), join(root, 'after-' + label, 'content/ui'), { recursive: true, errorOnExist: true, force: false }) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  stages.push(row)
  await writeFile(join(root, `${label}-events.json`), JSON.stringify(events, null, 2))
  await writeFile(join(root, 'stages.json'), JSON.stringify(stages, null, 2))
  console.log(JSON.stringify({ event: 'stage_end', label, elapsedSeconds: row.elapsedSeconds, phase: state.phase, failed: row.failed }))
  if (row.failed || stopped) throw Error(`Stage did not complete: ${label}`)
  return state
}

try {
  for (let batch = 0; batch < AUTHOR_BATCHES.length; batch++) {
    const state = JSON.parse(await readFile(projectDeliveryStatePath(workspace, dataRoot), 'utf8'))
    if (state.phase !== 'author' || (state.authorBatch ?? 0) !== batch) throw Error('Unexpected author state; no forced advancement')
    const next = await executeStage(`author-${batch + 1}`, batch === 0)
    if (next.phase === 'author' && (next.authorBatch ?? 0) === batch) throw Error('Author did not advance; no automated repair turn')
  }
  const state = JSON.parse(await readFile(projectDeliveryStatePath(workspace, dataRoot), 'utf8'))
  if (state.phase !== 'review') throw Error('Author did not reach Review')
  await mkdir(join(root, 'before-review'), { recursive: true })
  for (const name of PROJECT_DOCUMENTS) await copyFile(join(workspace, 'docs', name), join(root, 'before-review', name))
  try { await cp(join(workspace, 'content/ui'), join(root, 'before-review-ui'), { recursive: true, errorOnExist: true, force: false }) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const result = await executeStage('review')
  await writeFile(join(root, 'design-result.json'), JSON.stringify({ state: result,
    reportedReviewComplete: result.phase === 'resources', acceptedByHostGeometry: result.phase === 'resources', scope: 'Design test; no resource turn dispatched' }, null, 2))
  if (result.phase !== 'resources') throw Error('Review did not advance; retain findings, no automatic paid repair')
} catch (error) {
  failure = error instanceof Error ? error.message : String(error)
  console.log(JSON.stringify({ event: 'test_failed', reason: failure }))
  process.exitCode = 1
} finally {
  clearInterval(permissionTimer); process.off('SIGTERM', stop); process.off('SIGINT', stop)
  await manager.dispose()
  closing = true
  for (const abort of pending) abort.abort()
  proxy.stop(true)
  await writeFile(join(root, 'summary.json'), JSON.stringify({ elapsedSeconds: (Date.now() - started) / 1000,
    model: selected.ANTHROPIC_DEFAULT_SONNET_MODEL, sessionId: session.id, requestCount, usageRows, stages,
    stopped, failure, scope: 'Eight fresh documents + one Review/Revision; no extra repair/model turns' }, null, 2))
  console.log(JSON.stringify({ event: 'finished', elapsedSeconds: (Date.now() - started) / 1000, failed: Boolean(failure) }))
}
