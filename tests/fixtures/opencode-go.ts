import { OPENCODE_GO_PROFILES } from '../../packages/agent-workflow/src/opencode-go'

export const goModelCatalog = {
  responses: ['gpt-6-luna', 'new-responses-model', 'deepseek-v4.1-flash', 'deepseek-v4-pro', 'grok-4.6'],
  'anthropic-compatible': [...new Set([OPENCODE_GO_PROFILES['anthropic-compatible'].model, 'qwen3.7-plus', 'claude-haiku-5-5', 'new-anthropic-model'])],
  'openai-compatible': [...new Set([OPENCODE_GO_PROFILES['openai-compatible'].model, 'mimo-v2.6-flash', 'new-chat-model', 'deepseek-v4.1-flash', 'deepseek-v4-pro'])],
}
export const goRegistry = { 'opencode-go': { npm: '@ai-sdk/openai-compatible', models: {
  ...Object.fromEntries(goModelCatalog['anthropic-compatible'].map(id => [id, { provider: { npm: '@ai-sdk/anthropic' } }])),
  ...Object.fromEntries(goModelCatalog['openai-compatible'].map(id => [id, {}])),
  ...Object.fromEntries(goModelCatalog.responses.filter(id => !goModelCatalog['openai-compatible'].includes(id) && id !== 'grok-4.6').map(id => [id, { provider: { npm: '@ai-sdk/openai' } }])),
  'unsupported-google': { provider: { npm: '@ai-sdk/google' } },
  'removed-model': {},
  'deprecated-model': { status: 'deprecated' },
} }, opencode: { npm: '@ai-sdk/openai-compatible', models: {
  'grok-4.6': { provider: { npm: '@ai-sdk/openai' } },
  // Conflicting generic metadata must not override Go's explicit entries.
  'new-chat-model': { provider: { npm: '@ai-sdk/openai' } },
  'deprecated-model': { provider: { npm: '@ai-sdk/openai' } },
  'not-on-go': { provider: { npm: '@ai-sdk/openai' } },
} } }
export const goAvailable = { data: [...Object.values(goModelCatalog).flat(), 'gpt-6-luna', 'unsupported-google', 'deprecated-model', 'unknown-protocol'].map(id => ({ id })) }

export const goCatalogResponse = (url: string) => {
  if (url === 'https://opencode.ai/inference/go/v1/models') return Response.json(goAvailable)
  if (url === 'https://models.dev/api.json') return Response.json(goRegistry)
  throw Error('Unexpected catalog URL')
}
