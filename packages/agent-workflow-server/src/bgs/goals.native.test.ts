import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { BgsClient } from './client'
import { bgsProviderConfig } from './runner'
import { getSafeRuntimeProcessEnvironment } from '../beegame/runtime-process-environment'

// These tests use only a local Responses endpoint. They are skipped in the
// ordinary unit-test run because the bundled BGS binary needs the host sandbox.
const nativeTest = process.env.BGS_SANDBOX_TESTS === '1' ? test : test.skip

type Fixture = { server: ReturnType<typeof Bun.serve>; requests: any[]; close(): void }

function textResponse(id: string, text: string, tokens = 1) {
  const message = { id: `message-${id}`, type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text, annotations: [] }] }
  const response = { id, object: 'response', created_at: 1, model: 'fixture-model', status: 'completed', output: [message],
    usage: { input_tokens: 0, output_tokens: tokens, total_tokens: tokens,
      input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } }
  const events = [
    { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
    { type: 'response.output_item.added', output_index: 0, item: { ...message, status: 'in_progress', content: [] } },
    { type: 'response.content_part.added', item_id: message.id, output_index: 0, content_index: 0,
      part: { type: 'output_text', text: '', annotations: [] } },
    { type: 'response.output_text.delta', item_id: message.id, output_index: 0, content_index: 0, delta: text },
    { type: 'response.output_text.done', item_id: message.id, output_index: 0, content_index: 0, text },
    { type: 'response.content_part.done', item_id: message.id, output_index: 0, content_index: 0, part: message.content[0] },
    { type: 'response.output_item.done', output_index: 0, item: message },
    { type: 'response.completed', response },
  ].map((event, sequence_number) => `event: ${event.type}\ndata: ${JSON.stringify({ ...event, sequence_number })}\n\n`).join('')
  return new Response(events, { headers: { 'Content-Type': 'text/event-stream' } })
}

function responsesFixture(): Fixture {
  const requests: any[] = []
  let sequence = 0
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (new URL(request.url).pathname !== '/v1/responses') return new Response('not found', { status: 404 })
    requests.push(await request.json())
    if (requests.length > 8) return new Response('fixture request limit exceeded', { status: 429 })
    sequence++
    return textResponse(`response-${sequence}`, `offline-progress-${sequence}`)
  } })
  return { server, requests, close: () => server.stop(true) }
}

function waitFor<T>(read: () => T | undefined, predicate: (value: T) => boolean, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const poll = () => {
      const value = read()
      if (value !== undefined && predicate(value)) return resolve(value)
      if (Date.now() >= deadline) return reject(new Error('Timed out waiting for native Goal event'))
      setTimeout(poll, 10)
    }
    poll()
  })
}

async function startClient(root: string, fixture: Fixture, onNotification: (method: string, params: any) => void) {
  const env = { ...getSafeRuntimeProcessEnvironment(), BGS_HOME: root,
    OPENAI_API_KEY: 'synthetic-offline-only', OPENAI_BASE_URL: fixture.server.url.origin + '/v1',
    BEEGAME_MODEL: 'fixture-model' }
  const config = { ...bgsProviderConfig(env), cli_auth_credentials_store: 'file', 'features.goals': true }
  const client = await BgsClient.connect({ cwd: root, env, config, onNotification })
  const { thread } = await client.request('thread/start', { cwd: root })
  return { client, threadId: thread.id }
}

nativeTest('native Goal continues an idle thread and stops at its own token budget', async () => {
  const root = await mkdtemp('/private/tmp/bgs-goals-native-')
  const fixture = responsesFixture()
  let client: BgsClient | undefined
  const notifications: { method: string; params: any }[] = []
  try {
    const started = await startClient(root, fixture, (method, params) => notifications.push({ method, params }))
    client = started.client
    await client.request('thread/goal/set', { threadId: started.threadId, objective: 'Finish the offline fixture', status: 'active', tokenBudget: 3 })
    await waitFor(() => notifications.findLast(event => event.method === 'thread/goal/updated')?.params?.goal,
      goal => goal.status === 'budgetLimited' || goal.status === 'complete')
    expect(fixture.requests.length).toBeGreaterThanOrEqual(2)
    expect(fixture.requests.length).toBeLessThanOrEqual(3)
    expect(notifications.filter(event => event.method === 'turn/completed').length).toBeGreaterThanOrEqual(2)
    const toolNames = fixture.requests.map(request => (request.tools ?? [])
      .map((tool: any) => tool.name ?? tool.function?.name).filter(Boolean))
    expect(toolNames.every(names => names.includes('get_goal') && names.includes('update_goal'))).toBe(true)
    const goal = (await client.request('thread/goal/get', { threadId: started.threadId })).goal
    expect(goal.status).toBe('budgetLimited')
    expect(goal.tokensUsed).toBeGreaterThan(0)
  } finally {
    await client?.close()
    fixture.close()
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)

nativeTest('native Goal pause and resume preserve the same thread and do not start work while paused', async () => {
  const root = await mkdtemp('/private/tmp/bgs-goals-pause-')
  const fixture = responsesFixture()
  let client: BgsClient | undefined
  const notifications: { method: string; params: any }[] = []
  try {
    const started = await startClient(root, fixture, (method, params) => notifications.push({ method, params }))
    client = started.client
    const paused = await client.request('thread/goal/set', { threadId: started.threadId, objective: 'Pause the offline fixture', status: 'paused', tokenBudget: 20 })
    expect(paused.goal.status).toBe('paused')
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(fixture.requests).toHaveLength(0)

    await client.request('thread/goal/set', { threadId: started.threadId, status: 'active' })
    await waitFor(() => notifications.find(event => event.method === 'turn/completed'), Boolean)
    const requestsBeforePause = fixture.requests.length
    await client.request('thread/goal/set', { threadId: started.threadId, status: 'paused' })
    const pausedGoal = (await client.request('thread/goal/get', { threadId: started.threadId })).goal
    expect(pausedGoal).toMatchObject({ objective: 'Pause the offline fixture', tokenBudget: 20, status: 'paused' })
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(fixture.requests.length).toBeLessThanOrEqual(requestsBeforePause + 1)

    const completedBeforeResume = notifications.filter(event => event.method === 'turn/completed').length
    const requestsBeforeResume = fixture.requests.length
    await client.request('thread/goal/set', { threadId: started.threadId, status: 'active' })
    await waitFor(() => notifications.filter(event => event.method === 'turn/completed').length,
      count => count > completedBeforeResume)
    expect(fixture.requests.length).toBeGreaterThan(requestsBeforeResume)
    const resumedGoal = (await client.request('thread/goal/get', { threadId: started.threadId })).goal
    expect(resumedGoal).toMatchObject({ objective: 'Pause the offline fixture', tokenBudget: 20, status: 'active' })
    expect(resumedGoal.tokensUsed).toBeGreaterThan(pausedGoal.tokensUsed)

    await client.request('thread/goal/set', { threadId: started.threadId, status: 'paused' })
    expect((await client.request('thread/goal/get', { threadId: started.threadId })).goal)
      .toMatchObject({ objective: 'Pause the offline fixture', tokenBudget: 20, status: 'paused' })
  } finally {
    await client?.close()
    fixture.close()
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)

nativeTest('native Goal API rejects control of an unknown thread without contacting the model', async () => {
  const root = await mkdtemp('/private/tmp/bgs-goals-unknown-')
  const fixture = responsesFixture()
  let client: BgsClient | undefined
  try {
    const started = await startClient(root, fixture, () => {})
    client = started.client
    await expect(client.request('thread/goal/set', { threadId: '00000000-0000-7000-8000-000000000099', objective: 'Unknown', status: 'active' })).rejects.toThrow()
    expect(fixture.requests).toHaveLength(0)
  } finally {
    await client?.close()
    fixture.close()
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)
