export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function record(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

export function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.some(item => !stringValue(item)))
    return undefined
  return value as string[]
}

export function sameStrings(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}
