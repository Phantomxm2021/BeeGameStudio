import { describe, expect, test } from 'bun:test'
import { resolveBeeGameBillingConfig } from '../billing-config'

describe('billing configuration', () => {
  test('defaults to disabled without a billing service', () => {
    expect(resolveBeeGameBillingConfig({})).toEqual({ mode: 'disabled' })
  })
})
