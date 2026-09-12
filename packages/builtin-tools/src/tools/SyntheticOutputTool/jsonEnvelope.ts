type Schema = Record<string, any>
const object = (value: unknown): value is Schema => !!value && typeof value === 'object' && !Array.isArray(value)
export const REVIEW_JSON_ENVELOPE = 'beegame-reviewer-json-envelope-v1'

/** Local validation metadata is deliberately NOT exposed as the provider tool schema. */
export function structuredOutputSchemas(schema: Schema): { wire: Schema; content?: Schema } {
  if (schema.$comment !== REVIEW_JSON_ENVELOPE) return { wire: schema }
  const field = schema.properties?.payload_json
  if (schema.type !== 'object' || schema.additionalProperties !== false ||
    !object(schema.properties) || Object.keys(schema.properties).length !== 1 ||
    !Array.isArray(schema.required) || schema.required.length !== 1 || schema.required[0] !== 'payload_json' ||
    !object(field) || field.type !== 'string' || field.contentMediaType !== 'application/json' || !object(field.contentSchema))
    throw new Error('Invalid Reviewer JSON envelope schema')
  const { $comment: _marker, ...root } = schema
  const { contentMediaType: _media, contentSchema: content, ...property } = field
  return { wire: { ...root, properties: { payload_json: property } }, content }
}

export function parseStructuredOutputContent(input: unknown):
  { ok: true; value: unknown } | { ok: false; reason: 'invalid_json' | 'too_large' | 'too_deep' | 'not_object' } {
  const json = object(input) ? input.payload_json : undefined
  if (typeof json !== 'string') return { ok: false, reason: 'invalid_json' }
  if (Buffer.byteLength(json) > 2 * 1024 * 1024) return { ok: false, reason: 'too_large' }
  let depth = 0, quoted = false, escaped = false
  for (const char of json) {
    if (quoted) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
    } else if (char === '"') quoted = true
    else if (char === '{' || char === '[') { if (++depth > 64) return { ok: false, reason: 'too_deep' } }
    else if (char === '}' || char === ']') depth--
  }
  try {
    const value = JSON.parse(json)
    return object(value) ? { ok: true, value } : { ok: false, reason: 'not_object' }
  } catch { return { ok: false, reason: 'invalid_json' } }
}
