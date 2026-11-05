import { expect, spyOn, test } from 'bun:test'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createBgsRunner } from '../bgs/runner'
import { bgsCommand } from '../bgs/client'

const nativeTest = process.env.BGS_SANDBOX_TESTS === '1' ? test : test.skip

// Exercise the installed native consumer without a real provider or project.
nativeTest.each([
  { name: 'quota', code: 'insufficient_quota', body: { error: { type: 'rate_limit_error', code: 'insufficient_quota', message: 'PRIVATE_PROVIDER_BODY' } }, expected: { code: 'insufficient_quota' } },
  { name: 'rate', code: 'rate_limit_exceeded', body: { error: { type: 'rate_limit_error', code: 'rate_limit_exceeded', message: 'PRIVATE_PROVIDER_BODY' } }, expected: { code: 'rate_limit_exceeded' } },
  { name: 'Go top-level quota', code: undefined, body: { type: 'GoUsageLimitError', message: 'Weekly usage limit reached. PRIVATE_PROVIDER_BODY' }, expected: { type: 'GoUsageLimitError', messageReason: 'weekly_usage_limit' } },
  { name: 'message-only upstream rate', code: undefined, body: { error: { message: 'Upstream request failed: [rate_limit_exceeded] Rate limit exceeded. PRIVATE_PROVIDER_BODY' } }, expected: { messageCode: 'rate_limit_exceeded', messageReason: 'rate_limit' } },
])('converted HTTP 429 preserves native failure and diagnostics for $name without retries', async ({ code, body, expected }) => {
  const root = await mkdtemp('/private/tmp/bgs-http-error-'), game = join(root, 'game'), catalog = join(root, 'skills')
  await mkdir(game)
  await mkdir(join(catalog, 'fixture'), { recursive: true })
  await writeFile(join(catalog, 'fixture/SKILL.md'), '---\nname: fixture\ndescription: Offline fixture.\n---\nFixture.')
  const records: Record<string, any>[] = []
  const capture = spyOn(console, 'info').mockImplementation((value: unknown) => {
    if (typeof value === 'string' && value.startsWith('[model-request] ')) records.push(JSON.parse(value.slice(16)))
  })
  let requests = 0
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    if (request.method === 'GET' && /\/models(?:\/|$)/.test(new URL(request.url).pathname)) return new Response(null, { status: 404 })
    requests++
    return Response.json(body, { status: 429, headers: { 'retry-after': '120', 'x-request-id': '01a185aa-eb4f-7583-98c8-3edc62c207a2' } })
  } })
  const runner = createBgsRunner({ command: [await realpath(bgsCommand()[0]!)], resolveOutboundTarget: async value => {
    const url = new URL(value)
    if (url.origin !== server.url.origin) throw Error('External fixture request forbidden')
    return { url, addresses: ['127.0.0.1'], lookup: (_host, _options, callback) => callback(null, '127.0.0.1', 4) }
  } })
  let runtime: Awaited<ReturnType<typeof runner.start>> | undefined
  try {
    runtime = await runner.start({ sessionId: 'http-error-fixture', cwd: game,
      env: { BEEGAME_CONFIG_DIR: join(root, 'private'), BEEGAME_NATIVE_BUILTIN_SKILLS_DIR: catalog,
        BEEGAME_API_PROTOCOL: 'chat-completions', OPENAI_API_KEY: 'fixture-only',
        OPENAI_BASE_URL: server.url.origin + '/v1', BEEGAME_MODEL: 'fixture-unknown-model' },
      requestPermission: async () => ({ behavior: 'deny' }),
    })
    const events: unknown[] = []
    const failure: unknown = await runtime.submit({ prompt: 'Return a synthetic answer.',
      signal: AbortSignal.timeout(15_000), onMessage: event => { events.push(event) },
      requestPermission: async () => ({ behavior: 'deny' }),
    }).catch(error => error)
    expect(requests).toBe(1)
    expect(failure).toBeInstanceOf(Error)
    if (!(failure instanceof Error)) throw Error('Expected the native turn to fail')
    expect(failure).toHaveProperty('bgsErrorInfo', code === 'insufficient_quota'
      ? 'usageLimitExceeded' : { responseTooManyFailedAttempts: { httpStatusCode: 429 } })
    expect(failure.message).toContain(code === 'insufficient_quota' ? 'Quota exceeded' : 'exceeded retry limit')
    expect(JSON.stringify(events)).not.toContain('PRIVATE_PROVIDER_BODY')
    const finished = records.filter(row => row.event === 'finished')
    expect(finished).toHaveLength(1)
    expect(finished[0]).toMatchObject({ httpStatus: 429, error: { bodyStatus: 'parsed',
      requestId: '01a185aa-eb4f-7583-98c8-3edc62c207a2', retryAfter: 120, ...expected } })
    expect(JSON.stringify(records)).not.toContain('PRIVATE_PROVIDER_BODY')
  } finally { await runtime?.dispose?.(); server.stop(true); capture.mockRestore(); await rm(root, { recursive: true, force: true }) }
}, 25_000)
