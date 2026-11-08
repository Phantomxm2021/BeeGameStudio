export type ResourceSelectionRuntimeConfig = {
  baseUrl: string
  serviceToken?: string
}

/**
 * Keep the workflow/resource-service trust boundary explicit. A partially
 * configured client would otherwise turn asset integration into a delayed 503
 * after an Agent has already generated project work.
 */
export function resolveResourceSelectionRuntimeConfig(env: Record<string, string | undefined> = process.env): ResourceSelectionRuntimeConfig | undefined {
  const baseUrl = env.BEEGAME_RESOURCE_SERVER_URL?.trim()
  const serviceToken = env.BEEGAME_RESOURCE_SERVICE_TOKEN?.trim()
  const isProduction = env.NODE_ENV === 'production'
  const local = env.BEEGAME_WORKFLOW_V3_STORE === 'local-single-process'
  if (serviceToken && !baseUrl || baseUrl && !serviceToken && !local) {
    throw new Error('BEEGAME_RESOURCE_SERVER_URL and BEEGAME_RESOURCE_SERVICE_TOKEN must be configured together')
  }
  if (!baseUrl) {
    if (isProduction && !local) throw new Error('Resource selection configuration is required in production')
    return undefined
  }
  if (!/^https?:\/\//i.test(baseUrl)) throw new Error('BEEGAME_RESOURCE_SERVER_URL must be an HTTP(S) URL')
  return { baseUrl, ...(serviceToken ? { serviceToken } : {}) }
}
