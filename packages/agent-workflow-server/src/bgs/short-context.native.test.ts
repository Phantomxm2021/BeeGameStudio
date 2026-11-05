import { resolve } from 'node:path'
import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, realpath, rm, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { createBgsRunner } from './runner'
import { nativeSessionOutputPath } from '../beegame/native-runtime-process-path'
import { openAgentTools } from '../beegame/workflow-v3/agent-tools'
import { agentProfessionalContextForRun } from '../beegame/workflow-v3/agent-goal'
import { getLatestRuntimeUsage, type BeeGameEvent } from '../beegame/session-manager'

const localTest = process.env.BGS_SANDBOX_TESTS === '1' ? test : test.skip
localTest.each([false, true])('native children retain scope/capacity and reused work blocks premature completion: %s', async premature => {
  const root = await mkdtemp('/private/tmp/bgs-short-context-'), game = join(root, 'game'), catalog = join(root, 'skills')
  await mkdir(join(game, 'assets'), { recursive: true })
  await mkdir(join(catalog, 'fixture'), { recursive: true })
  await writeFile(join(catalog, 'fixture/SKILL.md'), '---\nname: fixture\ndescription: Offline fixture.\n---\nFixture.')
  await writeFile(join(game, 'shared.txt'), 'PARENT_OWNED_UNCHANGED')
  const confirmedScope = 'CONFIRMED_SCOPE_SENTINEL: Preserve selected visuals, animation and gameplay; no external charges.'
  const image = join(game, 'assets/fixture.png')
  await sharp({ create: { width: 16, height: 16, channels: 4, background: '#336699' } }).png().toFile(image)
  let quotes = 0, parentCalls = 0, limitRejected = false, peakChildren = 0, liveChildren = 0
  let releaseChildren!: () => void
  const holdChildren = new Promise<void>(resolve => { releaseChildren = resolve })
  let bothStarted!: () => void
  const twoChildrenStarted = new Promise<void>(resolve => { bothStarted = resolve })
  let reuseSent = false, reuseStarted!: () => void, releaseReuse!: () => void
  const reuseRunning = new Promise<void>(resolve => { reuseStarted = resolve })
  const reuseHold = new Promise<void>(resolve => { releaseReuse = resolve })
  const childCalls = new Map<string, number>()
  const requests: any[] = [], events: any[] = [], usage: BeeGameEvent[] = []
  const bridge = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() {
    quotes++; return Response.json({ available: true, provider: 'offline-fixture' })
  } })
  const tools = await openAgentTools({ workspacePath: game, sessionId: 'fixture', getAuthToken: () => undefined,
    openImage: () => ({ endpoint: bridge.url.origin, instruction: 'Offline fixture', close: async () => {} }) })
  const entry = resolve(game,tools.directory, 'assets.mjs')
  const message = (text: string) => ({ id: 'answer', type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text, annotations: [] }] })
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (request.method === 'GET' && /\/models(?:\/|$)/.test(new URL(request.url).pathname)) return new Response(null, { status: 404 })
    const body = await request.json() as any
    const requestIndex = requests.push(body)
    const text = JSON.stringify(body.input)
    const parent = text.includes('PARENT_HISTORY_SENTINEL')
    const call = (suffix: string, args: unknown, key = suffix) => {
      const namespace = body.tools.find((tool: any) => tool.type === 'namespace' && tool.tools?.some((child: any) => child.name === suffix))
      const tool = namespace?.tools.find((tool: any) => tool.name === suffix) ?? body.tools.find((tool: any) => tool.name === suffix)
      if (!tool) throw Error('Missing fixture tool: ' + suffix)
      return { type: 'function_call', id: key + requestIndex, call_id: key + requestIndex,
        name: tool.name, ...(namespace ? { namespace: namespace.name } : {}), arguments: JSON.stringify(args), status: 'completed' }
    }
    let output
    if (parent) {
      parentCalls++
      if (parentCalls === 1) output = [call('exec_command', { cmd: "printf 'Parent history saved.'" })]
      else if (parentCalls === 2) output = ['a', 'b'].map(owner => call('spawn_agent', { fork_context: false,
        message: `CHILD_ASSIGNMENT_${owner}: Current assignment is a synthetic bounded module task. Only write part-${owner}.txt with ${owner}; shared.txt belongs to the parent. Read ${image} and quote via bun ${entry} cost. Do not delegate, advance or deliver; return output paths and unverified limits.` }, 'spawn_' + owner))
      else if (parentCalls === 3) {
        await twoChildrenStarted
        output = [call('spawn_agent', { fork_context: false, message: 'THIRD_CHILD_MUST_NOT_START' }, 'capacity_probe')]
      }
      else {
        if (parentCalls === 4) {
          const result = body.input.findLast((item: any) => item.type === 'function_call_output' && item.call_id?.startsWith('capacity_probe'))
          limitRejected = /limit|maximum|capacity/i.test(String(result?.output))
          releaseChildren()
        }
        if (text.includes('CHILD_RESULT_a') && text.includes('CHILD_RESULT_b')) {
          const first = body.input.find((item: any) => item.type === 'function_call_output' && /^spawn_a/.test(item.call_id ?? ''))
          const target = JSON.parse(first.output).agent_id
          if (!reuseSent) {
            reuseSent = true
            output = [call('send_input', { target, message: 'Continue the same assignment; return REUSED_CHILD_DONE when done.' })]
          } else {
            await reuseRunning
            if (premature) output = [message('Premature parent finish while reused child is still running')]
            else {
              releaseReuse()
              if (!text.includes('REUSED_CHILD_DONE')) output = [call('wait_agent', { targets: [target], timeout_ms: 10000 })]
              else output = text.includes('INTEGRATED_BOTH') ? [message('Parent integrated both child files; game quality remains unverified.')]
                : [call('exec_command', { cmd: "cat part-a.txt part-b.txt > combined.txt && printf 'INTEGRATED_BOTH'" })]
            }
          }
        } else {
          const results = body.input.filter((item: any) => item.type === 'function_call_output' && /^spawn_[ab]/.test(item.call_id ?? ''))
          output = [call('wait_agent', { targets: results.map((item: any) => JSON.parse(item.output).agent_id), timeout_ms: 10000 })]
        }
      }
    } else {
      const owner = text.includes('CHILD_ASSIGNMENT_a') ? 'a' : text.includes('CHILD_ASSIGNMENT_b') ? 'b' : 'unexpected'
      const count = (childCalls.get(owner) ?? 0) + 1
      childCalls.set(owner, count)
      if (count === 3 && owner === 'a') {
        reuseStarted()
        await reuseHold
        output = [message('REUSED_CHILD_DONE')]
      } else if (count === 1) {
        liveChildren++; peakChildren = Math.max(peakChildren, liveChildren)
        if (liveChildren === 2) bothStarted()
        await holdChildren
        liveChildren--
        output = [call('exec_command', { cmd: `printf '${owner}' > part-${owner}.txt && bun ${entry} cost` }), call('view_image', { path: image })]
      } else output = [message(`CHILD_RESULT_${owner}: part-${owner}.txt written; assets/fixture.png read and quote returned; actual game quality unverified.`)]
    }
    const response = { id: 'resp_' + requestIndex, object: 'response', created_at: 1, model: body.model, status: 'completed', output,
      usage: { input_tokens: 10, input_tokens_details: { cached_tokens: 4 }, output_tokens: 2, total_tokens: 12 } }
    return new Response([
      { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
      ...output.flatMap((item, output_index) => [
        { type: 'response.output_item.added', output_index, item: { ...item, status: 'in_progress' } },
        { type: 'response.output_item.done', output_index, item },
      ]),
      { type: 'response.completed', response },
    ].map((event, sequence_number) => `data: ${JSON.stringify({ ...event, sequence_number })}\n\n`).join(''),
    { headers: { 'Content-Type': 'text/event-stream' } })
  } })
  const runner = createBgsRunner({ resolveOutboundTarget: async value => {
    const url = new URL(value)
    if (url.origin !== server.url.origin) throw Error('Non-local request forbidden')
    return { url, addresses: ['127.0.0.1'], lookup: (_host, _options, callback) => callback(null, '127.0.0.1', 4) }
  } })
  let runtime: Awaited<ReturnType<typeof runner.start>> | undefined
  try {
    runtime = await runner.start({ sessionId: 'fixture', cwd: game,
      systemContext: agentProfessionalContextForRun({}), confirmedBriefContext: confirmedScope,
      env: { BEEGAME_CONFIG_DIR: join(root, 'private'), BEEGAME_NATIVE_BUILTIN_SKILLS_DIR: catalog,
        OPENAI_API_KEY: 'fixture-only', OPENAI_BASE_URL: server.url.origin + '/v1', BEEGAME_MODEL: 'gpt-5.4' },
      onNativeUsage: (value, epoch) => usage.push({ id: usage.length, type: 'usage', sessionId: 'fixture', text: '', createdAt: new Date(),
        payload: { type: 'usage', subtype: 'native_accounting', nativeAccountingEpoch: epoch, usage: value } }),
      requestPermission: async () => ({ behavior: 'deny' }),
    })
    const submitted = runtime.submit({ confirmedBriefContext: confirmedScope, prompt: 'PARENT_HISTORY_SENTINEL: Establish parent history, then delegate two independent fixture modules and integrate their actual files. Parent owns shared.txt. No game delivery.', signal: AbortSignal.timeout(20000), onMessage: event => { events.push(event) },
      requestPermission: async () => ({ behavior: 'deny' }) })
    if (premature) {
      await expect(submitted).rejects.toThrow('unfinished child work')
      expect(childCalls.get('a')).toBe(3)
      return
    }
    await submitted
    expect(peakChildren).toBe(2)
    expect(limitRejected).toBe(true)
    expect(childCalls).toEqual(new Map([['a', 3], ['b', 2]]))
    for (const owner of ['a', 'b']) {
      const inputs = requests.filter(body => !JSON.stringify(body.input).includes('PARENT_HISTORY_SENTINEL') && JSON.stringify(body.input).includes('CHILD_ASSIGNMENT_' + owner))
      expect(inputs).toHaveLength(owner === 'a' ? 3 : 2)
      expect(JSON.stringify(inputs[0].input)).not.toContain('Parent history saved.')
      expect(JSON.stringify(inputs[0].input)).toContain('CONFIRMED_SCOPE_SENTINEL')
      expect(JSON.stringify(inputs[0].input)).toContain('BGS limited parallel work:')
      expect(JSON.stringify(inputs[0].input)).toContain('Only write part-' + owner + '.txt')
      expect(JSON.stringify(inputs[1].input)).toContain('offline-fixture')
      expect(JSON.stringify(inputs[1].input)).toContain('data:image/')
    }
    expect(quotes).toBe(2)
    expect(await readFile(join(game, 'combined.txt'), 'utf8')).toBe('ab')
    expect(await readFile(join(game, 'shared.txt'), 'utf8')).toBe('PARENT_OWNED_UNCHANGED')
    expect(events.some(event => event.text?.includes('Parent integrated both child files'))).toBe(true)
    expect(getLatestRuntimeUsage(usage)).toEqual({ prompt_tokens: requests.length * 6, cache_read_tokens: requests.length * 4,
      completion_tokens: requests.length * 2, cache_creation_tokens: 0, total_tokens: requests.length * 12 })
  } finally {
    releaseChildren(); releaseReuse(); reuseStarted()
    await runtime?.dispose?.(); await tools.close(); bridge.stop(true); server.stop(true)
    await rm(nativeSessionOutputPath(game, 'fixture'), { recursive: true, force: true })
    await rm(root, { recursive: true, force: true })
  }
}, 45000)
