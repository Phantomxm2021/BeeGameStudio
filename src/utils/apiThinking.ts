import type { ThinkingConfig } from './thinking.js'

/** Explicit disable is a wire setting, not omission (custom endpoints have defaults). */
export function applyThinkingPolicy<T extends { thinking?: unknown }>(
  params: T,
  config: ThinkingConfig,
  disabledByEnvironment: boolean,
): T | (Omit<T, 'thinking'> & { thinking: { type: 'disabled' } }) {
  return config.type === 'disabled' || disabledByEnvironment
    ? { ...params, thinking: { type: 'disabled' as const } }
    : params
}

export function thinkingParameterMode(value: unknown): 'default' | 'enabled' | 'adaptive' | 'disabled' {
  const type = value && typeof value === 'object' ? (value as { type?: unknown }).type : undefined
  return type === 'enabled' || type === 'adaptive' || type === 'disabled' ? type : 'default'
}
