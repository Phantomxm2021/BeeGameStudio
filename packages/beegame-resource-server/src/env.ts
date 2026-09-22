import { resolveFixedServicePort } from '../../agent-workflow-server/src/beegame/fixed-service-ports'

export type ResourceListenOptions = { host: string; port: number }

/** Keep catalog/download service available while background processing is paused. */
export function resourceProcessingEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const value = env.BEEGAME_RESOURCE_PROCESSING_ENABLED?.trim()
  if (value !== undefined && value !== '0' && value !== '1')
    throw new Error('BEEGAME_RESOURCE_PROCESSING_ENABLED must be 0 or 1')
  return value !== '0'
}

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
  return {
    host: env.BEEGAME_RESOURCE_HOST?.trim() || '127.0.0.1',
    port: resolveFixedServicePort('resources', env.BEEGAME_RESOURCE_PORT),
  }
}
