import { describe, expect, test } from 'bun:test'
import { getWriteToolDescription } from '../prompt'

describe('native large-file authoring guidance', () => {
  test('keeps checkpoint decisions native without a fixed studio limit', () => {
    const description = getWriteToolDescription()

    expect(description).toContain('For a long file')
    expect(description).toContain('small stable scaffold')
    expect(description).toContain('Edit tool')
    expect(description).not.toMatch(/8,?192|maximum \d+ characters|bounded append/i)
  })
})
