import { existsSync, readFileSync } from 'node:fs'

type JsonObject = Record<string, unknown>

loadEnvFile('.env.local')

const supabaseUrl = requireEnv(
  'BEEGAME_SUPABASE_URL',
  'SUPABASE_URL',
  'VITE_SUPABASE_URL',
)
const anonKey = requireEnv(
  'BEEGAME_SUPABASE_ANON_KEY',
  'SUPABASE_ANON_KEY',
  'VITE_SUPABASE_ANON_KEY',
)
const authContext = await resolveSmokeAuthContext()
const authToken = authContext.authToken
const userId = authContext.userId
const dataDir =
  process.env.BEEGAME_SMOKE_DATA_DIR?.trim() ||
  process.env.BEEGAME_DATA_DIR?.trim() ||
  '/tmp/beegame-supabase-smoke'
const assetBucket =
  process.env.BEEGAME_SUPABASE_ASSET_BUCKET?.trim() ||
  process.env.SUPABASE_ASSET_BUCKET?.trim() ||
  'beegame-assets'
const modelConfigId =
  process.env.BEEGAME_SMOKE_MODEL_CONFIG_ID?.trim() || undefined
const smokeId = `smoke_${Date.now().toString(36)}`

const currentUser = await rpc<JsonObject>('beegame_current_user_context', {})
assertCurrentUser(currentUser)

const workspaceId = stringField(currentUser.workspaceId) ||
  stringField(currentUser.workspace_id)
if (!workspaceId) {
  throw new Error(
    'beegame_current_user_context did not return a workspaceId. Re-run the Supabase schema or check the user trigger.',
  )
}

const projectId = `beegame-supabase-${smokeId}`
const projectRoot = `${dataDir.replace(/\/+$/, '')}/${projectId}`
let createdProject = false
let storageObjectPath: string | undefined
let runtimeEnv: JsonObject | undefined
try {
  await createSmokeProject(projectId, workspaceId, projectRoot)
  createdProject = true
  await upsertSmokeAssetManifest(projectId)
  storageObjectPath = await uploadSmokeAssetObject(projectId)
  const creditReservation = await rpc<JsonObject>('beegame_reserve_credits', {
    p_user_id: userId,
    p_credits: 1,
    p_kind: 'supabase_smoke',
    p_project_id: projectId,
    p_metadata: {
      smoke: true,
      script: 'scripts/smoke-beegame-supabase.ts',
    },
  })
  await rpc<JsonObject>('beegame_refund_credit_reservation', {
    p_user_id: userId,
    p_reservation_id: requireStringField(
      creditReservation,
      'reservation_id',
      'beegame_reserve_credits response',
    ),
    p_project_id: projectId,
    p_metadata: {
      smoke: true,
      reason: 'supabase_smoke_cleanup',
    },
  })

  runtimeEnv = await rpc<JsonObject>('beegame_runtime_env', {
    p_user_id: userId,
    p_data_dir: dataDir,
    ...(modelConfigId ? { p_model_config_id: modelConfigId } : {}),
  })
} finally {
  await cleanupSmokeResources({
    projectId: createdProject ? projectId : undefined,
    storageObjectPath,
  })
}
if (!runtimeEnv) {
  throw new Error('beegame_runtime_env smoke check did not return a payload')
}

console.log(JSON.stringify({
  ok: true,
  currentUser: {
    id: currentUser.id,
    role: currentUser.role,
    workspaceId,
    permissionsCount: Array.isArray(currentUser.permissions)
      ? currentUser.permissions.length
      : 0,
  },
  projectMetadata: {
    inserted: true,
    deleted: true,
  },
  assetManifest: {
    upserted: true,
  },
  assetStorage: {
    bucket: assetBucket,
    uploaded: true,
    deleted: true,
  },
  credits: {
    reserved: 1,
    refunded: true,
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

async function rest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(
    `${supabaseUrl.replace(/\/+$/, '')}${path}`,
    {
      ...init,
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${authToken}`,
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
    },
  )
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(
      `${init.method ?? 'GET'} ${path} failed: ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`,
    )
  }
  if (response.status === 204) return undefined as T
  const text = await response.text()
  return (text ? JSON.parse(text) : undefined) as T
}

async function resolveSmokeAuthContext(): Promise<{
  authToken: string
  userId: string
}> {
  const configuredToken =
    process.env.BEEGAME_SUPABASE_ACCESS_TOKEN?.trim() ||
    process.env.SUPABASE_ACCESS_TOKEN?.trim()
  const configuredUserId =
    process.env.BEEGAME_SUPABASE_USER_ID?.trim() ||
    process.env.SUPABASE_USER_ID?.trim()
  if (configuredToken && configuredUserId) {
    return {
      authToken: configuredToken,
      userId: configuredUserId,
    }
  }

  const email = process.env.BEEGAME_SMOKE_EMAIL?.trim()
  const password = process.env.BEEGAME_SMOKE_PASSWORD?.trim()
  if (!email || !password) {
    throw new Error(
      'Missing Supabase smoke auth. Set BEEGAME_SUPABASE_ACCESS_TOKEN + BEEGAME_SUPABASE_USER_ID, or BEEGAME_SMOKE_EMAIL + BEEGAME_SMOKE_PASSWORD.',
    )
  }

  const response = await fetch(
    `${supabaseUrl.replace(/\/+$/, '')}/auth/v1/token?grant_type=password`,
    {
      method: 'POST',
      headers: {
        apikey: anonKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    },
  )
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(
      `Supabase password sign-in failed: ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`,
    )
  }
  const payload = await response.json() as JsonObject
  const token = stringField(payload.access_token)
  const user = isRecord(payload.user) ? payload.user : undefined
  const id = user ? stringField(user.id) : undefined
  if (!token || !id) {
    throw new Error('Supabase password sign-in did not return access_token and user.id')
  }
  return {
    authToken: token,
    userId: id,
  }
}

async function createSmokeProject(
  projectId: string,
  workspaceId: string,
  projectRoot: string,
): Promise<void> {
  const rows = await rest<JsonObject[]>('/rest/v1/beegame_projects?select=id', {
    method: 'POST',
    headers: {
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      id: projectId,
      owner_id: userId,
      workspace_id: workspaceId,
      name: `BeeGame Supabase smoke ${smokeId}`,
      root_path: projectRoot,
      runtime_snapshot: {
        smoke: true,
      },
    }),
  })
  if (!Array.isArray(rows) || rows[0]?.id !== projectId) {
    throw new Error('Project metadata insert did not return the smoke project row')
  }
}

async function upsertSmokeAssetManifest(projectId: string): Promise<void> {
  const rows = await rest<JsonObject[]>('/rest/v1/beegame_assets?select=project_id', {
    method: 'POST',
    headers: {
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify({
      id: projectId,
      project_id: projectId,
      owner_id: userId,
      manifest: {
        version: 1,
        project: projectId,
        slots: [
          {
            id: 'smoke_asset',
            name: 'Smoke asset',
            type: 'data',
            status: 'placeholder',
          },
        ],
      },
    }),
  })
  if (!Array.isArray(rows) || rows[0]?.project_id !== projectId) {
    throw new Error('Asset manifest upsert did not return the smoke project row')
  }
}

async function uploadSmokeAssetObject(projectId: string): Promise<string> {
  const objectPath = [
    'projects',
    safeStoragePathSegment(userId),
    safeStoragePathSegment(projectId),
    `${smokeId}.txt`,
  ].join('/')
  const response = await fetch(
    `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/${encodeURIComponent(assetBucket)}/${objectPath}`,
    {
      method: 'PUT',
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${authToken}`,
        'content-type': 'text/plain; charset=utf-8',
        'x-upsert': 'true',
      },
      body: `BeeGame Supabase smoke asset ${smokeId}\n`,
    },
  )
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(
      `Storage upload failed for bucket "${assetBucket}": ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`,
    )
  }
  return objectPath
}

async function deleteSmokeStorageObject(objectPath: string): Promise<void> {
  const response = await fetch(
    `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/${encodeURIComponent(assetBucket)}/${objectPath}`,
    {
      method: 'DELETE',
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${authToken}`,
      },
    },
  )
  if (!response.ok && response.status !== 404) {
    const text = await response.text().catch(() => '')
    throw new Error(
      `Storage cleanup failed for bucket "${assetBucket}": ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`,
    )
  }
}

async function cleanupSmokeResources(input: {
  projectId?: string
  storageObjectPath?: string
}): Promise<void> {
  const errors: string[] = []
  if (input.storageObjectPath) {
    try {
      await deleteSmokeStorageObject(input.storageObjectPath)
    } catch (error) {
      errors.push(toErrorMessage(error))
    }
  }
  if (input.projectId) {
    try {
      await deleteSmokeProject(input.projectId)
    } catch (error) {
      errors.push(toErrorMessage(error))
    }
  }
  if (errors.length) {
    throw new Error(`Smoke cleanup failed: ${errors.join('; ')}`)
  }
}

async function deleteSmokeProject(projectId: string): Promise<void> {
  await rest<void>(
    `/rest/v1/beegame_projects?id=eq.${encodeURIComponent(projectId)}`,
    {
      method: 'DELETE',
      headers: {
        Prefer: 'return=minimal',
      },
    },
  )
}

function assertCurrentUser(currentUser: JsonObject): void {
  if (currentUser.id !== userId) {
    throw new Error(
      `RLS context returned user ${String(currentUser.id)} but expected ${userId}`,
    )
  }
  const permissions = currentUser.permissions
  if (!Array.isArray(permissions) || permissions.length === 0) {
    throw new Error('Current user context did not include permissions')
  }
}

function requireStringField(
  value: JsonObject,
  field: string,
  context: string,
): string {
  const normalized = stringField(value[field])
  if (!normalized) throw new Error(`${context} did not include ${field}`)
  return normalized
}

function requireEnv(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
  throw new Error(`Missing required env: ${names.join(' or ')}`)
}

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return
  const text = readFileSync(path, 'utf8')
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed)
    if (!match) continue
    const [, key, rawValue] = match
    if (!key || process.env[key] !== undefined) continue
    process.env[key] = unquoteEnvValue(rawValue ?? '')
  }
}

function unquoteEnvValue(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function stringField(value: unknown): string | undefined {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized || undefined
}

function safeStoragePathSegment(value: string): string {
  return encodeURIComponent(value.trim().replace(/[^\w.-]+/g, '-'))
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function shouldRedact(key: string): boolean {
  return /(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|AUTH)/i.test(key)
}
