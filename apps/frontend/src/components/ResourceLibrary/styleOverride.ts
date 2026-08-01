export function decodeStyleOverride(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (Array.isArray(parsed)) return uniqueStrings(parsed)
  } catch {
    return []
  }
  return []
}

export function encodeStyleOverride(styles: readonly string[]): string | null {
  const normalized = uniqueStrings(styles).sort((left, right) => left.localeCompare(right))
  return normalized.length ? JSON.stringify(normalized) : null
}

export function packStyleOptions(
  packStyles: readonly string[], customStyles: readonly string[] = []): string[] {
  return uniqueStrings([...packStyles, ...customStyles])
}

function uniqueStrings(values: readonly unknown[]): string[] {
  return [...new Set(values.flatMap(value => (typeof value === 'string' ? [value.trim()] : []))
        .filter(Boolean))]
}
