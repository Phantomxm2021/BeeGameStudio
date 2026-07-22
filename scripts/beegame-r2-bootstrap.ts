import {
  resolveR2BucketNames,
  type ProjectStorageBucketRole,
} from '../packages/beegame-storage-core/src/index'

type CloudflareEnvelope<T> = {
  success: boolean
  result?: T
  errors?: Array<{ code?: number; message?: string }>
}

export type R2BootstrapResult = {
  buckets: Array<{ name: string; created: boolean }>
  cors: Array<{ name: string; origins: string[] }>
  deliveryPublicBaseUrl?: string
}

const BROWSER_BUCKET_METHODS: Partial<
  Record<ProjectStorageBucketRole, string[]>
> = {
  'project-private': ['GET', 'HEAD', 'PUT'],
  'resource-private': ['GET', 'HEAD', 'PUT'],
  delivery: ['GET', 'HEAD'],
}

export async function bootstrapBeeGameR2(input: {
  env: Record<string, string | undefined>
  fetch?: typeof fetch
}): Promise<R2BootstrapResult> {
  const accountId = required(input.env.BEEGAME_R2_ACCOUNT_ID, 'BEEGAME_R2_ACCOUNT_ID')
  const apiToken = required(input.env.CLOUDFLARE_API_TOKEN, 'CLOUDFLARE_API_TOKEN')
  const request = input.fetch ?? fetch
  const bucketsByRole = resolveR2BucketNames(input.env)
  const bucketNames = [...new Set(Object.values(bucketsByRole))]
  const buckets: R2BootstrapResult['buckets'] = []

  for (const name of bucketNames) {
    const path = `/accounts/${encodeURIComponent(accountId)}/r2/buckets/${encodeURIComponent(name)}`
    const existing = await cloudflareRequest<unknown>(request, apiToken, path)
    if (existing.status === 404) {
      await cloudflareRequest(
        request,
        apiToken,
        `/accounts/${encodeURIComponent(accountId)}/r2/buckets`,
        { method: 'POST', body: JSON.stringify({ name }) },
      )
      buckets.push({ name, created: true })
      continue
    }
    if (!existing.ok) throw await cloudflareError(existing.response, path)
    buckets.push({ name, created: false })
  }

  const corsOrigins = resolveR2CorsOrigins(input.env)
  const cors: R2BootstrapResult['cors'] = []
  for (const [role, methods] of Object.entries(BROWSER_BUCKET_METHODS) as Array<
    [ProjectStorageBucketRole, string[]]
  >) {
    const name = bucketsByRole[role]
    await cloudflareRequest(
      request,
      apiToken,
      `/accounts/${encodeURIComponent(accountId)}/r2/buckets/${encodeURIComponent(name)}/cors`,
      {
        method: 'PUT',
        body: JSON.stringify({
          rules: [
            {
              id: 'beegame-browser-access',
              allowed: {
                origins: corsOrigins,
                methods,
                headers: ['content-type', 'range'],
              },
              exposeHeaders: ['ETag', 'Content-Length', 'Content-Range'],
              maxAgeSeconds: 3600,
            },
          ],
        }),
      },
    )
    cors.push({ name, origins: corsOrigins })
  }

  const configuredPublicUrl = input.env.BEEGAME_R2_DELIVERY_PUBLIC_BASE_URL?.trim()
  return {
    buckets,
    cors,
    ...(configuredPublicUrl
      ? { deliveryPublicBaseUrl: normalizePublicUrl(configuredPublicUrl) }
      : {}),
  }
}

export function resolveR2CorsOrigins(
  env: Record<string, string | undefined>,
): string[] {
  const configured = [
    env.BEEGAME_API_CORS_ORIGINS,
    env.BEEGAME_R2_CORS_ORIGINS,
  ]
    .flatMap(value => (value || '').split(','))
    .map(value => value.trim())
    .filter(Boolean)
  const origins = [
    'http://127.0.0.1:62173',
    'http://localhost:62173',
    ...configured,
  ]
  return [...new Set(origins.map(normalizeCorsOrigin))]
}

function normalizeCorsOrigin(value: string): string {
  const url = new URL(value)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.origin !== value.replace(/\/$/, '')
  )
    throw new Error(`Invalid R2 browser CORS origin: ${value}`)
  return url.origin
}

async function cloudflareRequest<T>(
  request: typeof fetch,
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; response: Response; body?: CloudflareEnvelope<T> }> {
  const response = await request(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...init.headers,
    },
  })
  const body = (await response.clone().json().catch(() => undefined)) as
    | CloudflareEnvelope<T>
    | undefined
  if (response.ok && body?.success === false)
    throw new Error(formatCloudflareErrors(body.errors, path))
  if (!response.ok && response.status !== 404)
    throw await cloudflareError(response, path)
  return { ok: response.ok, status: response.status, response, body }
}

async function cloudflareError(response: Response, path: string): Promise<Error> {
  const body = (await response.json().catch(() => undefined)) as
    | CloudflareEnvelope<unknown>
    | undefined
  return new Error(
    formatCloudflareErrors(
      body?.errors,
      `${path} (${response.status} ${response.statusText})`,
    ),
  )
}

function formatCloudflareErrors(
  errors: CloudflareEnvelope<unknown>['errors'],
  fallback: string,
): string {
  const message = errors
    ?.map(error => error.message?.trim())
    .filter((value): value is string => Boolean(value))
    .join('; ')
  if (message?.toLowerCase().includes('enable r2')) {
    return (
      'Cloudflare R2 is not enabled for this account. Open Storage & databases > R2 ' +
      'in the Cloudflare Dashboard, complete the one-time enablement, then rerun bun run r2:bootstrap.'
    )
  }
  return message
    ? `Cloudflare R2 bootstrap failed: ${message}`
    : `Cloudflare R2 bootstrap failed: ${fallback}`
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim()
  if (!normalized) throw new Error(`${name} is required for R2 bootstrap`)
  return normalized
}

function normalizePublicUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:')
    throw new Error('BEEGAME_R2_DELIVERY_PUBLIC_BASE_URL must use HTTPS')
  return url.toString().replace(/\/$/, '')
}
