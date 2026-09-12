import type { ErrorObject } from 'ajv'

type Schema = Record<string, any>
const object = (value: unknown): value is Schema => !!value && typeof value === 'object' && !Array.isArray(value)
const pointer = (key: string) => key.replace(/~/g, '~0').replace(/\//g, '~1')

/** Select diagnostics only; the caller must still validate against the full, unchanged schema. */
export function focusSchemaErrors(schema: Schema, input: unknown, errors: readonly ErrorObject[]): ErrorObject[] {
  const excluded: { schema: string; instance: string; referenced: boolean }[] = []
  // Ajv can report a local reference relative to its definition or its compiled root.
  const normalize = (path: string) => path.replace(/^#\/(?:definitions|\$defs)\/[^/]+(?=\/)/, '#')
  const summaries = new Set<string>()
  let visits = 0
  // A recursive definition's paths are reused at deeper input positions. Exclude
  // only this instance's local properties, stopping before another reference.
  function excludeLocal(node: Schema, value: unknown, schemaPath: string, instance: string, depth: number) {
    if (++visits > 4096 || depth > 64 || node.$ref) return
    excluded.push({ schema: normalize(schemaPath), instance, referenced: true })
    if (object(value)) for (const [key, child] of Object.entries(node.properties ?? {}))
      if (Object.hasOwn(value, key) && object(child)) excludeLocal(child, value[key], schemaPath + '/properties/' + pointer(key), instance + '/' + pointer(key), depth + 1)
    if (Array.isArray(value) && object(node.items)) value.slice(0, 512).forEach((child, index) =>
      excludeLocal(node.items, child, schemaPath + '/items', instance + '/' + index, depth + 1))
  }
  function visit(node: Schema, value: unknown, schemaPath: string, instance: string, depth: number) {
    if (++visits > 4096 || depth > 64) return
    if (typeof node.$ref === 'string' && node.$ref.startsWith('#/')) {
      const target = node.$ref.slice(2).split('/').reduce((part: any, key: string) => part?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], schema)
      if (object(target)) visit(target, value, node.$ref, instance, depth + 1)
      return
    }
    for (const union of ['oneOf', 'anyOf']) {
      if (!Array.isArray(node[union])) continue
      const branches: Schema[] = node[union]
      const typed = branches.map((branch, index) => branch.type === (Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value) ? index : -1).filter(index => index >= 0)
      // Recursive number-or-expression unions can have multiple object branches
      // distinguished by disjoint operator enums. Select diagnostics only; never
      // change the validator, schema or original arguments.
      const candidates = typed.length ? typed : branches.map((_, index) => index)
      const tags = object(value) ? Object.keys(branches[candidates[0]!]?.properties ?? {}).filter(key => Object.hasOwn(value, key) &&
        candidates.every(index => {
          const tag = branches[index]!.properties?.[key]
          return object(tag) && (Object.hasOwn(tag, 'const') || Array.isArray(tag.enum))
        })) : []
      const tagged = object(value) && tags.length ? candidates.filter(index => tags.every(key => {
        const tag = branches[index]!.properties[key]
        return Object.hasOwn(tag, 'const') ? value[key] === tag.const : tag.enum.includes(value[key])
      })) : []
      const selected = tagged.length === 1 ? tagged[0] : typed.length === 1 ? typed[0] : undefined
      if (selected !== undefined) {
        summaries.add(normalize(schemaPath + '/' + union) + '|' + instance)
        branches.forEach((branch, index) => {
          const path = schemaPath + '/' + union + '/' + index
          if (index !== selected) {
            const referenced = /^#\/(?:definitions|\$defs)\//.test(path)
            excluded.push({ schema: normalize(path), instance, referenced })
            if (referenced) excludeLocal(branch, value, path, instance, depth + 1)
          }
          else visit(branch, value, path, instance, depth + 1)
        })
      }
    }
    if (object(value)) for (const [key, child] of Object.entries(node.properties ?? {}))
      if (Object.hasOwn(value, key) && object(child)) visit(child, value[key], schemaPath + '/properties/' + pointer(key), instance + '/' + pointer(key), depth + 1)
    if (Array.isArray(value) && object(node.items)) value.slice(0, 512).forEach((child, index) =>
      visit(node.items, child, schemaPath + '/items', instance + '/' + index, depth + 1))
  }
  visit(schema, input, '#', '', 0)
  const filtered = errors.filter(error => !summaries.has(normalize(error.schemaPath) + '|' + error.instancePath) && !excluded.some(rule =>
    (normalize(error.schemaPath) === rule.schema || normalize(error.schemaPath).startsWith(rule.schema + '/')) &&
    (error.instancePath === rule.instance || !rule.referenced && error.instancePath.startsWith(rule.instance + '/'))))
  const unique = new Map((filtered.length ? filtered : errors).map(error =>
    [JSON.stringify([error.instancePath, error.schemaPath, error.keyword, error.params]), error]))
  return [...unique.values()]
}
