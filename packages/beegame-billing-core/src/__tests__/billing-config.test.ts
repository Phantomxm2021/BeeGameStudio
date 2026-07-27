import { describe, expect, test } from 'bun:test'
import { resolveBeeGameBillingConfig } from '../billing-config'

describe('billing configuration', () => {
  test('defaults usage billing to realtime mode', () => {
    expect(resolveBeeGameBillingConfig({})).toMatchObject({
      mode: 'disabled',
      usageBillingMode: 'realtime',
    })
  })

  test('always uses realtime mode after the migration', () => {
    expect(
      resolveBeeGameBillingConfig({ BEEGAME_USAGE_BILLING_MODE: 'shadow' }),
    ).toMatchObject({ usageBillingMode: 'realtime' })
    expect(
      resolveBeeGameBillingConfig({ BEEGAME_USAGE_BILLING_MODE: 'dual' }),
    ).toMatchObject({ usageBillingMode: 'realtime' })
  })
})
