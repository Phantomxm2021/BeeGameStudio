import { OPENCODE_GO_PROFILES } from '../../packages/agent-workflow/src/opencode-go'

export const goModelCatalog = {
  'anthropic-compatible': [...new Set([...Object.values(OPENCODE_GO_PROFILES['anthropic-compatible'].defaults), 'qwen3.7-plus', 'claude-haiku-5-5', 'new-anthropic-model'])],
  'openai-compatible': [...new Set([...Object.values(OPENCODE_GO_PROFILES['openai-compatible'].defaults), 'mimo-v2.6-flash', 'new-chat-model'])],
}
export const goRegistry = { 'opencode-go': { npm: '@ai-sdk/openai-compatible', models: {
  ...Object.fromEntries(goModelCatalog['anthropic-compatible'].map(id => [id, { provider: { npm: '@ai-sdk/anthropic' } }])),
  ...Object.fromEntries(goModelCatalog['openai-compatible'].map(id => [id, {}])),
  'gpt-6-luna': { provider: { npm: '@ai-sdk/openai' } },
  'unsupported-google': { provider: { npm: '@ai-sdk/google' } },
  'removed-model': {},
  'deprecated-model': { status: 'deprecated' },
} } }
export const goAvailable = { data: [...Object.values(goModelCatalog).flat(), 'gpt-6-luna', 'unsupported-google', 'deprecated-model', 'unknown-protocol'].map(id => ({ id })) }

export const goCatalogResponse = (url: string) => {
  if (url === 'https://opencode.ai/inference/go/v1/models') return Response.json(goAvailable)
  if (url === 'https://models.dev/api.json') return Response.json(goRegistry)
  throw Error('Unexpected catalog URL')
}
