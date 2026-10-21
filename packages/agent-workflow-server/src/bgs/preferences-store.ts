import { bgsHomeDirectory } from './home'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export function bgsSettingsHome(env: Record<string, string>) {
  if (!env.BEEGAME_CONFIG_DIR) throw Error('An owner-specific configuration directory is required')
  return bgsHomeDirectory(env.BEEGAME_CONFIG_DIR, env.BGS_HOME)
}

export function reasoningConnectionKey(env: Record<string, string>, model: string) {
  const provider = env.BEEGAME_MODEL_TYPE || 'openai'
  const prefix = { openai: 'OPENAI', anthropic: 'ANTHROPIC', gemini: 'GEMINI', grok: 'GROK' }[provider]
  return createHash('sha256').update(JSON.stringify([env.OPENAI_AUTH_MODE || 'api', provider,
    env.BEEGAME_API_PROTOCOL || '', prefix && env[prefix + '_BASE_URL'] || '', model])).digest('hex')
}

function settingsFile(env: Record<string, string>) { return join(bgsSettingsHome(env), 'bgs-preferences.json') }
export function readReasoningPreferences(env: Record<string, string>): Record<string, string | null> {
  const file = settingsFile(env)
  if (!existsSync(file)) return {}
  const value = JSON.parse(readFileSync(file, 'utf8'))
  if (value.version !== 1 || !value.reasoning || typeof value.reasoning !== 'object' || Array.isArray(value.reasoning) ||
      Object.values(value.reasoning).some(effort => effort !== null && typeof effort !== 'string')) throw Error('Invalid BGS preferences')
  return value.reasoning
}

export function saveReasoningPreference(env: Record<string, string>, key: string, effort: string | null) {
  const reasoning = readReasoningPreferences(env)
  // Keep an explicit default choice: resumed Bgs threads otherwise retain
  // their previous reasoning override even when the config omits it.
  reasoning[key] = effort
  const file = settingsFile(env), temporary = file + '.' + randomUUID() + '.tmp'
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  try {
    writeFileSync(temporary, JSON.stringify({ version: 1, reasoning }) + '\n', { mode: 0o600, flag: 'wx' })
    renameSync(temporary, file)
  } finally { rmSync(temporary, { force: true }) }
}
