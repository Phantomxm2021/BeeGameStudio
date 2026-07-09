export function getRuntimeScopedCacheKey(...parts: string[]): string {
  return [
    ...parts,
    process.env.CLAUDE_CONFIG_DIR ?? '',
    process.env.BEEGAME_CONFIG_DIR ?? '',
    process.env.BEEGAME_PROJECT_CONFIG_DIR_NAME ?? '',
    process.env.CLAUDE_CODE_SIMPLE ?? '',
    process.env.CLAUDE_CODE_DISABLE_POLICY_SKILLS ?? '',
  ].join('\0')
}
