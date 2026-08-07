export type ResourceListenOptions = { host: string; port: number }

export type ResourceSemanticRuntimeOptions = {
  configured: boolean
  runtimeServerUrl?: string
  serviceToken?: string
  curatorRevision: string
}

export function resolveBeeGameResourceSemanticRuntimeOptions(
  env: Record<string, string | undefined> = process.env,
): ResourceSemanticRuntimeOptions {
  const runtimeServerUrl = env.BEEGAME_RUNTIME_SERVER_URL?.trim() || ''
  const serviceToken = env.BEEGAME_RESOURCE_SERVICE_TOKEN?.trim() || ''
  const curatorRevision = env.BEEGAME_RESOURCE_SEMANTIC_CURATOR_REVISION?.trim() || 'semantic-curator-v1'
  if (!runtimeServerUrl && !serviceToken) return { configured: false, curatorRevision }
  if (!runtimeServerUrl || !serviceToken) return { configured: false, curatorRevision }
  let parsed: URL
  try {
    parsed = new URL(runtimeServerUrl)
  } catch {
    return { configured: false, curatorRevision }
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) {
    return { configured: false, curatorRevision }
  }
  return { configured: true, runtimeServerUrl: parsed.toString(), serviceToken, curatorRevision }
}

export function resolveBeeGameResourceListenOptions(
  env: Record<string, string | undefined> = process.env,
): ResourceListenOptions {
  const parsed = Number.parseInt(env.BEEGAME_RESOURCE_PORT ?? '', 10)
  return {
    host: env.BEEGAME_RESOURCE_HOST?.trim() || '127.0.0.1',
    port: Number.isFinite(parsed) && parsed >= 0 ? parsed : 62177,
  }
}
