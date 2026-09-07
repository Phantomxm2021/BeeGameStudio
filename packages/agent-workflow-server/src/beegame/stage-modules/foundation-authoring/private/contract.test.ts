import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { authorDigest, canonicalAuthorJson, parseAuthorConfiguration, parseAuthorStart } from './contract'

function input() {
  const body = { confirmedBrief: 'A fixed test brief', confirmedBriefDigest: createHash('sha256').update('A fixed test brief').digest('hex') }
  return { protocolVersion: 1 as const, requestId: 'request-1', ownerId: 'owner', projectId: 'project', input: body, inputDigest: authorDigest({ ownerId: 'owner', projectId: 'project', input: body }) }
}
describe('private author public-boundary validation', () => {
  test('canonical JSON does not depend on object insertion order', () => {
    expect(authorDigest({ b: [2, 1], a: 1 })).toBe(authorDigest({ a: 1, b: [2, 1] }))
    expect(authorDigest([2, 1])).not.toBe(authorDigest([1, 2]))
    expect(() => canonicalAuthorJson({ a: undefined })).toThrow()
    expect(() => canonicalAuthorJson(NaN)).toThrow()
  })
  test('binds brief bytes and project identity', () => {
    const value = input()
    expect(parseAuthorStart(value)).toEqual(value)
    expect(() => parseAuthorStart({ ...value, ownerId: 'another' })).toThrow('input digest mismatch')
    expect(() => parseAuthorStart({ ...value, input: { ...value.input, confirmedBrief: 'changed' } })).toThrow('brief digest mismatch')
  })
  test('rejects full workflow state, callbacks and unknown nested fields', () => {
    const value = input()
    expect(() => parseAuthorStart({ ...value, foundationDraftState: {} })).toThrow()
    expect(() => parseAuthorStart({ ...value, input: { ...value.input, run: {} } })).toThrow()
    expect(() => parseAuthorConfiguration({ workspacePath: '/tmp/work', privateRootPath: '/tmp/state', model: { command: ['cli'], env: {} }, runner: () => {} })).toThrow()
    expect(() => parseAuthorConfiguration({ workspacePath: '../work', privateRootPath: '/tmp/state', model: { command: ['cli'], env: {} } })).toThrow()
  })
  test('does not retain caller-owned values', () => {
    const value = input()
    const parsed = parseAuthorStart(value)
    value.input.confirmedBrief = 'mutated'
    expect(parsed.input.confirmedBrief).toBe('A fixed test brief')
    const config = { workspacePath: '/tmp/work', privateRootPath: '/tmp/state', model: { command: ['cli'], env: { SECRET: 'private' } } }
    const parsedConfig = parseAuthorConfiguration(config)
    config.model.command.push('mutated')
    config.model.env.SECRET = 'changed'
    expect(parsedConfig.model.command).toEqual(['cli'])
    expect(parsedConfig.model.env.SECRET).toBe('private')
  })
})
