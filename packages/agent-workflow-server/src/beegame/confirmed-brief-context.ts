import type { ResourceLibraryUsage } from '@bee-game-studio/beegame-resource-core'

/** Validate confirmed input before use; the chat transcript retains the context. */
export function validateConfirmedBriefContext(value: string): void {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('Confirmed brief context must be valid JSON')
  }
  if (!isRecord(parsed) || parsed.kind !== 'confirmed_build_brief') {
    throw new Error('Confirmed brief context has an invalid kind')
  }
  const resourceLibraryUsage = parseResourceLibraryUsage(parsed.resource_library_usage)
  if (!resourceLibraryUsage) {
    throw new Error('Confirmed brief context has an invalid resource_library_usage')
  }
  const documentLanguage = stringValue(parsed.document_language)
  const gameUserVisibleLanguage = stringValue(parsed.game_user_visible_language)
  const agentResponseLanguage = stringValue(parsed.agent_response_language)
  if (!documentLanguage || !gameUserVisibleLanguage || !agentResponseLanguage) {
    throw new Error('Confirmed brief context must contain explicit response, document, and player-visible languages')
  }
}

function parseResourceLibraryUsage(value: unknown): ResourceLibraryUsage | undefined {
  return value === 'optional' || value === 'preferred' || value === 'required'
    ? value
    : undefined
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
