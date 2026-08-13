import { describe, expect, test } from 'bun:test'
import { shouldEnableFineGrainedToolStreaming } from '../api.js'

describe('fine-grained tool input streaming capability', () => {
  test('honors an explicit native opt-in on an Anthropic-compatible custom endpoint', () => {
    expect(
      shouldEnableFineGrainedToolStreaming({
        provider: 'firstParty',
        firstPartyBaseUrl: false,
        featureEnabled: false,
        explicitlyEnabled: true,
      }),
    ).toBe(true)
  })

  test('does not send the beta field to an unconfigured custom endpoint', () => {
    expect(
      shouldEnableFineGrainedToolStreaming({
        provider: 'firstParty',
        firstPartyBaseUrl: false,
        featureEnabled: true,
        explicitlyEnabled: false,
      }),
    ).toBe(false)
  })
})
