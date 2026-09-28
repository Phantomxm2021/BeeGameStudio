/** Public artifact sharing is opt-in to an operator-owned Bee Game Studio endpoint. */
export const BEEGAME_ARTIFACTS_URL_ENV = 'BEEGAME_ARTIFACTS_URL'
export const BEEGAME_ARTIFACTS_TOKEN_ENV = 'BEEGAME_ARTIFACTS_TOKEN'

export function getArtifactsToken(): string {
  const token = process.env[BEEGAME_ARTIFACTS_TOKEN_ENV]?.trim()
  if (!token) throw new Error(`${BEEGAME_ARTIFACTS_TOKEN_ENV} is not configured; no artifact was uploaded.`)
  return token
}

export function getArtifactsBaseUrl(): string {
  const value = process.env[BEEGAME_ARTIFACTS_URL_ENV]?.trim()
  if (!value) throw new Error(`${BEEGAME_ARTIFACTS_URL_ENV} is not configured; no artifact was uploaded.`)
  const url = new URL(value)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))
    throw new Error(`${BEEGAME_ARTIFACTS_URL_ENV} must use HTTPS (or local HTTP).`)
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error(`${BEEGAME_ARTIFACTS_URL_ENV} must be an origin without credentials or a path.`)
  return url.origin
}

/** Strip trailing slash so `${base}/upload` is well-formed. */
export function getUploadUrl(): string {
  return `${getArtifactsBaseUrl()}/upload`
}
