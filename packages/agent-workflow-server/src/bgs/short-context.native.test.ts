import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { createBgsRunner } from './runner'
import { nativeSessionOutputPath } from '../beegame/native-runtime-process-path'
import { openAgentTools } from '../beegame/workflow-v3/agent-tools'
import { getLatestRuntimeUsage, type BeeGameEvent } from '../beegame/session-manager'

const localTest = process.env.BGS_SANDBOX_TESTS === '1' ? test : test.skip
localTest('short-context child reads project images and current resource tools without parent history, and usage includes both', async () => {
  const root = await mkdtemp('/private/tmp/bgs-short-context-'), game = join(root, 'game'), catalog = join(root, 'skills')
  await mkdir(join(game, 'assets'), { recursive: true })
  await mkdir(join(catalog, 'fixture'), { recursive: true })
  await writeFile(join(catalog, 'fixture/SKILL.md'), '---\nname: fixture\ndescription: Offline fixture.\n---\nFixture.')
  const image = join(game, 'assets/fixture.png')
  await sharp({ create: { width: 16, height: 16, channels: 4, background: '#336699' } }).png().toFile(image)
  let quotes = 0, parentCalls = 0, childCalls = 0
  const requests: any[] = [], events: any[] = [], usage: BeeGameEvent[] = []
  const bridge = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() {
    quotes++; return Response.json({ available: true, provider: 'offline-fixture' })
  } })
  const tools = await openAgentTools({ workspacePath: game, sessionId: 'fixture', getAuthToken: () => undefined,
    openImage: () => ({ endpoint: bridge.url.origin, instruction: 'Offline fixture', close: async () => {} }) })
  const entry = join(game, tools.directory, 'assets.mjs')
  const message = (text: string) => ({ id: 'answer', type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text, annotations: [] }] })
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const body = await request.json() as any
    requests.push(body)
    const text = JSON.stringify(body.input)
    const parent = text.includes('PARENT_HISTORY_SENTINEL')
    const call = (suffix: string, args: unknown) => {
      const namespace = body.tools.find((tool: any) => tool.type === 'namespace' && tool.tools?.some((child: any) => child.name === suffix))
      const tool = namespace?.tools.find((tool: any) => tool.name === suffix) ?? body.tools.find((tool: any) => tool.name === suffix)
      if (!tool) throw Error('Missing fixture tool: ' + suffix)
      return { type: 'function_call', id: suffix + requests.length, call_id: suffix + requests.length,
        name: tool.name, ...(namespace ? { namespace: namespace.name } : {}), arguments: JSON.stringify(args), status: 'completed' }
    }
    let output
    if (parent) {
      parentCalls++
      if (parentCalls === 1) output = [call('exec_command', { cmd: "printf 'Parent history saved.'" })]
      else if (parentCalls === 2) output = [call('spawn_agent', { fork_context: false,
        message: `CHILD_ASSIGNMENT: Read ${image} and quote via bun ${entry} cost. Read-only; return evidence and unverified limits.` })]
      else if (text.includes('CHILD_RESULT')) output = [message('Parent received CHILD_RESULT; image quality remains unverified.')]
      else {
        const result = body.input.findLast((item: any) => item.type === 'function_call_output' && item.call_id?.startsWith('spawn_agent'))
        const parsed = JSON.parse(result.output)
        output = [call('wait_agent', { targets: [parsed.agent_id], timeout_ms: 10000 })]
      }
    } else {
      childCalls++
      if (childCalls === 1) output = [call('exec_command', { cmd: 'bun ' + entry + ' cost' }), call('view_image', { path: image })]
      else output = [message('CHILD_RESULT: assets/fixture.png read and quote returned; visual quality unverified in scripted fixture.')]
    }
    const response = { id: 'resp_' + requests.length, object: 'response', created_at: 1, model: body.model, status: 'completed', output,
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
      env: { BEEGAME_CONFIG_DIR: join(root, 'private'), BEEGAME_NATIVE_BUILTIN_SKILLS_DIR: catalog,
        OPENAI_API_KEY: 'fixture-only', OPENAI_BASE_URL: server.url.origin + '/v1', BEEGAME_MODEL: 'gpt-5.4' },
      onNativeUsage: (value, epoch) => usage.push({ id: usage.length, type: 'usage', sessionId: 'fixture', text: '', createdAt: new Date(),
        payload: { type: 'usage', subtype: 'native_accounting', nativeAccountingEpoch: epoch, usage: value } }),
      requestPermission: async () => ({ behavior: 'deny' }),
    })
    await runtime.submit({ prompt: 'PARENT_HISTORY_SENTINEL: Establish parent history, then delegate the bounded read-only fixture assignment.', signal: AbortSignal.timeout(20000), onMessage: event => { events.push(event) },
        requestPermission: async () => ({ behavior: 'deny' }) })
    const childRequests = requests.filter(body => !JSON.stringify(body.input).includes('PARENT_HISTORY_SENTINEL'))
    expect(childCalls).toBe(2)
    expect(parentCalls).toBeGreaterThanOrEqual(3)
    expect(JSON.stringify(childRequests[0].input)).toContain('CHILD_ASSIGNMENT')
    expect(JSON.stringify(childRequests[0])).not.toContain('Parent history saved.')
    expect(JSON.stringify(childRequests[1].input)).toContain('offline-fixture')
    expect(JSON.stringify(childRequests[1].input).includes('data:image/')).toBe(true)
    expect(quotes).toBe(1)
    expect(events.some(event => event.text?.includes('Parent received CHILD_RESULT'))).toBe(true)
    expect(getLatestRuntimeUsage(usage)).toEqual({ prompt_tokens: requests.length * 6, cache_read_tokens: requests.length * 4,
      completion_tokens: requests.length * 2, cache_creation_tokens: 0, total_tokens: requests.length * 12 })
  } finally {
    await runtime?.dispose?.(); await tools.close(); bridge.stop(true); server.stop(true)
    await rm(nativeSessionOutputPath(game, 'fixture', await realpath(tmpdir())), { recursive: true, force: true })
    await rm(root, { recursive: true, force: true })
  }
}, 45000)
