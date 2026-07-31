export const RESOURCE_LIBRARY_ACTIONS = [
  'browse_packs',
  'inspect_pack',
  'index_pack_elements',
  'import_elements',
  'refresh_import_metadata',
] as const

export type ResourceLibraryAction = (typeof RESOURCE_LIBRARY_ACTIONS)[number]

export type NormalizedResourceLibraryCall = {
  action?: string
  validAction?: ResourceLibraryAction
  input: Record<string, unknown>
  isValidAction: boolean
}

/** Validate the one native ResourceLibrary call lane. */
export function normalizeResourceLibraryCall(
  toolName: string,
  toolInput: Record<string, unknown>,
): NormalizedResourceLibraryCall | undefined {
  if (toolName !== 'ResourceLibrary') return undefined
  const input = toolInput
  const action = stringField(input, 'action') || undefined
  const validAction =
    action && (RESOURCE_LIBRARY_ACTIONS as readonly string[]).includes(action)
      ? (action as ResourceLibraryAction)
      : undefined
  return {
    ...(action ? { action } : {}),
    ...(validAction ? { validAction } : {}),
    input,
    isValidAction: Boolean(validAction),
  }
}

function stringField(value: Record<string, unknown>, key: string): string {
  const field = value[key]
  return typeof field === 'string' ? field.trim() : ''
}
