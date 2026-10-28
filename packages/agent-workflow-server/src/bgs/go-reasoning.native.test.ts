import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici/index.js'
import { createBgsRunner } from './runner'
import { bgsCommand } from './client'
import { reasoningConnectionKey, saveReasoningPreference } from './preferences-store'

const nativeTest = process.env.BGS_SANDBOX_TESTS === '1' ? test : test.skip

// All upstream requests are intercepted in memory. Unmatched requests cannot
// reach the network; the real native CLI talks only to its localhost bridge.
nativeTest('Go effort reaches the converted request and default clears a cold-resumed override', async () => {
  const root = await mkdtemp('/private/tmp/bgs-go-reasoning-native-'), game = join(root, 'game'), catalog = join(root, 'skills')
  await mkdir(game)
  await mkdir(join(catalog, 'fixture'), { recursive: true })
  await writeFile(join(catalog, 'fixture/SKILL.md'), '---\nname: fixture\ndescription: Offline fixture.\n---\nFixture.')
  const originalDispatcher = getGlobalDispatcher(), mock = new MockAgent()
  mock.disableNetConnect()
  const requests: Array<{ reasoning_effort?: string; messages: Array<{ reasoning_content?: string }> }> = []
  mock.get('https://opencode.ai').intercept({ path: '/zen/go/v1/chat/completions', method: 'POST' }).reply(200, options => {
    requests.push(JSON.parse(String(options.body)))
    return [
      { choices: [{ index: 0, delta: { content: 'Synthetic answer.', reasoning_content: 'synthetic-history-' + requests.length }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 10 } },
    ].map(event => 'data: ' + JSON.stringify(event) + '\n\n').join('')
  }, { headers: { 'content-type': 'text/event-stream' } }).times(4)
  setGlobalDispatcher(mock)
  const env = { BEEGAME_CONFIG_DIR: join(root, 'private'), BEEGAME_NATIVE_BUILTIN_SKILLS_DIR: catalog,
    BEEGAME_MODEL_TYPE: 'openai', BEEGAME_API_PROTOCOL: 'chat-completions', OPENAI_API_KEY: 'offline-fixture-only',
    OPENAI_BASE_URL: 'https://opencode.ai/zen/go/v1', BEEGAME_MODEL: 'deepseek-v4.1-flash' }
  const runner = createBgsRunner({ command: [await realpath(bgsCommand()[0]!)], resolveOutboundTarget: async value => {
    if (value !== env.OPENAI_BASE_URL) throw Error('Unexpected fixture target')
    // Exercise the normal transport's injected dispatcher with no external I/O.
    return { url: new URL(value), addresses: ['198.18.0.1'], trustedDevelopmentProxy: true,
      lookup: (_host, _options, callback) => callback(null, '198.18.0.1', 4) }
  } })
  let runtime: Awaited<ReturnType<typeof runner.start>> | undefined, nativeSessionId = ''
  try {
    for (const effort of [undefined, 'low', 'high', null]) {
      if (effort !== undefined) saveReasoningPreference(env, reasoningConnectionKey(env, env.BEEGAME_MODEL), effort)
      runtime = await runner.start({ sessionId: 'go-effort-fixture', cwd: game, env,
        ...(nativeSessionId ? { resumeSessionId: nativeSessionId } : {}),
        onNativeSessionId: id => { nativeSessionId = id }, requestPermission: async () => ({ behavior: 'deny' }) })
      await runtime.submit({ prompt: 'Return a synthetic answer.', signal: AbortSignal.timeout(15_000),
        onMessage() {}, requestPermission: async () => ({ behavior: 'deny' }) })
      await runtime.dispose?.(); runtime = undefined
    }
    expect(requests.map(request => request.reasoning_effort)).toEqual([undefined, 'low', 'high', undefined])
    expect(requests[1]!.messages.some(message => message.reasoning_content === 'synthetic-history-1')).toBe(true)
    expect(requests[3]).not.toHaveProperty('reasoning_effort')
    mock.assertNoPendingInterceptors()
  } finally {
    await runtime?.dispose?.(); setGlobalDispatcher(originalDispatcher); await mock.close()
    await rm(root, { recursive: true, force: true })
  }
}, 45_000)
