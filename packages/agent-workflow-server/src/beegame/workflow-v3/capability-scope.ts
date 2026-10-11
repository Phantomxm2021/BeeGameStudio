import type { TaskSpec } from './state'

// Describe actual drivers; never infer allowed tools from an engine name.
export function taskCapabilityNotes(task: TaskSpec, _constraints: Record<string, unknown>): string[] {
  return [
    'Use project-native sources. BGS Scene/UI JSON is optional, not a universal game format. Preserve the confirmed technology.',
    ...(task.checks.some(id => id === 'build' || id === 'rule-tests')
      ? ['These declared build/rule-tests checks execute Bun package scripts. Passing them does not prove engine build or game quality.'] : []),
  ]
}
