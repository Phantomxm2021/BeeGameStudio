import { expect, test } from 'bun:test'
import { createResponseRedactor } from '../native-response-trace'

test('credentials are removed from nested tool arguments and bearer headers', () => {
  const redact = createResponseRedactor({ ANTHROPIC_AUTH_TOKEN: 'full-known-token' })
  const result = JSON.stringify(redact({ input: { password: 'unknown-password', nested: { api_key: 'unknown-key' },
    command: 'curl -H "Authorization: Bearer full-known-token"', content: 'ordinary design text' } }))
  expect(result).not.toContain('unknown-password')
  expect(result).not.toContain('unknown-key')
  expect(result).not.toContain('full-known-token')
  expect(result).toContain('ordinary design text')
})

test('configured secrets and partial values are redacted while ordinary tool content remains visible', () => {
  const redact = createResponseRedactor({ OPENAI_API_KEY: 'secret-token-123456' })
  expect(redact('# Asset Inventory\nkey: secret-token-')).not.toContain('secret-token-')
  const text = redact('# Asset Inventory\nkey: secret-token-123456\napi_key=other-secret')
  expect(text).not.toContain('secret-token-123456')
  expect(text).not.toContain('other-secret')
  expect(text).toContain('# Asset Inventory')
})
