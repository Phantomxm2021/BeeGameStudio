export type MaterialTextureBindings = Record<string, { baseColor?: string }>

export function decodeMaterialTextureBindings(value: unknown): MaterialTextureBindings {
  if (typeof value !== 'string' || !value) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).flatMap(([material, binding]) => {
      if (!binding || typeof binding !== 'object' || Array.isArray(binding)) return []
      const baseColor = (binding as Record<string, unknown>).baseColor
      return typeof baseColor === 'string' && baseColor ? [[material, { baseColor }]] : []
    }))
  } catch { return {} }
}

export function encodeMaterialTextureBindings(bindings: MaterialTextureBindings): string {
  return JSON.stringify(Object.fromEntries(Object.entries(bindings).flatMap(([material, binding]) =>
    binding.baseColor ? [[material, { baseColor: binding.baseColor }]] : [],
  )))
}
