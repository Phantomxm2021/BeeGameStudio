import { describe, expect, test } from 'bun:test'
import { validateOutboundTarget } from '../security/outbound-target-policy'

const publicResolvers = {
  resolve4: async () => ['93.184.216.34'],
  resolve6: async () => ['2606:2800:220:1:248:1893:25c8:1946'],
}

describe('validateOutboundTarget', () => {
  test('rejects loopback IPv4 targets', async () => {
    await expect(validateOutboundTarget('https://127.0.0.1/api', publicResolvers))
      .resolves.toBe(false)
  })

  test('rejects link-local IPv4 targets', async () => {
    await expect(validateOutboundTarget('https://169.254.169.254/latest', publicResolvers))
      .resolves.toBe(false)
  })

  test('rejects IPv4-mapped IPv6 loopback targets', async () => {
    await expect(validateOutboundTarget('https://[::ffff:7f00:1]/api', publicResolvers))
      .resolves.toBe(false)
  })

  test.each([
    'https://[::127.0.0.1]/api',
    'https://[::10.0.0.1]/api',
    'https://[::c0a8:1]/api',
  ])('rejects IPv4-compatible IPv6 private targets: %s', async target => {
    await expect(validateOutboundTarget(target, publicResolvers)).resolves.toBe(false)
  })

  test('rejects non-HTTP URL schemes', async () => {
    await expect(validateOutboundTarget('file:///etc/passwd', publicResolvers))
      .resolves.toBe(false)
  })

  test('accepts a normal HTTPS URL after injected public DNS resolution', async () => {
    await expect(validateOutboundTarget('https://api.example.test/v1', publicResolvers))
      .resolves.toBe(true)
  })
})
