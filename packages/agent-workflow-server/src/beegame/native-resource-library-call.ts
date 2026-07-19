export const RESOURCE_LIBRARY_ACTIONS = [
  'inspect_project',
  'browse_packs',
  'inspect_pack',
  'index_pack_elements',
  'browse_pack_elements',
  'import_elements',
  'refresh_import_metadata',
  'verify_integration',
] as const

export type ResourceLibraryAction = typeof RESOURCE_LIBRARY_ACTIONS[number]

export type NormalizedResourceLibraryCall = {
  action?: string
  validAction?: ResourceLibraryAction
  input: Record<string, unknown>
  isValidAction: boolean
  isWrapped: boolean
}

/** Normalize direct and ExecuteExtraTool-wrapped ResourceLibrary calls. */
export function normalizeResourceLibraryCall(
  toolName: string,
  toolInput: Record<string, unknown>,
): NormalizedResourceLibraryCall | undefined {
  const isWrapped = toolName === 'ExecuteExtraTool'
  const targetName = isWrapped ? stringField(toolInput, 'tool_name') : toolName
  if (targetName !== 'ResourceLibrary') return undefined

  const input = isWrapped && isRecord(toolInput.params)
    ? toolInput.params
    : toolInput
  const action = stringField(input, 'action') || undefined
  const validAction = action &&
    (RESOURCE_LIBRARY_ACTIONS as readonly string[]).includes(action)
    ? action as ResourceLibraryAction
    : undefined
  return {
    ...(action ? { action } : {}),
    ...(validAction ? { validAction } : {}),
    input,
    isValidAction: Boolean(validAction),
    isWrapped,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringField(value: Record<string, unknown>, key: string): string {
  const field = value[key]
  return typeof field === 'string' ? field.trim() : ''
}
