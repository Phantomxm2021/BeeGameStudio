import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { WritingWorkflowRuntime } from './writing-workflow-runtime'
import { checkAuthorDraft } from './author-draft-check'
import { designHandoffFixture, writeDesignDocumentFixture, writeDesignDocumentsFixture } from './fixtures/layout-fixture'
import { nativeWritingAuthors, type NativeWritingBatch } from '@bee-game-studio/agent-workflow/native-direction-authors'
import { sanitizePath } from '../../../../src/utils/sessionStoragePortable'
import { nativeSessionTemporaryPath } from './native-runtime-process-path'
import { designBaselineFixture } from './fixtures/layout-fixture'
import { writeBeeGameAssetManifest } from './asset-contracts'
import { assetManifestAuthoringExamples } from './asset-manifest-authoring-contract'

async function reviewTurn(f: Awaited<ReturnType<typeof setup>>) {
  const directory = join(f.workspace, '.beegame/tmp/review')
  await mkdir(directory, { recursive: true })
  const context = join(directory, 'context.md'); await writeFile(context, 'Synthetic original independent Review')
  return { ...f.turn, directionAuthors: undefined, projectTurn: { reviewDocuments: ['GDD.md'], reviewStep: 'inspect' as const,
    reviewContextPath: context, reviewWorkspace: f.workspace, reviewResultPath: join(directory, 'result.txt'),
    reviewWritableDocuments: [], reviewReceiptContext: { step: 'inspect' as const, findings: [], sourceHeadings: { 'GDD.md': ['Design'] } } } }
}
async function exposeGdd(f: Awaited<ReturnType<typeof setup>>, turn: BeeGameSessionSubmitInput) {
  const path = join(f.workspace, 'docs/GDD.md'), content = await readFile(path, 'utf8')
  await turn.onMessage({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'read-gdd', name: 'Read', input: { file_path: path } }] } })
  await turn.onMessage({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'read-gdd',
    content: content.split('\n').map((line, i) => (i + 1) + '\t' + line).join('\n') }] },
    tool_use_result: { type: 'text', file: { filePath: path, content, startLine: 1, numLines: content.split('\n').length, totalLines: content.split('\n').length } } })
}

test('Review is an independent ordinary primary CLI session with public tool selection, host coverage and exact recovery', () => fixture(async f => {
  const turn = await reviewTurn(f); let calls = 0
  const start = async (input: BeeGameSessionRunnerStartInput) => {
    expect(input.nativeTools).toContain('Read'); expect(input.nativeTools).not.toContain('Agent')
    expect(input.systemContext).toContain('game-design-check')
    const base = await f.start(input)
    return { ...base, async submit(request: BeeGameSessionSubmitInput) {
      expect(request.projectTurn).toBeUndefined()
      if (++calls === 2) {
        expect(String(request.prompt)).toContain('remaining saved-source ranges')
        await exposeGdd(f, request)
      }
      await writeFile(turn.projectTurn.reviewResultPath, 'complete\n' + JSON.stringify({ step: 'inspect', findings: [], resolved: [] }))
      await base.submit(request)
    } }
  }
  const first = new WritingWorkflowRuntime(f.input, start)
  await first.submit(turn); await first.dispose()
  expect(calls).toBe(2); expect(f.starts).toHaveLength(1)
  expect(f.events.filter(row => row.type === 'result')).toHaveLength(1)
  expect(f.events.at(-1)?.status).toBe('completed')
  const second = new WritingWorkflowRuntime(f.input, start)
  try { await second.submit(turn); expect(calls).toBe(2); expect(f.starts).toHaveLength(1) }
  finally { await second.dispose() }
}))

test('Review cannot report completion if it never exposes the required saved sources', () => fixture(async f => {
  const turn = await reviewTurn(f); let calls = 0
  const runtime = new WritingWorkflowRuntime(f.input, async input => {
    const base = await f.start(input)
    return { ...base, async submit(request) {
      calls++
      await writeFile(turn.projectTurn.reviewResultPath, 'complete\n' + JSON.stringify({ step: 'inspect', findings: [], resolved: [] }))
      await base.submit(request)
    } }
  })
  try {
    await expect(runtime.submit(turn)).rejects.toThrow('no saved-source progress')
    expect(calls).toBe(2); expect(f.events.some(row => row.type === 'result')).toBe(false)
    expect(f.events.at(-1)?.status).toBe('failed')
  } finally { await runtime.dispose() }
}))

test('a genuine blocked Review receipt is forwarded honestly, not cached as released documents', () => fixture(async f => {
  const turn = await reviewTurn(f)
  const runtime = new WritingWorkflowRuntime(f.input, async input => {
    const base = await f.start(input)
    return { ...base, async submit(request) {
      await exposeGdd(f, request)
      await writeFile(turn.projectTurn.reviewResultPath, 'blocked\n' + JSON.stringify({ step: 'inspect', findings: [], resolved: [],
        blockedReason: 'A required external fact is unavailable.' }))
      await base.submit(request)
    } }
  })
  try {
    await runtime.submit(turn)
    expect(f.events.at(-1)?.status).toBe('blocked')
    await runtime.submit(turn)
    expect(f.starts).toHaveLength(2)
    expect(f.starts[1]!.resumeSessionId).toBe(f.starts[0]!.nativeSessionId)
  } finally { await runtime.dispose() }
}))

test('production feedback never overwrites the task input even if the worker changes it', () => fixture(async f => {
  const directory = join(f.workspace, '.beegame/tmp/task'); await mkdir(directory, { recursive: true })
  const path = join(directory, 'milestone-current.txt')
  const runtime = new WritingWorkflowRuntime(f.input, async () => ({ stop() {}, async submit(turn) {
    await writeFile(f.context, 'Unexpected new authority')
    await writeFile(path, 'done')
    await turn.onMessage({ type: 'result', result: 'Actual owner result' })
  } }))
  try {
    await expect(runtime.submit({ ...f.turn, directionAuthors: undefined, projectTurn: {
      production: { phase: 'resources', contextPath: f.context, inputRevision: 'a'.repeat(64) }, milestoneResult: { phase: 'resources', path } } }))
      .rejects.toThrow('without saved-source progress')
    expect(await readFile(f.context, 'utf8')).toBe('Unexpected new authority')
  } finally { await runtime.dispose() }
}))

import type { BeeGameSessionRunnerStartInput, BeeGameSessionSubmitInput, DashboardSDKMessage } from './session-manager'

async function fixture(run: (value: Awaited<ReturnType<typeof setup>>) => Promise<void>, batch: NativeWritingBatch = 1) {
  const value = await setup(batch)
  try { await run(value) } finally { await rm(value.root, { recursive: true, force: true }) }
}
async function setup(batch: NativeWritingBatch) {
  const root = await realpath(await mkdtemp('/private/tmp/bgs-writing-workflow-test-'))
  const workspace = join(root, 'workspace'), evidence = join(root, 'host'), config = join(root, 'config')
  await mkdir(workspace); await mkdir(evidence); await mkdir(config)
  await writeDesignDocumentsFixture(workspace)
  const context = join(workspace, 'context.md'); await writeFile(context, 'Synthetic original assignment')
  const events: DashboardSDKMessage[] = [], starts: BeeGameSessionRunnerStartInput[] = [], prompts: string[] = [], usage: number[] = []
  const input: BeeGameSessionRunnerStartInput = { sessionId: 'host-parent', cwd: workspace,
    deliveryEvidenceDataRoot: evidence, env: { BEEGAME_CONFIG_DIR: config },
    onNativeUsage: value => usage.push(value.total_tokens), onNativeSessionId: () => { throw Error('Child UUID must not replace parent identity') } }
  const turn: BeeGameSessionSubmitInput = { prompt: 'Original task', directionAuthors: { batch, inputRevision: 'a'.repeat(64), contextPath: context,
    responsibilities: Object.fromEntries(nativeWritingAuthors(batch).map(author => [author.document, 'Own ' + author.document])) },
    signal: new AbortController().signal, onMessage: message => { events.push(message) }, requestPermission: async () => ({ behavior: 'allow' }) }
  const start = async (child: BeeGameSessionRunnerStartInput) => {
    starts.push(child)
    const session = child.nativeSessionId ?? child.resumeSessionId!
    child.onNativeSessionId?.(session)
    const transcript = join(config, 'projects', sanitizePath(workspace), session + '.jsonl')
    await mkdir(join(config, 'projects', sanitizePath(workspace)), { recursive: true })
    await writeFile(transcript, 'Synthetic native transcript marker\n')
    return { submit: async (request: BeeGameSessionSubmitInput) => {
      expect(request.projectTurn).toBeUndefined(); expect(request.directionAuthors).toBeUndefined()
      prompts.push(String(request.prompt))
      await request.onMessage({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'read-' + session, name: 'Read', input: { file_path: context } }] } })
      const counts = { prompt_tokens: 100, completion_tokens: 10, cache_read_tokens: 5, cache_creation_tokens: 2, total_tokens: 117 }
      child.onNativeUsage?.(counts)
      await request.onMessage({ type: 'result', subtype: 'success', is_error: false, result: 'Saved owned draft.',
        modelUsage: { fixture: { inputTokens: 100, outputTokens: 10, cacheReadInputTokens: 5, cacheCreationInputTokens: 2 } } })
      // Duplicate or late diagnostic must not double-count the SDK result.
      child.onNativeUsage?.(counts)
    }, stop() {}, async dispose() {} }
  }
  return { root, workspace, evidence, config, context, input, turn, events, starts, prompts, usage, start }
}

test('host dispatches three ordinary sessions with source-backed methods, truthful events and exact accounting', () => fixture(async f => {
  const runtime = new WritingWorkflowRuntime(f.input, f.start)
  try {
    await runtime.submit(f.turn)
    expect(f.starts).toHaveLength(3)
    expect(new Set(f.starts.map(row => row.nativeSessionId)).size).toBe(3)
    for (const row of f.starts) {
      expect(row.resumeSessionId).toBeUndefined()
      expect(row.systemContext).toContain('# BGS-supplied method:')
      expect(row.systemContext).toContain('No author semantic PASS')
    }
    const starts = f.events.filter(row => row.subtype === 'task_started')
    const ends = f.events.filter(row => row.subtype === 'task_notification')
    expect(starts).toHaveLength(3); expect(ends).toHaveLength(3)
    expect(ends.every(row => row.status === 'completed' && row.origin === 'workflow_host')).toBe(true)
    expect(f.events.filter(row => row.type === 'assistant').every(row => starts.some(task => task.tool_use_id === row.parent_tool_use_id))).toBe(true)
    expect(JSON.stringify(f.events)).not.toContain('"name":"Agent"')
    expect(f.events.filter(row => row.type === 'result')).toHaveLength(1)
    expect(f.events.at(-1)?.origin).toBe('workflow_host')
    expect(f.usage.at(-1)).toBe(351)
    expect(f.usage.every((count, i) => i === 0 || count >= f.usage[i - 1]!)).toBe(true)
  } finally { await runtime.dispose() }
}))

test.each([2, 3, 4] as const)('batch %d observes real dependencies rather than forcing every author parallel', batch => fixture(async f => {
  const runtime = new WritingWorkflowRuntime(f.input, async child => {
    if (f.starts.length) expect(f.events.at(-1)?.subtype).toBe('task_notification')
    return f.start(child)
  })
  try { await runtime.submit(f.turn); expect(f.starts).toHaveLength(batch === 3 ? 1 : 2) }
  finally { await runtime.dispose() }
}, batch))

test('saved draft format feedback is a normal continuation in the same author session', () => fixture(async f => {
  const path = join(f.workspace, '.beegame/design-handoffs/UI_UX_SPEC.json')
  const index = designHandoffFixture('UI_UX_SPEC.md')
  await writeFile(path, JSON.stringify({ ...index, document: 'UI_UX_SPEC.md' }))
  let submissions = 0
  const runtime = new WritingWorkflowRuntime(f.input, async child => {
    const base = await f.start(child)
    return { ...base, async submit(turn) {
      if (++submissions === 2) { expect(String(turn.prompt)).toContain('Unrecognized key'); await writeFile(path, JSON.stringify(index)) }
      await base.submit(turn)
    } }
  })
  try {
    await runtime.submit(f.turn)
    expect(submissions).toBe(2); expect(f.starts).toHaveLength(1)
    expect(f.events.at(-1)?.subtype).toBe('success')
  } finally { await runtime.dispose() }
}, 3))

test('unchanged invalid files stop with an honest error, not a hidden native loop or turn limit', () => fixture(async f => {
  await writeFile(join(f.workspace, '.beegame/design-handoffs/UI_UX_SPEC.json'), '{}')
  const runtime = new WritingWorkflowRuntime(f.input, f.start)
  try {
    await expect(runtime.submit(f.turn)).rejects.toThrow('no saved-source progress')
    expect(f.prompts).toHaveLength(2)
    expect(f.events.some(row => row.type === 'result')).toBe(false)
    expect(f.events.at(-1)?.status).toBe('failed')
  } finally { await runtime.dispose() }
}, 3))

test('restart reuses completed saved outputs without another model turn; changed output resumes its actual owner', () => fixture(async f => {
  const first = new WritingWorkflowRuntime(f.input, f.start)
  await first.submit(f.turn); await first.dispose()
  const second = new WritingWorkflowRuntime(f.input, f.start)
  try {
    await second.submit(f.turn)
    expect(f.starts).toHaveLength(1)
    const document = join(f.workspace, 'docs/UI_UX_SPEC.md')
    await writeFile(document, await readFile(document, 'utf8') + '\nChanged owned requirement.\n')
    await second.submit(f.turn)
    expect(f.starts).toHaveLength(2)
    expect(f.starts[1]!.resumeSessionId).toBe(f.starts[0]!.nativeSessionId)
    expect(f.starts[1]!.nativeSessionId).toBeUndefined()
    const starts = f.events.filter(row => row.subtype === 'task_started')
    expect(starts).toHaveLength(2)
    expect(starts[1]!.task_id).toBe(starts[0]!.task_id)
    expect(starts[1]!.tool_use_id).not.toBe(starts[0]!.tool_use_id)
  } finally { await second.dispose() }
}, 3))

test('interrupted owner resumes, while a missing submitted transcript cannot silently duplicate paid work', () => fixture(async f => {
  const first = new WritingWorkflowRuntime(f.input, async child => {
    const base = await f.start(child)
    return { ...base, async submit() { throw Error('Synthetic interruption') } }
  })
  await expect(first.submit(f.turn)).rejects.toThrow('Synthetic interruption'); await first.dispose()
  const session = f.starts[0]!.nativeSessionId!
  const transcript = join(f.config, 'projects', sanitizePath(f.workspace), session + '.jsonl')
  await rm(transcript)
  const second = new WritingWorkflowRuntime(f.input, f.start)
  try {
    await expect(second.submit(f.turn)).rejects.toThrow('no saved native transcript')
    expect(f.starts).toHaveLength(1)
    await writeFile(transcript, 'Synthetic restored transcript')
    await second.submit(f.turn)
    expect(f.starts[1]!.resumeSessionId).toBe(session)
  } finally { await second.dispose() }
}, 3))

test('host store cannot live inside the model-writable workspace', () => fixture(async f => {
  const runtime = new WritingWorkflowRuntime({ ...f.input, deliveryEvidenceDataRoot: f.workspace }, f.start)
  try { await expect(runtime.submit(f.turn)).rejects.toThrow('outside the agent workspace'); expect(f.starts).toHaveLength(0) }
  finally { await runtime.dispose() }
}))

test('a failing parallel owner retains completed siblings, and only the unfinished owner resumes', () => fixture(async f => {
  let completed = 0, release!: () => void
  const siblings = new Promise<void>(resolve => { release = resolve })
  const turn = { ...f.turn, onMessage(message: DashboardSDKMessage) {
    f.events.push(message)
    if (message.subtype === 'task_notification' && message.status === 'completed' && ++completed === 2) release()
  } }
  const first = new WritingWorkflowRuntime(f.input, async child => {
    const base = await f.start(child)
    const audio = child.systemContext?.includes('you own docs/AUDIO_DESIGN.md')
    return { ...base, async submit(turn) {
      if (audio) { await siblings; throw Error('Synthetic audio failure') }
      await base.submit(turn)
    } }
  })
  await expect(first.submit(turn)).rejects.toThrow('Synthetic audio failure')
  await first.dispose()
  expect(f.starts).toHaveLength(3)
  const unfinished = f.starts.find(row => row.systemContext?.includes('you own docs/AUDIO_DESIGN.md'))!
  const second = new WritingWorkflowRuntime(f.input, f.start)
  try {
    await second.submit(f.turn)
    expect(f.starts).toHaveLength(4)
    expect(f.starts[3]!.resumeSessionId).toBe(unfinished.nativeSessionId)
    expect(f.events.filter(row => row.type === 'result')).toHaveLength(1)
  } finally { await second.dispose() }
}))

test('stop aborts every live owner and disposal completes before unfinished work is reported', () => fixture(async f => {
  let running = 0, ready!: () => void
  const started = new Promise<void>(resolve => { ready = resolve })
  const disposed: string[] = [], stopped: string[] = []
  const runtime = new WritingWorkflowRuntime(f.input, async child => {
    const base = await f.start(child)
    const id = child.nativeSessionId!
    return { ...base, async submit(turn) {
      if (++running === 3) ready()
      await new Promise((_, reject) => turn.signal.addEventListener('abort', () => reject(Error('Synthetic stopped owner')), { once: true }))
    }, stop() { stopped.push(id) }, async dispose() { await Bun.sleep(1); disposed.push(id) } }
  })
  const turn = runtime.submit(f.turn)
  // Attach before cancellation so the test never creates an unhandled rejection.
  const failure = turn.then(() => undefined, error => error as Error)
  await started; runtime.stop()
  expect((await failure)?.message).toContain('Synthetic stopped owner')
  expect(stopped).toHaveLength(3); expect(disposed).toHaveLength(3)
  expect(f.events.some(row => row.type === 'result')).toBe(false)
  await runtime.dispose()
}))

test('a blocked owner cannot be reported as completed just because old saved files remain valid', () => fixture(async f => {
  const runtime = new WritingWorkflowRuntime(f.input, async child => {
    const base = await f.start(child)
    return { ...base, async submit(turn) { await turn.onMessage({ type: 'result', is_error: false, result: 'blocked\nA necessary owner decision is unavailable.' }) } }
  })
  try {
    await expect(runtime.submit(f.turn)).rejects.toThrow('assignment is blocked')
    expect(f.events.at(-1)?.status).toBe('failed')
    expect(f.events.some(row => row.type === 'result')).toBe(false)
  } finally { await runtime.dispose() }
}, 3))

test('normal turns use the unchanged ordinary runtime and receive no writer role/history', () => fixture(async f => {
  let submitted: BeeGameSessionSubmitInput | undefined
  const runtime = new WritingWorkflowRuntime(f.input, async child => {
    expect(child.nativeSessionId).toBeUndefined()
    expect(child.systemContext).toBe(f.input.systemContext)
    return { async submit(turn) { submitted = turn; await turn.onMessage({ type: 'result', result: 'Ordinary native response' }) }, stop() {} }
  })
  try {
    await runtime.submit({ ...f.turn, directionAuthors: undefined })
    expect(submitted?.prompt).toBe('Original task')
    expect(f.events).toEqual([{ type: 'result', result: 'Ordinary native response' }])
  } finally { await runtime.dispose() }
}))

test('saved milestone failures return through a standard continuation, without publishing the premature completion', () => fixture(async f => {
  const directory = join(f.workspace, '.beegame/tmp/task'); await mkdir(directory, { recursive: true })
  const path = join(directory, 'milestone-current.txt'), wrong = join(directory, 'milestone-other.txt')
  let calls = 0, starts = 0
  const runtime = new WritingWorkflowRuntime(f.input, async () => {
    starts++
    return { stop() {}, async submit(turn) {
      if (++calls === 1) await writeFile(wrong, 'complete\n')
      else { expect(String(turn.prompt)).toContain(JSON.stringify(path)); await writeFile(path, 'complete\n') }
      await turn.onMessage({ type: 'result', is_error: false, result: 'native-attempt-' + calls,
        modelUsage: { fixture: { inputTokens: calls * 10, outputTokens: calls } } })
    } }
  })
  try {
    await runtime.submit({ ...f.turn, directionAuthors: undefined, projectTurn: { milestoneResult: { phase: 'implementation', path } } })
    expect(starts).toBe(1); expect(calls).toBe(2)
    expect(f.events.filter(row => row.type === 'result').map(row => row.result)).toEqual(['native-attempt-2'])
    expect(f.usage.at(-1)).toBe(22)
    expect(await readFile(wrong, 'utf8')).toBe('complete\n')
  } finally { await runtime.dispose() }
}))

test('unchanged milestone failures stop without a native business StopHook or false completion', () => fixture(async f => {
  const directory = join(f.workspace, '.beegame/tmp/task'); await mkdir(directory, { recursive: true })
  const path = join(directory, 'milestone-current.txt')
  let calls = 0
  const runtime = new WritingWorkflowRuntime(f.input, async () => ({ stop() {}, async submit(turn) {
    calls++; await turn.onMessage({ type: 'result', is_error: false, result: 'Premature claim' })
  } }))
  try {
    await expect(runtime.submit({ ...f.turn, directionAuthors: undefined, projectTurn: { milestoneResult: { phase: 'implementation', path } } })).rejects.toThrow('remains invalid')
    expect(calls).toBe(2); expect(f.events.filter(row => row.type === 'result')).toEqual([])
  } finally { await runtime.dispose() }
}))

test('production receives exact diagnostics through normal continuation, without rewriting temporary task inputs', () => fixture(async f => {
  const directory = join(f.workspace, '.beegame/tmp/task'); await mkdir(directory, { recursive: true })
  const path = join(directory, 'milestone-current.txt'), original = await readFile(f.context, 'utf8')
  let calls = 0
  const runtime = new WritingWorkflowRuntime(f.input, async () => ({ stop() {}, async submit(turn) {
    if (++calls === 1) await writeFile(path, 'done\n')
    else if (calls === 2) {
      expect(String(turn.prompt)).toContain('first line')
      await writeFile(path, 'blocked\n')
    } else {
      const input = await readFile(f.context, 'utf8')
      expect(String(turn.prompt)).toContain('must include a reason')
      expect(input).toBe(original)
      await writeFile(path, 'blocked\nSource-backed professional input unavailable.\n')
    }
    await turn.onMessage({ type: 'result', result: 'Owner outcome' })
  } }))
  try {
    await runtime.submit({ ...f.turn, directionAuthors: undefined, projectTurn: {
      production: { phase: 'resources', contextPath: f.context, inputRevision: 'a'.repeat(64) },
      milestoneResult: { phase: 'resources', path },
    } })
    expect(calls).toBe(3); expect(f.events.filter(row => row.type === 'result')).toHaveLength(1)
  } finally { await runtime.dispose() }
}))

test('unchanged production is reused, but corrupt resources return to the same actual owner and cannot be called complete', () => fixture(async f => {
  await writeBeeGameAssetManifest(f.workspace, assetManifestAuthoringExamples().canonical)
  const asset = join(f.workspace, 'assets/runtime/example/resource.json')
  await mkdir(join(f.workspace, 'assets/runtime/example'), { recursive: true }); await writeFile(asset, '{}')
  const directory = join(f.workspace, '.beegame/tmp/task'); await mkdir(directory, { recursive: true })
  const path = join(directory, 'milestone-current.txt')
  const baseline = designBaselineFixture(f.workspace)
  const turn = { ...f.turn, directionAuthors: undefined, projectTurn: {
    production: { phase: 'resources' as const, contextPath: f.context, inputRevision: 'a'.repeat(64) },
    milestoneResult: { phase: 'resources' as const, path, designBaseline: baseline, objective: '' } } }
  let calls = 0
  const runtime = new WritingWorkflowRuntime(f.input, async input => {
    const base = await f.start(input)
    return { ...base, async submit(request) {
      calls++
      if (calls === 1) await writeFile(path, 'complete\nSaved resources.\n')
      if (calls === 3) {
        expect(String(request.prompt)).toContain('File does not exist')
        await writeFile(path, 'blocked\nMissing resource needs a source-backed replacement.\n')
      }
      await base.submit(request)
    } }
  })
  try {
    await runtime.submit(turn); await runtime.submit(turn)
    expect(calls).toBe(1)
    await rm(asset)
    await runtime.submit(turn)
    expect(calls).toBe(3)
    expect(f.starts[1]!.resumeSessionId).toBe(f.starts[0]!.nativeSessionId)
    expect(f.events.at(-1)?.status).toBe('blocked')
    expect(f.events.filter(row => row.type === 'result')).toHaveLength(3)
  } finally { await runtime.dispose() }
}))

test('legacy native production task records are not silently replaced or dispatched again', () => fixture(async f => {
  const resume = '11111111-1111-4111-8111-111111111111'
  const tasks = join(nativeSessionTemporaryPath(f.workspace, f.input.sessionId),
    process.platform === 'win32' ? 'claude' : 'claude-' + (process.getuid?.() ?? 0), sanitizePath(f.workspace), resume, 'tasks')
  await mkdir(tasks, { recursive: true })
  const path = join(tasks, 'bgs-resources-visual-' + 'a'.repeat(64) + '.json')
  const original = '{"agentId":"a123456","legacy":"pending"}'
  await writeFile(path, original)
  const directory = join(f.workspace, '.beegame/tmp/task'); await mkdir(directory, { recursive: true })
  const runtime = new WritingWorkflowRuntime({ ...f.input, resumeSessionId: resume }, f.start)
  try {
    await expect(runtime.submit({ ...f.turn, directionAuthors: undefined, projectTurn: {
      production: { phase: 'resources', contextPath: f.context, inputRevision: 'a'.repeat(64) },
      milestoneResult: { phase: 'resources', path: join(directory, 'milestone.txt') } } })).rejects.toThrow('Legacy native production associations exist')
    expect(f.starts).toHaveLength(0)
    expect(await readFile(path, 'utf8')).toBe(original)
  } finally { await runtime.dispose() }
}))

test('host draft checker allows pending siblings, rejects lost evidence and does not mutate drafts', () => fixture(async f => {
  await writeDesignDocumentFixture(f.workspace, 'ART_DIRECTION.md', undefined, '# Design\n[Proof](calc/proof.md)\n')
  const before = await readFile(join(f.workspace, 'docs/ART_DIRECTION.md'), 'utf8')
  const failed = checkAuthorDraft(f.workspace, 'ART_DIRECTION.md', 1)
  expect(failed.issues.join('\n')).toContain('calc/proof.md')
  await mkdir(join(f.workspace, 'docs/calc')); await writeFile(join(f.workspace, 'docs/calc/proof.md'), '# Actual synthetic proof')
  const passed = checkAuthorDraft(f.workspace, 'ART_DIRECTION.md', 1)
  expect(passed.issues).toEqual([]); expect(passed.revision).not.toBe(failed.revision)
  expect(await readFile(join(f.workspace, 'docs/ART_DIRECTION.md'), 'utf8')).toBe(before)
}))
