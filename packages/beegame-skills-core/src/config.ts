export type BeeGameSkillsConfig = {
  apiBaseUrl: string
  serviceToken?: string
}

type SkillsEnv = {
  [key: string]: string | undefined
  BEEGAME_SKILLS_API_BASE_URL?: string
  BEEGAME_SKILLS_SERVICE_TOKEN?: string
}

export function resolveBeeGameSkillsConfig(
  env: SkillsEnv = process.env,
): BeeGameSkillsConfig {
  return {
    apiBaseUrl: trimTrailingSlash(
      trimString(env.BEEGAME_SKILLS_API_BASE_URL) || 'http://127.0.0.1:62176',
    ),
    ...(trimString(env.BEEGAME_SKILLS_SERVICE_TOKEN)
      ? { serviceToken: trimString(env.BEEGAME_SKILLS_SERVICE_TOKEN) }
      : {}),
  }
}

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function trimTrailingSlash(value: string): string {
  let next = value
  while (next.endsWith('/')) next = next.slice(0, -1)
  return next
}
