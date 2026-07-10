import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const VERSION = 'v1'
const IV_BYTES = 12
const KEY_BYTES = 32

export function getSecretEncryptionKey(
  env: Record<string, string | undefined> = process.env,
): Buffer | undefined {
  const encoded = env.BEEGAME_CONFIG_ENCRYPTION_KEY?.trim()
  if (!encoded) {
    if (env.NODE_ENV === 'production') {
      throw new Error('BEEGAME_CONFIG_ENCRYPTION_KEY is required for secret encryption')
    }
    return undefined
  }

  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded)) {
    throw new Error('BEEGAME_CONFIG_ENCRYPTION_KEY must be base64')
  }
  const key = Buffer.from(encoded, 'base64')
  if (key.length !== KEY_BYTES) {
    throw new Error('BEEGAME_CONFIG_ENCRYPTION_KEY must decode to 32 bytes')
  }
  return key
}

export function encryptSecret(secret: string, recordType: string): string {
  const key = getSecretEncryptionKey()
  if (!key) {
    assertPlaintextAllowed()
    return secret
  }

  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(recordType, 'utf8'))
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(secret, 'utf8')),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  return [
    VERSION,
    encodeBase64Url(iv),
    encodeBase64Url(tag),
    encodeBase64Url(ciphertext),
  ].join('.')
}

export function decryptSecret(value: string, recordType: string): string {
  const key = getSecretEncryptionKey()
  if (!/^v\d+\./u.test(value)) {
    if (!key) assertPlaintextAllowed()
    return value
  }
  if (!key) {
    throw new Error('BEEGAME_CONFIG_ENCRYPTION_KEY is required to decrypt a secret')
  }

  const parts = value.split('.')
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Unsupported secret envelope version')
  }
  const iv = decodeBase64Url(parts[1], 'iv')
  const tag = decodeBase64Url(parts[2], 'tag')
  const ciphertext = decodeBase64Url(parts[3], 'ciphertext', true)
  if (iv.length !== IV_BYTES || tag.length !== 16) {
    throw new Error('Malformed secret envelope')
  }

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAAD(Buffer.from(recordType, 'utf8'))
    decipher.setAuthTag(tag)
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    throw new Error('Secret envelope authentication failed')
  }
}

export function isSecretEnvelope(value: string): boolean {
  return /^v\d+\./u.test(value)
}

function assertPlaintextAllowed(): void {
  if (process.env.NODE_ENV === 'production' ||
    process.env.BEEGAME_ALLOW_PLAINTEXT_SECRETS !== '1') {
    throw new Error(
      'Plaintext secrets require BEEGAME_ALLOW_PLAINTEXT_SECRETS=1 outside production',
    )
  }
}

function encodeBase64Url(value: Buffer): string {
  return value.toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '')
}

function decodeBase64Url(
  value: string,
  label: string,
  allowEmpty = false,
): Buffer {
  if ((!allowEmpty && !value) || (value && !/^[A-Za-z0-9_-]+$/u.test(value))) {
    throw new Error(`Malformed secret envelope ${label}`)
  }
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
  try {
    return Buffer.from(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='), 'base64')
  } catch {
    throw new Error(`Malformed secret envelope ${label}`)
  }
}
