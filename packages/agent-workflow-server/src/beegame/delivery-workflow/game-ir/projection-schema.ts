/** Small constructors used by domain manifests for their model-facing value schemas. */
export type ProjectionJsonSchema = Readonly<Record<string, unknown>>

export const projectionText = (description: string): ProjectionJsonSchema =>
  Object.freeze({ type: 'string', minLength: 1, description })
export const projectionFiniteNumber = (
  description: string,
): ProjectionJsonSchema => Object.freeze({ type: 'number', description })
export const projectionInteger = (
  description: string,
  minimum?: number,
): ProjectionJsonSchema =>
  Object.freeze({
    type: 'integer',
    ...(minimum === undefined ? {} : { minimum }),
    description,
  })
export const projectionBoolean = (description: string): ProjectionJsonSchema =>
  Object.freeze({ type: 'boolean', description })
export const projectionEnum = (
  values: readonly string[],
  description: string,
): ProjectionJsonSchema =>
  Object.freeze({ enum: Object.freeze([...values]), description })
export const projectionStringArray = (
  description: string,
): ProjectionJsonSchema =>
  Object.freeze({
    type: 'array',
    items: projectionText('non-empty text'),
    description,
  })
export const projectionNumberArray = (
  description: string,
): ProjectionJsonSchema =>
  Object.freeze({
    type: 'array',
    items: projectionFiniteNumber('finite number'),
    minItems: 1,
    description,
  })
export const projectionArray = (
  items: ProjectionJsonSchema,
  description: string,
  minItems = 1,
): ProjectionJsonSchema =>
  Object.freeze({ type: 'array', items, minItems, description })
export const projectionObject = (
  properties: Readonly<Record<string, ProjectionJsonSchema>>,
  required: readonly string[],
  description: string,
): ProjectionJsonSchema =>
  Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: Object.freeze({ ...properties }),
    required: Object.freeze([...required]),
    description,
  })
/**
 * A schema-owned recursive value.  Definitions live with the manifest field
 * that owns them; the compiler only lifts them into the generated root schema.
 */
export const projectionRecursive = (
  rootName: string,
  definitions: Readonly<Record<string, ProjectionJsonSchema>>,
): ProjectionJsonSchema =>
  Object.freeze({
    $defs: Object.freeze({ ...definitions }),
    $ref: `#/$defs/${rootName}`,
  })

export function projectionValueSchema(
  properties: Readonly<Record<string, ProjectionJsonSchema>>,
  optionalFields: readonly string[] = [],
): ProjectionJsonSchema {
  const actual = Object.keys(properties)
  const optional = new Set(optionalFields)
  for (const field of optional) {
    if (!Object.hasOwn(properties, field))
      throw new Error(`optional projection field ${field} is not declared`)
  }
  return projectionObject(
    properties,
    actual.filter(field => !optional.has(field)),
    'schema-owned node value',
  )
}

export function projectionValueProperties(
  schema: Readonly<Record<string, unknown>>,
): Readonly<Record<string, ProjectionJsonSchema>> {
  const properties = schema.properties
  if (
    !properties ||
    typeof properties !== 'object' ||
    Array.isArray(properties)
  )
    throw new Error('projection value schema must declare properties')
  return properties as Readonly<Record<string, ProjectionJsonSchema>>
}

export function projectionValueRequiredFields(
  schema: Readonly<Record<string, unknown>>,
): readonly string[] {
  const required = schema.required
  if (
    !Array.isArray(required) ||
    !required.every(field => typeof field === 'string')
  )
    throw new Error('projection value schema must declare required fields')
  return Object.freeze([...required])
}

export function projectionValueOptionalFields(
  schema: Readonly<Record<string, unknown>>,
): readonly string[] {
  const properties = projectionValueProperties(schema)
  const required = new Set(projectionValueRequiredFields(schema))
  return Object.freeze(
    Object.keys(properties).filter(field => !required.has(field)),
  )
}

export function projectionValueFields(
  schema: Readonly<Record<string, unknown>>,
): readonly string[] {
  return Object.freeze(Object.keys(projectionValueProperties(schema)))
}
