/** Public artifact sharing requires an explicitly configured endpoint. */
export const ARTIFACTS_URL_ENV = 'CLAUDE_ARTIFACTS_URL'
export const ARTIFACTS_TOKEN_ENV = 'CLAUDE_ARTIFACTS_TOKEN'

export function getArtifactsToken(): string {
  const token = process.env[ARTIFACTS_TOKEN_ENV]?.trim()
  if (!token) throw new Error(`${ARTIFACTS_TOKEN_ENV} is not configured; no artifact was uploaded.`)
  return token
}

export function getArtifactsBaseUrl(): string {
  const value = process.env[ARTIFACTS_URL_ENV]?.trim()
  if (!value) throw new Error(`${ARTIFACTS_URL_ENV} is not configured; no artifact was uploaded.`)
  const url = new URL(value)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))
    throw new Error(`${ARTIFACTS_URL_ENV} must use HTTPS (or local HTTP).`)
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error(`${ARTIFACTS_URL_ENV} must be an origin without credentials or a path.`)
  return url.origin
}

/** Strip trailing slash so `${base}/upload` is well-formed. */
export function getUploadUrl(): string {
  return `${getArtifactsBaseUrl()}/upload`
}
