import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createNativeCliProcessRunner, nativeRuntimeCommand } from '../src/beegame/native-cli-process-runner'
import { BeeGameSessionManager, type BeeGameSessionRunnerStartInput } from '../src/beegame/session-manager'
import { sendProjectConversation } from '../src/beegame/project-conversation'
import { beginProjectDelivery, readProjectDelivery } from '../src/beegame/project-delivery'
import { writeDesignDocumentsFixture, designBaselineFixture } from '../src/beegame/fixtures/layout-fixture'
import { writeBeeGameAssetManifest } from '../src/beegame/asset-contracts'
import { assetManifestAuthoringExamples } from '../src/beegame/asset-manifest-authoring-contract'
import { projectContentAuthority } from '../src/beegame/project-delivery'
import { checkDesignHandoffDraft } from '../src/beegame/design-handoff'
import { standardCliProvider } from '@bee-game-studio/agent-workflow/standard-cli-provider'
import { RUNTIME_ENV_ALIASES } from '../../../src/utils/runtimeEnvironment'

// Explicit isolated CLI + fake loopback provider: no saved credentials or paid requests.
const cli = process.env.BEEGAME_REVIEW_TEST_CLI

test.skipIf(!cli).each([false, true])('direct CLI public settings select the model without BGS native overrides, legacyNames=%s (offline)', async legacyNames => {
  const root = await realpath(await mkdtemp('/private/tmp/bgs-direct-public-provider-'))
  const workspace = join(root, 'workspace'), config = join(root, 'config')
  await mkdir(workspace); await mkdir(config)
  const staleConfig = JSON.stringify({ modelType: 'openai' })
  await writeFile(join(config, 'settings.json'), staleConfig)
  const requests: string[] = []
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (new URL(request.url).pathname.endsWith('/count_tokens')) return Response.json({ input_tokens: 10 })
    if (!new URL(request.url).pathname.endsWith('/messages')) return new Response('', { status: 404 })
    const body = await request.json() as { model: string }
    requests.push(body.model)
    return response(body.model, { type: 'text', text: 'DIRECT_PUBLIC_SETTINGS_OK' })
  } })
  const provider = standardCliProvider({
    PATH: process.env.PATH!, HOME: root, BEEGAME_CONFIG_DIR: config,
    BEEGAME_MODEL_TYPE: 'anthropic', BGS_USE_GEMINI: '1',
    ANTHROPIC_AUTH_TOKEN: 'LOCAL_DIRECT_FIXTURE_KEY',
    ANTHROPIC_BASE_URL: 'http://127.0.0.1:' + server.port,
    BGS_DEFAULT_BALANCED_MODEL: 'claude-sonnet-4-6',
    BGS_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
  })
  const childEnvironment = { ...provider.environment }
  if (legacyNames) {
    for (const [legacy, product] of Object.entries(RUNTIME_ENV_ALIASES)) {
      if (childEnvironment[product] === undefined) continue
      childEnvironment[legacy] = childEnvironment[product]!
      delete childEnvironment[product]
    }
  }
  const child = Bun.spawn([process.execPath, cli!, '--print', '--output-format', 'json',
    '--settings', JSON.stringify({ modelType: provider.modelType }),
    '--tools', '', '--disable-slash-commands', '--setting-sources', '',
    '--mcp-config', '{"mcpServers":{}}', '--strict-mcp-config',
    '--no-session-persistence', '--no-chrome'],
    { cwd: workspace, env: childEnvironment, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
  const timer = setTimeout(() => child.kill('SIGKILL'), 15_000)
  try {
    child.stdin.write('Return the synthetic direct CLI result.'); child.stdin.end()
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ])
    expect(exitCode, stderr).toBe(0)
    expect(JSON.parse(stdout)).toMatchObject({ subtype: 'success', is_error: false, result: 'DIRECT_PUBLIC_SETTINGS_OK' })
    expect(requests).toEqual(['claude-sonnet-4-6'])
    expect(provider.environment).not.toHaveProperty('BEEGAME_MODEL_TYPE')
    expect(await readFile(join(config, 'settings.json'), 'utf8')).toBe(staleConfig)
  } finally {
    clearTimeout(timer)
    if (child.exitCode === null) { child.kill('SIGKILL'); await child.exited }
    server.stop(true); await rm(root, { recursive: true, force: true })
  }
}, 20_000)

test.skipIf(!cli).each([false, true])('public modelType settings select the host provider over stale native config, isolated=%s (offline)', async isolated => {
  const root = await realpath(await mkdtemp('/private/tmp/bgs-public-provider-')), workspace = join(root, 'workspace'), config = join(root, 'config')
  await mkdir(workspace); await mkdir(config)
  await writeFile(join(config, 'settings.json'), JSON.stringify({ modelType: 'openai' }))
  let requests = 0
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (new URL(request.url).pathname.endsWith('/count_tokens')) return Response.json({ input_tokens: 10 })
    if (!new URL(request.url).pathname.endsWith('/messages')) return new Response('', { status: 404 })
    const input = await request.json() as { model: string }; requests++
    return response(input.model, { type: 'text', text: 'Selected public Anthropic settings.' })
  } })
  const start: BeeGameSessionRunnerStartInput = { sessionId: 'offline-selected-provider', cwd: workspace,
    ...(isolated ? { isolatedTask: { workspacePath: workspace, readOnlyPaths: [] } } : {}),
    env: { BEEGAME_CONFIG_DIR: config, BEEGAME_MODEL_TYPE: 'anthropic', BGS_USE_GEMINI: '1',
      ANTHROPIC_AUTH_TOKEN: 'LOCAL_ONLY_FIXTURE_KEY', ANTHROPIC_BASE_URL: 'http://127.0.0.1:' + server.port,
      BGS_DEFAULT_BALANCED_MODEL: 'claude-sonnet-4-6', BGS_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1' } }
  const runtime = await createNativeCliProcessRunner({ command: [process.execPath, cli!, ...nativeRuntimeCommand(start).slice(2)] }).start(start)
  const controller = new AbortController(), timer = setTimeout(() => controller.abort('offline_deadline'), 15_000)
  try {
    const results: Record<string, unknown>[] = []
    await runtime.submit({ prompt: 'Confirm selected provider only.', signal: controller.signal,
      requestPermission: async () => ({ behavior: 'deny' }), onMessage: message => { if (message.type === 'result') results.push(message) } })
    expect(requests).toBe(1)
    expect(results).toHaveLength(1)
    expect(results[0]!.is_error).not.toBe(true)
    expect(await readFile(join(config, 'settings.json'), 'utf8')).toBe(JSON.stringify({ modelType: 'openai' }))
  } finally { clearTimeout(timer); controller.abort('offline_cleanup'); await runtime.dispose?.(); server.stop(true); await rm(root, { recursive: true, force: true }) }
}, 20_000)

test.skipIf(!cli)('upstream large-output cache is readable through standard session paths without native BGS overrides (offline)', async () => {
  const root = await realpath(await mkdtemp('/private/tmp/bgs-upstream-cache-cli-')), workspace = join(root, 'workspace')
  await mkdir(workspace)
  const requests: Array<{ model: string; messages: any[] }> = []
  let archived = ''
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (new URL(request.url).pathname.endsWith('/count_tokens')) return Response.json({ input_tokens: 10 })
    if (!new URL(request.url).pathname.endsWith('/messages')) return new Response('', { status: 404 })
    const input = await request.json() as typeof requests[number]; requests.push(input)
    if (requests.length === 1) return response(input.model, { type: 'tool_use', id: 'big-output', name: 'Bash',
      input: { command: "printf 'UPSTREAM_CACHE_OUTPUT\\n%.0s' {1..8000}" } })
    if (requests.length === 2) {
      const blocks = input.messages.flatMap(message => Array.isArray(message.content) ? message.content : [])
      const result = blocks.find(block => block.type === 'tool_result' && block.tool_use_id === 'big-output')
      const text = typeof result?.content === 'string' ? result.content : result?.content?.map((b: any) => b.text ?? '').join('\n') ?? ''
      archived = text.match(/Full output saved to: ([^\n]+)/)?.[1] ?? ''
      expect(archived).toContain('/tool-results/')
      expect(archived).not.toContain('.native-tool-results')
      return response(input.model, { type: 'tool_use', id: 'read-cache', name: 'Read', input: { file_path: archived, limit: 1 } })
    }
    return response(input.model, { type: 'text', text: 'Checked the actual cached output.' })
  } })
  const start: BeeGameSessionRunnerStartInput = { sessionId: 'offline-cache-host', cwd: workspace,
    env: { BEEGAME_CONFIG_DIR: join(root, 'config'), BEEGAME_MODEL_TYPE: 'anthropic', ANTHROPIC_AUTH_TOKEN: 'LOCAL_ONLY_FIXTURE_KEY',
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:' + server.port, BGS_DEFAULT_BALANCED_MODEL: 'claude-sonnet-4-6',
      BGS_DEFAULT_FAST_MODEL: 'claude-sonnet-4-6', BGS_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1' } }
  const runtime = await createNativeCliProcessRunner({ command: [process.execPath, cli!, ...nativeRuntimeCommand(start).slice(2)] }).start(start)
  const controller = new AbortController(), timer = setTimeout(() => controller.abort('offline_deadline'), 20_000)
  try {
    await runtime.submit({ prompt: 'Test only standard output cache reads.', signal: controller.signal,
      requestPermission: async () => ({ behavior: 'allow' }), onMessage() {} })
    expect(requests).toHaveLength(3)
    expect(await readFile(archived, 'utf8')).toContain('UPSTREAM_CACHE_OUTPUT')
    const readResult = requests[2]!.messages.flatMap(message => Array.isArray(message.content) ? message.content : [])
      .find(block => block.type === 'tool_result' && block.tool_use_id === 'read-cache')
    expect(readResult).toBeDefined()
    if (readResult.is_error) throw new Error('Cached Read failed: ' + JSON.stringify(readResult.content))
    expect(readResult.is_error).not.toBe(true)
    expect(JSON.stringify(readResult.content)).toContain('UPSTREAM_CACHE_OUTPUT')
    const history = JSON.stringify(requests[2]!.messages)
    expect(history).toContain('read-cache')
    expect(history).not.toContain('Path is outside')
    expect(history).not.toContain('permission denied')
  } finally { clearTimeout(timer); controller.abort('offline_cleanup'); await runtime.dispose?.(); server.stop(true); await rm(root, { recursive: true, force: true }) }
}, 25_000)

test.skipIf(!cli).each(['resources', 'content'] as const)('production uses ordinary primary CLI and reuses only checked saved outputs: %s (offline)', async phase => {
  const root = await realpath(await mkdtemp('/private/tmp/bgs-public-production-cli-')), workspace = join(root, 'workspace')
  await mkdir(workspace); await writeDesignDocumentsFixture(workspace)
  const baseline = designBaselineFixture(workspace)
  await writeBeeGameAssetManifest(workspace, phase === 'resources' ? assetManifestAuthoringExamples().canonical
    : { ...assetManifestAuthoringExamples().canonical, resources: [], requirements: [] })
  if (phase === 'resources') {
    await mkdir(join(workspace, 'assets/runtime/example'), { recursive: true })
    await writeFile(join(workspace, 'assets/runtime/example/resource.json'), '{}')
  }
  if (phase === 'content') {
    const authority = projectContentAuthority(workspace)
    await writeFile(join(workspace, 'content/index.json'), JSON.stringify({ schema: 'beegame-content-package.v2', id: 'game', dimension: '2d',
      documentRevision: authority.documentRevision, assetManifestRevision: authority.assetManifestRevision,
      entryScene: 'level', sceneModel: 'game-object-v2', files: ['scenes/level.json', 'ui/menu.json'] }))
  }
  const directory = join(workspace, '.beegame/tmp/production'); await mkdir(directory, { recursive: true })
  const context = join(directory, 'context.md'), receipt = join(directory, 'result.txt')
  await writeFile(context, 'Synthetic original ' + phase + ' assignment.')
  const requests: Array<{ model: string; messages: unknown; system?: unknown }> = []
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (new URL(request.url).pathname.endsWith('/count_tokens')) return Response.json({ input_tokens: 10 })
    if (!new URL(request.url).pathname.endsWith('/messages')) return new Response('', { status: 404 })
    const input = await request.json() as typeof requests[number]; requests.push(input)
    return response(input.model, requests.length % 2 === 1 ? { type: 'tool_use', id: 'save-production-' + requests.length,
      name: 'Write', input: { file_path: receipt, content: 'complete\nSaved synthetic ' + phase + '.\n' } }
      : { type: 'text', text: 'Saved the exact receipt; no quality PASS.' })
  } })
  const start: BeeGameSessionRunnerStartInput = { sessionId: 'offline-production-host', cwd: workspace, deliveryEvidenceDataRoot: root,
    env: { BEEGAME_CONFIG_DIR: join(root, 'config'), BEEGAME_MODEL_TYPE: 'anthropic', ANTHROPIC_AUTH_TOKEN: 'LOCAL_ONLY_FIXTURE_KEY',
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:' + server.port, BGS_DEFAULT_BALANCED_MODEL: 'claude-sonnet-4-6',
      BGS_DEFAULT_FAST_MODEL: 'claude-sonnet-4-6', BGS_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1' } }
  const runtime = await createNativeCliProcessRunner({ command: [process.execPath, cli!, ...nativeRuntimeCommand(start).slice(2)] }).start(start)
  const events: Record<string, unknown>[] = [], controller = new AbortController()
  const timer = setTimeout(() => controller.abort('offline_deadline'), 25_000)
  const turn = { prompt: 'Execute only this synthetic production milestone.', signal: controller.signal,
    projectTurn: { production: { phase, contextPath: context, inputRevision: 'a'.repeat(64) },
      milestoneResult: { phase, path: receipt, objective: '{"settings":{"orientation":"Landscape","dimension":"2D"}}', designBaseline: baseline } },
    requestPermission: async () => ({ behavior: 'allow' as const }), onMessage: (message: Record<string, unknown>) => { events.push(message) } }
  try {
    await runtime.submit(turn)
    expect(requests).toHaveLength(2)
    expect(JSON.stringify(requests[0]!.system)).toContain('# BGS-supplied method: game-content-pipeline-engineer')
    expect(JSON.stringify(events)).not.toContain('"name":"Agent"')
    expect(events.filter(row => row.type === 'result')).toHaveLength(1)
    expect(events.at(-1)?.status).toBe('completed')
    await runtime.submit(turn)
    expect(requests).toHaveLength(2)
    await runtime.submit({ ...turn, projectTurn: { ...turn.projectTurn, production: { ...turn.projectTurn.production, inputRevision: 'b'.repeat(64) } } })
    expect(requests).toHaveLength(4)
    const tasks = events.filter(row => row.subtype === 'task_started')
    expect(tasks).toHaveLength(2)
    expect(tasks[0]!.task_id).toBe(tasks[1]!.task_id) // same ordinary native owner, not regeneration
    expect(tasks[0]!.tool_use_id).not.toBe(tasks[1]!.tool_use_id)
    const projects = join(start.env.BEEGAME_CONFIG_DIR!, 'projects')
    expect((await readdir(projects, { recursive: true })).filter(path => /[a-f0-9-]{36}\.jsonl$/.test(path))).toHaveLength(1)
    expect(JSON.stringify(requests[2]!.messages)).toContain('Saved the exact receipt')
  } finally { clearTimeout(timer); controller.abort('offline_cleanup'); await runtime.dispose?.(); server.stop(true); await rm(root, { recursive: true, force: true }) }
}, 30_000)

test.skipIf(!cli).each(['complete', 'unread-first', 'scope-denied', 'question'] as const)('BGS public Review is a primary CLI task with host-only boundaries: %s (offline)', async mode => {
  const root = await realpath(await mkdtemp('/private/tmp/bgs-public-review-cli-')), workspace = join(root, 'workspace')
  await mkdir(workspace); await writeDesignDocumentsFixture(workspace)
  const directory = join(workspace, '.beegame/tmp/review'); await mkdir(directory, { recursive: true })
  const context = join(directory, 'context.md'), receipt = join(directory, 'result.txt')
  await writeFile(context, 'Synthetic original Review assignment; no gameplay generation.')
  const document = join(workspace, 'docs/GDD.md'), original = await readFile(document, 'utf8')
  const requests: Array<{ model: string; messages: unknown; system?: unknown; tools?: unknown[] }> = []
  const finding = { id: 'choose', severity: 'blocker', action: 'decide', owner: 'user', documents: ['GDD.md'],
    sources: [{ document: 'GDD.md', section: 'Design' }], impact: 'Two source-backed directions.', closeWhen: 'Choose one.', neededBefore: 'resources' }
  const step = mode === 'question' ? 'revise' : 'inspect'
  const read: FixtureBlock = { type: 'tool_use', id: 'read-review-gdd', name: 'Read', input: { file_path: document } }
  const save: FixtureBlock = { type: 'tool_use', id: 'save-review-receipt', name: 'Write',
    input: { file_path: receipt, content: 'complete\n' + JSON.stringify({ step, findings: mode === 'question' ? [finding] : [], resolved: [] }) } }
  const done: FixtureBlock = { type: 'text', text: 'Saved the assigned Review receipt; no quality PASS.' }
  const steps: FixtureBlock[] = mode === 'unread-first' ? [save, done, read, done]
    : mode === 'scope-denied' ? [read, { type: 'tool_use', id: 'bad-write', name: 'Write',
        input: { file_path: document, content: '# Erased original authority' } }, save, done]
    : mode === 'question' ? [read, { type: 'tool_use', id: 'new-question-proposal', name: 'Write',
        input: { file_path: receipt + '.decision-findings.json', content: JSON.stringify([finding]) } },
      { type: 'tool_use', id: 'human-decision', name: 'AskUserQuestion', input: { questions: [{
        header: 'choose', question: 'Which direction?', options: [{ label: 'A', description: 'Direction A' }, { label: 'B', description: 'Direction B' }], multiSelect: false,
      }] } }, save, done] : [read, save, done]
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (new URL(request.url).pathname.endsWith('/count_tokens')) return Response.json({ input_tokens: 10 })
    if (!new URL(request.url).pathname.endsWith('/messages')) return new Response('', { status: 404 })
    const input = await request.json() as typeof requests[number]; requests.push(input)
    const block = steps[requests.length - 1]
    return block ? response(input.model, block) : new Response('Unexpected mock request', { status: 400 })
  } })
  const start: BeeGameSessionRunnerStartInput = { sessionId: 'offline-review-host', cwd: workspace, deliveryEvidenceDataRoot: root,
    env: { BEEGAME_CONFIG_DIR: join(root, 'config'), BEEGAME_MODEL_TYPE: 'anthropic', ANTHROPIC_AUTH_TOKEN: 'LOCAL_ONLY_FIXTURE_KEY',
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:' + server.port, BGS_DEFAULT_BALANCED_MODEL: 'claude-sonnet-4-6',
      BGS_DEFAULT_FAST_MODEL: 'claude-sonnet-4-6', BGS_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1' } }
  const runtime = await createNativeCliProcessRunner({ command: [process.execPath, cli!, ...nativeRuntimeCommand(start).slice(2)] }).start(start)
  const events: Record<string, unknown>[] = [], controller = new AbortController()
  const timer = setTimeout(() => controller.abort('offline_deadline'), 20_000)
  let questions = 0
  const turn = { prompt: 'Perform this synthetic Review only.', signal: controller.signal,
    projectTurn: { reviewDocuments: ['GDD.md'], reviewStep: step as 'inspect' | 'revise', reviewRevision: 'a'.repeat(64),
      reviewContextPath: context, reviewWorkspace: workspace, reviewResultPath: receipt, reviewWritableDocuments: step === 'revise' ? ['GDD.md'] : [],
      reviewReceiptContext: { step: step as 'inspect' | 'revise', findings: [], sourceHeadings: { 'GDD.md': ['Design'] } } },
    requestPermission: async (request: any) => {
      if (request.toolName === 'AskUserQuestion') {
        questions++
        expect(request.input.metadata.designFindings).toEqual([finding])
        return { behavior: 'allow' as const, source: 'user' as const,
          updatedInput: { ...request.input, answers: { 'Which direction?': 'A' } } }
      }
      return { behavior: 'allow' as const, source: 'policy' as const }
    }, onMessage: (message: Record<string, unknown>) => { events.push(message) } }
  try {
    await runtime.submit(turn)
    expect(requests).toHaveLength(steps.length)
    expect(JSON.stringify(events)).not.toContain('"name":"Agent"')
    expect(events.filter(row => row.subtype === 'task_started')).toHaveLength(1)
    expect(events.filter(row => row.type === 'result')).toHaveLength(1)
    expect(events.at(-1)?.status).toBe('completed')
    expect(await readFile(document, 'utf8')).toBe(original)
    if (mode === 'unread-first') expect(JSON.stringify(requests[2]!.messages)).toContain('remaining saved-source ranges')
    if (mode === 'scope-denied') expect(JSON.stringify(requests[2]!.messages)).toContain('bounded BGS design review')
    if (mode === 'question') {
      expect(questions).toBe(1)
      const schema = requests[0]!.tools!.find((tool: any) => tool.name === 'AskUserQuestion')
      expect(JSON.stringify(schema)).not.toContain('designFindings')
      expect(JSON.stringify(requests[3]!.messages)).not.toContain('"metadata":{"designFindings"')
    }
    await runtime.submit(turn)
    expect(requests).toHaveLength(steps.length) // actual source/receipt checkpoint reused
  } finally { clearTimeout(timer); controller.abort('offline_cleanup'); await runtime.dispose?.(); server.stop(true); await rm(root, { recursive: true, force: true }) }
}, 25_000)


test.skipIf(!cli)('BGS writing workflow uses an ordinary primary CLI task, without native Agent dispatch or another coordinator request (offline)', async () => {
  const root = await realpath(await mkdtemp('/private/tmp/bgs-public-writing-cli-')), workspace = join(root, 'workspace')
  await mkdir(workspace); await writeDesignDocumentsFixture(workspace)
  const context = join(workspace, 'author.context.md'); await writeFile(context, 'Synthetic original UI assignment')
  const document = join(workspace, 'docs/UI_UX_SPEC.md'), index = join(workspace, '.beegame/design-handoffs/UI_UX_SPEC.json')
  const body = await readFile(document, 'utf8'), sidecar = await readFile(index, 'utf8')
  const requests: Array<{ model: string; messages: unknown; system?: unknown }> = []
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (new URL(request.url).pathname.endsWith('/count_tokens')) return Response.json({ input_tokens: 10 })
    if (!new URL(request.url).pathname.endsWith('/messages')) return new Response('', { status: 404 })
    const input = await request.json() as typeof requests[number]; requests.push(input)
    return response(input.model, requests.length === 1 ? [
      { type: 'tool_use', id: 'save-author-prose', name: 'Write', input: { file_path: document, content: body } },
      { type: 'tool_use', id: 'save-author-index', name: 'Write', input: { file_path: index, content: sidecar } },
    ] : { type: 'text', text: 'Saved docs/UI_UX_SPEC.md and its index; no quality approval.' })
  } })
  const start: BeeGameSessionRunnerStartInput = { sessionId: 'offline-writing-host', cwd: workspace, deliveryEvidenceDataRoot: root,
    env: { BEEGAME_CONFIG_DIR: join(root, 'config'), BEEGAME_MODEL_TYPE: 'anthropic', ANTHROPIC_AUTH_TOKEN: 'LOCAL_ONLY_FIXTURE_KEY',
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:' + server.port, BGS_DEFAULT_BALANCED_MODEL: 'claude-sonnet-4-6',
      BGS_DEFAULT_FAST_MODEL: 'claude-sonnet-4-6', BGS_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1' } }
  const runtime = await createNativeCliProcessRunner({ command: [process.execPath, cli!, ...nativeRuntimeCommand(start).slice(2)] }).start(start)
  const events: Record<string, unknown>[] = [], controller = new AbortController()
  const timeout = setTimeout(() => controller.abort('offline_timeout'), 20_000)
  const turn = { prompt: 'Host should dispatch exactly one owner.', directionAuthors: { batch: 3 as const, inputRevision: 'a'.repeat(64), contextPath: context,
    responsibilities: { 'UI_UX_SPEC.md': 'UI owner' } }, signal: controller.signal,
    onMessage: (message: Record<string, unknown>) => { events.push(message) }, requestPermission: async () => ({ behavior: 'allow' as const }) }
  try {
    await runtime.submit(turn)
    expect(requests).toHaveLength(2)
    expect(JSON.stringify(requests[0]!.system)).toContain('# BGS-supplied method: game-ui-ux-designer')
    expect(events.filter(row => row.subtype === 'task_started')).toHaveLength(1)
    expect(events.at(-1)).toMatchObject({ type: 'result', origin: 'workflow_host', is_error: false })
    expect(JSON.stringify(events)).not.toContain('"name":"Agent"')
    expect(events.filter(row => row.type === 'assistant').every(row => typeof row.parent_tool_use_id === 'string')).toBe(true)
    await runtime.submit(turn)
    expect(requests).toHaveLength(2) // actual saved handoff is reused, not rewritten
    expect(await readFile(document, 'utf8')).toBe(body)
  } finally { clearTimeout(timeout); controller.abort('offline_cleanup'); await runtime.dispose?.(); server.stop(true); await rm(root, { recursive: true, force: true }) }
}, 25_000)

test.skipIf(!cli).each(['complete', 'blocked', 'bad-index', 'bad-conclusion'] as const)('BGS GDD saves with native tools and finishes without a receipt: %s (offline)', async outcome => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-gdd-final-result-'))), workspace = join(root, 'workspace')
  const documentPath = join(workspace, 'docs/GDD.md'), indexPath = join(workspace, '.beegame/design-handoffs/GDD.json')
  const body = '# Rules\nSynthetic original rule and observable result.\n'
  const index = { outputs: [{ id: 'rule', section: outcome === 'bad-index' ? 'Absent heading' : 'Rules',
    acceptance: { section: 'Rules', method: 'test' } }] }
  const requests: Array<{ model: string; messages: unknown; system?: unknown; tools?: unknown[] }> = []
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (new URL(request.url).pathname.endsWith('/count_tokens')) return Response.json({ input_tokens: 10 })
    if (!new URL(request.url).pathname.endsWith('/messages')) return new Response('', { status: 404 })
    const input = await request.json() as typeof requests[number]; requests.push(input)
    const blocks: FixtureBlock[] = requests.length === 1 ? [
      { type: 'tool_use', id: 'save-prose', name: 'Write', input: { file_path: documentPath, content: body } },
      { type: 'tool_use', id: 'save-index', name: 'Write', input: { file_path: indexPath, content: JSON.stringify(index) } },
    ] : [{ type: 'text', text: requests.length === 2
      ? outcome === 'bad-conclusion' ? 'Done' : outcome === 'blocked' ? 'blocked\nSynthetic unresolved core decision.'
        : 'complete\nSaved docs/GDD.md and its index; no quality verdict.'
      : 'blocked\nSynthetic unresolved saved handoff issue.' }]
    if (requests.length > 3) return new Response('Unexpected fixture request', { status: 400 })
    return response(input.model, blocks)
  } })
  const manager = new BeeGameSessionManager({ async start(start) {
    const isolated: BeeGameSessionRunnerStartInput = { ...start, env: {
      BEEGAME_CONFIG_DIR: join(root, 'configuration'), BEEGAME_MODEL_TYPE: 'anthropic',
      BEEGAME_NATIVE_BUILTIN_SKILLS_DIR: fileURLToPath(new URL('../../../.beegame/skills/builtinskills', import.meta.url)),
      ANTHROPIC_AUTH_TOKEN: 'LOCAL_ONLY_FIXTURE_KEY', ANTHROPIC_BASE_URL: 'http://127.0.0.1:' + server.port,
      BGS_DEFAULT_BALANCED_MODEL: 'claude-sonnet-4-6', BGS_DEFAULT_FAST_MODEL: 'claude-sonnet-4-6',
      BGS_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
    } }
    const runtime = await createNativeCliProcessRunner({ command: [process.execPath, cli!, ...nativeRuntimeCommand(isolated).slice(2)] }).start(isolated)
    return { ...runtime, stop: () => runtime.stop(), dispose: () => runtime.dispose?.(),
      submit: turn => runtime.submit({ ...turn, requestPermission: async request =>
        request.toolName === 'Write' && [documentPath, indexPath].includes(String(request.input.file_path))
          ? { behavior: 'allow' } : { behavior: 'deny', message: 'Outside the synthetic GDD write scope.' } }) }
  } }, root)
  try {
    await mkdir(workspace)
    await beginProjectDelivery(workspace, root, 'Synthetic standalone GDD, no production work.')
    const session = manager.start({ workspacePath: workspace, userId: 'offline-owner', projectId: 'offline-project' })
    await sendProjectConversation({ sessions: manager, deliveryDataRoot: root, sessionId: session.id,
      ownerId: 'offline-owner', message: 'Complete only the current GDD assignment.', autoContinuation: true })
    await manager.waitForSessionIdle(session.id)
    const events = manager.transcript(session.id)
    expect(events.filter(event => event.type === 'turn.failed')).toEqual([])
    expect((await readProjectDelivery(workspace, root))?.authorBatch ?? 0).toBe(outcome === 'complete' ? 1 : 0)
    // An ordinary native conclusion ends its turn. The host accepts/rejects
    // saved outputs; no native BGS stop hook adds a third correction request.
    expect(requests).toHaveLength(2)
    expect(JSON.stringify(requests[0]!.messages)).toContain('Base directory for this skill:')
    expect(JSON.stringify(requests[0]!.messages)).toContain('game-systems-designer-expert')
    expect(JSON.stringify(requests[0]!.messages)).toContain('Complete only the current GDD assignment.')
    expect(events.filter(event => event.type === 'tool.started').map(event => event.payload?.toolName)).toEqual(['Write', 'Write'])
    expect(await readdir(join(workspace, '.beegame/tmp', session.id))).toEqual([])
    expect(await readFile(documentPath, 'utf8')).toContain('Synthetic original rule')
    if (outcome === 'bad-index' || outcome === 'bad-conclusion') {
      const errors = events.filter(event => event.payload?.subtype === 'delivery_error').map(event => event.text).join(' ')
      expect(errors).toContain(outcome === 'bad-index' ? 'Absent heading' : 'first line')
    }
    if (outcome === 'complete') {
      // Byte sizes locate overhead without pretending the mock count_tokens
      // response is a tokenizer or a measurement of real paid consumption.
      const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value))
      console.info('[offline GDD input bytes, not tokens]', JSON.stringify({ system: bytes(requests[0]!.system),
        tools: bytes(requests[0]!.tools), messages: bytes(requests[0]!.messages) }))
    }
  } finally { await manager.dispose(); server.stop(true); await rm(root, { recursive: true, force: true }) }
}, 25_000)

test.skipIf(!cli)('bundled Revision loads the layout calculator and returns a concrete error before accepting completion (offline)', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-native-layout-revision-'))), workspace = join(root, 'workspace')
  await writeDesignDocumentsFixture(workspace)
  await mkdir(join(workspace, '.beegame/tmp'), { recursive: true })
  const contextPath = join(workspace, '.beegame/tmp/context.md'), receipt = join(workspace, '.beegame/tmp/result.txt')
  await writeFile(contextPath, '# Synthetic UI revision\nInspect the saved source and report the actual remaining error.\n')
  const requests: Array<{ model: string; messages: unknown }> = []
  const result = JSON.stringify({ step: 'revise', findings: [], resolved: [] })
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (new URL(request.url).pathname.endsWith('/count_tokens')) return Response.json({ input_tokens: 10 })
    if (!new URL(request.url).pathname.endsWith('/messages')) return new Response('', { status: 404 })
    const input = await request.json() as typeof requests[number]; requests.push(input)
    const steps: FixtureBlock[] = [
      { type: 'tool_use', id: 'read-ui', name: 'Read', input: { file_path: join(workspace, 'docs/UI_UX_SPEC.md') } },
      { type: 'tool_use', id: 'complete', name: 'Write', input: { file_path: receipt, content: 'complete\n' + result } },
      { type: 'tool_use', id: 'blocked', name: 'Write', input: { file_path: receipt, content: 'blocked\n' + result } },
      { type: 'text', text: 'Synthetic remaining orientation error reported, not bypassed.' },
    ]
    return steps[requests.length - 1] ? response(input.model, steps[requests.length - 1]!) : new Response('Unexpected request', { status: 400 })
  } })
  const start: BeeGameSessionRunnerStartInput = { sessionId: 'offline-layout-revision', cwd: workspace, deliveryEvidenceDataRoot: root, env: {
    BEEGAME_CONFIG_DIR: join(root, 'configuration'), BEEGAME_MODEL_TYPE: 'anthropic',
    ANTHROPIC_AUTH_TOKEN: 'LOCAL_ONLY_FIXTURE_KEY', ANTHROPIC_BASE_URL: 'http://127.0.0.1:' + server.port,
    BGS_DEFAULT_BALANCED_MODEL: 'claude-sonnet-4-6', BGS_DEFAULT_FAST_MODEL: 'claude-sonnet-4-6',
    BGS_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
  } }
  const runtime = await createNativeCliProcessRunner({ command: [process.execPath, cli!, ...nativeRuntimeCommand(start).slice(2)] }).start(start)
  const controller = new AbortController(), timer = setTimeout(() => controller.abort('offline_deadline'), 20_000)
  try {
    await runtime.submit({ prompt: 'Run the synthetic revision.', signal: controller.signal,
      projectTurn: { reviewDocuments: ['UI_UX_SPEC.md'], reviewStep: 'revise', reviewSettings: { orientation: 'Portrait' },
        reviewContextPath: contextPath, reviewWorkspace: workspace, reviewResultPath: receipt, reviewWritableDocuments: ['UI_UX_SPEC.md'],
        reviewReceiptContext: { step: 'revise', findings: [], sourceHeadings: { 'UI_UX_SPEC.md': ['Design'] } } },
      requestPermission: async () => ({ behavior: 'allow' }), onMessage() {},
    })
    expect(requests).toHaveLength(4)
    expect(JSON.stringify(requests[2]!.messages)).toContain('Layout orientation differs')
    expect(await readFile(receipt, 'utf8')).toBe('blocked\n' + result)
  } finally { clearTimeout(timer); controller.abort('cleanup'); await runtime.dispose?.(); server.stop(true); await rm(root, { recursive: true, force: true }) }
}, 25_000)

test.skipIf(!cli)('native Revision completes beyond 32 model turns without a BGS cap or synthetic receipt (offline)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-review-limit-')), workspace = join(root, 'workspace')
  const repo = fileURLToPath(new URL('../../../', import.meta.url))
  const contextPath = join(workspace, '.beegame/tmp/context.md'), receiptPath = join(workspace, '.beegame/tmp/result.txt')
  const documentPath = join(workspace, 'docs/GDD.md')
  await mkdir(join(workspace, '.beegame/tmp'), { recursive: true })
  await mkdir(join(workspace, 'docs'))
  await writeFile(contextPath, '# Offline assignment\nRevise only the recorded fixture; submit a real receipt only after required checks.\n')
  await writeFile(documentPath, '# Offline draft\nORIGINAL_FIXTURE\nINDEPENDENT_FIXTURE\n')
  await mkdir(join(workspace, '.beegame/design-handoffs'), { recursive: true })
  await writeFile(join(workspace, '.beegame/design-handoffs/GDD.json'), JSON.stringify({ outputs: [
    { id: 'rule', section: 'Offline draft', acceptance: { section: 'Offline draft', method: 'test' } },
  ] }))
  let requests = 0
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (new URL(request.url).pathname.endsWith('/count_tokens')) return Response.json({ input_tokens: 10 })
    if (!new URL(request.url).pathname.endsWith('/messages')) return new Response('', { status: 404 })
    const body = await request.json() as { model: string }
    requests++
    const content = requests === 35
      ? { type: 'tool_use' as const, id: 'real-receipt', name: 'Write', input: {
        file_path: receiptPath, content: 'complete\n' + JSON.stringify({ step: 'revise', findings: [], resolved: [] }),
      } }
      : requests === 36 ? { type: 'text' as const, text: 'OFFLINE_REVISION_FINISHED' }
      : requests === 2
      ? [{ type: 'tool_use' as const, id: 'limit-edit', name: 'Edit', input: {
          file_path: documentPath, old_string: 'ORIGINAL_FIXTURE', new_string: 'PARTIAL_REVISION', replace_all: false,
        } }, { type: 'tool_use' as const, id: 'limit-independent-edit', name: 'Edit', input: {
          file_path: documentPath, old_string: 'INDEPENDENT_FIXTURE', new_string: 'INDEPENDENT_REVISION', replace_all: false,
        } }]
      : { type: 'tool_use' as const, id: 'limit-read-' + requests, name: 'Read', input: { file_path: documentPath } }
    return response(body.model, content)
  } })
  const start: BeeGameSessionRunnerStartInput = { sessionId: 'offline-review-limit', cwd: workspace, deliveryEvidenceDataRoot: root, env: {
    BEEGAME_CONFIG_DIR: join(root, 'configuration'), BEEGAME_NATIVE_BUILTIN_SKILLS_DIR: join(repo, '.beegame/skills/builtinskills'),
    BEEGAME_MODEL_TYPE: 'anthropic', ANTHROPIC_AUTH_TOKEN: 'LOCAL_ONLY_FIXTURE_KEY',
    ANTHROPIC_BASE_URL: 'http://127.0.0.1:' + server.port,
    BGS_DEFAULT_BALANCED_MODEL: 'claude-sonnet-4-6', BGS_DEFAULT_FAST_MODEL: 'claude-sonnet-4-6',
    BGS_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
  } }
  const runtime = await createNativeCliProcessRunner({ command: [process.execPath, cli!, ...nativeRuntimeCommand(start).slice(2)] }).start(start)
  const controller = new AbortController(), timer = setTimeout(() => controller.abort('offline_deadline'), 30_000)
  const messages: Record<string, unknown>[] = []
  try {
    await runtime.submit({ prompt: 'Run the offline revision fixture.', signal: controller.signal,
      projectTurn: { restartContext: false, reviewDocuments: ['GDD.md'], reviewStep: 'revise',
        reviewContextPath: contextPath, reviewWorkspace: workspace, reviewResultPath: receiptPath, reviewWritableDocuments: ['GDD.md'],
        reviewReceiptContext: { step: 'revise', findings: [], sourceHeadings: { 'GDD.md': ['Offline draft'] } } },
      requestPermission: async () => ({ behavior: 'allow' }), onMessage(message) { messages.push(message) },
    })
    expect(requests).toBe(36)
    expect(messages.some(m => m.type === 'result' && m.subtype === 'success')).toBe(true)
    expect(messages.some(m => m.type === 'system' && m.subtype === 'task_notification' && m.status === 'failed')).toBe(false)
    expect(await readFile(receiptPath, 'utf8')).toBe('complete\n' + JSON.stringify({ step: 'revise', findings: [], resolved: [] }))
    expect(await readFile(documentPath, 'utf8')).toBe('# Offline draft\nPARTIAL_REVISION\nINDEPENDENT_REVISION\n')
  } finally {
    clearTimeout(timer); controller.abort('offline_cleanup'); await runtime.dispose?.(); server.stop(true)
    await rm(root, { recursive: true, force: true })
  }
}, 35_000)

test.skipIf(!cli)('scheduled review uses independent primary CLI sessions for distinct review revisions, without coordinator model calls (offline)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-review-skill-')), workspace = join(root, 'workspace')
  const repo = fileURLToPath(new URL('../../../', import.meta.url))
  const skillRoot = join(repo, '.beegame/skills/builtinskills')
  const contextPath = join(workspace, '.beegame/tmp/context.md')
  const receiptPath = join(workspace, '.beegame/tmp/result.txt')
  const documentPath = join(workspace, 'docs/GDD.md')
  await mkdir(join(workspace, '.beegame/tmp'), { recursive: true })
  await mkdir(join(workspace, 'docs'), { recursive: true })
  await writeFile(contextPath, '# Original review assignment\nORIGINAL_REQUIREMENT_ONLY_IN_TASK_FILE\nReview docs/GDD.md; GDD owns the core gameplay contract.\n')
  await writeFile(documentPath, '# Offline draft\nComplete saved draft for native read verification.\n')
  const requests: Array<{ model: string; messages: unknown; system?: unknown; tools?: Array<{name: string; description?: string}> }> = []
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (new URL(request.url).pathname.endsWith('/count_tokens')) return Response.json({ input_tokens: 10 })
    if (!new URL(request.url).pathname.endsWith('/messages')) return new Response('', { status: 404 })
    const body = await request.json() as typeof requests[number]
    requests.push(body)
    const steps = [
      { type: 'tool_use' as const, id: 'offline-review-input', name: 'Read', input: { file_path: contextPath } },
      { type: 'tool_use' as const, id: 'offline-review-draft', name: 'Read', input: { file_path: documentPath } },
      { type: 'tool_use' as const, id: 'offline-review-methods', name: 'Read', input: {
        file_path: join(skillRoot, 'game-design-check/references/document-checks.md'),
      } },
      { type: 'tool_use' as const, id: 'offline-saved-review-receipt', name: 'Write', input: { file_path: receiptPath, content: 'complete\n' + JSON.stringify({ step: 'inspect', findings: [], resolved: [] }) } },
      { type: 'text' as const, text: 'OFFLINE_REVIEW_METHOD_HANDOFF_OK; no semantic verdict inferred from this fixture.' },
    ]
    const content = steps[(requests.length - 1) % steps.length]
    if (!content) return new Response('Unexpected extra fixture request', { status: 400 })
    return response(body.model, content)
  } })
  const start: BeeGameSessionRunnerStartInput = {
    sessionId: 'offline-review-skills', cwd: workspace, deliveryEvidenceDataRoot: root, env: {
      BEEGAME_CONFIG_DIR: join(root, 'configuration'), BEEGAME_NATIVE_BUILTIN_SKILLS_DIR: skillRoot,
      BEEGAME_MODEL_TYPE: 'anthropic', ANTHROPIC_AUTH_TOKEN: 'LOCAL_ONLY_FIXTURE_KEY',
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:' + server.port,
      BGS_DEFAULT_BALANCED_MODEL: 'claude-sonnet-4-6', BGS_DEFAULT_FAST_MODEL: 'claude-sonnet-4-6',
      BGS_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
    },
  }
  const runtime = await createNativeCliProcessRunner({
    command: [process.execPath, cli!, ...nativeRuntimeCommand(start).slice(2), '--max-turns', '10'],
  }).start(start)
  const controller = new AbortController(), timer = setTimeout(() => controller.abort('offline_deadline'), 30_000)
  const messages: Record<string, unknown>[] = []
  const projectTurn = { restartContext: false, reviewRevision: 'a'.repeat(64), reviewDocuments: ['GDD.md'], reviewContextPath: contextPath,
    reviewStep: 'inspect' as const, reviewWorkspace: workspace, reviewResultPath: join(workspace, '.beegame/tmp/result.txt'),
    reviewWritableDocuments: [], reviewReceiptContext: { step: 'inspect' as const, findings: [], sourceHeadings: { 'GDD.md': ['Offline draft'] } } }
  try {
    await runtime.submit({ prompt: 'Dispatch the independent reviewer; do not review or revise the draft yourself.',
      projectTurn,
      signal: controller.signal, requestPermission: async () => ({ behavior: 'allow' }),
      onMessage(message) { messages.push(message) },
    })
    expect(requests).toHaveLength(5)
    expect(requests[0]!.tools!.map(tool => tool.name).sort()).toEqual(['Read', 'Glob', 'Grep', 'Bash', 'WebFetch', 'WebSearch', 'Write'].sort())
    const bashDescription = requests[0]!.tools!.find(tool => tool.name === 'Bash')!.description!
    expect(bashDescription).toContain('bash command')
    expect(bashDescription).not.toContain('Use the supplied BGS design check interfaces')
    const childInput = JSON.stringify(requests[0])
    expect(childInput).toContain('Check whether the assigned design can be used by its downstream team')
    expect(childInput).toContain('## Select the applicable checks')
    expect(childInput).toContain('.beegame/tmp/context.md')
    expect(childInput).not.toContain('Dispatch the independent reviewer; do not review or revise')
    expect(JSON.stringify(requests[1]!.messages)).toContain('ORIGINAL_REQUIREMENT_ONLY_IN_TASK_FILE')
    expect(JSON.stringify(requests[3]!.messages)).toContain('## GDD.md')
    expect(messages).toContainEqual(expect.objectContaining({ type: 'result', subtype: 'success' }))
    await runtime.submit({ prompt: 'STALE_COORDINATOR_CLAIM: the previous review already passed.',
      projectTurn: { ...projectTurn, reviewRevision: 'b'.repeat(64), restartContext: true },
      signal: controller.signal, requestPermission: async () => ({ behavior: 'allow' }),
      onMessage(message) { messages.push(message) },
    })
    expect(requests).toHaveLength(10)
    expect(JSON.stringify(requests[5])).toContain('## Select the applicable checks')
    expect(JSON.stringify(requests[5])).not.toContain('OFFLINE_REVIEW_METHOD_HANDOFF_OK')
    expect(JSON.stringify(requests[5])).not.toContain('STALE_COORDINATOR_CLAIM')
    const results = messages.filter(message => message.type === 'result' && message.subtype === 'success')
    expect(results).toHaveLength(2)
    expect(results.every(result => String(result.result).includes('OFFLINE_REVIEW_METHOD_HANDOFF_OK'))).toBe(true)
    const actualResults = messages.filter(message => message.subtype === 'workflow_task_result').map(message => message.native_result as any)
    const usage = actualResults.flatMap(result => Object.values(result.modelUsage) as Array<{ inputTokens: number; outputTokens: number }>)
    expect(usage.reduce((total, value) => total + value.inputTokens, 0)).toBe(100)
    expect(usage.reduce((total, value) => total + value.outputTokens, 0)).toBe(100)
    const projects = join(root, 'configuration/projects')
    const readTranscripts = async () => (await readdir(projects, { recursive: true })).filter(path => /\/[a-f0-9-]{36}\.jsonl$/.test(path))
    // Native transcript writes are batched for 100ms; a result event does not
    // imply that its separate durable transcript has already flushed.
    let transcripts = await readTranscripts()
    const flushDeadline = Date.now() + 2000
    while (transcripts.length < 2 && Date.now() < flushDeadline) {
      await Bun.sleep(25)
      transcripts = await readTranscripts()
    }
    expect(transcripts).toHaveLength(2)
    for (const transcript of transcripts) {
      const raw = await readFile(join(projects, transcript), 'utf8')
      expect(raw).toContain('Complete saved draft for native read verification.')
      expect(raw).toContain('ORIGINAL_REQUIREMENT_ONLY_IN_TASK_FILE')
    }
    expect(await readFile(documentPath, 'utf8')).toBe('# Offline draft\nComplete saved draft for native read verification.\n')
  } finally {
    clearTimeout(timer); controller.abort('offline_cleanup'); await runtime.dispose?.(); server.stop(true)
    await rm(root, { recursive: true, force: true })
  }
}, 35_000)

test.skipIf(!cli)('review retains native format Read behavior and repairs receipt fields in place (offline)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-review-cost-boundary-')), workspace = join(root, 'workspace')
  const repo = fileURLToPath(new URL('../../../', import.meta.url))
  const contextPath = join(workspace, '.beegame/tmp/context.md')
  const documentPath = join(workspace, 'docs/GDD.md')
  const receiptPath = join(workspace, '.beegame/tmp/result.txt')
  const formatPath = join(workspace, '.beegame/delivery/content-format.json')
  await mkdir(join(workspace, '.beegame/tmp'), { recursive: true })
  await mkdir(join(workspace, '.beegame/delivery'), { recursive: true })
  await mkdir(join(workspace, 'docs'), { recursive: true })
  await writeFile(contextPath, '# Offline assignment\nInspect docs/GDD.md and write the assigned receipt.\n')
  const draft = '# Offline draft\nUNCHANGED_SYNTHETIC_DRAFT\n'
  await writeFile(documentPath, draft)
  const format = JSON.stringify({ values: 'FORMAT '.repeat(4000), tail: 'FULL_FORMAT_TAIL_RETAINED' })
  await writeFile(formatPath, format)
  const validReceipt = 'complete\n' + JSON.stringify({ step: 'inspect', findings: [], resolved: [] })
  const invalidReceipt = 'complete\n' + JSON.stringify({ step: 'inspect', findings: [], resolved: [{ id: 'invented-check', evidence: 'passed' }] })
  const requests: Array<{ model: string; messages: unknown }> = []
  let invalidWriteLeftNoReceipt = false
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (new URL(request.url).pathname.endsWith('/count_tokens')) return Response.json({ input_tokens: 10 })
    if (!new URL(request.url).pathname.endsWith('/messages')) return new Response('', { status: 404 })
    const body = await request.json() as typeof requests[number]
    requests.push(body)
    if (requests.length === 5) invalidWriteLeftNoReceipt = !await Bun.file(receiptPath).exists()
    const content = [
      { type: 'tool_use' as const, id: 'cost-read-task', name: 'Read', input: { file_path: contextPath } },
      { type: 'tool_use' as const, id: 'cost-read-draft', name: 'Read', input: { file_path: documentPath } },
      { type: 'tool_use' as const, id: 'cost-read-format', name: 'Read', input: { file_path: formatPath } },
      { type: 'tool_use' as const, id: 'cost-invalid-receipt', name: 'Write', input: { file_path: receiptPath, content: invalidReceipt } },
      { type: 'tool_use' as const, id: 'cost-valid-receipt', name: 'Write', input: { file_path: receiptPath, content: validReceipt } },
      { type: 'text' as const, text: 'OFFLINE_TRANSPORT_FIXTURE_ONLY; not a semantic acceptance verdict.' },
    ][requests.length - 1]
    if (!content) return new Response('Unexpected extra fixture request', { status: 400 })
    return response(body.model, content)
  } })
  const start: BeeGameSessionRunnerStartInput = { sessionId: 'offline-review-cost-boundary', cwd: workspace, deliveryEvidenceDataRoot: root, env: {
    BEEGAME_CONFIG_DIR: join(root, 'configuration'),
    BEEGAME_NATIVE_BUILTIN_SKILLS_DIR: join(repo, '.beegame/skills/builtinskills'),
    BEEGAME_MODEL_TYPE: 'anthropic', ANTHROPIC_AUTH_TOKEN: 'LOCAL_ONLY_FIXTURE_KEY',
    ANTHROPIC_BASE_URL: 'http://127.0.0.1:' + server.port,
    BGS_DEFAULT_BALANCED_MODEL: 'claude-sonnet-4-6', BGS_DEFAULT_FAST_MODEL: 'claude-sonnet-4-6',
    BGS_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
  } }
  const runtime = await createNativeCliProcessRunner({ command: [process.execPath, cli!, ...nativeRuntimeCommand(start).slice(2), '--max-turns', '10'] }).start(start)
  const controller = new AbortController(), timer = setTimeout(() => controller.abort('offline_deadline'), 30_000)
  try {
    await runtime.submit({ prompt: 'Execute the independent offline fixture review.', signal: controller.signal,
      requestPermission: async () => ({ behavior: 'allow' }), onMessage() {},
      projectTurn: { restartContext: false, reviewDocuments: ['GDD.md'], reviewContextPath: contextPath,
        reviewStep: 'inspect', reviewWorkspace: workspace, reviewResultPath: receiptPath, reviewWritableDocuments: [],
        reviewReceiptContext: { step: 'inspect', findings: [], sourceHeadings: { 'GDD.md': ['Offline draft'] } } },
    })
    expect(requests).toHaveLength(6)
    const messages = JSON.stringify(requests[3]!.messages)
    expect(messages).not.toContain('Full output saved to:')
    expect(messages).toContain('FULL_FORMAT_TAIL_RETAINED')
    expect(JSON.stringify(requests[4]!.messages)).toContain('resolved must reference a recorded finding ID')
    expect(invalidWriteLeftNoReceipt).toBe(true)
    expect(await readFile(receiptPath, 'utf8')).toBe(validReceipt)
    expect(await readFile(documentPath, 'utf8')).toBe(draft)
    expect(await readFile(formatPath, 'utf8')).toBe(format)
  } finally {
    clearTimeout(timer); controller.abort('offline_cleanup'); await runtime.dispose?.(); server.stop(true)
    await rm(root, { recursive: true, force: true })
  }
}, 35_000)

test.skipIf(!cli)('Revision rejects malformed saved indexes before completion and repairs them in the same ordinary CLI session (offline)', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-revision-index-feedback-'))), workspace = join(root, 'workspace')
  const repo = fileURLToPath(new URL('../../../', import.meta.url))
  const contextPath = join(workspace, '.beegame/tmp/context.md'), receiptPath = join(workspace, '.beegame/tmp/result.txt')
  const documentPath = join(workspace, 'docs/GDD.md'), indexPath = join(workspace, '.beegame/design-handoffs/GDD.json')
  await mkdir(join(workspace, '.beegame/tmp'), { recursive: true })
  await mkdir(join(workspace, '.beegame/design-handoffs'), { recursive: true })
  await mkdir(join(workspace, 'docs'), { recursive: true })
  await writeFile(contextPath, '# Offline assignment\nCorrect only the saved index contract and submit the revision receipt.\n')
  const draft = '# Offline draft\nUNCHANGED_RULE_AND_EXPECTATION\n'
  await writeFile(documentPath, draft)
  const index = '{\n  "document": "docs/GDD.md",\n  "outputs": [{"id":"rule","section":"Offline draft","acceptance":{"section":"Offline draft","method":"test"}}]\n}\n'
  await writeFile(indexPath, index)
  const receipt = 'complete\n' + JSON.stringify({ step: 'revise', findings: [], resolved: [] })
  const requests: Array<{ model: string; messages: unknown }> = []
  let deniedWriteLeftNoReceipt = false
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (new URL(request.url).pathname.endsWith('/count_tokens')) return Response.json({ input_tokens: 10 })
    if (!new URL(request.url).pathname.endsWith('/messages')) return new Response('', { status: 404 })
    const body = await request.json() as typeof requests[number]
    requests.push(body)
    if (requests.length === 5) deniedWriteLeftNoReceipt = !await Bun.file(receiptPath).exists()
    const content = [
      { type: 'tool_use' as const, id: 'index-read-task', name: 'Read', input: { file_path: contextPath } },
      { type: 'tool_use' as const, id: 'index-read-document', name: 'Read', input: { file_path: documentPath } },
      { type: 'tool_use' as const, id: 'index-read-source', name: 'Read', input: { file_path: indexPath } },
      { type: 'tool_use' as const, id: 'index-premature-receipt', name: 'Write', input: { file_path: receiptPath, content: receipt } },
      { type: 'tool_use' as const, id: 'index-correct-source', name: 'Edit', input: { file_path: indexPath,
        old_string: '  "document": "docs/GDD.md",\n', new_string: '', replace_all: false } },
      { type: 'tool_use' as const, id: 'index-valid-receipt', name: 'Write', input: { file_path: receiptPath, content: receipt } },
      { type: 'text' as const, text: 'OFFLINE_INDEX_REVISION_DONE; semantic verification remains separate.' },
    ][requests.length - 1]
    if (!content) return new Response('Unexpected extra fixture request', { status: 400 })
    return response(body.model, content)
  } })
  const start: BeeGameSessionRunnerStartInput = { sessionId: 'offline-revision-index-feedback', cwd: workspace, deliveryEvidenceDataRoot: root, env: {
    BEEGAME_CONFIG_DIR: join(root, 'configuration'), BEEGAME_NATIVE_BUILTIN_SKILLS_DIR: join(repo, '.beegame/skills/builtinskills'),
    BEEGAME_MODEL_TYPE: 'anthropic', ANTHROPIC_AUTH_TOKEN: 'LOCAL_ONLY_FIXTURE_KEY', ANTHROPIC_BASE_URL: 'http://127.0.0.1:' + server.port,
    BGS_DEFAULT_BALANCED_MODEL: 'claude-sonnet-4-6', BGS_DEFAULT_FAST_MODEL: 'claude-sonnet-4-6',
    BGS_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
  } }
  const runtime = await createNativeCliProcessRunner({ command: [process.execPath, cli!, ...nativeRuntimeCommand(start).slice(2)] }).start(start)
  const controller = new AbortController(), timer = setTimeout(() => controller.abort('offline_deadline'), 30_000)
  const messages: Record<string, unknown>[] = []
  try {
    await runtime.submit({ prompt: 'Run the isolated index correction fixture.', signal: controller.signal,
      requestPermission: async () => ({ behavior: 'allow' }), onMessage(message) { messages.push(message) },
      projectTurn: { restartContext: false, reviewDocuments: ['GDD.md'], reviewContextPath: contextPath,
        reviewStep: 'revise', reviewWorkspace: workspace, reviewResultPath: receiptPath, reviewWritableDocuments: ['GDD.md'],
        reviewWritableFiles: ['.beegame/design-handoffs/GDD.json'],
        reviewReceiptContext: { step: 'revise', findings: [], sourceHeadings: { 'GDD.md': ['Offline draft'] } } },
    })
    expect(requests).toHaveLength(7)
    expect(JSON.stringify(requests[4]!.messages)).toContain('saved draft checks failed')
    expect(JSON.stringify(requests[4]!.messages)).toContain('same revision step')
    expect(deniedWriteLeftNoReceipt).toBe(true)
    expect(await readFile(receiptPath, 'utf8')).toBe(receipt)
    expect(await readFile(indexPath, 'utf8')).toBe(index.replace('  "document": "docs/GDD.md",\n', ''))
    expect(await readFile(documentPath, 'utf8')).toBe(draft)
    expect(messages.filter(m => m.type === 'system' && m.subtype === 'task_started')).toHaveLength(1)
    expect(messages.some(m => m.type === 'result' && m.subtype === 'success')).toBe(true)
  } finally {
    clearTimeout(timer); controller.abort('offline_cleanup'); await runtime.dispose?.(); server.stop(true)
    await rm(root, { recursive: true, force: true })
  }
}, 35_000)

test.skipIf(!cli).each([true, false])('subagent background=%s emits text and parallel tools once, before completion, without display history in the parent model (offline)', async (background) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-background-tool-stream-'))), workspace = join(root, 'workspace')
  await mkdir(workspace)
  await writeFile(join(workspace, 'fixture.txt'), 'OFFLINE_READ_CONTENT')
  const parentRequests: unknown[] = []
  let childRequests = 0
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (new URL(request.url).pathname.endsWith('/count_tokens')) return Response.json({ input_tokens: 10 })
    if (!new URL(request.url).pathname.endsWith('/messages')) return new Response('', { status: 404 })
    const body = await request.json() as { model: string; system?: unknown; messages: unknown }
    if (JSON.stringify(body.system).includes('OFFLINE_CHILD_SYSTEM')) {
      childRequests++
      return response(body.model, childRequests === 1 ? [{ type: 'tool_use', id: 'slow-background-tool', name: 'Bash', input: {
        command: 'bun -e \'await new Promise(resolve => setTimeout(resolve, 1500)); console.log("OFFLINE_TOOL_FINISHED")\'',
      } }, { type: 'tool_use', id: 'parallel-read-tool', name: 'Read', input: { file_path: join(workspace, 'fixture.txt') } }]
        : { type: 'text', text: 'OFFLINE_CHILD_DONE' })
    }
    parentRequests.push(body.messages)
    return response(body.model, parentRequests.length === 1 ? { type: 'tool_use', id: 'background-owner', name: 'Agent', input: {
      subagent_type: 'offline-observer', description: 'Observe a slow local tool', prompt: 'Run the isolated tool fixture.', run_in_background: background,
    } } : { type: 'text', text: 'OFFLINE_PARENT_DONE' })
  } })
  const start: BeeGameSessionRunnerStartInput = { sessionId: 'offline-background-tool-stream', cwd: workspace, deliveryEvidenceDataRoot: root, env: {
    BEEGAME_CONFIG_DIR: join(root, 'configuration'), BEEGAME_MODEL_TYPE: 'anthropic',
    ANTHROPIC_AUTH_TOKEN: 'LOCAL_ONLY_FIXTURE_KEY', ANTHROPIC_BASE_URL: 'http://127.0.0.1:' + server.port,
    BGS_DEFAULT_BALANCED_MODEL: 'claude-sonnet-4-6', BGS_DEFAULT_FAST_MODEL: 'claude-sonnet-4-6',
    BGS_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
  } }
  const runtime = await createNativeCliProcessRunner({ command: [process.execPath, cli!, ...nativeRuntimeCommand(start).slice(2),
    '--agents', JSON.stringify({ 'offline-observer': { description: 'Offline transport fixture', prompt: 'OFFLINE_CHILD_SYSTEM', tools: ['Bash', 'Read'] } }),
  ] }).start(start)
  const controller = new AbortController(), timer = setTimeout(() => controller.abort('offline_deadline'), 30_000)
  const starts: number[] = [], results: number[] = []
  const readStarts: number[] = [], textMessages: number[] = []
  try {
    await runtime.submit({ prompt: 'Run the offline background observer.', signal: controller.signal,
      requestPermission: async () => ({ behavior: 'allow' }), onMessage(message) {
        const content = (message.message as { content?: Array<{ type: string; id?: string; tool_use_id?: string; text?: string }> } | undefined)?.content ?? []
        if (message.parent_tool_use_id !== 'background-owner') return
        if (content.some(block => block.type === 'tool_use' && block.id === 'slow-background-tool')) starts.push(Date.now())
        if (content.some(block => block.type === 'tool_result' && block.tool_use_id === 'slow-background-tool')) results.push(Date.now())
        if (content.some(block => block.type === 'tool_use' && block.id === 'parallel-read-tool')) readStarts.push(Date.now())
        if (content.some(block => block.type === 'text' && block.text === 'OFFLINE_CHILD_DONE')) textMessages.push(Date.now())
      },
    })
    expect(childRequests).toBe(2)
    expect(starts).toHaveLength(1)
    expect(results).toHaveLength(1)
    expect(readStarts).toHaveLength(1)
    expect(textMessages).toHaveLength(1)
    expect(results[0]! - starts[0]!).toBeGreaterThan(500)
    expect(JSON.stringify(parentRequests)).not.toContain('slow-background-tool')
  } finally {
    clearTimeout(timer); controller.abort('offline_cleanup'); await runtime.dispose?.(); server.stop(true)
    await rm(root, { recursive: true, force: true })
  }
}, 35_000)

type FixtureBlock = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
function response(model: string, content: FixtureBlock | FixtureBlock[]) {
  const blocks = Array.isArray(content) ? content : [content]
  const tool = blocks.some(block => block.type === 'tool_use')
  const frames = [
    { type: 'message_start', message: { id: 'offline-' + crypto.randomUUID(), type: 'message', role: 'assistant',
      content: [], model, stop_reason: null, stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } },
    ...blocks.flatMap((block, index) => [
      { type: 'content_block_start', index, content_block: block.type === 'tool_use' ? { ...block, input: {} } : { type: 'text', text: '' } },
      { type: 'content_block_delta', index, delta: block.type === 'tool_use' ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) }
        : { type: 'text_delta', text: block.text } },
      { type: 'content_block_stop', index },
    ]),
    { type: 'message_delta', delta: { stop_reason: tool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } },
    { type: 'message_stop' },
  ]
  return new Response(frames.map(frame => 'event: ' + frame.type + '\ndata: ' + JSON.stringify(frame) + '\n\n').join(''),
    { headers: { 'content-type': 'text/event-stream' } })
}

test.skipIf(!cli)('native Read, edits and format retrieval preserve ordinary history across milestone resume (offline)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-native-project-turn-')), workspace = join(root, 'workspace')
  await mkdir(join(workspace, 'docs'), { recursive: true })
  await mkdir(join(workspace, '.beegame/delivery'), { recursive: true })
  const source = JSON.stringify({ ok: true, scope: 'content-format-selection', values: { fixture: 'SOURCE '.repeat(3000) } })
  await writeFile(join(workspace, '.beegame/delivery/check-content.mjs'), 'console.log(' + JSON.stringify(source) + ')')
  const draft = '# GDD\nSAVED_BODY_START\nOffline original requirement\nSAVED_BODY_END\n'
  const requests: Array<{ model: string; messages: unknown }> = []
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (new URL(request.url).pathname.endsWith('/count_tokens')) return Response.json({ input_tokens: 10 })
    if (!new URL(request.url).pathname.endsWith('/messages')) return new Response('', { status: 404 })
    const body = await request.json() as { model: string; messages: unknown }
    requests.push(body)
    const content = [
      { type: 'tool_use' as const, id: 'offline-write', name: 'Write', input: { file_path: join(workspace, 'docs/GDD.md'), content: draft } },
      { type: 'tool_use' as const, id: 'offline-read', name: 'Read', input: { file_path: join(workspace, 'docs/GDD.md') } },
      ...[
        ['Offline original requirement', 'Offline corrected requirement'],
        ['SAVED_BODY_START', 'CHECKED_BODY_START'],
        ['SAVED_BODY_END', 'CHECKED_BODY_END'],
      ].map(([old_string, new_string], index) => ({ type: 'tool_use' as const, id: 'offline-repair-' + index,
        name: 'Edit', input: { file_path: join(workspace, 'docs/GDD.md'), old_string, new_string } })),
      { type: 'tool_use' as const, id: 'offline-format-pipeline', name: 'Bash', input: { command: 'bun .beegame/delivery/check-content.mjs --format fixture | head -200' } },
      { type: 'tool_use' as const, id: 'offline-good-format', name: 'Bash', input: { command: 'bun .beegame/delivery/check-content.mjs --format fixture' } },
      { type: 'text' as const, text: 'OFFLINE_CHECKED_HANDOFF' },
      { type: 'tool_use' as const, id: 'offline-next-stage-edit', name: 'Edit', input: {
        file_path: join(workspace, 'docs/GDD.md'), old_string: 'CHECKED_BODY_END', new_string: 'NEXT_STAGE_BODY_END',
      } },
      { type: 'text' as const, text: 'OFFLINE_NEXT_STAGE_OK' },
      { type: 'text' as const, text: 'OFFLINE_RESUME_OK' },
    ][requests.length - 1]
    if (!content) throw new Error('Unexpected extra model request: ' + requests.length)
    return response(body.model, content)
  } })
  let nativeSessionId: string | undefined
  const start: BeeGameSessionRunnerStartInput = { sessionId: 'offline-milestone', cwd: workspace,
    onNativeSessionId(id) { nativeSessionId = id }, env: {
      BEEGAME_CONFIG_DIR: join(root, 'configuration'), BEEGAME_MODEL_TYPE: 'anthropic',
      ANTHROPIC_AUTH_TOKEN: 'LOCAL_ONLY_FIXTURE_KEY', ANTHROPIC_BASE_URL: 'http://127.0.0.1:' + server.port,
      BGS_DEFAULT_BALANCED_MODEL: 'claude-sonnet-4-6', BGS_DEFAULT_FAST_MODEL: 'claude-sonnet-4-6',
      BGS_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
    } }
  const launch = (input: BeeGameSessionRunnerStartInput) => createNativeCliProcessRunner({
    command: [process.execPath, cli!, ...nativeRuntimeCommand(input).slice(2), '--max-turns', '12'],
  }).start(input)
  let runtime = await launch(start)
  const controller = new AbortController(), timer = setTimeout(() => controller.abort('offline_deadline'), 30_000)
  const messages: Record<string, unknown>[] = []
  const submit = (prompt: string, projectTurn?: { restartContext: boolean }) => runtime.submit({
    prompt, projectTurn, signal: controller.signal, onMessage(message) { messages.push(message) },
    requestPermission: async () => ({ behavior: 'allow' }),
  })
  try {
    await submit('HUMAN_ORIGINAL_OFFLINE_ONLY: write and inspect the GDD fixture.', { restartContext: false })
    expect(requests).toHaveLength(8)
    expect(JSON.stringify(requests[2]!.messages)).toContain('SAVED_BODY_END')
    expect(await readFile(join(workspace, 'docs/GDD.md'), 'utf8')).toBe(draft.replace('Offline original requirement', 'Offline corrected requirement')
      .replace('SAVED_BODY_START', 'CHECKED_BODY_START').replace('SAVED_BODY_END', 'CHECKED_BODY_END'))
    expect(JSON.stringify(requests[6]!.messages)).not.toContain('without an output-filtering pipeline')
    const encoded = JSON.stringify(requests[7]!.messages)
    expect(encoded).not.toContain('Full output saved to:')
    expect(encoded).toContain('SOURCE '.repeat(3000))
    const oldId = nativeSessionId
    await submit('HUMAN_NEXT_STAGE: inspect sources if needed.', { restartContext: true })
    expect(nativeSessionId).toBe(oldId)
    expect(JSON.stringify(requests[8]!.messages)).toContain('HUMAN_ORIGINAL_OFFLINE_ONLY')
    expect(JSON.stringify(requests[8]!.messages)).toContain('OFFLINE_CHECKED_HANDOFF')
    expect(JSON.stringify(requests[8]!.messages)).toContain('offline-write')
    expect(messages.some(message => message.type === 'system' && message.subtype === 'compact_boundary')).toBe(false)
    // The previous native saved-file read cache is still valid: no new Read
    // is needed solely because the host changes its business milestone.
    expect(await readFile(join(workspace, 'docs/GDD.md'), 'utf8')).toContain('NEXT_STAGE_BODY_END')
    await runtime.dispose?.()
    runtime = await launch({ ...start, resumeSessionId: oldId })
    await submit('HUMAN_RESUMED_STAGE')
    expect(requests).toHaveLength(11)
    expect(JSON.stringify(requests[10]!.messages)).toContain('HUMAN_ORIGINAL_OFFLINE_ONLY')
    expect(JSON.stringify(requests[10]!.messages)).toContain('HUMAN_NEXT_STAGE')
    expect(JSON.stringify(requests[10]!.messages)).toContain('OFFLINE_CHECKED_HANDOFF')
    expect(messages.filter(m => m.type === 'result' && m.subtype === 'success')).toHaveLength(3)
    const raw = await readFile(join(workspace, '.beegame/logs/native-runtime.jsonl'), 'utf8')
    const projectDir = join(root, 'configuration/projects')
    const transcriptPath = (await readdir(projectDir, { recursive: true })).find(path => path.endsWith(nativeSessionId + '.jsonl'))!
    expect(await readFile(join(projectDir, transcriptPath), 'utf8')).toContain('OFFLINE_CHECKED_HANDOFF') // Durable evidence was not rewritten.
    expect(raw).not.toContain('LOCAL_ONLY_FIXTURE_KEY')
  } finally {
    clearTimeout(timer); controller.abort('offline_cleanup'); await runtime.dispose?.(); server.stop(true)
    await rm(root, { recursive: true, force: true })
  }
}, 35_000)

test.skipIf(!cli)('scheduled author keeps native tool API, format pipeline and save results (offline)', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-author-native-tools-'))), workspace = join(root, 'workspace')
  const repo = fileURLToPath(new URL('../../../', import.meta.url))
  const contextPath = join(workspace, '.beegame/tmp/context.md')
  const formatPath = join(workspace, '.beegame/delivery/content-format.json')
  const checkerPath = join(workspace, '.beegame/delivery/check-content.mjs')
  const uiPath = join(workspace, 'content/ui/menu.json')
  const indexPath = join(workspace, '.beegame/design-handoffs/UI_UX_SPEC.json')
  const indexBody = JSON.stringify({ outputs: [{ id: 'ui', section: 'UI draft', acceptance: { section: 'UI draft', method: 'test' } }] })
  await mkdir(join(workspace, '.beegame/tmp'), { recursive: true })
  await mkdir(join(workspace, '.beegame/delivery'), { recursive: true })
  await mkdir(join(workspace, 'docs'))
  await writeFile(join(workspace, 'docs/UI_UX_SPEC.md'), '# UI draft\nOffline transport fixture; no quality verdict.\n')
  await writeFile(contextPath, '# Offline original UI assignment\nTransport fixture only; no quality verdict.\n')
  const source = JSON.stringify({ ok: true, scope: 'content-format-selection', values: 'SOURCE '.repeat(2500), tail: 'SOURCE_TAIL_RETAINED' })
  await writeFile(formatPath, source)
  await writeFile(checkerPath, 'console.log(' + JSON.stringify(source) + ')')
  const requests: Array<{ model: string; messages: unknown; tools?: Array<{ name: string; description?: string }> }> = []
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (new URL(request.url).pathname.endsWith('/count_tokens')) return Response.json({ input_tokens: 10 })
    if (!new URL(request.url).pathname.endsWith('/messages')) return new Response('', { status: 404 })
    const body = await request.json() as typeof requests[number]
    requests.push(body)
    const content = [
      { type: 'tool_use' as const, id: 'author-task', name: 'Read', input: { file_path: contextPath } },
      { type: 'tool_use' as const, id: 'author-format-read', name: 'Read', input: { file_path: formatPath } },
      { type: 'tool_use' as const, id: 'author-checker-read', name: 'Read', input: { file_path: checkerPath } },
      { type: 'tool_use' as const, id: 'author-format-pipeline', name: 'Bash', input: {
        command: 'bun .beegame/delivery/check-content.mjs --format coordinates | head -200',
      } },
      { type: 'tool_use' as const, id: 'author-ui-save', name: 'Write', input: { file_path: uiPath, content: '{}' } },
      { type: 'tool_use' as const, id: 'author-index-save', name: 'Write', input: { file_path: indexPath, content: indexBody } },
      { type: 'text' as const, text: 'OFFLINE_NATIVE_TOOL_HANDOFF; invalid fixture is not certified for delivery.' },
    ][requests.length - 1]
    if (!content) return new Response('Unexpected fixture request', { status: 400 })
    return response(body.model, content)
  } })
  const start: BeeGameSessionRunnerStartInput = { sessionId: 'offline-native-author-tools', cwd: workspace, deliveryEvidenceDataRoot: root, env: {
    BEEGAME_CONFIG_DIR: join(root, 'configuration'), BEEGAME_NATIVE_BUILTIN_SKILLS_DIR: join(repo, '.beegame/skills/builtinskills'),
    BEEGAME_MODEL_TYPE: 'anthropic', ANTHROPIC_AUTH_TOKEN: 'LOCAL_ONLY_FIXTURE_KEY',
    ANTHROPIC_BASE_URL: 'http://127.0.0.1:' + server.port,
    BGS_DEFAULT_BALANCED_MODEL: 'claude-sonnet-4-6', BGS_DEFAULT_FAST_MODEL: 'claude-sonnet-4-6',
    BGS_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
  } }
  const runtime = await createNativeCliProcessRunner({ command: [process.execPath, cli!, ...nativeRuntimeCommand(start).slice(2)] }).start(start)
  const controller = new AbortController(), timer = setTimeout(() => controller.abort('offline_deadline'), 30_000)
  try {
    await runtime.submit({ prompt: 'Dispatch the offline UI owner.', signal: controller.signal,
      directionAuthors: { batch: 3, contextPath, responsibilities: { 'UI_UX_SPEC.md': 'Original UI ownership' } },
      requestPermission: async () => ({ behavior: 'allow' }), onMessage() {},
    })
    expect(requests).toHaveLength(7)
    const bash = requests[0]!.tools!.find(tool => tool.name === 'Bash')!.description!
    expect(bash).toContain('bash command')
    expect(bash).not.toContain('Use the BGS design commands and source paths supplied')
    expect(JSON.stringify(requests[2]!.messages)).toContain('SOURCE_TAIL_RETAINED')
    expect(JSON.stringify(requests[3]!.messages)).not.toContain('BGS design author source scope')
    const blocks = (requests[4]!.messages as Array<{ content: Array<{ type: string; tool_use_id?: string; content?: unknown; is_error?: boolean }> }>).flatMap(message => message.content)
    const pipeline = blocks.find(block => block.type === 'tool_result' && block.tool_use_id === 'author-format-pipeline')!
    expect(pipeline).toBeDefined()
    expect(pipeline.is_error).not.toBe(true)
    expect(JSON.stringify(pipeline.content)).toContain('SOURCE_TAIL_RETAINED')
    expect(JSON.stringify(requests[6]!.messages)).not.toContain('BGS saved-draft structure')
    expect(JSON.stringify(requests[6]!.messages)).not.toContain('bgsDraftCheck')
    expect(await readFile(uiPath, 'utf8')).toBe('{}')
    expect(await readFile(indexPath, 'utf8')).toBe(indexBody)
  } finally {
    clearTimeout(timer); controller.abort('offline_cleanup'); await runtime.dispose?.(); server.stop(true)
    await rm(root, { recursive: true, force: true })
  }
}, 35_000)

test.skipIf(!cli)('host GDD validation supplies normal continuation requests with real cumulative usage (offline)', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-gdd-format-feedback-'))), workspace = join(root, 'workspace')
  await mkdir(workspace)
  const documentPath = join(workspace, 'docs/GDD.md'), indexPath = join(workspace, '.beegame/design-handoffs/GDD.json')
  const body = '# Rules\nOnly the original fixture rules.\n'
  const proofPath = join(workspace, 'proof.json')
  const index = { outputs: [{ id: 'rule', section: 'Rules', acceptance: { section: 'Rules', method: 'test' } }],
    evidence: [{ id: 'proof', kind: 'contract', path: 'proof.json', source: 'Synthetic fixture', pointer: '/value', expected: 3 }] }
  const requests: Array<{ model: string; messages: unknown }> = [], accounting: number[] = []
  let counted!: () => void
  const usageComplete = new Promise<void>(resolve => { counted = resolve })
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (new URL(request.url).pathname.endsWith('/count_tokens')) return Response.json({ input_tokens: 10 })
    if (!new URL(request.url).pathname.endsWith('/messages')) return new Response('', { status: 404 })
    const input = await request.json() as typeof requests[number]; requests.push(input)
    const steps: Array<FixtureBlock | FixtureBlock[]> = [
      { type: 'tool_use', id: 'gdd-prose', name: 'Write', input: { file_path: documentPath, content: body } },
      { type: 'tool_use', id: 'gdd-bad-index', name: 'Write', input: { file_path: indexPath, content: JSON.stringify({ ...index, document: 'GDD.md' }) } },
      { type: 'text', text: 'complete\nDRAFT_SAVED_BUT_BAD_INDEX' },
      { type: 'tool_use', id: 'gdd-partial-index', name: 'Write', input: { file_path: indexPath, content: JSON.stringify({ ...index, outputs: [] }) } },
      { type: 'text', text: 'complete\nOWNED_DRAFT_STILL_INCOMPLETE' },
      [
        { type: 'tool_use', id: 'gdd-fix-index', name: 'Write', input: { file_path: indexPath, content: JSON.stringify(index) } },
        { type: 'tool_use', id: 'gdd-save-proof', name: 'Write', input: { file_path: proofPath, content: '{"value":3}' } },
      ],
      { type: 'text', text: 'complete\nOWNED_DRAFT_FIXED' },
    ]
    const content = steps[requests.length - 1]
    if (!content) return new Response('Unexpected fixture request', { status: 400 })
    return response(input.model, content)
  } })
  const start: BeeGameSessionRunnerStartInput = { sessionId: 'offline-gdd-format', cwd: workspace, deliveryEvidenceDataRoot: root, env: {
    BEEGAME_CONFIG_DIR: join(root, 'configuration'), BEEGAME_MODEL_TYPE: 'anthropic',
    BEEGAME_NATIVE_BUILTIN_SKILLS_DIR: fileURLToPath(new URL('../../../.beegame/skills/builtinskills', import.meta.url)),
    ANTHROPIC_AUTH_TOKEN: 'LOCAL_ONLY_FIXTURE_KEY', ANTHROPIC_BASE_URL: 'http://127.0.0.1:' + server.port,
    BGS_DEFAULT_BALANCED_MODEL: 'claude-sonnet-4-6', BGS_DEFAULT_FAST_MODEL: 'claude-sonnet-4-6',
    BGS_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
  }, onNativeUsage(usage) {
    accounting.push(usage.total_tokens)
    if (usage.total_tokens >= 140) counted()
  } }
  const runtime = await createNativeCliProcessRunner({ command: [process.execPath, cli!, ...nativeRuntimeCommand(start).slice(2)] }).start(start)
  const controller = new AbortController(), timer = setTimeout(() => controller.abort('offline_deadline'), 20_000)
  try {
    await runtime.submit({ prompt: 'Save only this offline GDD fixture and its index.', projectTurn: { authorDocument: 'GDD.md' },
      signal: controller.signal, requestPermission: async () => ({ behavior: 'allow' }), onMessage() {},
    })
    expect(requests).toHaveLength(3)
    const fields = checkDesignHandoffDraft(workspace, 'GDD.md')
    expect(fields.issues.join(' ')).toContain('Unrecognized key')
    await runtime.submit({ prompt: 'BGS saved-draft diagnostics: ' + fields.issues.join('; ') + '. Repair this saved draft.',
      projectTurn: { authorDocument: 'GDD.md' }, signal: controller.signal,
      requestPermission: async () => ({ behavior: 'allow' }), onMessage() {} })
    expect(requests).toHaveLength(5)
    const missing = checkDesignHandoffDraft(workspace, 'GDD.md')
    expect(missing.issues.join(' ')).toContain('owned delivery outcomes are missing')
    expect(missing.issues.join(' ')).toContain('proof.json')
    await runtime.submit({ prompt: 'BGS saved-draft diagnostics: ' + missing.issues.join('; ') + '. Repair this saved draft.',
      projectTurn: { authorDocument: 'GDD.md' }, signal: controller.signal,
      requestPermission: async () => ({ behavior: 'allow' }), onMessage() {} })
    expect(checkDesignHandoffDraft(workspace, 'GDD.md').issues).toEqual([])
    await Promise.race([usageComplete, new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('No complete usage checkpoint')), { once: true }))])
    expect(requests).toHaveLength(7)
    expect(JSON.stringify(requests[3]!.messages)).toContain('BGS saved-draft diagnostics')
    expect(JSON.stringify(requests[3]!.messages)).toContain('Unrecognized key')
    expect(JSON.stringify(requests[5]!.messages)).toContain('owned delivery outcomes are missing')
    expect(JSON.stringify(requests[5]!.messages)).toContain('proof.json')
    expect(await readFile(documentPath, 'utf8')).toBe(body)
    expect(JSON.parse(await readFile(indexPath, 'utf8'))).toEqual(index)
    expect(await readFile(proofPath, 'utf8')).toBe('{"value":3}')
    expect(accounting.at(-1)).toBe(140)
  } finally {
    clearTimeout(timer); controller.abort('offline_cleanup'); await runtime.dispose?.(); server.stop(true)
    await rm(root, { recursive: true, force: true })
  }
}, 25_000)

test.skipIf(!cli)('a native completion claim does not manufacture files or trigger a BGS self-check retry (offline)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-native-selfcheck-stop-')), workspace = join(root, 'workspace')
  await mkdir(workspace)
  let requests = 0
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (new URL(request.url).pathname.endsWith('/count_tokens')) return Response.json({ input_tokens: 10 })
    if (!new URL(request.url).pathname.endsWith('/messages')) return new Response('', { status: 404 })
    const body = await request.json() as { model: string }
    requests++
    return response(body.model, { type: 'text', text: 'UNSUPPORTED_COMPLETION' })
  } })
  const start: BeeGameSessionRunnerStartInput = { sessionId: 'offline-failed-handoff', cwd: workspace, deliveryEvidenceDataRoot: root, env: {
    BEEGAME_CONFIG_DIR: join(root, 'configuration'), BEEGAME_MODEL_TYPE: 'anthropic',
    ANTHROPIC_AUTH_TOKEN: 'LOCAL_ONLY_FIXTURE_KEY', ANTHROPIC_BASE_URL: 'http://127.0.0.1:' + server.port,
    BGS_DEFAULT_BALANCED_MODEL: 'claude-sonnet-4-6', BGS_DEFAULT_FAST_MODEL: 'claude-sonnet-4-6',
    BGS_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
  } }
  const runtime = await createNativeCliProcessRunner({ command: [process.execPath, cli!,
    ...nativeRuntimeCommand(start).slice(2), '--max-turns', '8'] }).start(start)
  const controller = new AbortController(), timer = setTimeout(() => controller.abort('offline_deadline'), 15_000)
  const messages: Record<string, unknown>[] = []
  try {
    await runtime.submit({ prompt: 'Complete the fixture draft.',
      projectTurn: { restartContext: false }, signal: controller.signal,
      onMessage(message) { messages.push(message) }, requestPermission: async () => ({ behavior: 'deny' }),
    })
    expect(requests).toBe(1)
    expect(messages.some(m => m.type === 'result' && m.subtype === 'success')).toBe(true)
    expect(await Bun.file(join(workspace, 'docs/GDD.md')).exists()).toBe(false)
  } finally {
    clearTimeout(timer); controller.abort('offline_cleanup'); await runtime.dispose?.(); server.stop(true)
    await rm(root, { recursive: true, force: true })
  }
}, 20_000)
