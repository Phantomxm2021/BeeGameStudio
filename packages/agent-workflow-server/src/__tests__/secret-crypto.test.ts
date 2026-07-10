import { afterEach, describe, expect, test } from 'bun:test'
import {
  decryptSecret,
  encryptSecret,
  getSecretEncryptionKey,
} from '../security/secret-crypto'

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
})

describe('secret crypto', () => {
  test('round-trips an exact v1 AES-256-GCM envelope', () => {
    process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
    const envelope = encryptSecret('generated-test-secret', 'model.apiKey')

    expect(envelope.split('.')).toHaveLength(4)
    expect(envelope.startsWith('v1.')).toBe(true)
    expect(decryptSecret(envelope, 'model.apiKey')).toBe('generated-test-secret')
  })

  test('rejects tampering and an incorrect record type', () => {
    process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64')
    const envelope = encryptSecret('generated-test-secret', 'mcp.env')
    const parts = envelope.split('.')
    parts[3] = `${parts[3][0] === 'A' ? 'B' : 'A'}${parts[3].slice(1)}`

    expect(() => decryptSecret(parts.join('.'), 'mcp.env')).toThrow()
    expect(() => decryptSecret(envelope, 'model.apiKey')).toThrow()
  })

  test('rejects unknown versions', () => {
    process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString('base64')
    expect(() => decryptSecret('v2.a.b.c', 'model.apiKey')).toThrow(/version/i)
  })

  test('requires a valid key in production', () => {
    process.env.NODE_ENV = 'production'
    delete process.env.BEEGAME_CONFIG_ENCRYPTION_KEY
    delete process.env.BEEGAME_ALLOW_PLAINTEXT_SECRETS

    expect(() => getSecretEncryptionKey()).toThrow(/encryption.*key/i)
    expect(() => encryptSecret('generated-test-secret', 'model.apiKey')).toThrow(/encryption.*key/i)
  })

  test('rejects malformed key material', () => {
    process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = 'not-base64-key'
    expect(() => getSecretEncryptionKey()).toThrow(/base64|32 bytes/i)
  })

  test('allows plaintext only with the explicit local flag', () => {
    process.env.NODE_ENV = 'development'
    delete process.env.BEEGAME_CONFIG_ENCRYPTION_KEY
    process.env.BEEGAME_ALLOW_PLAINTEXT_SECRETS = '1'

    expect(encryptSecret('generated-test-secret', 'model.apiKey')).toBe('generated-test-secret')
    expect(decryptSecret('legacy-test-secret', 'model.apiKey')).toBe('legacy-test-secret')
  })
})
