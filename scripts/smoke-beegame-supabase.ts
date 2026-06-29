type JsonObject = Record<string, unknown>

const supabaseUrl = requireEnv('BEEGAME_SUPABASE_URL', 'SUPABASE_URL')
const anonKey = requireEnv(
  'BEEGAME_SUPABASE_ANON_KEY',
  'SUPABASE_ANON_KEY',
  'VITE_SUPABASE_ANON_KEY',
)
const authToken = requireEnv(
  'BEEGAME_SUPABASE_ACCESS_TOKEN',
  'SUPABASE_ACCESS_TOKEN',
)
const userId = requireEnv('BEEGAME_SUPABASE_USER_ID', 'SUPABASE_USER_ID')
const dataDir =
  process.env.BEEGAME_SMOKE_DATA_DIR?.trim() ||
  process.env.BEEGAME_DATA_DIR?.trim() ||
  '/tmp/beegame-supabase-smoke'
const modelConfigId =
  process.env.BEEGAME_SMOKE_MODEL_CONFIG_ID?.trim() || undefined

const currentUser = await rpc<JsonObject>('beegame_current_user_context', {})
const runtimeEnv = await rpc<JsonObject>('beegame_runtime_env', {
  p_user_id: userId,
  p_data_dir: dataDir,
  ...(modelConfigId ? { p_model_config_id: modelConfigId } : {}),
})

if (currentUser.id !== userId) {
  throw new Error(
    `RLS context returned user ${String(currentUser.id)} but expected ${userId}`,
  )
}

console.log(JSON.stringify({
  ok: true,
  currentUser: {
    id: currentUser.id,
    role: currentUser.role,
    permissionsCount: Array.isArray(currentUser.permissions)
      ? currentUser.permissions.length
      : 0,
  },
  runtimeEnv: summarizeRuntimeEnv(runtimeEnv),
}, null, 2))

async function rpc<T>(name: string, payload: JsonObject): Promise<T> {
  const response = await fetch(
    `${supabaseUrl.replace(/\/+$/, '')}/rest/v1/rpc/${name}`,
    {
      method: 'POST',
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${authToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  )
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(
      `${name} failed: ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`,
    )
  }
  return await response.json() as T
}

function requireEnv(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
  throw new Error(`Missing required env: ${names.join(' or ')}`)
}

function summarizeRuntimeEnv(env: JsonObject): JsonObject {
  return Object.fromEntries(
    Object.entries(env)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [
        key,
        typeof value === 'string' && value
          ? shouldRedact(key) ? '<redacted>' : '<set>'
          : '<empty>',
      ]),
  )
}

function shouldRedact(key: string): boolean {
  return /(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|AUTH)/i.test(key)
}
