import { bgsHomeDirectory } from './home'
import { readFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { BgsClient } from './client'
import { withBgsAccountUse } from './account-activity'
import { getSafeRuntimeProcessEnvironment } from '../beegame/runtime-process-environment'

export const bgsHome = (ownerRoot: string) => bgsHomeDirectory(join(ownerRoot, '.runtime', 'app'))

export async function getDefaultBgsModel(configDirectory: string): Promise<string> {
  return withBgsAccountUse(configDirectory, () => readDefaultBgsModel(configDirectory))
}
async function readDefaultBgsModel(configDirectory: string): Promise<string> {
  const home = bgsHomeDirectory(configDirectory)
  const client = await BgsClient.connect({ cwd: home, env: { ...getSafeRuntimeProcessEnvironment(), BGS_HOME: home }, config: { cli_auth_credentials_store: 'file' } })
  try {
    const result = await client.request('model/list', {})
    const model = result.data?.find((entry: Record<string, unknown>) => entry.isDefault === true)?.model
    if (typeof model !== 'string' || !model) throw Error('Select an available model')
    return model
  } finally { await client.close() }
}

/** Refresh through the official client and keep credentials in the same
 * owner-private home used by coding sessions. Never read the operator's login. */
const refreshing = new Map<string, Promise<{ accessToken: string; accountId: string | undefined }>>()
export function getValidChatGPTAuth(configDirectory: string) {
  if (!configDirectory) return Promise.reject(Error('An owner-specific ChatGPT configuration directory is required'))
  const root = resolve(configDirectory), current = refreshing.get(root)
  if (current) return current
  const pending = withBgsAccountUse(root, () => readChatGPTAuth(root)).finally(() => refreshing.delete(root))
  refreshing.set(root, pending)
  return pending
}
async function readChatGPTAuth(configDirectory: string) {
  const home = bgsHomeDirectory(configDirectory)
  const stored = JSON.parse(await readFile(join(home, 'auth.json'), 'utf8'))
  const accessToken = stored.tokens?.access_token
  if (typeof accessToken !== 'string' || !stored.tokens?.refresh_token) throw Error('Connect your ChatGPT account first')
  let expiry = 0
  try { expiry = JSON.parse(Buffer.from(accessToken.split('.')[1]!, 'base64url').toString()).exp * 1000 }
  catch { /* The official client handles opaque/expired credentials below. */ }
  if (Number.isFinite(expiry) && expiry > Date.now() + 5 * 60_000)
    return { accessToken, accountId: stored.tokens.account_id as string | undefined }
  const client = await BgsClient.connect({ cwd: home,
    env: { ...getSafeRuntimeProcessEnvironment(), BGS_HOME: home },
    config: { cli_auth_credentials_store: 'file' } })
  try {
    const account = await client.request('account/read', { refreshToken: true })
    if (account.account?.type !== 'chatgpt') throw Error('Connect your ChatGPT account first')
    const auth = JSON.parse(await readFile(join(home, 'auth.json'), 'utf8'))
    if (typeof auth.tokens?.access_token !== 'string' || !auth.tokens.access_token) throw Error('ChatGPT credentials are unavailable')
    return { accessToken: auth.tokens.access_token as string, accountId: auth.tokens.account_id as string | undefined }
  } finally { await client.close() }
}

export async function createChatGPTResponsesStream(input: {
  request: Record<string, unknown>; signal: AbortSignal; configDirectory: string; fetchOverride?: typeof fetch
}): Promise<AsyncIterable<Record<string, any>>> {
  const auth = await getValidChatGPTAuth(input.configDirectory)
  const response = await (input.fetchOverride ?? fetch)('https://chatgpt.com/backend-api/codex/responses', {
    method: 'POST', redirect: 'error', signal: input.signal,
    headers: { Authorization: 'Bearer ' + auth.accessToken, 'Content-Type': 'application/json', Accept: 'text/event-stream',
      ...(auth.accountId ? { 'ChatGPT-Account-Id': auth.accountId } : {}), originator: 'bee_game_studio' },
    body: JSON.stringify(input.request),
  })
  if (!response.ok) { await response.body?.cancel(); throw Object.assign(Error(`ChatGPT request failed (${response.status})`), { status: response.status }) }
  return parseEvents(response)
}

async function* parseEvents(response: Response): AsyncIterable<Record<string, any>> {
  if (!response.body) throw Error('Missing response stream')
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let buffer = '', data: string[] = []
  try {
    while (true) {
      const chunk = await reader.read()
      buffer += decoder.decode(chunk.value, { stream: !chunk.done })
      let end: number
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).replace(/\r$/, ''); buffer = buffer.slice(end + 1)
        if (!line && data.length) {
          const event = data.join('\n'); data = []
          if (event === '[DONE]') return
          yield JSON.parse(event)
        } else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
      }
      if (chunk.done) { if (buffer.trim() || data.length) throw Error('Truncated response stream'); return }
      if (buffer.length > 64 * 1024 * 1024) throw Error('Response event exceeds the image response limit')
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}
