import { expect, test } from 'bun:test'
import { createSyntheticOutputTool } from './SyntheticOutputTool'

test('ordinary schemas and inputs pass unchanged, including comments resembling old host metadata', async () => {
  const schema = { type: 'object' as const, $comment: 'beegame-reviewer-json-envelope-v1',
    additionalProperties: false, required: ['value'], properties: { value: { type: 'number' } } }
  const created = createSyntheticOutputTool(schema)
  expect('tool' in created).toBe(true)
  if (!('tool' in created)) throw new Error(created.error)
  expect(created.tool.inputJSONSchema).toBe(schema)
  const input = { value: 3 }
  const result = await created.tool.call(input, {} as any, {} as any, {} as any)
  if (!('structured_output' in result)) throw new Error('Structured output was not returned')
  expect(result.structured_output).toBe(input)
  await expect(created.tool.call({ value: 'invalid', extra: true }, {} as any, {} as any, {} as any))
    .rejects.toThrow('STRUCTURED_OUTPUT_DIAGNOSTIC')
})

test('schema compilation errors remain errors, not a successful output tool', () => {
  const result = createSyntheticOutputTool({ type: 'not-a-json-schema-type' })
  expect('error' in result).toBe(true)
})
