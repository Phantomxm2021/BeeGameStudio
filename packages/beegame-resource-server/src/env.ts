export type ResourceListenOptions = { host: string; port: number }

export function resolveBeeGameResourceListenOptions(
  env: Record<string, string | undefined> = process.env,
): ResourceListenOptions {
  const parsed = Number.parseInt(env.BEEGAME_RESOURCE_PORT ?? '', 10)
  return {
    host: env.BEEGAME_RESOURCE_HOST?.trim() || '127.0.0.1',
    port: Number.isFinite(parsed) && parsed >= 0 ? parsed : 62177,
  }
}
