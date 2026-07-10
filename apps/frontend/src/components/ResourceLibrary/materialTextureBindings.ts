export type MaterialTextureBindings = Record<string, { baseColor?: string }>

type TextureCandidate = { id: string; name: string; kind: string; category: string }

const baseColorTerms = new Set(['albedo', 'basecolor', 'base', 'color', 'diffuse', 'diff'])
const nonColorTerms = new Set(['normal', 'nrm', 'roughness', 'rough', 'metallic', 'metalness', 'ao', 'occlusion', 'height', 'displacement', 'specular', 'emissive', 'opacity', 'mask'])

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

export function suggestMaterialTextureCandidates(modelName: string, materialSlots: readonly string[], candidates: readonly TextureCandidate[]): Record<string, string[]> {
  const modelTokens = tokens(modelName)
  const textures = candidates.filter(candidate => candidate.kind === 'image' || candidate.category === 'textures')
  return Object.fromEntries(materialSlots.map(material => [material, textures
    .map(texture => ({ id: texture.id, score: textureScore(modelTokens, tokens(material), tokens(texture.name)) }))
    .filter(candidate => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .map(candidate => candidate.id),
  ]))
}

export function automaticallyBindBaseColorTextures(modelName: string, materialSlots: readonly string[], candidates: readonly TextureCandidate[], current: MaterialTextureBindings = {}): MaterialTextureBindings {
  const suggestions = suggestMaterialTextureCandidates(modelName, materialSlots, candidates)
  return Object.fromEntries(materialSlots.flatMap(material => {
    const existing = current[material]?.baseColor
    const candidate = suggestions[material]?.[0]
    return existing ? [[material, { baseColor: existing }]] : candidate ? [[material, { baseColor: candidate }]] : []
  }))
}

function tokens(name: string): string[] {
  return name.replace(/\.[^.]+$/, '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
}

function textureScore(modelTokens: readonly string[], materialTokens: readonly string[], textureTokens: readonly string[]): number {
  if (textureTokens.some(token => nonColorTerms.has(token))) return 0
  const textureTokenSet = new Set(textureTokens)
  const shared = new Set([...modelTokens, ...materialTokens]).size === 0 ? 0 : [...new Set([...modelTokens, ...materialTokens])].filter(token => textureTokenSet.has(token)).length
  const hasBaseColorTerm = textureTokens.some(token => baseColorTerms.has(token))
  return shared * 10 + (hasBaseColorTerm ? 4 : 0)
}
