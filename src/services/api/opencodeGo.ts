import { OPENCODE_GO_PROFILES } from '../../../packages/agent-workflow/src/opencode-go.js'

export function isOpenCodeGoBaseUrl(baseUrl: string | undefined): boolean {
  return !!baseUrl && Object.values(OPENCODE_GO_PROFILES).some(profile => baseUrl.replace(/\/$/, '') === profile.baseUrl)
}

export function getOpenCodeGoHeaders(baseUrl: string | undefined, sessionId: string): Record<string, string> {
  if (!isOpenCodeGoBaseUrl(baseUrl)) return {}
  return { 'User-Agent': `bee-game-studio/${MACRO.VERSION}`, 'X-Opencode-Session': sessionId }
}
