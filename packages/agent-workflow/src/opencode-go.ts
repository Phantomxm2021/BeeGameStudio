// Model catalog snapshot: 2026-10-16. Go requests use the subscription's /zen/go route.
// Keep protocols separate: Responses and Google models are not supported here.
export const OPENCODE_GO_ID = 'personal-opencode-go'
export const OPENCODE_GO_PROFILES = {
  'anthropic-compatible': {
    label: 'Anthropic',
    baseUrl: 'https://opencode.ai/zen/go',
    models: ['minimax-m3', 'qwen3.8-flash', 'qwen3.7-plus', 'qwen3.8-max', 'claude-haiku-5-5'],
    defaults: { fast: 'qwen3.8-flash', balanced: 'minimax-m3', strong: 'qwen3.8-max' },
  },
  'openai-compatible': {
    label: 'Chat Completions',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    models: ['glm-5.3-flash', 'glm-5.3', 'glm-5.2', 'kimi-k3', 'kimi-k2.7-code', 'longcat-2.0', 'deepseek-v4.1-flash', 'deepseek-v4-pro', 'mimo-v2.6-flash', 'mimo-v2.6-pro', 'mimo-v2.5', 'mimo-v2.5-pro', 'hy4-preview', 'hy3', 'space-bunny', 'longcat-2.5-preview-free', 'step-5-preview', 'cat-jam-free'],
    defaults: { fast: 'glm-5.3-flash', balanced: 'kimi-k2.7-code', strong: 'kimi-k3' },
  },
} as const
export type OpenCodeGoProvider = keyof typeof OPENCODE_GO_PROFILES
export function isOpenCodeGoProvider(value: unknown): value is OpenCodeGoProvider {
  return value === 'anthropic-compatible' || value === 'openai-compatible'
}
