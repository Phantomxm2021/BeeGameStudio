import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createNativeCliProcessRunner, nativeRuntimeCommand } from '../src/beegame/native-cli-process-runner'
import type { BeeGameSessionRunnerStartInput } from '../src/beegame/session-manager'
import { DESIGN_REVIEW_MAX_TURNS } from '../../../src/beegame/design-review'

// Explicit isolated CLI + fake loopback provider: no saved credentials or paid requests.
const cli = process.env.BEEGAME_REVIEW_TEST_CLI

test.skipIf(!cli)('capped native Revision fails with its reason, preserves partial edits and never synthesizes a receipt (offline)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-review-limit-')), workspace = join(root, 'workspace')
  const repo = fileURLToPath(new URL('../../../', import.meta.url))
  const contextPath = join(workspace, '.beegame/tmp/context.md'), receiptPath = join(workspace, '.beegame/tmp/result.txt')
  const documentPath = join(workspace, 'docs/GDD.md')
  await mkdir(join(workspace, '.beegame/tmp'), { recursive: true })
  await mkdir(join(workspace, 'docs'))
  await writeFile(contextPath, '# Offline assignment\nRevise only the recorded fixture; submit a real receipt only after required checks.\n')
  await writeFile(documentPath, '# Offline draft\nORIGINAL_FIXTURE\n')
  let requests = 0
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (new URL(request.url).pathname.endsWith('/count_tokens')) return Response.json({ input_tokens: 10 })
    if (!new URL(request.url).pathname.endsWith('/messages')) return new Response('', { status: 404 })
    const body = await request.json() as { model: string }
    requests++
    const content = requests === 2
      ? { type: 'tool_use' as const, id: 'limit-edit', name: 'Edit', input: {
        file_path: documentPath, old_string: 'ORIGINAL_FIXTURE', new_string: 'PARTIAL_REVISION', replace_all: false,
      } }
      : { type: 'tool_use' as const, id: 'limit-read-' + requests, name: 'Read', input: { file_path: documentPath } }
    return response(body.model, content)
  } })
  const start: BeeGameSessionRunnerStartInput = { sessionId: 'offline-review-limit', cwd: workspace, env: {
    BEEGAME_CONFIG_DIR: join(root, 'configuration'), BEEGAME_NATIVE_BUILTIN_SKILLS_DIR: join(repo, '.beegame/skills/builtinskills'),
    BEEGAME_MODEL_TYPE: 'anthropic', ANTHROPIC_AUTH_TOKEN: 'LOCAL_ONLY_FIXTURE_KEY',
    ANTHROPIC_BASE_URL: 'http://127.0.0.1:' + server.port,
    ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-6', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-sonnet-4-6',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
  } }
  const runtime = await createNativeCliProcessRunner({ command: [process.execPath, cli!, ...nativeRuntimeCommand(start).slice(2)] }).start(start)
  const controller = new AbortController(), timer = setTimeout(() => controller.abort('offline_deadline'), 30_000)
  const messages: Record<string, unknown>[] = []
  try {
    await expect(runtime.submit({ prompt: 'Run the offline revision fixture.', signal: controller.signal,
      projectTurn: { restartContext: false, reviewDocuments: ['GDD.md'], reviewStep: 'revise',
        reviewContextPath: contextPath, reviewWorkspace: workspace, reviewResultPath: receiptPath, reviewWritableDocuments: ['GDD.md'],
        reviewReceiptContext: { step: 'revise', findings: [], sourceHeadings: { 'GDD.md': ['Offline draft'] } } },
      requestPermission: async () => ({ behavior: 'allow' }), onMessage(message) { messages.push(message) },
    })).rejects.toThrow(`Agent execution limit reached (${DESIGN_REVIEW_MAX_TURNS} turns)`)
    expect(requests).toBe(DESIGN_REVIEW_MAX_TURNS)
    expect(messages.some(m => m.type === 'result' && m.subtype === 'success')).toBe(false)
    expect(messages.some(m => m.type === 'system' && m.subtype === 'task_notification' && m.status === 'failed')).toBe(true)
    expect(await Bun.file(receiptPath).exists()).toBe(false)
    expect(await readFile(documentPath, 'utf8')).toBe('# Offline draft\nPARTIAL_REVISION\n')
  } finally {
    clearTimeout(timer); controller.abort('offline_cleanup'); await runtime.dispose?.(); server.stop(true)
    await rm(root, { recursive: true, force: true })
  }
}, 35_000)

test.skipIf(!cli)('scheduled review runs fresh native children without coordinator model calls (offline)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-review-skill-')), workspace = join(root, 'workspace')
  const repo = fileURLToPath(new URL('../../../', import.meta.url))
  const skillRoot = join(repo, '.beegame/skills/builtinskills')
  const contextPath = join(workspace, '.beegame/tmp/context.md')
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
      { type: 'text' as const, text: 'OFFLINE_REVIEW_METHOD_HANDOFF_OK; no semantic verdict inferred from this fixture.' },
    ]
    const content = steps[(requests.length - 1) % steps.length]
    if (!content) return new Response('Unexpected extra fixture request', { status: 400 })
    return response(body.model, content)
  } })
  const start: BeeGameSessionRunnerStartInput = {
    sessionId: 'offline-review-skills', cwd: workspace, env: {
      BEEGAME_CONFIG_DIR: join(root, 'configuration'), BEEGAME_NATIVE_BUILTIN_SKILLS_DIR: skillRoot,
      BEEGAME_MODEL_TYPE: 'anthropic', ANTHROPIC_AUTH_TOKEN: 'LOCAL_ONLY_FIXTURE_KEY',
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:' + server.port,
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-6', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-sonnet-4-6',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
    },
  }
  const runtime = await createNativeCliProcessRunner({
    command: [process.execPath, cli!, ...nativeRuntimeCommand(start).slice(2), '--max-turns', '10'],
  }).start(start)
  const controller = new AbortController(), timer = setTimeout(() => controller.abort('offline_deadline'), 30_000)
  const messages: Record<string, unknown>[] = []
  const projectTurn = { restartContext: false, reviewDocuments: ['GDD.md'], reviewContextPath: contextPath,
    reviewStep: 'inspect' as const, reviewWorkspace: workspace, reviewResultPath: join(workspace, '.beegame/tmp/result.txt'),
    reviewWritableDocuments: [], reviewReceiptContext: { step: 'inspect' as const, findings: [], sourceHeadings: { 'GDD.md': ['Offline draft'] } } }
  try {
    await runtime.submit({ prompt: 'Dispatch the independent reviewer; do not review or revise the draft yourself.',
      projectTurn,
      signal: controller.signal, requestPermission: async () => ({ behavior: 'allow' }),
      onMessage(message) { messages.push(message) },
    })
    expect(requests).toHaveLength(4)
    expect(requests[0]!.tools!.map(tool => tool.name).sort()).toEqual(['Read', 'Glob', 'Grep', 'Bash', 'WebFetch', 'WebSearch', 'Write'].sort())
    expect(requests[0]!.tools!.find(tool => tool.name === 'Bash')!.description).toContain('not a general shell')
    const childInput = JSON.stringify(requests[0])
    expect(childInput).toContain('Check whether the assigned design can be used by its downstream team')
    expect(childInput).toContain('## Select the applicable checks')
    expect(childInput).toContain(contextPath)
    expect(childInput).not.toContain('Dispatch the independent reviewer; do not review or revise')
    expect(JSON.stringify(requests[1]!.messages)).toContain('ORIGINAL_REQUIREMENT_ONLY_IN_TASK_FILE')
    expect(JSON.stringify(requests[3]!.messages)).toContain('## GDD.md')
    expect(messages).toContainEqual(expect.objectContaining({ type: 'result', subtype: 'success' }))
    await runtime.submit({ prompt: 'STALE_COORDINATOR_CLAIM: the previous review already passed.',
      projectTurn: { ...projectTurn, restartContext: true },
      signal: controller.signal, requestPermission: async () => ({ behavior: 'allow' }),
      onMessage(message) { messages.push(message) },
    })
    expect(requests).toHaveLength(8)
    expect(JSON.stringify(requests[4])).toContain('## Select the applicable checks')
    expect(JSON.stringify(requests[4])).not.toContain('OFFLINE_REVIEW_METHOD_HANDOFF_OK')
    expect(JSON.stringify(requests[4])).not.toContain('STALE_COORDINATOR_CLAIM')
    const results = messages.filter(message => message.type === 'result' && message.subtype === 'success')
    expect(results).toHaveLength(2)
    expect(results.every(result => String(result.result).includes('OFFLINE_REVIEW_METHOD_HANDOFF_OK'))).toBe(true)
    const usage = Object.values(results[1]!.modelUsage as Record<string, { inputTokens: number; outputTokens: number }>)
    expect(usage.reduce((total, value) => total + value.inputTokens, 0)).toBe(80)
    expect(usage.reduce((total, value) => total + value.outputTokens, 0)).toBe(80)
    const projects = join(root, 'configuration/projects')
    const readTranscripts = async () => (await readdir(projects, { recursive: true })).filter(path => /subagents\/agent-(?!acompact-).*\.jsonl$/.test(path))
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
      expect(raw).toContain('## Select the applicable checks')
      expect(raw).toContain('ORIGINAL_REQUIREMENT_ONLY_IN_TASK_FILE')
    }
    expect(await readFile(documentPath, 'utf8')).toBe('# Offline draft\nComplete saved draft for native read verification.\n')
  } finally {
    clearTimeout(timer); controller.abort('offline_cleanup'); await runtime.dispose?.(); server.stop(true)
    await rm(root, { recursive: true, force: true })
  }
}, 35_000)

test.skipIf(!cli)('bounded review archives full format Read and repairs receipt fields in place (offline)', async () => {
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
  const start: BeeGameSessionRunnerStartInput = { sessionId: 'offline-review-cost-boundary', cwd: workspace, env: {
    BEEGAME_CONFIG_DIR: join(root, 'configuration'),
    BEEGAME_NATIVE_BUILTIN_SKILLS_DIR: join(repo, '.beegame/skills/builtinskills'),
    BEEGAME_MODEL_TYPE: 'anthropic', ANTHROPIC_AUTH_TOKEN: 'LOCAL_ONLY_FIXTURE_KEY',
    ANTHROPIC_BASE_URL: 'http://127.0.0.1:' + server.port,
    ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-6', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-sonnet-4-6',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
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
    expect(messages).toContain('Full output saved to:')
    expect(messages).not.toContain('FULL_FORMAT_TAIL_RETAINED')
    const blocks = (requests[3]!.messages as Array<{ content: Array<{ type: string; content?: unknown }> }>).flatMap(message => message.content)
    const archived = blocks.find(block => block.type === 'tool_result' && String(block.content).includes('Full output saved to:'))!
    const archivePath = String(archived.content).match(/Full output saved to: ([^\n]+)/)![1]!
    expect(await readFile(archivePath, 'utf8')).toContain(format)
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

function response(model: string, content: { type: 'text'; text: string } |
  { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }) {
  const tool = content.type === 'tool_use'
  const frames = [
    { type: 'message_start', message: { id: 'offline-' + crypto.randomUUID(), type: 'message', role: 'assistant',
      content: [], model, stop_reason: null, stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: tool ? { ...content, input: {} } : { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: tool ? { type: 'input_json_delta', partial_json: JSON.stringify(content.input) }
      : { type: 'text_delta', text: content.text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: tool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } },
    { type: 'message_stop' },
  ]
  return new Response(frames.map(frame => 'event: ' + frame.type + '\ndata: ' + JSON.stringify(frame) + '\n\n').join(''),
    { headers: { 'content-type': 'text/event-stream' } })
}

test.skipIf(!cli)('native full Read plus three repairs can hand off without redundant reread; archive and milestone resume work (offline)', async () => {
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
      { type: 'text' as const, text: 'FALSE_UNREAD_SELF_CHECK_CLAIM' },
      { type: 'tool_use' as const, id: 'offline-read', name: 'Read', input: { file_path: join(workspace, 'docs/GDD.md') } },
      ...[
        ['Offline original requirement', 'Offline corrected requirement'],
        ['SAVED_BODY_START', 'CHECKED_BODY_START'],
        ['SAVED_BODY_END', 'CHECKED_BODY_END'],
      ].map(([old_string, new_string], index) => ({ type: 'tool_use' as const, id: 'offline-repair-' + index,
        name: 'Edit', input: { file_path: join(workspace, 'docs/GDD.md'), old_string, new_string } })),
      { type: 'tool_use' as const, id: 'offline-bad-format', name: 'Bash', input: { command: 'bun .beegame/delivery/check-content.mjs --format fixture | head -200' } },
      { type: 'tool_use' as const, id: 'offline-good-format', name: 'Bash', input: { command: 'bun .beegame/delivery/check-content.mjs --format fixture' } },
      { type: 'text' as const, text: 'OFFLINE_CHECKED_HANDOFF' },
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
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-6', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-sonnet-4-6',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
    } }
  const launch = (input: BeeGameSessionRunnerStartInput) => createNativeCliProcessRunner({
    command: [process.execPath, cli!, ...nativeRuntimeCommand(input).slice(2), '--max-turns', '12'],
  }).start(input)
  let runtime = await launch(start)
  const controller = new AbortController(), timer = setTimeout(() => controller.abort('offline_deadline'), 30_000)
  const messages: Record<string, unknown>[] = []
  const submit = (prompt: string, projectTurn?: { restartContext: boolean; authorDocuments?: string[] }) => runtime.submit({
    prompt, projectTurn, signal: controller.signal, onMessage(message) { messages.push(message) },
    requestPermission: async () => ({ behavior: 'allow' }),
  })
  try {
    await submit('HUMAN_ORIGINAL_OFFLINE_ONLY: write and inspect the GDD fixture.', { restartContext: false, authorDocuments: ['GDD.md'] })
    expect(requests).toHaveLength(9)
    expect(JSON.stringify(requests[2]!.messages)).toContain('inspect the complete current saved documents: docs/GDD.md')
    expect(JSON.stringify(requests[3]!.messages)).toContain('SAVED_BODY_END')
    expect(await readFile(join(workspace, 'docs/GDD.md'), 'utf8')).toBe(draft.replace('Offline original requirement', 'Offline corrected requirement')
      .replace('SAVED_BODY_START', 'CHECKED_BODY_START').replace('SAVED_BODY_END', 'CHECKED_BODY_END'))
    expect(JSON.stringify(requests[7]!.messages)).toContain('without an output-filtering pipeline')
    const encoded = JSON.stringify(requests[8]!.messages)
    expect(encoded).toContain('Full output saved to:')
    const blocks = (requests[8]!.messages as Array<{ content: Array<{ type: string; content?: unknown }> }>).flatMap(m => m.content)
    const archived = blocks.find(block => block.type === 'tool_result' && String(block.content).includes('Full output saved to:'))!
    const path = String(archived.content).match(/Full output saved to: ([^\n]+)/)![1]!
    expect(await readFile(path, 'utf8')).toBe(source)
    const oldId = nativeSessionId
    await submit('HUMAN_NEXT_STAGE: inspect sources if needed.', { restartContext: true })
    expect(nativeSessionId).toBe(oldId)
    expect(JSON.stringify(requests[9]!.messages)).toContain('HUMAN_ORIGINAL_OFFLINE_ONLY')
    expect(JSON.stringify(requests[9]!.messages)).not.toContain('FALSE_UNREAD_SELF_CHECK_CLAIM')
    expect(JSON.stringify(requests[9]!.messages)).not.toContain('offline-write')
    expect(messages).toContainEqual(expect.objectContaining({ type: 'system', subtype: 'compact_boundary' }))
    await runtime.dispose?.()
    runtime = await launch({ ...start, resumeSessionId: oldId })
    await submit('HUMAN_RESUMED_STAGE')
    expect(requests).toHaveLength(11)
    expect(JSON.stringify(requests[10]!.messages)).toContain('HUMAN_ORIGINAL_OFFLINE_ONLY')
    expect(JSON.stringify(requests[10]!.messages)).toContain('HUMAN_NEXT_STAGE')
    expect(JSON.stringify(requests[10]!.messages)).not.toContain('FALSE_UNREAD_SELF_CHECK_CLAIM')
    expect(messages.filter(m => m.type === 'result' && m.subtype === 'success')).toHaveLength(3)
    const raw = await readFile(join(workspace, '.beegame/logs/native-runtime.jsonl'), 'utf8')
    const projectDir = join(root, 'configuration/projects')
    const transcriptPath = (await readdir(projectDir, { recursive: true })).find(path => path.endsWith(nativeSessionId + '.jsonl'))!
    expect(await readFile(join(projectDir, transcriptPath), 'utf8')).toContain('FALSE_UNREAD_SELF_CHECK_CLAIM') // Durable evidence was not rewritten.
    expect(raw).not.toContain('LOCAL_ONLY_FIXTURE_KEY')
  } finally {
    clearTimeout(timer); controller.abort('offline_cleanup'); await runtime.dispose?.(); server.stop(true)
    await rm(root, { recursive: true, force: true })
  }
}, 35_000)

test.skipIf(!cli)('native author that ignores saved-source correction fails instead of retrying forever (offline)', async () => {
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
  const start: BeeGameSessionRunnerStartInput = { sessionId: 'offline-failed-handoff', cwd: workspace, env: {
    BEEGAME_CONFIG_DIR: join(root, 'configuration'), BEEGAME_MODEL_TYPE: 'anthropic',
    ANTHROPIC_AUTH_TOKEN: 'LOCAL_ONLY_FIXTURE_KEY', ANTHROPIC_BASE_URL: 'http://127.0.0.1:' + server.port,
    ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-6', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-sonnet-4-6',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
  } }
  const runtime = await createNativeCliProcessRunner({ command: [process.execPath, cli!,
    ...nativeRuntimeCommand(start).slice(2), '--max-turns', '8'] }).start(start)
  const controller = new AbortController(), timer = setTimeout(() => controller.abort('offline_deadline'), 15_000)
  const messages: Record<string, unknown>[] = []
  try {
    await expect(runtime.submit({ prompt: 'Complete the fixture draft.',
      projectTurn: { restartContext: false, authorDocuments: ['GDD.md'] }, signal: controller.signal,
      onMessage(message) { messages.push(message) }, requestPermission: async () => ({ behavior: 'deny' }),
    })).rejects.toThrow('saved-draft self-check incomplete')
    expect(requests).toBe(2)
    expect(messages.some(m => m.type === 'result' && m.subtype === 'success')).toBe(false)
  } finally {
    clearTimeout(timer); controller.abort('offline_cleanup'); await runtime.dispose?.(); server.stop(true)
    await rm(root, { recursive: true, force: true })
  }
}, 20_000)
