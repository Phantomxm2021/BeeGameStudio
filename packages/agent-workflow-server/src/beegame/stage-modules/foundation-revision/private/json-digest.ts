import { createHash } from 'node:crypto'

/** Public handoff encoding only; a digest does not grant producer authority. */
export function revisionCanonicalJson(value: unknown): string {
  const active = new Set<object>()
  function encode(item: unknown): string {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item)
    if (typeof item === 'number' && Number.isFinite(item)) return JSON.stringify(item)
    if (!item || typeof item !== 'object' || active.has(item)) throw new Error('Revision handoff requires finite acyclic JSON')
    active.add(item)
    try {
      const descriptors = Object.getOwnPropertyDescriptors(item)
      if (Object.values(descriptors).some(descriptor => !('value' in descriptor)))
        throw new Error('Revision handoff cannot contain accessors')
      if (Object.getOwnPropertyNames(item).some(key => !(Array.isArray(item) && key === 'length') && !descriptors[key]!.enumerable))
        throw new Error('Revision handoff cannot contain hidden fields')
      if (Array.isArray(item)) {
        if (Object.keys(item).length !== item.length || Array.from({ length: item.length }, (_, index) => index).some(index => !Object.hasOwn(item, index)))
          throw new Error('Revision handoff arrays must be dense JSON')
        if (Object.getOwnPropertySymbols(item).length) throw new Error('Revision handoff cannot contain symbol keys')
        return '[' + item.map(encode).join(',') + ']'
      }
      if (Object.getPrototypeOf(item) !== Object.prototype || Object.getOwnPropertySymbols(item).length)
        throw new Error('Revision handoff requires plain JSON objects')
      return '{' + Object.keys(item).sort().map(key => JSON.stringify(key) + ':' + encode((item as Record<string, unknown>)[key])).join(',') + '}'
    } finally { active.delete(item) }
  }
  return encode(value)
}

export const revisionDigest = (value: unknown) => createHash('sha256').update(revisionCanonicalJson(value)).digest('hex')
export const revisionBytesDigest = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')
