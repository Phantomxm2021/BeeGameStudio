export function decodeStyleOverride(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (Array.isArray(parsed)) return uniqueStrings(parsed)
  } catch { /* legacy form below */ }
  return uniqueStrings(value.split('/'))
}

export function encodeStyleOverride(styles: readonly string[]): string | null {
  const normalized = uniqueStrings(styles).sort((left, right) => left.localeCompare(right))
  return normalized.length ? JSON.stringify(normalized) : null
}

export function packStyleOptions(packStyle: string, customStyles: readonly string[] = []): string[] {
  return uniqueStrings([...decodeStyleOverride(packStyle), ...customStyles])
}

function uniqueStrings(values: readonly unknown[]): string[] {
  return [...new Set(values.flatMap(value => typeof value === 'string' ? [value.trim()] : []).filter(Boolean))]
}
