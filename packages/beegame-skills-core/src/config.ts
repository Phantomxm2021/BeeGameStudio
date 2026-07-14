export type BeeGameSkillsConfig = {
  apiBaseUrl: string
  serviceToken?: string
  required?: boolean
}

type SkillsEnv = {
  [key: string]: string | undefined
  BEEGAME_SKILLS_API_BASE_URL?: string
  BEEGAME_SKILLS_SERVICE_TOKEN?: string
  BEEGAME_SKILLS_REQUIRED?: string
  NODE_ENV?: string
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
    required: parseBoolean(env.BEEGAME_SKILLS_REQUIRED) ?? env.NODE_ENV === 'production',
  }
}

function parseBoolean(value: unknown): boolean | undefined {
  if (value === '1' || value === 'true') return true
  if (value === '0' || value === 'false') return false
  return undefined
}

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function trimTrailingSlash(value: string): string {
  let next = value
  while (next.endsWith('/')) next = next.slice(0, -1)
  return next
}
