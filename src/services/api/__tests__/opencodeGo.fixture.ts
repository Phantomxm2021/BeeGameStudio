import { strict as assert } from 'node:assert'
import { mock } from 'bun:test'
import { getMacroDefines } from '../../../../scripts/defines.js'
import { OPENCODE_GO_PROFILES } from '../../../../packages/agent-workflow/src/opencode-go.js'
import { mapStoredModelConfigToRuntime } from '../../../../packages/agent-workflow/src/model-config.js'

Object.assign(globalThis, { MACRO: Object.fromEntries(Object.entries(getMacroDefines()).map(([key, value]) => [key.replace('MACRO.', ''), JSON.parse(value)])) })
process.env.BGS_SIMPLE = '1'
// Isolate authentication from any accounts connected on the developer's machine.
const auth = await import('../../../utils/auth.js')
mock.module('../../../utils/auth.js', () => ({
  ...auth,
  checkAndRefreshOAuthTokenIfNeeded: async () => {},
  getApiKeyFromApiKeyHelper: async () => undefined,
  getClaudeAIOAuthTokens: () => null,
  isClaudeAISubscriber: () => false,
  refreshAndGetAwsCredentials: async () => undefined,
  refreshGcpCredentialsIfNeeded: async () => {},
}))
const { getOpenCodeGoHeaders } = await import('../opencodeGo.js')
const { getSessionId, regenerateSessionId } = await import('../../../bootstrap/state.js')
const { getOpenAIClient, clearOpenAIClientCache } = await import('../openai/client.js')
const { getAnthropicClient } = await import('../client.js')

for (const url of [undefined, 'https://api.openai.com/v1', 'https://opencode.ai.evil.test/zen/go/v1', 'https://opencode.ai/zen/go/v1/other', 'http://opencode.ai/zen/go/v1']) assert.deepEqual(getOpenCodeGoHeaders(url, 'private-session'), {})
assert.equal(getOpenCodeGoHeaders(OPENCODE_GO_PROFILES['openai-compatible'].baseUrl, 'actual-session')['X-Opencode-Session'], 'actual-session')
assert.deepEqual(getOpenCodeGoHeaders('https://opencode.ai/inference/go/openai/v1', 'private-session'), {})
const requests: Array<{ url: string; headers: Headers }> = []
const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input)
  const headers = new Headers(input instanceof Request ? input.headers : init?.headers)
  requests.push({ url, headers })
  return new Response(JSON.stringify(new URL(url).pathname.endsWith('/messages')
    ? { id: 'msg-fixture', type: 'message', role: 'assistant', model: 'minimax-m3', content: [{ type: 'text', text: 'fixture' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }
    : { id: 'fixture', object: 'chat.completion', created: 1, model: 'kimi-k3', choices: [{ index: 0, message: { role: 'assistant', content: 'fixture' }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } })
}) as typeof fetch
process.env.OPENAI_BASE_URL = OPENCODE_GO_PROFILES['openai-compatible'].baseUrl
process.env.OPENAI_API_KEY = 'go-chat-key'
process.env.ANTHROPIC_BASE_URL = OPENCODE_GO_PROFILES['anthropic-compatible'].baseUrl
delete process.env.ANTHROPIC_AUTH_TOKEN
delete process.env.ANTHROPIC_API_KEY
Object.assign(process.env, mapStoredModelConfigToRuntime({
  provider: 'anthropic-compatible', baseUrl: process.env.ANTHROPIC_BASE_URL,
  apiKey: 'go-anthropic-key', models: OPENCODE_GO_PROFILES['anthropic-compatible'].defaults,
}).env)
for (const name of ['BGS_USE_BEDROCK', 'BGS_USE_VERTEX', 'BGS_USE_FOUNDRY', 'ANTHROPIC_CUSTOM_HEADERS']) delete process.env[name]
globalThis.fetch = fakeFetch
clearOpenAIClientCache()
const client = getOpenAIClient()
const call = () => client.chat.completions.create({ model: 'kimi-k3', messages: [{ role: 'user', content: 'fixture' }] })
const first = getSessionId()
await call()
await call()
assert.equal(requests[0].headers.get('x-opencode-session'), first)
assert.equal(requests[1].headers.get('x-opencode-session'), first)
const second = regenerateSessionId()
await call()
assert.notEqual(first, second)
assert.equal(requests[2].headers.get('x-opencode-session'), second)
assert.equal(requests[0].url, 'https://opencode.ai/zen/go/v1/chat/completions')
assert.equal(requests[0].headers.get('authorization'), 'Bearer go-chat-key')
assert.match(requests[0].headers.get('user-agent')!, /^bee-game-studio\//)
const anthropic = await getAnthropicClient({ maxRetries: 0, fetchOverride: fakeFetch })
await anthropic.beta.messages.create({ model: 'minimax-m3', max_tokens: 10, messages: [{ role: 'user', content: 'fixture' }] })
assert.equal(requests[3].url, 'https://opencode.ai/zen/go/v1/messages?beta=true')
assert.equal(requests[3].headers.get('x-opencode-session'), second)
assert.equal(requests[3].headers.get('x-api-key'), 'go-anthropic-key')
assert.equal(requests[3].headers.get('authorization'), null)
assert.match(requests[3].headers.get('user-agent')!, /^bee-game-studio\//)
process.env.OPENAI_BASE_URL = 'https://compatible.example/v1'
clearOpenAIClientCache()
await getOpenAIClient().chat.completions.create({ model: 'fixture', messages: [{ role: 'user', content: 'fixture' }] })
assert.equal(requests[4].headers.get('x-opencode-session'), null)
assert.ok(!requests[4].headers.get('user-agent')?.startsWith('bee-game-studio/'))
assert.equal(requests[4].headers.get('x-api-key'), null)
delete process.env.ANTHROPIC_API_KEY
Object.assign(process.env, mapStoredModelConfigToRuntime({
  provider: 'anthropic-compatible', baseUrl: 'https://compatible.example',
  apiKey: 'other-anthropic-key', models: { fast: 'fixture' },
}).env)
const otherAnthropic = await getAnthropicClient({ maxRetries: 0, fetchOverride: fakeFetch })
await otherAnthropic.beta.messages.create({ model: 'fixture', max_tokens: 10, messages: [{ role: 'user', content: 'fixture' }] })
assert.equal(requests[5].url, 'https://compatible.example/v1/messages?beta=true')
assert.equal(requests[5].headers.get('authorization'), 'Bearer other-anthropic-key')
assert.equal(requests[5].headers.get('x-api-key'), null)
assert.equal(requests[5].headers.get('x-opencode-session'), null)
console.log('Go request headers and SDK routes passed')
